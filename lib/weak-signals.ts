import type { QuizAttempt, QuizMode } from "./quiz.ts";
import { learningWordId } from "./selection-lookup.ts";
import type {
  ReviewEvent,
  StubbornWordMap,
  WordProgressMap,
} from "./learning.ts";
import type {
  GuessMistakeMap,
  LookupStat,
  LookupStats,
  LookupWord,
} from "./study.ts";

/** 回忆偏慢阈值（毫秒） */
export const SLOW_RECALL_MS = 15_000;
/** 划词 ≥2 次自动进入薄弱候选（词本划词集可标注/过滤） */
export const LOOKUP_WEAK_THRESHOLD = 2;
/** 划词 ≥3 次自动插队今日任务 */
export const LOOKUP_PRIORITY_THRESHOLD = 3;

/** 薄弱画像的全部信号源；均为已有状态，派生计算、不新增 schema。 */
export type WeakSignalInput = {
  lookupStats: LookupStats;
  lookupWords: LookupWord[];
  guessMistakes: GuessMistakeMap;
  quizAttempts: QuizAttempt[];
  reviews: ReviewEvent[];
  stubbornWords: StubbornWordMap;
  wordProgress: WordProgressMap;
};

/** 词级回忆耗时统计（最近 N 次评分样本） */
export type WordRecallStats = {
  /** 合法回忆耗时样本数（最多取最近 N 次评分） */
  sampleCount: number;
  /** 最近 N 次平均（毫秒） */
  averageMs: number;
  /** 最近 N 次中位数（毫秒） */
  medianMs: number;
  /** 最近一次评分耗时（毫秒） */
  latestMs: number;
};

/** 单个词的薄弱画像：标签列表 + 划词查询次数 + 回忆耗时统计 */
export type WeakWordProfile = {
  /** 薄弱信号标签（固定顺序，供词本/学习卡展示） */
  signals: string[];
  /** 该词的划词累计查询次数 */
  lookupCount: number;
  /** 该词最近评分的回忆耗时统计（无合法样本时为 undefined） */
  recall?: WordRecallStats;
};

/** 按词聚合回忆耗时：取最近 sampleCount 次合法评分的平均/中位数/最新值 */
export function wordRecallStats(
  reviews: readonly ReviewEvent[],
  wordId: number,
  sampleCount = 5,
): WordRecallStats | undefined {
  const samples = reviews
    .filter((review) =>
      review.wordId === wordId
      && typeof review.recallMs === "number"
      && Number.isFinite(review.recallMs)
      && review.recallMs >= 0)
    .sort((first, second) => second.reviewedAt.localeCompare(first.reviewedAt))
    .slice(0, sampleCount)
    .map((review) => review.recallMs as number);
  if (!samples.length) return undefined;
  const sorted = [...samples].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
  return {
    sampleCount: samples.length,
    averageMs: Math.round(
      samples.reduce((sum, ms) => sum + ms, 0) / samples.length,
    ),
    medianMs: Math.round(median),
    latestMs: samples[0],
  };
}

/** 周报薄弱维度趋势的单个维度 */
export type WeakDimensionTrend = {
  key:
    | "lookup"
    | "guess"
    | "quiz-spelling"
    | "quiz-c2e"
    | "quiz-choice"
    | "slow-recall"
    | "stubborn"
    | "lapse";
  label: string;
  /** 本周出现该信号的去重词数（guess 为累计词数） */
  count: number;
  /** 较上周变化；累计口径无周级变化源时为 null */
  change: number | null;
};

/** 词 id → 划词统计：通过划词记录把查询词关联回学习项 */
function lookupStatByWordId(input: WeakSignalInput): Map<number, LookupStat> {
  const byId = new Map<number, LookupStat>();
  for (const word of input.lookupWords) {
    const stat = input.lookupStats[word.query.trim().toLowerCase()];
    if (!stat) continue;
    const id = learningWordId(word);
    const current = byId.get(id);
    if (!current || (stat.count ?? 0) > current.count) byId.set(id, stat);
  }
  return byId;
}

/** 查询某学习项的划词统计（无记录返回 undefined） */
export function lookupStatForWordId(
  wordId: number,
  input: WeakSignalInput,
) {
  return lookupStatByWordId(input).get(wordId);
}

/** 该词在各测验模式下累计答错次数 */
function quizErrorCounts(attempts: readonly QuizAttempt[], wordId: number) {
  return attempts.reduce<Partial<Record<QuizMode, number>>>((counts, attempt) => {
    if (attempt.wordId === wordId && !attempt.correct) {
      counts[attempt.mode] = (counts[attempt.mode] ?? 0) + 1;
    }
    return counts;
  }, {});
}

