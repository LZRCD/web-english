import type { QuizAttempt, QuizMode } from "../quiz.ts";
import { learningWordId } from "../selection-lookup.ts";
import {
  isWeakProgress,
  type ReviewEvent,
} from "../learning.ts";
import {
  DEFAULT_WEAK_THRESHOLDS,
  type LookupStat,
  type WeakThresholds,
} from "../study.ts";
import {
  STUBBORN_TREATMENT_SEQUENCE,
  SPRINT_TREATMENT_DIMENSIONS,
  type ParsedSprintSession,
  type SprintTreatmentDimension,
  type StabilizedDimension,
  type StubbornTreatmentMode,
  type WeakSectionConcentration,
  type WeakSignalEntry,
  type WeakSignalInput,
  type WeakWordProfile,
  type WordRecallStats,
} from "./types.ts";

/** 回忆偏慢阈值（毫秒，默认值来自 study.ts 的 WeakThresholds） */
export const SLOW_RECALL_MS = DEFAULT_WEAK_THRESHOLDS.slowRecallMs;
/** 划词 ≥2 次自动进入薄弱候选（词本划词集可标注/过滤） */
export const LOOKUP_WEAK_THRESHOLD = DEFAULT_WEAK_THRESHOLDS.lookupWeak;
/** 划词 ≥3 次自动插队今日任务 */
export const LOOKUP_PRIORITY_THRESHOLD = DEFAULT_WEAK_THRESHOLDS.lookupPriority;

export const STUBBORN_SPRINT_SESSION_PREFIX = "sprint:stubborn:";
export const TREATMENT_SPRINT_SESSION_PREFIX = "sprint:treatment:";

export function createStubbornSprintSessionId(
  mode: StubbornTreatmentMode,
  now = new Date(),
) {
  return `${STUBBORN_SPRINT_SESSION_PREFIX}${mode}:${now.toISOString()}`;
}

/** 为未来普通冲刺写入唯一的维度化 id；unknown 只能来自解析。 */
export function createTreatmentSprintSessionId(
  dimension: SprintTreatmentDimension,
  now = new Date(),
) {
  return `${TREATMENT_SPRINT_SESSION_PREFIX}${dimension}:${now.toISOString()}`;
}

const TRAILING_ISO_PATTERN = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))$/;

function validTrailingStartedAt(value: string) {
  const startedAt = value.match(TRAILING_ISO_PATTERN)?.[1];
  return startedAt && Number.isFinite(new Date(startedAt).getTime())
    ? startedAt
    : undefined;
}

/** 统一解析新旧冲刺 id；非法结构安全回退，且尽量保留合法尾部时间。 */
export function parseSprintSessionId(sessionId?: string): ParsedSprintSession | null {
  if (!sessionId?.startsWith("sprint:")) return null;
  if (sessionId.startsWith(TREATMENT_SPRINT_SESSION_PREFIX)) {
    const rest = sessionId.slice(TREATMENT_SPRINT_SESSION_PREFIX.length);
    const dimension = SPRINT_TREATMENT_DIMENSIONS.find((candidate) =>
      rest.startsWith(`${candidate}:`));
    const startedAt = validTrailingStartedAt(rest);
    return {
      dimension: dimension && startedAt ? dimension : "unknown",
      format: "treatment",
      ...(startedAt ? { startedAt } : {}),
    };
  }
  if (sessionId.startsWith(STUBBORN_SPRINT_SESSION_PREFIX)) {
    const rest = sessionId.slice(STUBBORN_SPRINT_SESSION_PREFIX.length);
    const submode = STUBBORN_TREATMENT_SEQUENCE.find((candidate) =>
      rest.startsWith(`${candidate}:`));
    const startedAt = validTrailingStartedAt(rest);
    return {
      dimension: submode && startedAt ? "stubborn" : "unknown",
      format: "stubborn",
      ...(startedAt ? { startedAt } : {}),
      ...(submode && startedAt ? { submode } : {}),
    };
  }
  const startedAt = validTrailingStartedAt(sessionId.slice("sprint:".length));
  return {
    dimension: "unknown",
    format: "legacy",
    ...(startedAt ? { startedAt } : {}),
  };
}

/** 兼容既有顽固词调用方；权威解析委托给 parseSprintSessionId。 */
export function parseStubbornSprintSessionId(sessionId?: string) {
  const parsed = parseSprintSessionId(sessionId);
  return parsed?.dimension === "stubborn" && parsed.submode && parsed.startedAt
    ? { mode: parsed.submode, startedAt: parsed.startedAt }
    : null;
}

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

