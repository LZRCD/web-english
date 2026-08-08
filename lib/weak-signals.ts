import type { QuizAttempt, QuizMode } from "./quiz.ts";
import { learningWordId } from "./selection-lookup.ts";
import {
  isWeakProgress,
  rebuildStubbornWords,
  type ExamPhase,
  type ReviewEvent,
  type StubbornWordMap,
  type WordProgressMap,
} from "./learning.ts";
import {
  DEFAULT_WEAK_THRESHOLDS,
  type WeakThresholds,
  type GuessMistakeMap,
  type LookupStat,
  type LookupStats,
  type LookupWord,
} from "./study.ts";

/** 回忆偏慢阈值（毫秒，默认值来自 study.ts 的 WeakThresholds） */
export const SLOW_RECALL_MS = DEFAULT_WEAK_THRESHOLDS.slowRecallMs;
/** 划词 ≥2 次自动进入薄弱候选（词本划词集可标注/过滤） */
export const LOOKUP_WEAK_THRESHOLD = DEFAULT_WEAK_THRESHOLDS.lookupWeak;
/** 划词 ≥3 次自动插队今日任务 */
export const LOOKUP_PRIORITY_THRESHOLD = DEFAULT_WEAK_THRESHOLDS.lookupPriority;

export {
  DEFAULT_WEAK_THRESHOLDS,
  type WeakThresholds,
} from "./study.ts";

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

/** 本轮已接通的维度化处置建议；其余维度仍回退既有通用冲刺。 */
export type SprintTreatmentRecommendation =
  | {
      dimension: "quiz-spelling";
      mode: "listening-spelling";
      label: "听音拼写";
      wordIds: number[];
    }
  | {
      dimension: "quiz-c2e";
      mode: "chinese-to-english";
      label: "中译英";
      wordIds: number[];
    }
  | {
      dimension: "quiz-choice";
      mode: "meaning-choice";
      label: "释义辨析";
      wordIds: number[];
    }
  | {
      dimension: "lookup";
      mode: "lookup-recall";
      label: "词义主动回忆";
      wordIds: number[];
    }
  | {
      dimension: "stubborn";
      mode: StubbornTreatmentMode;
      label: "词义主动回忆" | "听音拼写" | "中译英";
      wordIds: number[];
    };

/** 顽固词的三步强化全部复用既有训练，阶段只由真实评分日志派生。 */
export const STUBBORN_TREATMENT_SEQUENCE = [
  "lookup-recall",
  "listening-spelling",
  "chinese-to-english",
] as const;

export type StubbornTreatmentMode =
  typeof STUBBORN_TREATMENT_SEQUENCE[number];

export const STUBBORN_SPRINT_SESSION_PREFIX = "sprint:stubborn:";

const STUBBORN_TREATMENT_LABELS: Record<
  StubbornTreatmentMode,
  "词义主动回忆" | "听音拼写" | "中译英"
> = {
  "lookup-recall": "词义主动回忆",
  "listening-spelling": "听音拼写",
  "chinese-to-english": "中译英",
};

export function createStubbornSprintSessionId(
  mode: StubbornTreatmentMode,
  now = new Date(),
) {
  return `${STUBBORN_SPRINT_SESSION_PREFIX}${mode}:${now.toISOString()}`;
}

/** 解析结构化顽固词冲刺 id；旧记录或非法值安全回退。 */
export function parseStubbornSprintSessionId(sessionId?: string) {
  if (!sessionId?.startsWith(STUBBORN_SPRINT_SESSION_PREFIX)) return null;
  const rest = sessionId.slice(STUBBORN_SPRINT_SESSION_PREFIX.length);
  const mode = STUBBORN_TREATMENT_SEQUENCE.find((candidate) =>
    rest.startsWith(`${candidate}:`));
  if (!mode) return null;
  const startedAt = rest.slice(mode.length + 1);
  if (!Number.isFinite(new Date(startedAt).getTime())) return null;
  return { mode, startedAt };
}

