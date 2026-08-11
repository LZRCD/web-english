import {
  canonicalWordId,
  REDBOOK_SOURCE_TOTAL,
} from "./redbook.ts";
import {
  averageRetrievability,
  rebuildStubbornWords,
  rebuildWordProgress,
  type Rating,
  type ReviewEvent,
  type SessionBatchSize,
  type SenseFrequencyEntry,
  type SenseFrequencyMap,
  type SerializedFsrsCard,
  type StubbornWordMap,
  type StubbornWordRecord,
  type StudySession,
  type WordEnrichment,
  type WordProgress,
  type WordProgressMap,
} from "./learning.ts";
import {
  normalizeQuizQuestionSnapshots,
  normalizeQuizQuestionWordIds,
  type QuizAttempt,
  type QuizSessionState,
} from "./quiz.ts";
import { localDateKey as dateKey } from "./date-utils.ts";

export type {
  Rating,
  ReviewEvent,
  SessionBatchSize,
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

export type RatingUndo = {
  reviewId: string;
  wordId: number;
  word: string;
  previousProgress?: WordProgress;
  previousMistake?: MistakeRecord;
  evictedReview?: Review;
  previousPosition: number;
  previousSession?: StudySession;
  studyKey: string;
  selectedSection: string;
  selectedUnit: number | string | "all";
  studyMode: StudyMode;
  studyScope: StudyScope;
  shuffleSeed: number;
};

export type LookupWord = {
  id: number;
  /** 命中红宝书词目时关联原始学习项，避免生成第二份学习进度。 */
  linkedWordId?: number;
  query: string;
  kind: "word" | "phrase" | "sentence";
  phonetic: string;
  phoneticSource?: "redbook" | "dictionary";
  part: string;
  meaning: string;
  note: string;
  source: "redbook" | "dictionary" | "ai";
  addedAt: string;
};

export type FamiliarMeaningMap = Record<number, string[]>;

export type LookupStat = {
  /** 累计查询次数 */
  count: number;
  /** 首次查询时间 */
  firstAt: string;
  /** 最近查询时间 */
  lastAt: string;
};

/** 划词查询次数统计：key 为小写查询词 */
export type LookupStats = Record<string, LookupStat>;

/** 薄弱判定阈值：设置页可调，持久化可选字段，缺省用默认值 */
export type WeakThresholds = {
  /** 划词 ≥ 该次数进入薄弱候选（词本标注/过滤） */
  lookupWeak: number;
  /** 划词 ≥ 该次数自动插队今日任务 */
  lookupPriority: number;
  /** 回忆 ≥ 该毫秒数判定为回忆偏慢 */
  slowRecallMs: number;
};

export const DEFAULT_WEAK_THRESHOLDS: WeakThresholds = {
  lookupWeak: 2,
  lookupPriority: 3,
  slowRecallMs: 15_000,
};

/** 隐藏释义阶段猜词猜错的累计次数：key 为学习项 wordId */
export type GuessMistakeMap = Record<number, number>;

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
  quizAttempts: QuizAttempt[];
  activeQuiz?: QuizSessionState;
  enrichments: Record<number, WordEnrichment>;
  lookupWords: LookupWord[];
  lookupStats: LookupStats;
  /** 隐藏释义阶段猜词猜错的累计次数 */
  guessMistakes: GuessMistakeMap;
  /** 多义词义项考频（AI 生成，按需缓存） */
  senseFrequency: SenseFrequencyMap;
  familiarMeanings: FamiliarMeaningMap;
  started: boolean;
  dailyGoal: number;
  sessionBatchSize: SessionBatchSize;
  adaptiveNewWords: boolean;
  minimumNewWords: number;
  examDate: string;
  soundOn: boolean;
  /** 隐藏学习卡下方释义的中文 */
  hideChineseMeaning: boolean;
  /** 多释义单词先显示英文语境句，让人猜测后再展开中文释义 */
  guessContextFirst: boolean;
  /** 薄弱判定阈值（设置页可调；可选，缺省用默认值） */
  weakThresholds?: WeakThresholds;
  studyMode: StudyMode;
  studyScope: StudyScope;
  shuffleSeed: number;
  selectedSection: string;
  selectedUnit: number | string | "all";
  ratingUndoStack: RatingUndo[];
};

/**
 * 清空本机学习记录，同时保留收藏、内容缓存和用户设置。
 * 调用方必须在持久化该结果前保存完整恢复快照。
 */
export function clearLearningRecords(state: StoredState): StoredState {
  return {
    ...state,
    reviews: [],
    wordProgress: {},
    mistakes: [],
    stubbornWords: {},
    positions: {},
    activeSession: undefined,
    quizAttempts: [],
    activeQuiz: undefined,
    ratingUndoStack: [],
  };
}

