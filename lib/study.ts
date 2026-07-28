import { canonicalWordId } from "./redbook.ts";
import {
  averageRetrievability,
  rebuildStubbornWords,
  rebuildWordProgress,
  type Rating,
  type ReviewEvent,
  type SerializedFsrsCard,
  type StubbornWordMap,
  type StubbornWordRecord,
  type StudySession,
  type WordEnrichment,
  type WordProgress,
  type WordProgressMap,
} from "./learning.ts";

export type {
  Rating,
  ReviewEvent,
  StudySession,
  WordEnrichment,
  WordProgress,
  WordProgressMap,
} from "./learning.ts";

export type WordRelation = {
  kind: "grammar" | "lexicalized" | "pronoun" | "derived" | "contrast" | "inflection" | "variant";
  label: string;
  note: string;
  lemmaId?: number;
  lemma?: string;
  canonicalId: number;
  independent: boolean;
  confidence: "confirmed" | "source-confirmed";
};

export type Word = {
  word: string;
  phonetic?: string;
  part?: string;
  meaning: string;
  sentence?: string;
  translation?: string;
  collocation?: string;
  root?: string;
  family?: string;
  level?: string;
  id?: number;
  section?: string;
  unit?: number | string;
  sourcePage?: number;
  relation?: WordRelation;
};

export type Review = ReviewEvent;

export type SavedWord = {
  wordId: number;
  addedAt: string;
};

export type MistakeRecord = SavedWord & {
  mistakeCount: number;
  lastRating: number;
  lastMistakeAt: string;
};

export type StudyMode = "ordered" | "shuffled";
export type StudyScope = "selection" | "all";
export type StudyPositions = Record<string, number>;

export type StoredState = {
  schemaVersion: 5;
  reviews: Review[];
  wordProgress: WordProgressMap;
  favorites: SavedWord[];
  mistakes: MistakeRecord[];
  stubbornWords: StubbornWordMap;
  positions: StudyPositions;
  activeSession?: StudySession;
  enrichments: Record<number, WordEnrichment>;
  started: boolean;
  dailyGoal: number;
  adaptiveNewWords: boolean;
  minimumNewWords: number;
  examDate: string;
  soundOn: boolean;
  studyMode: StudyMode;
  studyScope: StudyScope;
  shuffleSeed: number;
  selectedSection: string;
  selectedUnit: number | string | "all";
};

export const STORAGE_KEY = "wordloop-state";
export const STORAGE_VERSION = 5;
export const MAX_REVIEWS = 10000;
export const REDBOOK_SECTIONS = ["必考词", "基础词", "超纲词"] as const;

const REVIEW_INTERVALS = [
  10 * 60 * 1000,
  24 * 60 * 60 * 1000,
  4 * 24 * 60 * 60 * 1000,
  12 * 24 * 60 * 60 * 1000,
];

function validDate(value: unknown) {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function storedWordId(item: Record<string, unknown>) {
  const word = item.word as Record<string, unknown> | undefined;
  const keyMatch = typeof item.key === "string" ? item.key.match(/^redbook-(\d+)$/) : null;
  const value = item.wordId ?? item.id ?? word?.id ?? keyMatch?.[1];
  const id = Number(value);
  return Number.isInteger(id) && id >= 1 && id <= 6550 ? canonicalWordId(id) : null;
}

function normalizeSavedWord(value: unknown): SavedWord | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const wordId = storedWordId(item);
  if (!wordId) return null;
  return {
    wordId,
    addedAt: validDate(item.addedAt)?.toISOString() ?? new Date(0).toISOString(),
  };
}

function normalizeMistake(value: unknown): MistakeRecord | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const saved = normalizeSavedWord(item);
  if (!saved) return null;
  const lastRating = Number(item.lastRating);
  return {
    ...saved,
    mistakeCount: Math.max(1, Number(item.mistakeCount) || 1),
    lastRating: lastRating === 1 ? 1 : 0,
    lastMistakeAt:
      validDate(item.lastMistakeAt)?.toISOString() ?? saved.addedAt,
  };
}