/** 该词回忆耗时 ≥15s 的评分次数 */
function slowReviewCount(reviews: readonly ReviewEvent[], wordId: number) {
  return reviews.filter((review) =>
    review.wordId === wordId
    && typeof review.recallMs === "number"
    && review.recallMs >= SLOW_RECALL_MS).length;
}

/**
 * 聚合单个词的多维薄弱信号（查词/猜错/各模式测验/回忆/顽固/lapse）。
 * 信号按固定顺序排列，空数组表示当前没有薄弱信号。
 */
export function buildWordWeakSignals(
  wordId: number,
  input: WeakSignalInput,
  lookupById = lookupStatByWordId(input),
): string[] {
  const signals: string[] = [];
  const lookupCount = lookupById.get(wordId)?.count ?? 0;
  if (lookupCount >= LOOKUP_WEAK_THRESHOLD) {
    signals.push(`查过${lookupCount}次`);
  }
  const guessCount = input.guessMistakes[wordId] ?? 0;
  if (guessCount > 0) signals.push(`猜错${guessCount}次`);
  const quizErrors = quizErrorCounts(input.quizAttempts, wordId);
  if (quizErrors["listening-spelling"]) {
    signals.push(`拼写测验错${quizErrors["listening-spelling"]}次`);
  }
  if (quizErrors["chinese-to-english"]) {
    signals.push(`中译英错${quizErrors["chinese-to-english"]}次`);
  }
  if (quizErrors["meaning-choice"]) {
    signals.push(`辨析错${quizErrors["meaning-choice"]}次`);
  }
  const slowCount = slowReviewCount(input.reviews, wordId);
  if (slowCount > 0) signals.push(`回忆偏慢${slowCount}次`);
  if (input.stubbornWords[wordId]?.active) signals.push("顽固词");
  const lapseCount = input.wordProgress[wordId]?.lapseCount ?? 0;
  if (lapseCount > 0) signals.push(`FSRS lapse ${lapseCount}`);
  return signals;
}

/** 全量词级薄弱画像：key 为学习项 wordId */
export function buildWeakProfiles(
  input: WeakSignalInput,
): Record<number, WeakWordProfile> {
  const lookupById = lookupStatByWordId(input);
  const wordIds = new Set<number>();
  for (const wordId of lookupById.keys()) wordIds.add(wordId);
  for (const wordId of Object.keys(input.guessMistakes)) {
    wordIds.add(Number(wordId));
  }
  for (const attempt of input.quizAttempts) wordIds.add(attempt.wordId);
  for (const review of input.reviews) {
    if (review.wordId !== undefined) wordIds.add(review.wordId);
  }
  for (const wordId of Object.keys(input.stubbornWords)) {
    wordIds.add(Number(wordId));
  }
  for (const wordId of Object.keys(input.wordProgress)) {
    wordIds.add(Number(wordId));
  }
  const profiles: Record<number, WeakWordProfile> = {};
  for (const wordId of wordIds) {
    const recall = wordRecallStats(input.reviews, wordId);
    profiles[wordId] = {
      signals: buildWordWeakSignals(wordId, input, lookupById),
      lookupCount: lookupById.get(wordId)?.count ?? 0,
      ...(recall ? { recall } : {}),
    };
  }
  return profiles;
}

/** 划词 ≥2 次的薄弱候选（词本划词集标注/过滤） */
export function lookupWeakCandidateIds(input: WeakSignalInput): number[] {
  return [...lookupStatByWordId(input).entries()]
    .filter(([, stat]) => (stat.count ?? 0) >= LOOKUP_WEAK_THRESHOLD)
    .sort((first, second) => second[1].count - first[1].count)
    .map(([wordId]) => wordId);
}

/**
 * 反复查过但之后答对（rating≥2 且查询次数不再增长）→ 自动降级出队。
 * 纯派生判断：最近一次评分时间晚于最近查询时间即认为已覆盖。
 */
function isLookupDemoted(
  wordId: number,
  stat: LookupStat,
  input: WeakSignalInput,
) {
  const progress = input.wordProgress[wordId];
  if (!progress) return false;
  return progress.lastRating >= 2 && progress.lastReviewedAt >= stat.lastAt;
}

/** 划词 ≥3 次且未被近期答对覆盖的词 id（今日任务插队，按查询次数倒序） */
export function lookupPriorityWordIds(input: WeakSignalInput): number[] {
  const items: { wordId: number; stat: LookupStat }[] = [];
  for (const [wordId, stat] of lookupStatByWordId(input)) {
    if ((stat.count ?? 0) < LOOKUP_PRIORITY_THRESHOLD) continue;
    if (isLookupDemoted(wordId, stat, input)) continue;
    items.push({ wordId, stat });
  }
  return items
    .sort((first, second) =>
      second.stat.count - first.stat.count
      || second.stat.lastAt.localeCompare(first.stat.lastAt))
    .map((item) => item.wordId);
}