/** 已满足恢复条件、可在学习卡给出正向反馈的薄弱维度。 */
export type StabilizedDimension = {
  key:
    | "lookup"
    | "lapse"
    | "slow-recall"
    | "quiz-spelling"
    | "quiz-c2e"
    | "quiz-choice";
  /** 学习卡合并展示用的简短名称。 */
  label: string;
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

/** 最近两次同模式作答均正确时，当前测验薄弱信号视为已恢复。 */
function isQuizModeRecovered(
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
 * 聚合单个词的多维薄弱信号（查词/猜错/各模式测验/回忆/顽固/lapse）。
 * 信号按固定顺序排列，空数组表示当前没有薄弱信号。
 */
export function buildWordWeakSignals(
  wordId: number,
  input: WeakSignalInput,
  lookupById = lookupStatByWordId(input),
  thresholds: WeakThresholds = DEFAULT_WEAK_THRESHOLDS,
): string[] {
  const signals: string[] = [];
  const lookupStat = lookupById.get(wordId);
  const lookupCount = lookupStat?.count ?? 0;
  // 答对且查询不再增长（isLookupDemoted）→ 查词标签淡出，与插队队列降级口径贯通
  if (
    lookupCount >= thresholds.lookupWeak
    && !(lookupStat && isLookupDemoted(wordId, lookupStat, input))
  ) {
    signals.push(`查过${lookupCount}次`);
  }
  const guessCount = input.guessMistakes[wordId] ?? 0;
  if (guessCount > 0) signals.push(`猜错${guessCount}次`);
  const quizErrors = quizErrorCounts(input.quizAttempts, wordId);
  if (
    quizErrors["listening-spelling"]
    && !isQuizModeRecovered(input.quizAttempts, wordId, "listening-spelling")
  ) {
    signals.push(`拼写测验错${quizErrors["listening-spelling"]}次`);
  }
  if (
    quizErrors["chinese-to-english"]
    && !isQuizModeRecovered(input.quizAttempts, wordId, "chinese-to-english")
  ) {
    signals.push(`中译英错${quizErrors["chinese-to-english"]}次`);
  }
  if (
    quizErrors["meaning-choice"]
    && !isQuizModeRecovered(input.quizAttempts, wordId, "meaning-choice")
  ) {
    signals.push(`辨析错${quizErrors["meaning-choice"]}次`);
  }
  const slowCount = slowReviewCount(input.reviews, wordId, thresholds.slowRecallMs);
  // 历史慢回忆仍保留在 review/时间线/统计中；仅当前标签在可靠恢复后淡出
  if (
    slowCount > 0
    && !isSlowRecallRecovered(input.reviews, wordId, thresholds.slowRecallMs)
  ) {
    signals.push(`回忆偏慢${slowCount}次`);
  }
  if (input.stubbornWords[wordId]?.active) signals.push("顽固词");
  const progress = input.wordProgress[wordId];
  const lapseCount = progress?.lapseCount ?? 0;
  // 历史 lapse 计数保留不变；仅在既有进度判定仍弱时展示，恢复后自动淡出
  if (lapseCount > 0 && isWeakProgress(progress)) {
    signals.push(`FSRS lapse ${lapseCount}`);
  }
  return signals;
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

/** 单个分册内的单元薄弱集中度 */
export type WeakUnitConcentration = {
  unit: string;
  count: number;
};

/** 按词本分册（section）分组的薄弱集中度 */
export type WeakSectionConcentration = {
  section: string;
  /** 该分册薄弱词数 */
  total: number;
  /** 单元明细（按 count 降序） */
  units: WeakUnitConcentration[];
};

/**
 * 薄弱集中度：按 section 分组统计薄弱词数（buildWordWeakSignals 标签非空），
 * section 内按 unit 分组；无 section 的词跳过，unit 统一转字符串。
 */
export function buildWeakConcentration(
  input: WeakSignalInput,
  wordById: ReadonlyMap<number | undefined, import("./study.ts").Word>,
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
  wordById: ReadonlyMap<number | undefined, import("./study.ts").Word>,
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

/** 单次冲刺记录（由评分日志按 sessionId 分组派生） */
export type SprintHistoryRecord = {
  sessionId: string;
  /** 冲刺开始时间（createStudySession id 内嵌的 ISO 时间） */
  startedAt: string;
  /** 本次冲刺覆盖的去重词数 */
  wordCount: number;
  /** 本次冲刺当场达标（rating≥2）的去重词数 */
  successCount: number;
  /** 本次冲刺平均回忆耗时（毫秒），无合法样本为 null */
  averageRecallMs: number | null;
};

/** 冲刺历史：按时间倒序的记录 + 总计 */
export type SprintHistory = {
  records: SprintHistoryRecord[];
  /** 冲刺总次数 */
  totalCount: number;
  /** 全部冲刺覆盖的去重词数 */
  totalWordCount: number;
};

/**
 * 从评分日志派生冲刺历史：按 `sessionId.startsWith("sprint:")` 分组，
 * 每条记录取内嵌 ISO 时间、去重词数、成功词数与平均回忆耗时。
 */
export function buildSprintHistory(
  reviews: readonly ReviewEvent[],
): SprintHistory {
  const groups = new Map<string, ReviewEvent[]>();
  for (const review of reviews) {
    const sessionId = review.sessionId;
    if (!sessionId || !sessionId.startsWith("sprint:")) continue;
    const items = groups.get(sessionId) ?? [];
    items.push(review);
    groups.set(sessionId, items);
  }
  const records = [...groups.entries()].flatMap(([sessionId, items]) => {
    const startedAt = parseStubbornSprintSessionId(sessionId)?.startedAt
      ?? sessionId.slice("sprint:".length);
    if (!Number.isFinite(new Date(startedAt).getTime())) return [];
    const wordIds = new Set(
      items
        .map((review) => review.wordId)
        .filter((wordId): wordId is number => wordId !== undefined),
    );
    const successIds = new Set(
      items
        .filter((review) => review.rating >= 2)
        .map((review) => review.wordId)
        .filter((wordId): wordId is number => wordId !== undefined),
    );
    const recallTimes = items
      .map((review) => review.recallMs)
      .filter((value): value is number =>
        typeof value === "number"
        && Number.isFinite(value)
        && value >= 0);
    return [{
      sessionId,
      startedAt,
      wordCount: wordIds.size,
      successCount: successIds.size,
      averageRecallMs: recallTimes.length
        ? Math.round(
            recallTimes.reduce((sum, ms) => sum + ms, 0) / recallTimes.length,
          )
        : null,
    }];
  });
  records.sort((first, second) => second.startedAt.localeCompare(first.startedAt));
  return {
    records,
    totalCount: records.length,
    totalWordCount: new Set(
      reviews
        .filter((review) =>
          review.sessionId?.startsWith("sprint:")
          && review.wordId !== undefined)
        .map((review) => review.wordId),
    ).size,
  };
}

/** 提取某次冲刺覆盖的去重词 id（供「再跑一次」复用） */
export function buildSprintRecordWordIds(
  reviews: readonly ReviewEvent[],
  sessionId: string,
): number[] {
  const wordIds = new Set<number>();
  for (const review of reviews) {
    if (review.sessionId !== sessionId || review.wordId === undefined) continue;
    wordIds.add(review.wordId);
  }
  return [...wordIds];
}

/** 本周冲刺成效：按本地周一聚合，纯派生、不新增 schema */
export type SprintEffectiveness = {
  /** 本周冲刺次数 */
  sprintCount: number;
  /** 本周冲刺覆盖的去重词数 */
  coveredWordCount: number;
  /** 冲刺前这些词的历史平均回忆耗时（毫秒），无样本为 null */
  beforeAverageRecallMs: number | null;
  /** 冲刺期间平均回忆耗时（毫秒），无样本为 null */
  sprintAverageRecallMs: number | null;
  /** 平均回忆降幅（毫秒）：冲刺前平均 − 冲刺期间平均；正值表示回忆更快 */
  recallImprovementMs: number | null;
  /** 冲刺期间当场达标（rating≥2）的去重词数 */
  resolvedCount: number;
};

/**
 * 从评分日志按本地周一聚合本周冲刺成效。
 * 周归属用 reviewedAt；baseline 取覆盖词集中早于本周首次冲刺开始、
 * 且非冲刺会话的历史评分，避免后续冲刺样本混入（与完成页口径同源）。
 */
export function buildSprintEffectiveness(
  reviews: readonly ReviewEvent[],
  now = new Date(),
): SprintEffectiveness | null {
  const weekStart = localWeekStart(now);
  const weekStartMs = weekStart.getTime();
  const weekEndMs = addLocalDays(weekStart, 7).getTime();
  const weekSprints = reviews.filter((review) =>
    review.sessionId?.startsWith("sprint:")
    && inWindow(review.reviewedAt, weekStartMs, weekEndMs));
  if (!weekSprints.length) return null;
  const firstSprintMs = weekSprints.reduce<number>((min, review) => {
    const ms = new Date(review.reviewedAt).getTime();
    return Number.isFinite(ms) && ms < min ? ms : min;
  }, Number.POSITIVE_INFINITY);
  const coveredIds = new Set(
    weekSprints
      .map((review) => review.wordId)
      .filter((wordId): wordId is number => wordId !== undefined),
  );
  const resolvedCount = new Set(
    weekSprints
      .filter((review) => review.rating >= 2)
      .map((review) => review.wordId),
  ).size;
  const sprintSamples = weekSprints
    .map((review) => review.recallMs)
    .filter((value): value is number =>
      typeof value === "number" && Number.isFinite(value) && value >= 0);
  const sprintAverageRecallMs = sprintSamples.length
    ? Math.round(
        sprintSamples.reduce((sum, ms) => sum + ms, 0) / sprintSamples.length,
      )
    : null;
  const beforeSamples = reviews.flatMap<number>((review) => {
    const reviewedAtMs = new Date(review.reviewedAt).getTime();
    if (
      review.wordId !== undefined
      && coveredIds.has(review.wordId)
      && Number.isFinite(reviewedAtMs)
      && reviewedAtMs < firstSprintMs
      && !review.sessionId?.startsWith("sprint:")
      && typeof review.recallMs === "number"
      && Number.isFinite(review.recallMs)
      && review.recallMs >= 0
    ) {
      return [review.recallMs];
    }
    return [];
  });
  const beforeAverageRecallMs = beforeSamples.length
    ? Math.round(
        beforeSamples.reduce((sum, ms) => sum + ms, 0) / beforeSamples.length,
      )
    : null;
  return {
    sprintCount: new Set(weekSprints.map((review) => review.sessionId)).size,
    coveredWordCount: coveredIds.size,
    beforeAverageRecallMs,
    sprintAverageRecallMs,
    recallImprovementMs:
      beforeAverageRecallMs !== null && sprintAverageRecallMs !== null
        ? beforeAverageRecallMs - sprintAverageRecallMs
        : null,
    resolvedCount,
  };
}

/** 某周冲刺成效（无该周冲刺记录时为 null） */
export type SprintEffectivenessWeek = {
  weekStart: string;
  effectiveness: SprintEffectiveness | null;
};

/**
 * 冲刺成效近 N 周序列（含本周，按时间升序）。
 * 复用 buildSprintEffectiveness 的单周口径：对每周围一个该周内的 now 派生，
 * 无冲刺周的周为 null（不虚报 0），与 buildWeakDimensionTrendSeries 同构。
 */
export function buildSprintEffectivenessSeries(
  reviews: readonly ReviewEvent[],
  now = new Date(),
  weeks = 4,
): SprintEffectivenessWeek[] {
  const thisWeekStart = localWeekStart(now);
  const count = Math.max(1, Math.trunc(weeks));
  const series: SprintEffectivenessWeek[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const start = addLocalDays(thisWeekStart, -offset * 7);
    const weekNow = addLocalDays(start, 3);
    weekNow.setHours(12, 0, 0, 0);
    series.push({
      weekStart: localDateKey(start),
      effectiveness: buildSprintEffectiveness(reviews, weekNow),
    });
  }
  return series;
}

/** 某个冲刺周当场达标词截至当前的薄弱追踪：保留旧接口名，不代表历史复发事件。 */
export type SprintRelapse = {
  /** 该周冲刺当场达标（rating≥2 去重）词数 */
  solvedCount: number;
  /** 该周当场达标词中当前仍薄弱（buildWordWeakSignals 非空）的词数 */
  relapsedCount: number;
  /** 当前仍薄弱率（relapsedCount / solvedCount，0–100 取整） */
  relapseRate: number;
  /** 当前仍薄弱词 id（按当前薄弱信号数降序，便于定位） */
  relapsedIds: number[];
};

/** 某个已完成冲刺周截至当前的薄弱结果（无当场达标词时为 null） */
export type SprintRelapseWeek = {
  /** 冲刺处置周起始日（本地周一，YYYY-MM-DD） */
  weekStart: string;
  /** 截至当前的薄弱结果；该周无冲刺当场达标词时为 null */
  relapse: SprintRelapse | null;
};

/**
 * 一次扫描按本地周收集冲刺当场达标词，供单周追踪与多周回溯共用。
 * 同词在多个所选周达标时只归最近一次处置周，避免跨周重复样本。
 */
function buildSprintSolvedCohorts(
  reviews: readonly ReviewEvent[],
  weekStarts: readonly Date[],
): Map<string, Set<number>> {
  const cohorts = new Map(
    weekStarts.map((start) => [localDateKey(start), new Set<number>()]),
  );
  const latestCohortByWordId = new Map<
    number,
    { weekKey: string; reviewedAtMs: number }
  >();
  for (const review of reviews) {
    if (
      !review.sessionId?.startsWith("sprint:")
      || review.rating < 2
      || review.wordId === undefined
    ) continue;
    const reviewedAtMs = new Date(review.reviewedAt).getTime();
    if (!Number.isFinite(reviewedAtMs)) continue;
    const weekKey = localDateKey(localWeekStart(new Date(reviewedAtMs)));
    if (!cohorts.has(weekKey)) continue;
    const previous = latestCohortByWordId.get(review.wordId);
    if (!previous || reviewedAtMs > previous.reviewedAtMs) {
      latestCohortByWordId.set(review.wordId, { weekKey, reviewedAtMs });
    }
  }
  for (const [wordId, { weekKey }] of latestCohortByWordId) {
    cohorts.get(weekKey)?.add(wordId);
  }
  return cohorts;
}

/** 用当前统一薄弱画像判断一个当场达标 cohort，并复用跨 cohort 的判定缓存。 */
function buildSprintCohortRelapse(
  solvedIds: ReadonlySet<number> | undefined,
  input: WeakSignalInput,
  thresholds: WeakThresholds,
  weakSignalCountByWordId = new Map<number, number>(),
): SprintRelapse | null {
  if (!solvedIds?.size) return null;
  const relapsedIds = [...solvedIds]
    .map((wordId) => {
      let signalCount = weakSignalCountByWordId.get(wordId);
      if (signalCount === undefined) {
        signalCount = buildWordWeakSignals(
          wordId,
          input,
          undefined,
          thresholds,
        ).length;
        weakSignalCountByWordId.set(wordId, signalCount);
      }
      return { wordId, signalCount };
    })
    .filter((item) => item.signalCount > 0)
    .sort((first, second) => second.signalCount - first.signalCount)
    .map((item) => item.wordId);
  return {
    solvedCount: solvedIds.size,
    relapsedCount: relapsedIds.length,
    relapseRate: Math.round((relapsedIds.length / solvedIds.size) * 100),
    relapsedIds,
  };
}

/**
 * 追踪上周冲刺当场达标词的当前薄弱情况：取上周一至本周一之间、
 * 且 sessionId 为冲刺会话的 rating≥2 去重词集，再过滤当前仍薄弱的词。
 * 周划分与 buildSprintEffectiveness 一致（本地周一）。
 * 旧接口名仅为兼容；当前状态不能区分从未恢复与恢复后再次薄弱。
 */
export function buildSprintRelapse(
  reviews: readonly ReviewEvent[],
  input: WeakSignalInput,
  now = new Date(),
  thresholds: WeakThresholds = DEFAULT_WEAK_THRESHOLDS,
): SprintRelapse | null {
  const weekStart = localWeekStart(now);
  const lastWeekStart = addLocalDays(weekStart, -7);
  const weekKey = localDateKey(lastWeekStart);
  const cohorts = buildSprintSolvedCohorts(reviews, [lastWeekStart]);
  return buildSprintCohortRelapse(
    cohorts.get(weekKey),
    input,
    thresholds,
  );
}

/**
 * 最近 N 个已完成冲刺周的截至当前薄弱率回溯（按时间升序）。
 * 这是按最近一次达标处置周分组后用当前统一薄弱画像回看，
 * 不是历史周末状态快照，也不能区分从未恢复与恢复后再次薄弱。
 */
export function buildSprintRelapseSeries(
  reviews: readonly ReviewEvent[],
  input: WeakSignalInput,
  now = new Date(),
  weeks = 4,
  thresholds: WeakThresholds = DEFAULT_WEAK_THRESHOLDS,
): SprintRelapseWeek[] {
  const thisWeekStart = localWeekStart(now);
  const count = Math.max(1, Math.trunc(weeks));
  const weekStarts: Date[] = [];
  for (let offset = count; offset >= 1; offset -= 1) {
    weekStarts.push(addLocalDays(thisWeekStart, -offset * 7));
  }
  const cohorts = buildSprintSolvedCohorts(reviews, weekStarts);
  const weakSignalCountByWordId = new Map<number, number>();
  return weekStarts.map((start) => {
    const weekStart = localDateKey(start);
    return {
      weekStart,
      relapse: buildSprintCohortRelapse(
        cohorts.get(weekStart),
        input,
        thresholds,
        weakSignalCountByWordId,
      ),
    };
  });
}

/** 考前薄弱冲刺候选：已学且统一薄弱画像非空的词 id，按薄弱程度排序 */
export function buildSprintWordIds(
  input: WeakSignalInput,
  thresholds: WeakThresholds = DEFAULT_WEAK_THRESHOLDS,
): number[] {
  const lookupById = lookupStatByWordId(input);
  const items: {
    wordId: number;
    lapseCount: number;
    lookupCount: number;
    recallAvgMs: number;
  }[] = [];
  for (const wordId of Object.keys(input.wordProgress)) {
    const id = Number(wordId);
    const progress = input.wordProgress[id];
    if (!progress) continue;
    const lookupCount = lookupById.get(id)?.count ?? 0;
    const recall = wordRecallStats(input.reviews, id);
    const recallAvgMs = recall?.averageMs ?? 0;
    if (!buildWordWeakSignals(id, input, lookupById, thresholds).length) continue;
    items.push({
      wordId: id,
      lapseCount: progress.lapseCount,
      lookupCount,
      recallAvgMs,
    });
  }
  return items
    .sort((first, second) =>
      second.lapseCount - first.lapseCount
      || second.lookupCount - first.lookupCount
      || second.recallAvgMs - first.recallAvgMs)
    .map((item) => item.wordId);
}

function activeStubbornRecordsAt(
  input: WeakSignalInput,
  at?: Date,
): StubbornWordMap {
  if (!at) return input.stubbornWords;
  const cutoffMs = at.getTime();
  if (!Number.isFinite(cutoffMs)) return input.stubbornWords;
  const storedAtCutoff = Object.fromEntries(
    Object.entries(input.stubbornWords).filter(([, record]) => {
      const triggeredMs = new Date(record.triggeredAt).getTime();
      const resolvedMs = record.resolvedAt
        ? new Date(record.resolvedAt).getTime()
        : Number.POSITIVE_INFINITY;
      return Number.isFinite(triggeredMs)
        && triggeredMs <= cutoffMs
        && (!Number.isFinite(resolvedMs) || resolvedMs > cutoffMs);
    }),
  ) as StubbornWordMap;
  const reviewsAtCutoff = input.reviews.filter((review) =>
    new Date(review.reviewedAt).getTime() <= cutoffMs);
  return {
    ...storedAtCutoff,
    ...rebuildStubbornWords(reviewsAtCutoff, at),
  };
}

function stubbornTreatmentModeForWord(
  input: WeakSignalInput,
  wordId: number,
  triggeredAt: string,
  at?: Date,
): StubbornTreatmentMode {
  const cutoffMs = at?.getTime() ?? Number.POSITIVE_INFINITY;
  const reviews = input.reviews
    .filter((review) =>
      review.wordId === wordId
      && review.reviewedAt >= triggeredAt
      && new Date(review.reviewedAt).getTime() <= cutoffMs)
    .sort((first, second) => first.reviewedAt.localeCompare(second.reviewedAt));
  // 旧版手工记录若没有对应低评分事件，不推导虚假的历史阶段。
  if (!reviews.some((review) => review.rating <= 1)) {
    return STUBBORN_TREATMENT_SEQUENCE[0];
  }
  let successStreak = 0;
  for (let index = reviews.length - 1; index >= 0; index -= 1) {
    if (reviews[index].rating <= 1) break;
    successStreak += 1;
  }
  return STUBBORN_TREATMENT_SEQUENCE[Math.min(
    successStreak,
    STUBBORN_TREATMENT_SEQUENCE.length - 1,
  )];
}

/**
 * 顽固词按真实 review 的连续成功数分组；一次只启动一个模式，其他阶段继续保留。
 * 传入 at 时按会话开始时刻重建候选，保证刷新后题组不因后续作答漂移。
 */
export function buildStubbornTreatmentRecommendation(
  input: WeakSignalInput,
  at?: Date,
): Extract<SprintTreatmentRecommendation, { dimension: "stubborn" }> | null {
  const records = activeStubbornRecordsAt(input, at);
  const activeRecords = Object.values(records)
    .filter((record) => record.active && Boolean(input.wordProgress[record.wordId]))
    .sort((first, second) => {
      const lapseDifference = (input.wordProgress[second.wordId]?.lapseCount ?? 0)
        - (input.wordProgress[first.wordId]?.lapseCount ?? 0);
      return lapseDifference || first.triggeredAt.localeCompare(second.triggeredAt);
    });
  for (const mode of STUBBORN_TREATMENT_SEQUENCE) {
    const wordIds = activeRecords
      .filter((record) =>
        stubbornTreatmentModeForWord(
          input,
          record.wordId,
          record.triggeredAt,
          at,
        ) === mode)
      .map((record) => record.wordId);
    if (wordIds.length) {
      return {
        dimension: "stubborn",
        mode,
        label: STUBBORN_TREATMENT_LABELS[mode],
        wordIds,
      };
    }
  }
  return null;
}

/**
 * 为统一冲刺入口选择当前已实现的最高优先级专项。
 * 只读取结构化测验/查词状态，不通过标签文案反推维度；已恢复的词自动退出。
 */
export function buildSprintTreatmentRecommendation(
  input: WeakSignalInput,
  thresholds: WeakThresholds = DEFAULT_WEAK_THRESHOLDS,
): SprintTreatmentRecommendation | null {
  const sprintWordIds = buildSprintWordIds(input, thresholds);
  const priorities = [
    {
      dimension: "quiz-spelling",
      mode: "listening-spelling",
      label: "听音拼写",
    },
    {
      dimension: "quiz-c2e",
      mode: "chinese-to-english",
      label: "中译英",
    },
    {
      dimension: "quiz-choice",
      mode: "meaning-choice",
      label: "释义辨析",
    },
  ] as const;
  for (const treatment of priorities) {
    const wordIds = sprintWordIds.filter((wordId) => {
      const errors = quizErrorCounts(input.quizAttempts, wordId);
      return Boolean(errors[treatment.mode])
        && !isQuizModeRecovered(input.quizAttempts, wordId, treatment.mode);
    });
    if (wordIds.length) return { ...treatment, wordIds };
  }
  const lookupById = lookupStatByWordId(input);
  const lookupWordIds = sprintWordIds.filter((wordId) => {
    const stat = lookupById.get(wordId);
    const progress = input.wordProgress[wordId];
    return Boolean(
      stat
      && stat.count >= thresholds.lookupWeak
      && !isLookupDemoted(wordId, stat, input)
      && !isWeakProgress(progress),
    );
  });
  if (lookupWordIds.length) {
    return {
      dimension: "lookup",
      mode: "lookup-recall",
      label: "词义主动回忆",
      wordIds: lookupWordIds,
    };
  }
  return buildStubbornTreatmentRecommendation(input);
}

/** 冲刺范围：按词本分册/单元过滤（unit 统一按字符串匹配） */
export type SprintScope = {
  section?: string;
  unit?: string;
};

/**
 * 限定范围的冲刺候选：先 buildSprintWordIds 全量派生，再按 section/unit 过滤；
 * 空 scope 返回全量；无 section 的词在按 section 过滤时不入选。
 */
export function buildScopedSprintWordIds(
  input: WeakSignalInput,
  wordById: ReadonlyMap<number | undefined, import("./study.ts").Word>,
  scope: SprintScope = {},
  thresholds: WeakThresholds = DEFAULT_WEAK_THRESHOLDS,
): number[] {
  const sprintIds = buildSprintWordIds(input, thresholds);
  if (!scope.section && scope.unit === undefined) return sprintIds;
  return sprintIds.filter((wordId) => {
    const word = wordById.get(wordId);
    if (!word) return false;
    if (scope.section && word.section !== scope.section) return false;
    if (scope.unit !== undefined && String(word.unit) !== String(scope.unit)) {
      return false;
    }
    return true;
  });
}

/** 薄弱冲刺清单：只含冲刺词，复用词级薄弱标签 */
export function buildSprintSummary(
  input: WeakSignalInput,
  wordById: ReadonlyMap<number | undefined, import("./study.ts").Word>,
  thresholds: WeakThresholds = DEFAULT_WEAK_THRESHOLDS,
): { word: string; signals: string[] }[] {
  return buildSprintWordIds(input, thresholds).flatMap((wordId) => {
    const word = wordById.get(wordId)?.word;
    if (!word) return [];
    const signals = buildWordWeakSignals(wordId, input, undefined, thresholds);
    if (!signals.length) return [];
    return [{ word, signals }];
  });
}

/** CSV 字段转义：含逗号/双引号/换行时双引号包裹，内部双引号翻倍 */
function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * 薄弱冲刺清单导出 CSV（词,信号列表）。含 BOM 前缀，Excel 打开中文不乱码；
 * 无条目返回空串。
 */
export function buildSprintCsv(
  summary: readonly { word: string; signals: string[] }[],
): string {
  if (!summary.length) return "";
  const lines = summary.map((item) =>
    [item.word, item.signals.join("、")].map(csvField).join(","));
  return `\uFEFF词,信号列表\n${lines.join("\n")}\n`;
}

const QUIZ_MODE_LABELS: Partial<Record<QuizMode, string>> = {
  "listening-spelling": "拼写测验",
  "chinese-to-english": "中译英",
  "meaning-choice": "辨析",
};

const REVIEW_RATING_LABELS = ["忘记", "模糊", "认识", "熟练"] as const;

/** 词级信号时间线中的单个事件 */
export type WordSignalEvent = {
  at: string;
  type: "review" | "slow-recall" | "lapse" | "quiz" | "lookup" | "stubborn";
  detail: string;
};

/**
 * 该词的信号时间线：普通评分、回忆偏慢/lapse、测验答错、查词、顽固词触发，
 * 全部由现有状态派生，按时间升序；无记录返回空数组。
 */
export function buildWordSignalTimeline(
  wordId: number,
  input: WeakSignalInput,
  thresholds: WeakThresholds = DEFAULT_WEAK_THRESHOLDS,
): WordSignalEvent[] {
  const events: WordSignalEvent[] = [];
  const seenReviewIds = new Set<string>();
  for (const review of input.reviews) {
    if (review.wordId !== wordId) continue;
    if (seenReviewIds.has(review.id)) continue;
    seenReviewIds.add(review.id);
    // rating=0 已由既有 lapse 事件表达，避免同一动作重复显示为普通复习。
    if (review.rating !== 0) {
      events.push({
        at: review.reviewedAt,
        type: "review",
        detail: `${review.sessionId?.startsWith("sprint:") ? "冲刺复习" : "复习"} · ${REVIEW_RATING_LABELS[review.rating]}（评分 ${review.rating}）`,
      });
    }
    if (
      typeof review.recallMs === "number"
      && review.recallMs >= thresholds.slowRecallMs
    ) {
      events.push({
        at: review.reviewedAt,
        type: "slow-recall",
        detail: `回忆偏慢 ${(review.recallMs / 1000).toFixed(1)}s`,
      });
    }
    if (review.rating === 0) {
      events.push({
        at: review.reviewedAt,
        type: "lapse",
        detail: "遗忘（评分 0）",
      });
    }
  }
  for (const attempt of input.quizAttempts) {
    if (attempt.wordId !== wordId || attempt.correct) continue;
    events.push({
      at: attempt.answeredAt,
      type: "quiz",
      detail: `${QUIZ_MODE_LABELS[attempt.mode] ?? attempt.mode} 答错`,
    });
  }
  const lookupStat = lookupStatByWordId(input).get(wordId);
  if (lookupStat) {
    events.push({
      at: lookupStat.firstAt,
      type: "lookup",
      detail: `首次查词（累计 ${lookupStat.count} 次）`,
    });
    if (lookupStat.lastAt !== lookupStat.firstAt) {
      events.push({
        at: lookupStat.lastAt,
        type: "lookup",
        detail: `最近查词（累计 ${lookupStat.count} 次）`,
      });
    }
  }
  const stubborn = input.stubbornWords[wordId];
  if (stubborn?.active) {
    events.push({
      at: stubborn.triggeredAt,
      type: "stubborn",
      detail: "进入顽固词",
    });
  }
  return events.sort((first, second) => first.at.localeCompare(second.at));
}

/** 划词达到阈值且未被近期答对覆盖的词 id（今日任务插队，按查询次数倒序） */
export function lookupPriorityWordIds(
  input: WeakSignalInput,
  thresholds: WeakThresholds = DEFAULT_WEAK_THRESHOLDS,
): number[] {
  const items: { wordId: number; stat: LookupStat }[] = [];
  for (const [wordId, stat] of lookupStatByWordId(input)) {
    if ((stat.count ?? 0) < thresholds.lookupPriority) continue;
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

function localDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** 单个维度的周级统计（startMs 所在周 vs 上一周） */
function buildTrendForWeek(
  input: WeakSignalInput,
  weekStartMs: number,
  weekEndMs: number,
  thresholds: WeakThresholds = DEFAULT_WEAK_THRESHOLDS,
): WeakDimensionTrend[] {
  const previousStartMs = weekStartMs - 7 * 24 * 60 * 60 * 1000;

  const lookupById = lookupStatByWordId(input);
  const lookupWords = (startMs: number, endMs: number) =>
    [...lookupById.values()].filter((stat) =>
      (stat.count ?? 0) >= thresholds.lookupWeak
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
    typeof review.recallMs === "number"
    && review.recallMs >= thresholds.slowRecallMs;
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

/**
 * 考研冲刺/临考期应强调的薄弱维度 key。
 * 这些维度直接决定临考记忆缺口，趋势区用红色系突出显示。
 */
export function emphasizedWeakDimensions(
  examPhase: ExamPhase | undefined,
): WeakDimensionTrend["key"][] {
  if (examPhase === "临考期" || examPhase === "冲刺期") {
    return ["lookup", "lapse", "slow-recall"];
  }
  return [];
}

/** 连续多周的薄弱维度趋势（含本周，按时间升序） */
export type WeakDimensionTrendWeek = {
  /** 该周起始日（本地周一，YYYY-MM-DD） */
  weekStart: string;
  dimensions: WeakDimensionTrend[];
};

/**
 * 本周各薄弱维度趋势（按本地周一划分，风格与 insights.ts 周报一致）。
 * 可归因到周的维度统计本周/上周去重词数；猜词猜错为累计口径（无周级时间源）。
 */
export function buildWeakDimensionTrend(
  input: WeakSignalInput,
  now = new Date(),
  thresholds: WeakThresholds = DEFAULT_WEAK_THRESHOLDS,
): WeakDimensionTrend[] {
  const weekStart = localWeekStart(now);
  return buildTrendForWeek(
    input,
    weekStart.getTime(),
    addLocalDays(weekStart, 7).getTime(),
    thresholds,
  );
}

/**
 * 薄弱维度近 N 周趋势序列（含本周，按时间升序）。
 * 复用 buildWeakDimensionTrend 的周划分与维度口径，供轨迹页连续观察。
 */
export function buildWeakDimensionTrendSeries(
  input: WeakSignalInput,
  now = new Date(),
  weeks = 4,
  thresholds: WeakThresholds = DEFAULT_WEAK_THRESHOLDS,
): WeakDimensionTrendWeek[] {
  const thisWeekStart = localWeekStart(now);
  const count = Math.max(1, Math.trunc(weeks));
  const series: WeakDimensionTrendWeek[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const start = addLocalDays(thisWeekStart, -offset * 7);
    const weekStartMs = start.getTime();
    series.push({
      weekStart: localDateKey(start),
      dimensions: buildTrendForWeek(
        input,
        weekStartMs,
        weekStartMs + 7 * 24 * 60 * 60 * 1000,
        thresholds,
      ),
    });
  }
  return series;
}