function normalizeStubbornWord(
  value: unknown,
  wordId: number,
): StubbornWordRecord | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const triggeredAt = validDate(item.triggeredAt);
  const lastChangedAt = validDate(item.lastChangedAt);
  if (
    !triggeredAt
    || !lastChangedAt
    || !["again-3", "low-5"].includes(String(item.reason))
  ) {
    return null;
  }
  const active = item.active === true
    && Date.now() - lastChangedAt.getTime() <= 30 * 24 * 60 * 60 * 1000;
  return {
    wordId: canonicalWordId(wordId),
    active,
    reason: item.reason as StubbornWordRecord["reason"],
    triggeredAt: triggeredAt.toISOString(),
    lastChangedAt: active
      ? lastChangedAt.toISOString()
      : validDate(item.resolvedAt)?.toISOString() ?? lastChangedAt.toISOString(),
    triggerCount: Math.max(1, Number(item.triggerCount) || 1),
    resolvedAt: active
      ? undefined
      : validDate(item.resolvedAt)?.toISOString() ?? lastChangedAt.toISOString(),
  };
}

function uniqueByWordId<T extends SavedWord>(items: T[]) {
  const seen = new Set<number>();
  return items.filter((item) => {
    if (seen.has(item.wordId)) return false;
    seen.add(item.wordId);
    return true;
  });
}

export function reviewDueAt(reviewedAt: string, rating: Rating) {
  const reviewed = validDate(reviewedAt) ?? new Date();
  return new Date(reviewed.getTime() + REVIEW_INTERVALS[rating]).toISOString();
}

function normalizeReview(value: unknown, index: number): Review | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const rating = Number(item.rating);
  const reviewedAt = validDate(item.reviewedAt);
  const section = typeof item.section === "string" ? item.section : undefined;
  if (
    typeof item.word !== "string" ||
    !item.word.trim() ||
    !Number.isInteger(rating) ||
    rating < 0 ||
    rating > 3 ||
    !reviewedAt ||
    !section ||
    !REDBOOK_SECTIONS.includes(section as (typeof REDBOOK_SECTIONS)[number])
  ) {
    return null;
  }
  const wordId = Number(item.wordId);
  const dueAt = validDate(item.dueAt)?.toISOString()
    ?? reviewDueAt(reviewedAt.toISOString(), rating as Rating);
  const normalizedWordId = Number.isInteger(wordId) && wordId >= 1 && wordId <= 6550
    ? canonicalWordId(wordId)
    : undefined;
  const intervalMs = Number(item.intervalMs);
  const recallMs = Number(item.recallMs);
  const inferredInterval = Math.max(
    10 * 60 * 1000,
    new Date(dueAt).getTime() - reviewedAt.getTime(),
  );
  return {
    id: typeof item.id === "string" && item.id
      ? item.id
      : `legacy:${normalizedWordId ?? item.word}:${reviewedAt.toISOString()}:${index}`,
    wordId: normalizedWordId,
    word: item.word.trim(),
    rating: rating as Rating,
    kind: item.kind === "new" ? "new" : "review",
    intervalMs: Number.isFinite(intervalMs) && intervalMs > 0
      ? intervalMs
      : inferredInterval,
    dueAt,
    reviewedAt: reviewedAt.toISOString(),
    recallMs: Number.isFinite(recallMs) && recallMs >= 0
      ? Math.round(recallMs)
      : undefined,
    section,
    unit: typeof item.unit === "string" || typeof item.unit === "number"
      ? item.unit
      : undefined,
  };
}

type NormalizedWordProgress = Omit<WordProgress, "fsrsCard"> & {
  fsrsCard?: SerializedFsrsCard;
};

function normalizeFsrsCard(value: unknown): SerializedFsrsCard | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  const due = validDate(item.due);
  const lastReview = validDate(item.lastReview);
  const state = Number(item.state);
  const numericFields = [
    "stability",
    "difficulty",
    "elapsedDays",
    "scheduledDays",
    "learningSteps",
    "reps",
    "lapses",
  ] as const;
  if (
    !due
    || !Number.isInteger(state)
    || state < 0
    || state > 3
    || numericFields.some((field) => !Number.isFinite(Number(item[field])))
  ) {
    return undefined;
  }
  return {
    due: due.toISOString(),
    stability: Number(item.stability),
    difficulty: Number(item.difficulty),
    elapsedDays: Number(item.elapsedDays),
    scheduledDays: Number(item.scheduledDays),
    learningSteps: Number(item.learningSteps),
    reps: Number(item.reps),
    lapses: Number(item.lapses),
    state,
    lastReview: lastReview?.toISOString(),
  };
}

