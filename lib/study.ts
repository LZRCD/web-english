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
};

export type Review = {
  wordId?: number;
  word: string;
  rating: number;
  dueAt: string;
  reviewedAt: string;
  section?: string;
  unit?: number | string;
};

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
  schemaVersion: 2;
  reviews: Review[];
  favorites: SavedWord[];
  mistakes: MistakeRecord[];
  positions: StudyPositions;
  started: boolean;
  dailyGoal: number;
  soundOn: boolean;
  studyMode: StudyMode;
  studyScope: StudyScope;
  shuffleSeed: number;
  selectedSection: string;
  selectedUnit: number | string | "all";
};

export const STORAGE_KEY = "wordloop-state";
export const STORAGE_VERSION = 2;
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
  return Number.isInteger(id) && id >= 1 && id <= 6550 ? id : null;
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

function uniqueByWordId<T extends SavedWord>(items: T[]) {
  const seen = new Set<number>();
  return items.filter((item) => {
    if (seen.has(item.wordId)) return false;
    seen.add(item.wordId);
    return true;
  });
}

export function reviewDueAt(reviewedAt: string, rating: number) {
  const reviewed = validDate(reviewedAt) ?? new Date();
  return new Date(reviewed.getTime() + REVIEW_INTERVALS[rating]).toISOString();
}

function normalizeReview(value: unknown): Review | null {
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
    ?? reviewDueAt(reviewedAt.toISOString(), rating);
  return {
    wordId: Number.isInteger(wordId) && wordId >= 1 && wordId <= 6550 ? wordId : undefined,
    word: item.word.trim(),
    rating,
    dueAt,
    reviewedAt: reviewedAt.toISOString(),
    section,
    unit: typeof item.unit === "string" || typeof item.unit === "number"
      ? item.unit
      : undefined,
  };
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

  return {
    schemaVersion: STORAGE_VERSION,
    reviews: (Array.isArray(state.reviews) ? state.reviews : [])
      .map(normalizeReview)
      .filter((item): item is Review => item !== null)
      .slice(-MAX_REVIEWS),
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
    positions,
    started: state.started === true,
    dailyGoal: [10, 20, 30, 50].includes(Number(state.dailyGoal))
      ? Number(state.dailyGoal)
      : 20,
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
    ? `id:${review.wordId}`
    : `${review.section ?? ""}:${review.unit ?? ""}:${review.word.toLowerCase()}`;
}

export function learningStats(reviews: Review[], now = new Date()) {
  const today = dateKey(now);
  const todayWords = new Set(
    reviews
      .filter((review) => dateKey(review.reviewedAt) === today)
      .map(reviewKey),
  );

  const activeDates = new Set(reviews.map((review) => dateKey(review.reviewedAt)));
  const cursor = new Date(now);
  if (!activeDates.has(dateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (activeDates.has(dateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  const latestByWord = new Map<string, Review>();
  for (const review of reviews) {
    const key = reviewKey(review);
    const previous = latestByWord.get(key);
    if (!previous || previous.reviewedAt < review.reviewedAt) {
      latestByWord.set(key, review);
    }
  }
  const due = [...latestByWord.values()].filter(
    (review) => new Date(review.dueAt).getTime() <= now.getTime(),
  );

  return {
    todayDone: todayWords.size,
    streak,
    dueCount: due.length,
    memoryStrength: reviews.length
      ? Math.round((reviews.filter((review) => review.rating > 1).length / reviews.length) * 100)
      : 0,
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