function localDayStart(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function addLocalDays(value: Date, days: number) {
  const result = new Date(value);
  result.setDate(result.getDate() + days);
  return result;
}

function localWeekStart(value: Date) {
  const start = localDayStart(value);
  const mondayOffset = (start.getDay() + 6) % 7;
  return addLocalDays(start, -mondayOffset);
}

function inWindow(value: string | undefined, startMs: number, endMs: number) {
  const ms = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(ms) && ms >= startMs && ms < endMs;
}

/**
 * 本周各薄弱维度趋势（按本地周一划分，风格与 insights.ts 周报一致）。
 * 可归因到周的维度统计本周/上周去重词数；猜词猜错为累计口径（无周级时间源）。
 */
export function buildWeakDimensionTrend(
  input: WeakSignalInput,
  now = new Date(),
): WeakDimensionTrend[] {
  const weekStart = localWeekStart(now);
  const previousWeekStart = addLocalDays(weekStart, -7);
  const weekStartMs = weekStart.getTime();
  const previousStartMs = previousWeekStart.getTime();
  const weekEndMs = addLocalDays(weekStart, 7).getTime();

  const lookupById = lookupStatByWordId(input);
  const lookupWords = (startMs: number, endMs: number) =>
    [...lookupById.values()].filter((stat) =>
      (stat.count ?? 0) >= LOOKUP_WEAK_THRESHOLD
      && inWindow(stat.lastAt, startMs, endMs)).length;
  const lookupCount = lookupWords(weekStartMs, weekEndMs);
  const lookupPrevious = lookupWords(previousStartMs, weekStartMs);

  const quizErrorWords = (mode: QuizMode, startMs: number, endMs: number) =>
    new Set(input.quizAttempts
      .filter((attempt) =>
        attempt.mode === mode
        && !attempt.correct
        && inWindow(attempt.answeredAt, startMs, endMs))
      .map((attempt) => attempt.wordId)).size;

  const reviewWords = (
    predicate: (review: ReviewEvent) => boolean,
    startMs: number,
    endMs: number,
  ) => new Set(input.reviews
    .filter((review) =>
      predicate(review) && inWindow(review.reviewedAt, startMs, endMs))
    .map((review) => review.wordId)
    .filter((wordId): wordId is number => wordId !== undefined)).size;
  const slowPredicate = (review: ReviewEvent) =>
    typeof review.recallMs === "number" && review.recallMs >= SLOW_RECALL_MS;
  const lapsePredicate = (review: ReviewEvent) => review.rating === 0;
  const slowCount = reviewWords(slowPredicate, weekStartMs, weekEndMs);
  const slowPrevious = reviewWords(slowPredicate, previousStartMs, weekStartMs);
  const lapseCount = reviewWords(lapsePredicate, weekStartMs, weekEndMs);
  const lapsePrevious = reviewWords(lapsePredicate, previousStartMs, weekStartMs);

  const stubbornWords = (startMs: number, endMs: number) =>
    new Set(Object.values(input.stubbornWords)
      .filter((record) =>
        record.active && inWindow(record.triggeredAt, startMs, endMs))
      .map((record) => record.wordId)).size;
  const stubbornCount = stubbornWords(weekStartMs, weekEndMs);
  const stubbornPrevious = stubbornWords(previousStartMs, weekStartMs);

  const guessCount = Object.keys(input.guessMistakes)
    .filter((wordId) => (input.guessMistakes[Number(wordId)] ?? 0) > 0)
    .length;

  const dimension = (
    key: WeakDimensionTrend["key"],
    label: string,
    count: number,
    previous: number,
  ): WeakDimensionTrend => ({ key, label, count, change: count - previous });

  return [
    dimension("lookup", "反复查词", lookupCount, lookupPrevious),
    { key: "guess", label: "猜词猜错", count: guessCount, change: null },
    dimension("quiz-spelling", "拼写测验错", quizErrorWords("listening-spelling", weekStartMs, weekEndMs), quizErrorWords("listening-spelling", previousStartMs, weekStartMs)),
    dimension("quiz-c2e", "中译英错", quizErrorWords("chinese-to-english", weekStartMs, weekEndMs), quizErrorWords("chinese-to-english", previousStartMs, weekStartMs)),
    dimension("quiz-choice", "辨析错", quizErrorWords("meaning-choice", weekStartMs, weekEndMs), quizErrorWords("meaning-choice", previousStartMs, weekStartMs)),
    dimension("slow-recall", "回忆偏慢", slowCount, slowPrevious),
    dimension("stubborn", "新顽固词", stubbornCount, stubbornPrevious),
    dimension("lapse", "遗忘词", lapseCount, lapsePrevious),
  ];
}