function normalizeWordProgress(
  value: unknown,
  wordId: number,
): NormalizedWordProgress | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const firstLearnedAt = validDate(item.firstLearnedAt);
  const lastReviewedAt = validDate(item.lastReviewedAt);
  const nextDueAt = validDate(item.nextDueAt);
  const lastRating = Number(item.lastRating);
  if (
    !firstLearnedAt
    || !lastReviewedAt
    || !nextDueAt
    || !Number.isInteger(lastRating)
    || lastRating < 0
    || lastRating > 3
  ) {
    return null;
  }
  const intervalMs = Number(item.intervalMs);
  return {
    wordId: canonicalWordId(wordId),
    status: item.status === "mastered"
      ? "mastered"
      : item.status === "reviewing"
        ? "reviewing"
        : "learning",
    firstLearnedAt: firstLearnedAt.toISOString(),
    lastReviewedAt: lastReviewedAt.toISOString(),
    nextDueAt: nextDueAt.toISOString(),
    lastRating: lastRating as Rating,
    reviewCount: Math.max(1, Number(item.reviewCount) || 1),
    successCount: Math.max(0, Number(item.successCount) || 0),
    lapseCount: Math.max(0, Number(item.lapseCount) || 0),
    consecutiveSuccesses: Math.max(0, Number(item.consecutiveSuccesses) || 0),
    intervalMs: Number.isFinite(intervalMs) && intervalMs > 0
      ? intervalMs
      : Math.max(10 * 60 * 1000, nextDueAt.getTime() - lastReviewedAt.getTime()),
    fsrsCard: normalizeFsrsCard(item.fsrsCard),
    ...(validDate(item.weakResolvedAt)
      ? { weakResolvedAt: validDate(item.weakResolvedAt)!.toISOString() }
      : {}),
  };
}

function normalizeSession(value: unknown): StudySession | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== "string"
    || typeof item.title !== "string"
    || !["today", "favorites", "mistakes", "search"].includes(String(item.kind))
    || !Array.isArray(item.wordIds)
  ) {
    return undefined;
  }
  const wordIds = item.wordIds
    .map(Number)
    .filter((wordId) => Number.isInteger(wordId) && wordId >= 1 && wordId <= 6550)
    .map(canonicalWordId)
    .filter((wordId, index, items) => items.indexOf(wordId) === index);
  return {
    id: item.id,
    kind: item.kind as StudySession["kind"],
    title: item.title,
    wordIds,
    index: Math.min(wordIds.length, Math.max(0, Number(item.index) || 0)),
    createdAt: validDate(item.createdAt)?.toISOString() ?? new Date(0).toISOString(),
  };
}

function normalizeEnrichments(value: unknown) {
  if (!value || typeof value !== "object") return {};
  const result: Record<number, WordEnrichment> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const wordId = canonicalWordId(Number(key));
    if (
      !Number.isInteger(wordId)
      || wordId < 1
      || wordId > 6550
      || !raw
      || typeof raw !== "object"
    ) {
      continue;
    }
    const item = raw as Record<string, unknown>;
    if (!["redbook", "dictionary", "ai"].includes(String(item.source))) continue;
    result[wordId] = {
      phonetic: typeof item.phonetic === "string" ? item.phonetic : undefined,
      sentence: typeof item.sentence === "string" ? item.sentence : undefined,
      translation: typeof item.translation === "string" ? item.translation : undefined,
      collocations: Array.isArray(item.collocations)
        ? item.collocations.filter((entry): entry is string => typeof entry === "string").slice(0, 4)
        : undefined,
      source: item.source as WordEnrichment["source"],
      generatedAt: validDate(item.generatedAt)?.toISOString(),
      verified: item.verified === true,
    };
  }
  return result;
}

export function buildStudyKey(
  scope: StudyScope,
  mode: StudyMode,
  section: string,
  unit: number | string | "all",
  shuffleSeed: number,
) {
  if (scope === "all") return `all:shuffled:${shuffleSeed}`;
  const base = `selection:${section}:${unit}:${mode}`;
  return mode === "shuffled" ? `${base}:${shuffleSeed}` : base;
}

