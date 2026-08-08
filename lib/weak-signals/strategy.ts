import {
  buildWordWeakSignals,
  isLookupDemoted,
  isQuizModeRecovered,
  lookupStatByWordId,
  quizErrorCounts,
  wordRecallStats,
} from "./detection.ts";
import {
  STUBBORN_TREATMENT_SEQUENCE,
  type SprintScope,
  type SprintTreatmentRecommendation,
  type StubbornTreatmentMode,
  type WeakSignalInput,
} from "./types.ts";
import {
  isWeakProgress,
  rebuildStubbornWords,
  type StubbornWordMap,
} from "../learning.ts";
import {
  DEFAULT_WEAK_THRESHOLDS,
  type WeakThresholds,
} from "../study.ts";

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

const STUBBORN_TREATMENT_LABELS: Record<
  StubbornTreatmentMode,
  "词义主动回忆" | "听音拼写" | "中译英"
> = {
  "lookup-recall": "词义主动回忆",
  "listening-spelling": "听音拼写",
  "chinese-to-english": "中译英",
};

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

/**
 * 限定范围的冲刺候选：先 buildSprintWordIds 全量派生，再按 section/unit 过滤；
 * 空 scope 返回全量；无 section 的词在按 section 过滤时不入选。
 */
export function buildScopedSprintWordIds(
  input: WeakSignalInput,
  wordById: ReadonlyMap<number | undefined, import("../study.ts").Word>,
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
  wordById: ReadonlyMap<number | undefined, import("../study.ts").Word>,
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
