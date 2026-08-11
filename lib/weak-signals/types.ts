import type { QuizAttempt } from "../quiz.ts";
import type {
  ReviewEvent,
  StubbornWordMap,
  WordProgressMap,
} from "../learning.ts";
import type {
  GuessMistakeMap,
  LookupStats,
  LookupWord,
} from "../study.ts";

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

export const SPRINT_TREATMENT_DIMENSIONS = [
  "listening-spelling",
  "chinese-to-english",
  "meaning-choice",
  "lookup-recall",
  "stubborn",
  "slow-recall",
  "lapse",
  "generic-sprint",
] as const;

export type SprintTreatmentDimension =
  typeof SPRINT_TREATMENT_DIMENSIONS[number];

export type ParsedSprintSession = {
  dimension: SprintTreatmentDimension | "unknown";
  format: "treatment" | "stubborn" | "legacy";
  startedAt?: string;
  submode?: StubbornTreatmentMode;
};

/** 已满足恢复条件、可在学习卡给出正向反馈的薄弱维度。 */
export type StabilizedDimension = {
  key:
    | "lookup"
    | "lapse"
    | "slow-recall"
    | "quiz-spelling"
    | "quiz-c2e"
    | "quiz-choice"
    | "quiz-cloze";
  /** 学习卡合并展示用的简短名称。 */
  label: string;
};

/** 周报薄弱维度趋势的单个维度 */
export type WeakDimensionTrend = {
  key:
    | "lookup"
    | "guess"
    | "quiz-spelling"
    | "quiz-c2e"
    | "quiz-choice"
    | "quiz-cloze"
    | "slow-recall"
    | "stubborn"
    | "lapse";
  label: string;
  /** 本周出现该信号的去重词数（guess 为累计词数） */
  count: number;
  /** 较上周变化；累计口径无周级变化源时为 null */
  change: number | null;
};

/** 薄弱信号稳定 key：与 WeakDimensionTrend.key 完全同源，作为领域通信协议 */
export type WeakSignalKey = WeakDimensionTrend["key"];

/** 结构化薄弱信号条目：稳定 key 与中文展示标签分离 */
export type WeakSignalEntry = {
  key: WeakSignalKey;
  /** 展示标签（逐字保持现有中文文案，不得改写） */
  label: string;
};

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
 * 同词配对回忆变化：目标侧按词内全部合法事件取均值，基线侧取边界前
 * 最近一次非冲刺合法事件，再跨词等权。变化值为目标均值减基线均值：
 * 负值表示目标侧更快，正值表示目标侧更慢。
 */
export type PairedRecallChange = {
  /** 两侧都有合法样本的去重词数 */
  pairedWordCount: number;
  /** 配对词的边界前最近非冲刺回忆均值 */
  pairedBeforeAverageRecallMs: number | null;
  /** 配对词的目标事件词内均值，再跨词等权 */
  pairedTargetAverageRecallMs: number | null;
  /** 目标均值 − 基线均值；负值更快、正值更慢 */
  pairedChangeMs: number | null;
};

/** 本周冲刺观察：按本地周一聚合，纯派生、不新增 schema */
export type SprintEffectiveness = {
  /** 本周冲刺次数 */
  sprintCount: number;
  /** 本周冲刺覆盖的去重词数 */
  coveredWordCount: number;
  /** 同词配对回忆变化；无配对样本时各均值与变化为 null */
  pairedRecall: PairedRecallChange;
  /** 冲刺期间当场达标（rating≥2）的去重词数 */
  resolvedCount: number;
};

/** 某周冲刺成效（无该周冲刺记录时为 null） */
export type SprintEffectivenessWeek = {
  weekStart: string;
  effectiveness: SprintEffectiveness | null;
};

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

/** 冲刺后首次正常复习保持中的同词测时配对；变化为随访 − 冲刺。 */
export type SprintRetentionPairedRecall = {
  sampleCount: number;
  sprintAverageRecallMs: number | null;
  followUpAverageRecallMs: number | null;
  changeMs: number | null;
};

/** 一个完整处置周的首次正常复习保持观察。 */
export type SprintRetention = {
  /** 窗口内最近一次成功冲刺锚点的去重词数。 */
  cohortWordCount: number;
  /** 锚点后、下一次冲刺前已有首条非冲刺 review 的词数。 */
  followedUpCount: number;
  /** 尚无可观察随访的词数；包含已被下一次冲刺截断的词。 */
  unobservedCount: number;
  /** 首条后续事件是下一次冲刺、因而不能跨冲刺观察的词数。 */
  truncatedCount: number;
  /** 随访覆盖率（0–100）；cohort 为空时为 null。 */
  coverageRate: number | null;
  /** 首条非冲刺 review 评分 rating≥2 的词数。 */
  retainedCount: number;
  /** 保持率（0–100）；没有已观察词时为 null。 */
  retentionRate: number | null;
  /** 已观察词从锚点到首次非冲刺 review 的词等权平均间隔。 */
  followUpDelayMs: number | null;
  pairedRecall: SprintRetentionPairedRecall;
};

/** 最近完整处置周的保持观察；空 cohort 周保持为 null。 */
export type SprintRetentionWeek = {
  weekStart: string;
  retention: SprintRetention | null;
};

export type DimensionObservationRow = {
  dimension: SprintTreatmentDimension | "unknown";
  sessionCount: number;
  coveredWordCount: number;
  resolvedCount: number;
  cohortWordCount: number;
  followedUpCount: number;
  unobservedCount: number;
  truncatedCount: number;
  coverageRate: number | null;
  retainedCount: number;
  retentionRate: number | null;
  followUpDelayMs: number | null;
  pairedRecall: SprintRetentionPairedRecall;
  stillWeakCount: number;
  stillWeakRate: number | null;
  stubbornSubmodeSessionCounts?: Partial<Record<StubbornTreatmentMode, number>>;
};

export type DimensionObservationReport = {
  windowStart: string;
  windowEnd: string;
  rows: DimensionObservationRow[];
};

/** 冲刺范围：按词本分册/单元过滤（unit 统一按字符串匹配） */
export type SprintScope = {
  section?: string;
  unit?: string;
};

/** 词级信号时间线中的单个事件 */
export type WordSignalEvent = {
  at: string;
  type: "review" | "slow-recall" | "lapse" | "quiz" | "lookup" | "stubborn";
  detail: string;
};

/** 连续多周的薄弱维度趋势（含本周，按时间升序） */
export type WeakDimensionTrendWeek = {
  /** 该周起始日（本地周一，YYYY-MM-DD） */
  weekStart: string;
  dimensions: WeakDimensionTrend[];
};