export const STORAGE_KEY = "wordloop-state";
export const STORAGE_VERSION = 5;
export const REDBOOK_SECTIONS = ["必考词", "基础词", "超纲词"] as const;
export const CUSTOM_WORD_ID_START = 1_000_000;

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

function normalizeCount(value: unknown, fallback = 0) {
  const count = Number(value);
  if (!Number.isFinite(count)) return fallback;
  return Math.min(
    Number.MAX_SAFE_INTEGER,
    Math.max(0, Math.trunc(count)),
  );
}

export function isValidStudyWordId(value: unknown): value is number {
  return Number.isSafeInteger(value)
    && Number(value) >= 1
    && (Number(value) <= 6550 || Number(value) >= CUSTOM_WORD_ID_START);
}

export function lookupWordId(query: string) {
  let hash = 2166136261;
  for (const character of query.trim().toLowerCase()) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return CUSTOM_WORD_ID_START + (hash >>> 0);
}

function storedWordId(item: Record<string, unknown>) {
  const word = item.word as Record<string, unknown> | undefined;
  const keyMatch = typeof item.key === "string" ? item.key.match(/^redbook-(\d+)$/) : null;
  const value = item.wordId ?? item.id ?? word?.id ?? keyMatch?.[1];
  const id = Number(value);
  return isValidStudyWordId(id) ? canonicalWordId(id) : null;
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

function normalizeLookupWord(value: unknown): LookupWord | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const query = typeof item.query === "string" ? item.query.trim().slice(0, 160) : "";
  const meaning = typeof item.meaning === "string" ? item.meaning.trim() : "";
  if (!query || !meaning || !["word", "phrase", "sentence"].includes(String(item.kind))) {
    return null;
  }
  const linkedWordId = Number(item.linkedWordId);
  return {
    id: isValidStudyWordId(Number(item.id))
      ? canonicalWordId(Number(item.id))
      : lookupWordId(query),
    linkedWordId: Number.isSafeInteger(linkedWordId)
      && linkedWordId >= 1
      && linkedWordId <= REDBOOK_SOURCE_TOTAL
      ? canonicalWordId(linkedWordId)
      : undefined,
    query,
    kind: item.kind as LookupWord["kind"],
    phonetic: (
      item.source !== "ai"
      || item.phoneticSource === "redbook"
      || item.phoneticSource === "dictionary"
    ) && typeof item.phonetic === "string"
      ? item.phonetic.trim()
      : "",
    phoneticSource: item.phoneticSource === "redbook"
      || item.phoneticSource === "dictionary"
      ? item.phoneticSource
      : item.source === "redbook"
        ? "redbook"
        : item.source === "dictionary"
          ? "dictionary"
          : undefined,
    part: typeof item.part === "string" && item.part.trim() ? item.part.trim() : "划词",
    meaning,
    note: typeof item.note === "string" ? item.note.trim() : "",
    source: ["redbook", "dictionary", "ai"].includes(String(item.source))
      ? item.source as LookupWord["source"]
      : "ai",
    addedAt: validDate(item.addedAt)?.toISOString() ?? new Date(0).toISOString(),
  };
}