/** 词 id → 划词统计：通过划词记录把查询词关联回学习项 */
export function lookupStatByWordId(input: WeakSignalInput): Map<number, LookupStat> {
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
export function quizErrorCounts(attempts: readonly QuizAttempt[], wordId: number) {
  return attempts.reduce<Partial<Record<QuizMode, number>>>((counts, attempt) => {
    if (attempt.wordId === wordId && !attempt.correct) {
      counts[attempt.mode] = (counts[attempt.mode] ?? 0) + 1;
    }
    return counts;
  }, {});
}

/** 最近两次同模式作答均正确时，当前测验薄弱信号视为已恢复。 */
export function isQuizModeRecovered(
  attempts: readonly QuizAttempt[],
  wordId: number,
  mode: QuizMode,
) {
  const seenIds = new Set<string>();
  const ordered = attempts
    .map((attempt, index) => ({
      attempt,
      index,
      answeredAtMs: new Date(attempt.answeredAt).getTime(),
    }))
    .filter(({ attempt }) => {
      if (attempt.wordId !== wordId || attempt.mode !== mode) return false;
      const id = attempt.id.trim();
      if (!id) return true;
      if (seenIds.has(id)) return false;
      seenIds.add(id);
      return true;
    });
  // 时间无效的答对不能充当恢复证据；时间无效的答错无法可靠排序，保守保留标签。
  if (ordered.some(({ attempt, answeredAtMs }) =>
    !Number.isFinite(answeredAtMs) && !attempt.correct)) {
    return false;
  }
  const valid = ordered
    .filter(({ answeredAtMs }) => Number.isFinite(answeredAtMs))
    .sort((first, second) =>
      first.answeredAtMs - second.answeredAtMs || first.index - second.index);
  return valid.length >= 2
    && valid[valid.length - 1].attempt.correct
    && valid[valid.length - 2].attempt.correct;
}

function hasValidRecallMs(review: ReviewEvent): review is ReviewEvent & { recallMs: number } {
  return typeof review.recallMs === "number"
    && Number.isFinite(review.recallMs)
    && review.recallMs >= 0;
}

/** 该词回忆耗时不低于阈值的历史评分次数 */
function slowReviewCount(
  reviews: readonly ReviewEvent[],
  wordId: number,
  slowRecallMs: number,
) {
  return reviews.filter((review) =>
    review.wordId === wordId
    && hasValidRecallMs(review)
    && review.recallMs >= slowRecallMs).length;
}

/** 最近两次均为有测时的成功快速回忆时，当前慢回忆信号视为已恢复。 */
function isSlowRecallRecovered(
  reviews: readonly ReviewEvent[],
  wordId: number,
  slowRecallMs: number,
) {
  const latestReviews = reviews
    .filter((review) => review.wordId === wordId)
    .sort((first, second) => second.reviewedAt.localeCompare(first.reviewedAt));
  let consecutiveFastSuccesses = 0;
  for (const review of latestReviews) {
    if (
      review.rating >= 2
      && hasValidRecallMs(review)
      && review.recallMs < slowRecallMs
    ) {
      consecutiveFastSuccesses += 1;
      if (consecutiveFastSuccesses >= 2) return true;
      continue;
    }
    break;
  }
  return false;
}

/**
 * 聚合单个词的多维薄弱信号条目（查词/猜错/各模式测验/回忆/顽固/lapse）。
 * 条目按固定顺序排列，空数组表示当前没有薄弱信号；
 * key 为稳定通信协议（与 WeakDimensionTrend.key 同源），label 为展示文案。
 */
export function buildWordWeakSignalEntries(
  wordId: number,
  input: WeakSignalInput,
  lookupById = lookupStatByWordId(input),
  thresholds: WeakThresholds = DEFAULT_WEAK_THRESHOLDS,
): WeakSignalEntry[] {
  const entries: WeakSignalEntry[] = [];
  const lookupStat = lookupById.get(wordId);
  const lookupCount = lookupStat?.count ?? 0;
  // 答对且查询不再增长（isLookupDemoted）→ 查词标签淡出，与插队队列降级口径贯通
  if (
    lookupCount >= thresholds.lookupWeak
    && !(lookupStat && isLookupDemoted(wordId, lookupStat, input))
  ) {
    entries.push({ key: "lookup", label: `查过${lookupCount}次` });
  }
  const guessCount = input.guessMistakes[wordId] ?? 0;
  if (guessCount > 0) entries.push({ key: "guess", label: `猜错${guessCount}次` });
  const quizErrors = quizErrorCounts(input.quizAttempts, wordId);
  if (
    quizErrors["listening-spelling"]
    && !isQuizModeRecovered(input.quizAttempts, wordId, "listening-spelling")
  ) {
    entries.push({
      key: "quiz-spelling",
      label: `拼写测验错${quizErrors["listening-spelling"]}次`,
    });
  }
  if (
    quizErrors["chinese-to-english"]
    && !isQuizModeRecovered(input.quizAttempts, wordId, "chinese-to-english")
  ) {
    entries.push({
      key: "quiz-c2e",
      label: `中译英错${quizErrors["chinese-to-english"]}次`,
    });
  }
  if (
    quizErrors["meaning-choice"]
    && !isQuizModeRecovered(input.quizAttempts, wordId, "meaning-choice")
  ) {
    entries.push({
      key: "quiz-choice",
      label: `辨析错${quizErrors["meaning-choice"]}次`,
    });
  }
  if (
    quizErrors["passage-cloze"]
    && !isQuizModeRecovered(input.quizAttempts, wordId, "passage-cloze")
  ) {
    entries.push({
      key: "quiz-cloze",
      label: `短文填词错${quizErrors["passage-cloze"]}次`,
    });
  }
  const slowCount = slowReviewCount(input.reviews, wordId, thresholds.slowRecallMs);
  // 历史慢回忆仍保留在 review/时间线/统计中；仅当前标签在可靠恢复后淡出
  if (
    slowCount > 0
    && !isSlowRecallRecovered(input.reviews, wordId, thresholds.slowRecallMs)
  ) {
    entries.push({ key: "slow-recall", label: `回忆偏慢${slowCount}次` });
  }
  if (input.stubbornWords[wordId]?.active) {
    entries.push({ key: "stubborn", label: "顽固词" });
  }
  const progress = input.wordProgress[wordId];
  const lapseCount = progress?.lapseCount ?? 0;
  // 历史 lapse 计数保留不变；仅在既有进度判定仍弱时展示，恢复后自动淡出
  if (lapseCount > 0 && isWeakProgress(progress)) {
    entries.push({ key: "lapse", label: `FSRS lapse ${lapseCount}` });
  }
  return entries;
}

/**
 * 聚合单个词的多维薄弱信号（查词/猜错/各模式测验/回忆/顽固/lapse）。
 * 信号按固定顺序排列，空数组表示当前没有薄弱信号；
 * 投影自 buildWordWeakSignalEntries，仅保留展示标签，消费端形状不变。
 */
export function buildWordWeakSignals(
  wordId: number,
  input: WeakSignalInput,
  lookupById = lookupStatByWordId(input),
  thresholds: WeakThresholds = DEFAULT_WEAK_THRESHOLDS,
): string[] {
  return buildWordWeakSignalEntries(wordId, input, lookupById, thresholds)
    .map((entry) => entry.label);
}

/** 全量词级薄弱画像：key 为学习项 wordId */
export function buildWeakProfiles(
  input: WeakSignalInput,
  thresholds: WeakThresholds = DEFAULT_WEAK_THRESHOLDS,
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
      signals: buildWordWeakSignals(wordId, input, lookupById, thresholds),
      lookupCount: lookupById.get(wordId)?.count ?? 0,
      ...(recall ? { recall } : {}),
    };
  }
  return profiles;
}