export function parseStoredState(raw: string): StoredState {
  const state = JSON.parse(raw) as Record<string, unknown>;
  const sourceVersion = Number(state.schemaVersion) || 1;
  const studyMode: StudyMode = state.studyMode === "shuffled" ? "shuffled" : "ordered";
  const studyScope: StudyScope = state.studyScope === "all" ? "all" : "selection";
  const shuffleSeed = Number.isFinite(state.shuffleSeed) ? Number(state.shuffleSeed) : 1;
  const selectedSection = typeof state.selectedSection === "string"
    && REDBOOK_SECTIONS.includes(state.selectedSection as (typeof REDBOOK_SECTIONS)[number])
    ? state.selectedSection
    : "必考词";
  const selectedUnit = typeof state.selectedUnit === "string" || typeof state.selectedUnit === "number"
    ? state.selectedUnit
    : 1;
  const positions = state.positions && typeof state.positions === "object"
    ? Object.fromEntries(
        Object.entries(state.positions as Record<string, unknown>)
          .filter(([, value]) => Number.isInteger(value) && Number(value) >= 0)
          .slice(-200)
          .map(([key, value]) => [key, Number(value)]),
      )
    : {};
  const legacyIndex = Number(state.wordIndex);
  if (!Object.keys(positions).length && Number.isInteger(legacyIndex) && legacyIndex >= 0) {
    positions[buildStudyKey(
      studyScope,
      studyMode,
      selectedSection,
      selectedUnit,
      shuffleSeed,
    )] = legacyIndex;
  }
  const normalizedReviews = (Array.isArray(state.reviews) ? state.reviews : [])
    .map(normalizeReview)
    .filter((item): item is Review => item !== null)
    .slice(-MAX_REVIEWS);
  if (sourceVersion < 4) {
    const seen = new Set<number>();
    for (const review of normalizedReviews) {
      if (!review.wordId) continue;
      review.kind = seen.has(review.wordId) ? "review" : "new";
      seen.add(review.wordId);
    }
  }
  const normalizedProgress = state.wordProgress && typeof state.wordProgress === "object"
    ? Object.fromEntries(
        Object.entries(state.wordProgress as Record<string, unknown>)
          .map(([key, value]) => {
            const wordId = Number(key);
            return [canonicalWordId(wordId), normalizeWordProgress(value, wordId)];
          })
          .filter((entry): entry is [number, NormalizedWordProgress] =>
            Number.isInteger(entry[0]) && entry[1] !== null),
      )
    : {};
  const storedProgressIsFsrs = sourceVersion >= STORAGE_VERSION
    && (Object.keys(normalizedProgress).length > 0 || normalizedReviews.length === 0)
    && Object.values(normalizedProgress).every((item) => item.fsrsCard !== undefined);
  const wordProgress: WordProgressMap = storedProgressIsFsrs
    ? Object.fromEntries(
        Object.entries(normalizedProgress)
          .map(([wordId, item]) => [wordId, item as WordProgress]),
      )
    : rebuildWordProgress(normalizedReviews);
  if (!storedProgressIsFsrs) {
    for (const [wordId, item] of Object.entries(normalizedProgress)) {
      if (item.weakResolvedAt && wordProgress[Number(wordId)]) {
        wordProgress[Number(wordId)].weakResolvedAt = item.weakResolvedAt;
      }
    }
  }
  const storedStubbornWords: StubbornWordMap = state.stubbornWords
    && typeof state.stubbornWords === "object"
    ? Object.fromEntries(
        Object.entries(state.stubbornWords as Record<string, unknown>)
          .map(([key, value]) => {
            const wordId = canonicalWordId(Number(key));
            return [wordId, normalizeStubbornWord(value, wordId)];
          })
          .filter((entry): entry is [number, StubbornWordRecord] =>
            Number.isInteger(entry[0]) && entry[1] !== null),
      )
    : {};
  const stubbornWords = {
    ...storedStubbornWords,
    ...rebuildStubbornWords(normalizedReviews),
  };

  return {
    schemaVersion: STORAGE_VERSION,
    reviews: normalizedReviews,
    wordProgress,
    favorites: uniqueByWordId(
      (Array.isArray(state.favorites) ? state.favorites : [])
        .map(normalizeSavedWord)
        .filter((item): item is SavedWord => item !== null),
    ),
    mistakes: uniqueByWordId(
      (Array.isArray(state.mistakes) ? state.mistakes : [])
        .map(normalizeMistake)
        .filter((item): item is MistakeRecord => item !== null),
    ),
    stubbornWords,
    positions,
    activeSession: normalizeSession(state.activeSession),
    enrichments: normalizeEnrichments(state.enrichments),
    started: state.started === true,
    dailyGoal: [10, 20, 30, 50].includes(Number(state.dailyGoal))
      ? Number(state.dailyGoal)
      : 20,
    adaptiveNewWords: state.adaptiveNewWords !== false,
    minimumNewWords: [0, 5, 10].includes(Number(state.minimumNewWords))
      ? Number(state.minimumNewWords)
      : 5,
    examDate: typeof state.examDate === "string"
      && /^\d{4}-\d{2}-\d{2}$/.test(state.examDate)
      ? state.examDate
      : "",
    soundOn: state.soundOn !== false,
    studyMode,
    studyScope,
    shuffleSeed,
    selectedSection,
    selectedUnit,
  };
}