function normalizeLookupWords(value: unknown) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .map(normalizeLookupWord)
    .filter((item): item is LookupWord => {
      if (!item) return false;
      const key = item.linkedWordId === undefined
        ? `lookup:${item.query.toLowerCase()}`
        : `redbook:${item.linkedWordId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeLookupStats(value: unknown): LookupStats {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: LookupStats = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    const firstAt = validDate(item.firstAt);
    const lastAt = validDate(item.lastAt);
    const count = Number(item.count);
    if (!firstAt || !lastAt || !Number.isInteger(count) || count < 1) continue;
    const query = key.trim().toLowerCase().slice(0, 160);
    if (!query) continue;
    result[query] = {
      count: Math.min(Number.MAX_SAFE_INTEGER, count),
      firstAt: firstAt.toISOString(),
      lastAt: lastAt.toISOString(),
    };
  }
  return result;
}

function normalizeSenseFrequency(value: unknown): SenseFrequencyMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: SenseFrequencyMap = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const wordId = canonicalWordId(Number(key));
    if (!isValidStudyWordId(wordId) || !Array.isArray(raw)) continue;
    const entries = raw
      .filter((entry): entry is Record<string, unknown> =>
        Boolean(entry) && typeof entry === "object" && !Array.isArray(entry))
      .map((entry) => {
        const meaning = typeof entry.meaning === "string" ? entry.meaning.trim() : "";
        const rawLevel = entry.level;
        const level: SenseFrequencyEntry["level"] | undefined =
          rawLevel === "high" || rawLevel === "medium" || rawLevel === "low"
            ? rawLevel
            : undefined;
        const note = typeof entry.note === "string" ? entry.note.trim().slice(0, 80) : "";
        if (!meaning || !level) return null;
        return {
          meaning,
          level,
          ...(note ? { note } : {}),
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .slice(0, 12);
    if (entries.length) result[wordId] = entries;
  }
  return result;
}

function normalizeWeakThresholds(value: unknown): WeakThresholds {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const lookupWeak = normalizeCount(raw.lookupWeak, DEFAULT_WEAK_THRESHOLDS.lookupWeak);
  const lookupPriority = normalizeCount(raw.lookupPriority, DEFAULT_WEAK_THRESHOLDS.lookupPriority);
  const slowRecallMs = normalizeCount(raw.slowRecallMs, DEFAULT_WEAK_THRESHOLDS.slowRecallMs);
  return {
    lookupWeak: Math.min(20, Math.max(1, lookupWeak)),
    lookupPriority: Math.min(20, Math.max(1, lookupPriority)),
    slowRecallMs: Math.min(120_000, Math.max(1_000, slowRecallMs)),
  };
}

function normalizeGuessMistakes(value: unknown): GuessMistakeMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: GuessMistakeMap = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const wordId = canonicalWordId(Number(key));
    const count = Number(raw);
    if (!isValidStudyWordId(wordId) || !Number.isInteger(count) || count < 1) continue;
    result[wordId] = Math.min(Number.MAX_SAFE_INTEGER, count);
  }
  return result;
}

function normalizeFamiliarMeanings(value: unknown): FamiliarMeaningMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, meanings]) => {
        const wordId = canonicalWordId(Number(key));
        const normalized = Array.isArray(meanings)
          ? [...new Set(
              meanings
                .filter((item): item is string => typeof item === "string")
                .map((item) => item.trim())
                .filter(Boolean),
            )].slice(0, 50)
          : [];
        return [wordId, normalized] as const;
      })
      .filter(([wordId, meanings]) =>
        isValidStudyWordId(wordId)
        && meanings.length > 0),
  );
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
    ![...REDBOOK_SECTIONS, "划词集"].includes(section)
  ) {
    return null;
  }
  const wordId = Number(item.wordId);
  const dueAt = validDate(item.dueAt)?.toISOString()
    ?? reviewDueAt(reviewedAt.toISOString(), rating as Rating);
  const normalizedWordId = isValidStudyWordId(wordId)
    ? canonicalWordId(wordId)
    : undefined;
  const intervalMs = Number(item.intervalMs);
  const recallMs = Number(item.recallMs);
  const inferredInterval = Math.max(
    10 * 60 * 1000,
    new Date(dueAt).getTime() - reviewedAt.getTime(),
  );
  return {
    // 稳定 ID：已有 ID 保留，否则从 (wordId+时间+区间) 生成确定性 ID
    // 同一评分事件重复导入时 ID 相同，IndexedDB upsert 自动去重
    id: typeof item.id === "string" && item.id
      ? item.id
      : `${normalizedWordId ?? item.word}:${reviewedAt.toISOString()}`,
    sessionId: typeof item.sessionId === "string" && item.sessionId.trim()
      ? item.sessionId.trim()
      : undefined,
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
  const stability = Number(item.stability);
  const difficulty = Number(item.difficulty);
  const elapsedDays = Number(item.elapsedDays);
  const scheduledDays = Number(item.scheduledDays);
  const learningSteps = Number(item.learningSteps);
  const reps = Number(item.reps);
  const lapses = Number(item.lapses);
  if (
    !due
    || !Number.isInteger(state)
    || state < 0
    || state > 3
    // 语义范围校验：stability/difficulty/计数不可为负
    || !Number.isFinite(stability) || stability < 0
    || !Number.isFinite(difficulty) || difficulty < 0
    || !Number.isInteger(elapsedDays) || elapsedDays < 0
    || !Number.isInteger(scheduledDays) || scheduledDays < 0
    || !Number.isInteger(learningSteps) || learningSteps < 0
    || !Number.isInteger(reps) || reps < 0
    || !Number.isInteger(lapses) || lapses < 0
    || lapses > reps
    || (lastReview !== null && lastReview.getTime() > due.getTime())
    // 到期时间不可在过去超过 100 年（明显异常数据）
    || due.getTime() < Date.now() - 100 * 365 * 24 * 60 * 60 * 1000
  ) {
    return undefined;
  }
  return {
    due: due.toISOString(),
    stability,
    difficulty,
    elapsedDays,
    scheduledDays,
    learningSteps,
    reps,
    lapses,
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
    // 日期一致性：首次学习不晚于最后复习
    || firstLearnedAt.getTime() > lastReviewedAt.getTime()
    // 到期时间应在合理范围（不过去 100 年，不超出未来 100 年）
    || nextDueAt.getTime() < Date.now() - 100 * 365 * 24 * 60 * 60 * 1000
  ) {
    return null;
  }
  const intervalMs = Number(item.intervalMs);
  let fsrsCard = normalizeFsrsCard(item.fsrsCard);
  if (
    fsrsCard?.lastReview
    && Math.abs(
      new Date(fsrsCard.lastReview).getTime() - lastReviewedAt.getTime(),
    ) > 24 * 60 * 60 * 1000
  ) {
    fsrsCard = undefined;
  }
  // FSRS 卡片是排程真源；有效卡片存在时统一使用其 due。
  const effectiveNextDueAt = fsrsCard
    ? new Date(fsrsCard.due)
    : nextDueAt;
  const reviewCount = Math.max(1, normalizeCount(item.reviewCount, 1));
  const successCount = Math.min(
    reviewCount,
    normalizeCount(item.successCount),
  );
  const lapseCount = Math.min(
    reviewCount,
    normalizeCount(item.lapseCount),
  );
  return {
    wordId: canonicalWordId(wordId),
    status: item.status === "mastered"
      ? "mastered"
      : item.status === "reviewing"
        ? "reviewing"
        : "learning",
    firstLearnedAt: firstLearnedAt.toISOString(),
    lastReviewedAt: lastReviewedAt.toISOString(),
    nextDueAt: effectiveNextDueAt.toISOString(),
    lastRating: lastRating as Rating,
    reviewCount,
    successCount,
    lapseCount,
    consecutiveSuccesses: Math.min(
      successCount,
      normalizeCount(item.consecutiveSuccesses),
    ),
    intervalMs: Number.isFinite(intervalMs) && intervalMs > 0
      ? intervalMs
      : Math.max(
          10 * 60 * 1000,
          effectiveNextDueAt.getTime() - lastReviewedAt.getTime(),
        ),
    fsrsCard,
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
    || ![
      "today",
      "favorites",
      "mistakes",
      "stubborn",
      "search",
      "lookups",
      "article",
      "sprint",
      "vocab-test",
      "reinforcement",
    ].includes(String(item.kind))
    || !Array.isArray(item.wordIds)
  ) {
    return undefined;
  }
  const wordIds = item.wordIds
    .map(Number)
    .filter(isValidStudyWordId)
    .map(canonicalWordId)
    .filter((wordId, index, items) => items.indexOf(wordId) === index);
  const originKind = [
    "today",
    "favorites",
    "mistakes",
    "stubborn",
    "search",
    "lookups",
    "article",
    "sprint",
    "vocab-test",
  ].includes(String(item.originKind))
    ? item.originKind as StudySession["originKind"]
    : undefined;
  return {
    id: item.id,
    kind: item.kind as StudySession["kind"],
    ...(originKind ? { originKind } : {}),
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
      !isValidStudyWordId(wordId)
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
      senseExamples: Array.isArray(item.senseExamples)
        ? item.senseExamples
            .filter((entry): entry is Record<string, unknown> =>
              Boolean(entry) && typeof entry === "object")
            .map((entry) => {
              const feedback = entry.feedback
                && typeof entry.feedback === "object"
                && !Array.isArray(entry.feedback)
                ? entry.feedback as Record<string, unknown>
                : undefined;
              const review = entry.review
                && typeof entry.review === "object"
                && !Array.isArray(entry.review)
                ? entry.review as Record<string, unknown>
                : undefined;
              const reviewStatus: "pending" | "passed" | "failed" | undefined =
                review?.status === "pending"
                || review?.status === "passed"
                || review?.status === "failed"
                ? review.status
                : undefined;
              return {
                meaning: typeof entry.meaning === "string" ? entry.meaning.trim() : "",
                sentence: typeof entry.sentence === "string" ? entry.sentence.trim() : "",
                translation: typeof entry.translation === "string" ? entry.translation.trim() : "",
                confidence: Number.isFinite(entry.confidence)
                  ? Math.max(0, Math.min(1, Number(entry.confidence)))
                  : undefined,
                feedback: feedback?.reason === "meaning-mismatch"
                  && typeof feedback.reportedAt === "string"
                  ? {
                      reason: "meaning-mismatch" as const,
                      reportedAt: feedback.reportedAt,
                    }
                  : undefined,
                review: reviewStatus ? {
                  status: reviewStatus,
                  confidence: Number.isFinite(review?.confidence)
                    ? Math.max(0, Math.min(1, Number(review?.confidence)))
                    : undefined,
                  note: typeof review?.note === "string"
                    ? review.note.slice(0, 200)
                    : undefined,
                  reviewedAt: typeof review?.reviewedAt === "string"
                    ? review.reviewedAt
                    : undefined,
                } : undefined,
              };
            })
            .filter((entry) => entry.meaning && entry.sentence && entry.translation)
            .slice(0, 8)
        : undefined,
      collocations: Array.isArray(item.collocations)
        ? item.collocations.filter((entry): entry is string => typeof entry === "string").slice(0, 4)
        : undefined,
      targetMeanings: Array.isArray(item.targetMeanings)
        ? item.targetMeanings
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.trim())
            .filter(Boolean)
            .slice(0, 30)
        : undefined,
      source: item.source as WordEnrichment["source"],
      generatedAt: validDate(item.generatedAt)?.toISOString(),
      verified: item.verified === true,
    };
  }
  return result;
}

/** 最近一次 parseStoredState 中由评分历史重建的进度词数（0 表示无修复） */
let lastParseRepairedCount = 0;

/** 读取并重置最近一次状态解析的修复词数，供持久化层判断是否需要写回修复结果 */
export function consumeStoredParseRepairCount() {
  const count = lastParseRepairedCount;
  lastParseRepairedCount = 0;
  return count;
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
  return normalizeStoredState(JSON.parse(raw));
}

function normalizeRatingUndo(value: unknown): RatingUndo | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const rawWordId = Number(item.wordId);
  if (
    !isValidStudyWordId(rawWordId)
    || typeof item.reviewId !== "string"
    || !item.reviewId.trim()
    || typeof item.word !== "string"
    || !item.word.trim()
    || typeof item.studyKey !== "string"
    || !item.studyKey.trim()
    || typeof item.selectedSection !== "string"
    || !REDBOOK_SECTIONS.includes(item.selectedSection as (typeof REDBOOK_SECTIONS)[number])
    || !(typeof item.selectedUnit === "string" || Number.isFinite(item.selectedUnit))
    || !Number.isInteger(item.previousPosition)
    || Number(item.previousPosition) < 0
    || !Number.isFinite(item.shuffleSeed)
  ) {
    return null;
  }
  const wordId = canonicalWordId(rawWordId);
  const previousProgress = item.previousProgress === undefined
    ? undefined
    : normalizeWordProgress(item.previousProgress, wordId);
  const previousMistake = item.previousMistake === undefined
    ? undefined
    : normalizeMistake(item.previousMistake);
  const evictedReview = item.evictedReview === undefined
    ? undefined
    : normalizeReview(item.evictedReview);
  const previousSession = item.previousSession === undefined
    ? undefined
    : normalizeSession(item.previousSession);
  if (
    (item.previousProgress !== undefined && !previousProgress?.fsrsCard)
    || (previousProgress && previousProgress.wordId !== wordId)
    || (item.previousMistake !== undefined && previousMistake?.wordId !== wordId)
    || (item.evictedReview !== undefined && !evictedReview)
    || (item.previousSession !== undefined && !previousSession)
  ) {
    return null;
  }
  return {
    reviewId: item.reviewId.trim(),
    wordId,
    word: item.word.trim(),
    ...(previousProgress?.fsrsCard
      ? { previousProgress: previousProgress as WordProgress }
      : {}),
    ...(previousMistake ? { previousMistake } : {}),
    ...(evictedReview ? { evictedReview } : {}),
    previousPosition: Number(item.previousPosition),
    ...(previousSession ? { previousSession } : {}),
    studyKey: item.studyKey.trim(),
    selectedSection: item.selectedSection,
    selectedUnit: item.selectedUnit as RatingUndo["selectedUnit"],
    studyMode: item.studyMode === "shuffled" ? "shuffled" : "ordered",
    studyScope: item.studyScope === "all" ? "all" : "selection",
    shuffleSeed: Number(item.shuffleSeed),
  };
}

function normalizeRatingUndoStack(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeRatingUndo)
    .filter((item): item is RatingUndo => item !== null)
    .slice(-30);
}


const QUIZ_MODES = new Set(["listening-spelling", "chinese-to-english", "meaning-choice"]);

function normalizeQuizAttempt(value: unknown): QuizAttempt | null {
  if (!value || typeof value !== "object") return null;
  const attempt = value as Partial<QuizAttempt>;
  const wordId = attempt.wordId;
  if (
    !Number.isSafeInteger(wordId)
    || typeof attempt.answeredAt !== "string"
    || !Number.isFinite(new Date(attempt.answeredAt).getTime())
  ) {
    return null;
  }
  const mode = typeof attempt.mode === "string" && QUIZ_MODES.has(attempt.mode)
    ? attempt.mode
    : "meaning-choice";
  return {
    id: typeof attempt.id === "string"
      ? attempt.id
      : `quiz:${wordId}:${attempt.answeredAt}:${Math.random().toString(36).slice(2, 7)}`,
    wordId: wordId as number,
    mode: mode as QuizAttempt["mode"],
    correct: attempt.correct === true,
    recallMs: Math.max(0, Number(attempt.recallMs) || 0),
    answeredAt: attempt.answeredAt,
    appliedToSchedule: attempt.appliedToSchedule === true,
  };
}

function normalizeQuizAttempts(value: unknown): QuizAttempt[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeQuizAttempt)
    .filter((item): item is QuizAttempt => item !== null);
}

function normalizeQuizSession(value: unknown): QuizSessionState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const session = value as Partial<QuizSessionState>;
  if (
    typeof session.mode !== "string"
    || !QUIZ_MODES.has(session.mode)
    || !Number.isFinite(Number(session.seed))
    || !Number.isFinite(Number(session.index))
  ) {
    return undefined;
  }
  const answers: QuizSessionState["answers"] = {};
  if (session.answers && typeof session.answers === "object") {
    for (const [questionId, entry] of Object.entries(session.answers)) {
      if (entry && typeof entry === "object" && "correct" in entry) {
        const record = entry as { answer?: unknown; correct?: unknown };
        answers[questionId] = {
          answer: typeof record.answer === "string" ? record.answer : "",
          correct: record.correct === true,
        };
      }
    }
  }
  const questionSnapshots = normalizeQuizQuestionSnapshots(
    session.questionSnapshots,
  )?.filter((question) => question.mode === session.mode);
  const questionWordIds = questionSnapshots !== undefined
    ? questionSnapshots.map((question) => question.wordId)
    : normalizeQuizQuestionWordIds(session.questionWordIds);
  return {
    id: typeof session.id === "string" ? session.id : "quiz:restored",
    mode: session.mode as QuizSessionState["mode"],
    seed: Number(session.seed),
    ...(questionWordIds !== undefined ? { questionWordIds } : {}),
    ...(questionSnapshots !== undefined ? { questionSnapshots } : {}),
    index: Math.max(0, Math.trunc(Number(session.index))),
    correctCount: Math.max(0, Math.trunc(Number(session.correctCount) || 0)),
    answers,
    complete: session.complete === true,
    startedAt: typeof session.startedAt === "string"
      ? session.startedAt
      : new Date().toISOString(),
  };
}

/**
 * 归一化已解析的持久化状态。IndexedDB 返回的本来就是对象，
 * 直接走该入口可避免一次完整的 JSON.stringify + JSON.parse。
 */
export function normalizeStoredState(parsed: unknown): StoredState {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("状态数据格式无效：期望对象");
  }
  const state = parsed as Record<string, unknown>;
  const hasSourceVersion = state.schemaVersion !== undefined;
  const parsedSourceVersion = Number(state.schemaVersion);
  if (
    hasSourceVersion
    && (!Number.isSafeInteger(parsedSourceVersion) || parsedSourceVersion < 1)
  ) {
    throw new Error("状态数据版本无效");
  }
  const sourceVersion = hasSourceVersion ? parsedSourceVersion : 1;
  if (sourceVersion > STORAGE_VERSION) {
    throw new Error(
      `状态数据来自更新版本的词环（v${sourceVersion}），当前版本为 v${STORAGE_VERSION}`,
    );
  }
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
  const normalizedReviewInput = (Array.isArray(state.reviews) ? state.reviews : [])
    .map(normalizeReview)
    .filter((item): item is Review => item !== null);

  // 检测并去除重复 ID（保留最后出现的，与 IDB upsert 行为一致）
  const seenIds = new Set<string>();
  const dedupedReviews: Review[] = [];
  for (let i = normalizedReviewInput.length - 1; i >= 0; i--) {
    const review = normalizedReviewInput[i];
    if (!seenIds.has(review.id)) {
      seenIds.add(review.id);
      dedupedReviews.push(review);
    }
  }
  dedupedReviews.reverse();
  // IndexedDB getAll() 按主键返回；统一按事件时间排序（完整保留历史，不静默截断）。
  const normalizedReviews = dedupedReviews
    .sort((a, b) =>
      a.reviewedAt.localeCompare(b.reviewedAt)
      || a.id.localeCompare(b.id))

  if (sourceVersion < 4) {
    const seen = new Set<number>();
    for (const review of normalizedReviews) {
      if (!review.wordId) continue;
      review.kind = seen.has(review.wordId) ? "review" : "new";
      seen.add(review.wordId);
    }
  }
  const rawProgress = state.wordProgress
    && typeof state.wordProgress === "object"
    && !Array.isArray(state.wordProgress)
    ? state.wordProgress as Record<string, unknown>
    : {};
  const progressWordIds = new Set(
    Object.keys(rawProgress)
      .map(Number)
      .filter(isValidStudyWordId)
      .map(canonicalWordId),
  );
  const normalizedProgress = Object.keys(rawProgress).length
    ? Object.fromEntries(
        Object.entries(rawProgress)
          .map(([key, value]) => {
            const wordId = Number(key);
            return [canonicalWordId(wordId), normalizeWordProgress(value, wordId)];
          })
          .filter((entry): entry is [number, NormalizedWordProgress] =>
            isValidStudyWordId(entry[0]) && entry[1] !== null),
      )
    : {};

  // 逐词校验：按 FSRS 卡状态分三组处理
  // 1) 有合法 FSRS 卡 → 直接使用已存储的进度
  // 2) FSRS 卡缺失/损坏 → 仅对该词从 reviews 降级重建
  // 3) 无任何已存储进度 → 从 reviews 全量重建（旧版迁移路径）
  const healthyProgress: WordProgressMap = {};
  const damagedWordIds = new Set(progressWordIds);

  for (const [wordIdStr, item] of Object.entries(normalizedProgress)) {
    const wordId = Number(wordIdStr);
    const progress = item as WordProgress;
    if (progress.fsrsCard) {
      healthyProgress[wordId] = progress;
      damagedWordIds.delete(wordId);
    } else {
      damagedWordIds.add(wordId);
    }
  }

  const latestReviewAtByWordId = new Map<number, string>();
  for (const review of normalizedReviews) {
    if (review.wordId === undefined) continue;
    const latestReviewAt = latestReviewAtByWordId.get(review.wordId);
    if (!latestReviewAt || review.reviewedAt > latestReviewAt) {
      latestReviewAtByWordId.set(review.wordId, review.reviewedAt);
    }
  }
  for (const [wordIdText, progress] of Object.entries(healthyProgress)) {
    const wordId = Number(wordIdText);
    const latestReviewAt = latestReviewAtByWordId.get(wordId);
    if (
      latestReviewAt !== undefined
      && latestReviewAt > progress.lastReviewedAt
    ) {
      delete healthyProgress[wordId];
      damagedWordIds.add(wordId);
    }
  }

  // reviews 中出现但 progress 缺失的词也必须进入逐词重建。
  for (const review of normalizedReviews) {
    if (review.wordId !== undefined && !healthyProgress[review.wordId]) {
      damagedWordIds.add(review.wordId);
    }
  }

  const wordProgress: WordProgressMap = { ...healthyProgress };
  let repairedCount = 0;
  if (damagedWordIds.size > 0) {
    const damagedReviews = normalizedReviews.filter(
      (review) =>
        review.wordId !== undefined && damagedWordIds.has(review.wordId),
    );
    if (damagedReviews.length > 0) {
      const rebuilt = rebuildWordProgress(damagedReviews);
      for (const [wordIdStr, rebuiltProgress] of Object.entries(rebuilt)) {
        const wordId = Number(wordIdStr);
        if (damagedWordIds.has(wordId)) {
          const original = normalizedProgress[wordId];
          if (original?.weakResolvedAt) {
            rebuiltProgress.weakResolvedAt = original.weakResolvedAt;
          }
          wordProgress[wordId] = rebuiltProgress;
          damagedWordIds.delete(wordId);
          repairedCount += 1;
        }
      }
    }
    // 无 reviews 可重建的损坏条目不再伪装成完整 WordProgress。
    for (const wordId of damagedWordIds) {
      delete wordProgress[wordId];
    }
  }
  lastParseRepairedCount = repairedCount;
  const storedStubbornWords: StubbornWordMap = state.stubbornWords
    && typeof state.stubbornWords === "object"
    ? Object.fromEntries(
        Object.entries(state.stubbornWords as Record<string, unknown>)
          .map(([key, value]) => {
            const wordId = canonicalWordId(Number(key));
            return [wordId, normalizeStubbornWord(value, wordId)];
          })
          .filter((entry): entry is [number, StubbornWordRecord] =>
            isValidStudyWordId(entry[0]) && entry[1] !== null),
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
    lookupWords: normalizeLookupWords(state.lookupWords),
    lookupStats: normalizeLookupStats(state.lookupStats),
    guessMistakes: normalizeGuessMistakes(state.guessMistakes),
    senseFrequency: normalizeSenseFrequency(state.senseFrequency),
    familiarMeanings: normalizeFamiliarMeanings(state.familiarMeanings),
    started: state.started === true,
    dailyGoal: [10, 20, 30, 50].includes(Number(state.dailyGoal))
      ? Number(state.dailyGoal)
      : 20,
    sessionBatchSize: typeof state.sessionBatchSize === "number"
      && [5, 10, 15, 20].includes(state.sessionBatchSize)
      ? state.sessionBatchSize as SessionBatchSize
      : 10,
    adaptiveNewWords: state.adaptiveNewWords !== false,
    minimumNewWords: [0, 5, 10].includes(Number(state.minimumNewWords))
      ? Number(state.minimumNewWords)
      : 5,
    examDate: typeof state.examDate === "string"
      && /^\d{4}-\d{2}-\d{2}$/.test(state.examDate)
      ? state.examDate
      : "",
    soundOn: state.soundOn !== false,
    hideChineseMeaning: state.hideChineseMeaning === true,
    guessContextFirst: state.guessContextFirst === true,
    weakThresholds: normalizeWeakThresholds(state.weakThresholds),
    studyMode,
    studyScope,
    shuffleSeed,
    selectedSection,
    selectedUnit,
    ratingUndoStack: normalizeRatingUndoStack(state.ratingUndoStack),
    quizAttempts: normalizeQuizAttempts(state.quizAttempts),
    activeQuiz: normalizeQuizSession(state.activeQuiz),
  };
}

export { dateKey };

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

export type DailyAggregate = {
  /** 当天新学次数 */
  newCount: number;
  /** 当天复习次数 */
  reviewCount: number;
  /** 当天覆盖的不同单词数 */
  coveredCount: number;
};

/**
 * 每日聚合：把完整评分日志折叠为按自然日的轻量汇总，
 * 供年度日历与趋势展示使用，避免长期使用后每次都要扫描全量日志。
 */
export function buildDailyAggregates(
  reviews: Review[],
): Record<string, DailyAggregate> {
  const aggregates: Record<string, DailyAggregate> = {};
  const coveredPerDay = new Map<string, Set<string>>();
  for (const review of reviews) {
    const day = dateKey(review.reviewedAt);
    const aggregate = aggregates[day] ?? { newCount: 0, reviewCount: 0, coveredCount: 0 };
    aggregate.newCount += review.kind === "new" ? 1 : 0;
    aggregate.reviewCount += review.kind === "review" ? 1 : 0;
    aggregates[day] = aggregate;
    const words = coveredPerDay.get(day) ?? new Set<string>();
    words.add(review.wordId !== undefined
      ? `id:${canonicalWordId(review.wordId)}`
      : `${review.section ?? ""}:${review.unit ?? ""}:${review.word.toLowerCase()}`);
    coveredPerDay.set(day, words);
  }
  for (const [day, words] of coveredPerDay) {
    const aggregate = aggregates[day];
    if (aggregate) aggregate.coveredCount = words.size;
  }
  return aggregates;
}

export function buildActivityCalendar(
  reviews: Review[],
  days = 140,
  now = new Date(),
) {
  // 基于每日聚合计算，避免长期使用后每次都扫描全量日志
  const aggregates = buildDailyAggregates(reviews);
  const end = new Date(now);
  end.setHours(12, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));

  return Array.from({ length: days }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = dateKey(date);
    const count = aggregates[key]?.coveredCount ?? 0;
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
  const partPattern = "(?:vlink|modal|usage|prep|conj|pron|suff|pref|adj|adv|det|int|num|aux|ord|vi|vt|n|v)";
  const normalized = value.trim();
  const segments = [
    ...normalized.matchAll(
      new RegExp(
        `((?:${partPattern}\\.\\s*)+)([\\s\\S]*?)(?=${partPattern}\\.|$)`,
        "gi",
      ),
    ),
  ];
  if (!segments.length || segments[0].index !== 0) {
    return {
      part: "红宝书",
      meaning: normalized,
      senses: [{ part: "红宝书", meaning: normalized }],
    };
  }

  const grouped = new Map<string, string[]>();
  const meanings: string[] = [];
  for (const segment of segments) {
    const meaning = segment[2].trim().replace(/^[;；]\s*/, "");
    if (!meaning) continue;
    meanings.push(meaning);
    const parts = [
      ...segment[1].matchAll(new RegExp(`${partPattern}\\.`, "gi")),
    ].map(([item]) => item.toLowerCase());
    for (const part of parts) {
      const items = grouped.get(part) ?? [];
      items.push(meaning);
      grouped.set(part, items);
    }
  }

  const joinMeanings = (items: string[]) =>
    items
      .map((item) => item.replace(/[;；]\s*$/, ""))
      .join("；");
  const senses = [...grouped].map(([part, items]) => ({
    part,
    meaning: joinMeanings(items),
  }));
  return {
    part: senses.map((sense) => sense.part).join(" "),
    meaning: joinMeanings(meanings),
    senses,
  };
}