/**
 * 薄弱集中度：按 section 分组统计薄弱词数（buildWordWeakSignals 标签非空），
 * section 内按 unit 分组；无 section 的词跳过，unit 统一转字符串。
 */
export function buildWeakConcentration(
  input: WeakSignalInput,
  wordById: ReadonlyMap<number | undefined, import("../study.ts").Word>,
  thresholds: WeakThresholds = DEFAULT_WEAK_THRESHOLDS,
): WeakSectionConcentration[] {
  const profiles = buildWeakProfiles(input, thresholds);
  const bySection = new Map<string, Map<string, number>>();
  for (const [wordIdKey, profile] of Object.entries(profiles)) {
    if (!profile.signals.length) continue;
    const word = wordById.get(Number(wordIdKey));
    const section = word?.section;
    if (!section) continue;
    const unit = word?.unit;
    const unitKey = unit === undefined ? "未分单元" : String(unit);
    const units = bySection.get(section) ?? new Map<string, number>();
    units.set(unitKey, (units.get(unitKey) ?? 0) + 1);
    bySection.set(section, units);
  }
  return [...bySection.entries()]
    .map(([section, units]) => ({
      section,
      total: [...units.values()].reduce((sum, count) => sum + count, 0),
      units: [...units.entries()]
        .map(([unit, count]) => ({ unit, count }))
        .sort((first, second) => second.count - first.count),
    }))
    .sort((first, second) => second.total - first.total);
}