export function dateKey(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function reviewKey(review: Review) {
  return review.wordId
    ? `id:${canonicalWordId(review.wordId)}`
    : `${review.section ?? ""}:${review.unit ?? ""}:${review.word.toLowerCase()}`;
}

export function learningStats(
  reviews: Review[],
  progressOrNow: WordProgressMap | Date = rebuildWordProgress(reviews),
  currentTime = new Date(),
) {
  const progress = progressOrNow instanceof Date
    ? rebuildWordProgress(reviews)
    : progressOrNow;
  const now = progressOrNow instanceof Date ? progressOrNow : currentTime;
  const today = dateKey(now);
  const todayReviews = reviews.filter((review) => dateKey(review.reviewedAt) === today);
  const todayWords = new Set(todayReviews.map(reviewKey));
  const newCount = todayReviews.filter((review) => review.kind === "new").length;
  const reviewCount = todayReviews.length - newCount;

  const activeDates = new Set(reviews.map((review) => dateKey(review.reviewedAt)));
  const cursor = new Date(now);
  if (!activeDates.has(dateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (activeDates.has(dateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  const dueCount = Object.values(progress).filter(
    (item) => new Date(item.nextDueAt).getTime() <= now.getTime(),
  ).length;

  return {
    todayDone: todayWords.size,
    newCount,
    reviewCount,
    completionCount: todayReviews.length,
    coveredCount: todayWords.size,
    streak,
    dueCount,
    retrievability: averageRetrievability(progress, now),
  };
}

export function buildActivityCalendar(
  reviews: Review[],
  days = 140,
  now = new Date(),
) {
  const counts = new Map<string, Set<string>>();
  for (const review of reviews) {
    const day = dateKey(review.reviewedAt);
    const words = counts.get(day) ?? new Set<string>();
    words.add(reviewKey(review));
    counts.set(day, words);
  }

  const end = new Date(now);
  end.setHours(12, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));

  return Array.from({ length: days }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = dateKey(date);
    const count = counts.get(key)?.size ?? 0;
    const level = count === 0 ? 0 : count < 5 ? 1 : count < 10 ? 2 : count < 20 ? 3 : 4;
    return { date: key, count, level };
  });
}

export function formatDueTime(dueAt: string, now = new Date()) {
  const difference = new Date(dueAt).getTime() - now.getTime();
  if (difference <= 0) return "现在复习";
  const minutes = Math.ceil(difference / 60000);
  if (minutes < 60) return `${minutes} 分钟后`;
  const hours = Math.ceil(difference / 3600000);
  if (hours < 24) return `${hours} 小时后`;
  return `${Math.ceil(difference / 86400000)} 天后`;
}

export function splitMeaning(value: string) {
  const match = value.match(
    /^((?:(?:adj|adv|n|v|vi|vt|prep|conj|pron|num|aux|modal)\.\s*)+)/i,
  );
  if (!match) return { part: "红宝书", meaning: value };
  return {
    part: match[1].trim(),
    meaning: value.slice(match[0].length).trim(),
  };
}