/** 划词达到阈值的薄弱候选（词本划词集标注/过滤） */
export function lookupWeakCandidateIds(
  input: WeakSignalInput,
  thresholds: WeakThresholds = DEFAULT_WEAK_THRESHOLDS,
): number[] {
  const lookupById = lookupStatByWordId(input);
  return [...lookupById.entries()]
    .filter(([wordId, stat]) =>
      (stat.count ?? 0) >= thresholds.lookupWeak
      && buildWordWeakSignals(wordId, input, lookupById, thresholds).length > 0)
    .sort((first, second) => second[1].count - first[1].count)
    .map(([wordId]) => wordId);
}

/** 薄弱候选清单：只含划词薄弱候选词，复用词级薄弱标签（与 buildSprintSummary 同构） */
export function buildWeakCandidateSummary(
  input: WeakSignalInput,
  wordById: ReadonlyMap<number | undefined, import("../study.ts").Word>,
  thresholds: WeakThresholds = DEFAULT_WEAK_THRESHOLDS,
): { word: string; signals: string[] }[] {
  return lookupWeakCandidateIds(input, thresholds).flatMap((wordId) => {
    const word = wordById.get(wordId)?.word;
    if (!word) return [];
    const signals = buildWordWeakSignals(wordId, input, undefined, thresholds);
    if (!signals.length) return [];
    return [{ word, signals }];
  });
}

/**
 * 反复查过但之后答对（rating≥2 且查询次数不再增长）→ 自动降级出队。
 * 纯派生判断：最近一次评分时间晚于最近查询时间即认为已覆盖。
 */
export function isLookupDemoted(
  wordId: number,
  stat: LookupStat,
  input: WeakSignalInput,
) {
  const progress = input.wordProgress[wordId];
  if (!progress) return false;
  return progress.lastRating >= 2 && progress.lastReviewedAt >= stat.lastAt;
}

/**
 * 已稳定维度：必须有当前阈值下的真实历史弱点证据、满足该维度既有恢复条件，
 * 且统一画像已无任何当前薄弱信号。猜错没有恢复规则，因此不参与派生。
 */
export function buildWordStabilizedDimensions(
  wordId: number,
  input: WeakSignalInput,
  thresholds: WeakThresholds = DEFAULT_WEAK_THRESHOLDS,
): StabilizedDimension[] {
  if (buildWordWeakSignals(wordId, input, undefined, thresholds).length > 0) {
    return [];
  }

  const dimensions: StabilizedDimension[] = [];
  const stat = lookupStatForWordId(wordId, input);
  if (
    stat
    && stat.count >= thresholds.lookupWeak
    && isLookupDemoted(wordId, stat, input)
  ) {
    dimensions.push({ key: "lookup", label: "查词" });
  }

  const progress = input.wordProgress[wordId];
  if ((progress?.lapseCount ?? 0) > 0 && !isWeakProgress(progress)) {
    dimensions.push({ key: "lapse", label: "遗忘" });
  }

  if (
    slowReviewCount(input.reviews, wordId, thresholds.slowRecallMs) > 0
    && isSlowRecallRecovered(input.reviews, wordId, thresholds.slowRecallMs)
  ) {
    dimensions.push({ key: "slow-recall", label: "慢回忆" });
  }

  const quizErrors = quizErrorCounts(input.quizAttempts, wordId);
  if (
    (quizErrors["listening-spelling"] ?? 0) > 0
    && isQuizModeRecovered(input.quizAttempts, wordId, "listening-spelling")
  ) {
    dimensions.push({ key: "quiz-spelling", label: "拼写" });
  }
  if (
    (quizErrors["chinese-to-english"] ?? 0) > 0
    && isQuizModeRecovered(input.quizAttempts, wordId, "chinese-to-english")
  ) {
    dimensions.push({ key: "quiz-c2e", label: "中译英" });
  }
  if (
    (quizErrors["meaning-choice"] ?? 0) > 0
    && isQuizModeRecovered(input.quizAttempts, wordId, "meaning-choice")
  ) {
    dimensions.push({ key: "quiz-choice", label: "辨析" });
  }
  if (
    (quizErrors["passage-cloze"] ?? 0) > 0
    && isQuizModeRecovered(input.quizAttempts, wordId, "passage-cloze")
  ) {
    dimensions.push({ key: "quiz-cloze", label: "短文填词" });
  }
  return dimensions;
}

/** 查词维度已稳定；保留既有布尔接口，判定统一委托给多维派生。 */
export function isLookupStabilized(
  wordId: number,
  input: WeakSignalInput,
  thresholds: WeakThresholds = DEFAULT_WEAK_THRESHOLDS,
) {
  return buildWordStabilizedDimensions(wordId, input, thresholds)
    .some((dimension) => dimension.key === "lookup");
}
