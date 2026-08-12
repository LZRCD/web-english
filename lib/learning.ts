import {
  createEmptyCard,
  fsrs,
  Rating as FsrsRating,
  State as FsrsState,
  type Card,
  type CardInput,
  type FSRSHistory,
  type Grade,
} from "ts-fsrs";
import { canonicalWordId } from "./redbook.ts";
import type { EtymologyCacheEntry } from "./etymology.ts";
import { seededScore } from "./word-utils.ts";

export type Rating = 0 | 1 | 2 | 3;
export type ReviewKind = "new" | "review";
export type MemoryStatus = "learning" | "reviewing" | "mastered";
export type SessionBatchSize = 5 | 10 | 15 | 20;
export type SessionKind =
  | "today"
  | "favorites"
  | "mistakes"
  | "stubborn"
  | "search"
  | "lookups"
  | "article"
  | "sprint"
  | "vocab-test"
  | "reinforcement";

export type ReviewEvent = {
  id: string;
  /** 评分所属学习会话；旧记录可缺省。 */
  sessionId?: string;
  wordId?: number;
  word: string;
  rating: Rating;
  kind: ReviewKind;
  intervalMs: number;
  dueAt: string;
  reviewedAt: string;
  recallMs?: number;
  section?: string;
  unit?: number | string;
};

export type SerializedFsrsCard = {
  due: string;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: FsrsState;
  lastReview?: string;
};

export type WordProgress = {
  wordId: number;
  status: MemoryStatus;
  firstLearnedAt: string;
  lastReviewedAt: string;
  nextDueAt: string;
  lastRating: Rating;
  reviewCount: number;
  successCount: number;
  lapseCount: number;
  consecutiveSuccesses: number;
  intervalMs: number;
  fsrsCard: SerializedFsrsCard;
  weakResolvedAt?: string;
};

export type WordProgressMap = Record<number, WordProgress>;

export type StudySession = {
  id: string;
  kind: SessionKind;
  /** 强化会话完成后返回原始入口。 */
  originKind?: Exclude<SessionKind, "reinforcement">;
  title: string;
  wordIds: number[];
  index: number;
  createdAt: string;
};

export type TodayQueueOptions = {
  familyKeyByWordId?: Record<number, string>;
  reviewedTodayWordIds?: number[];
  /** 划词补漏：反复查询(≥3 次)的词 id，插在到期词之后、新词之前 */
  lookupPriorityIds?: number[];
  /**
   * 今日任务整体乱序种子（通常按日期派生，当天固定、每天换新）。
   * 提供时把到期/补漏/新词完全混合随机；缺省保持「到期 → 补漏 → 新词」顺序。
   */
  shuffleSeed?: number;
};

export type TodayTaskPreview = {
  wordIds: number[];
  dueWordIds: number[];
  lookupWordIds: number[];
  newWordIds: number[];
  totalCount: number;
  dueCount: number;
  lookupCount: number;
  newCount: number;
  estimatedMinutes: number;
  goalExplanation: string;
  complete: boolean;
};

export type TodaySessionBatch = {
  batchWordIds: number[];
  batchCount: number;
  totalRemainingCount: number;
  estimatedMinutes: number;
  complete: boolean;
};

export type StudyWordSource = {
  label: string;
  description: string;
};

export type StubbornWordRecord = {
  wordId: number;
  active: boolean;
  reason: "again-3" | "low-5";
  triggeredAt: string;
  lastChangedAt: string;
  triggerCount: number;
  resolvedAt?: string;
};

export type StubbornWordMap = Record<number, StubbornWordRecord>;

export type SenseExample = {
  meaning: string;
  sentence: string;
  translation: string;
  confidence?: number;
  feedback?: {
    reason: "meaning-mismatch";
    reportedAt: string;
  };
  review?: {
    status: "pending" | "passed" | "failed";
    confidence?: number;
    note?: string;
    reviewedAt?: string;
  };
};

export type WordEnrichment = {
  phonetic?: string;
  sentence?: string;
  translation?: string;
  /** 按释义逐条生成的例句，sentence/translation 取第一条以便向下兼容 */
  senseExamples?: SenseExample[];
  collocations?: string[];
  targetMeanings?: string[];
  source: "redbook" | "dictionary" | "ai";
  generatedAt?: string;
  verified?: boolean;
  etymology?: EtymologyCacheEntry;
};

export type SenseFrequencyLevel = "high" | "medium" | "low";

export type SenseFrequencyEntry = {
  /** 与红宝书义项文本一致 */
  meaning: string;
  /** 考研语境下的考频等级：high 高频常考 / medium 中频 / low 低频 */
  level: SenseFrequencyLevel;
  /** 简短提示，如「真题常考熟词僻义」 */
  note?: string;
};

/** 多义词义项考频：key 为学习项 wordId */
export type SenseFrequencyMap = Record<number, SenseFrequencyEntry[]>;
export type RatingResult = {
  review: ReviewEvent;
  progress: WordProgress;
};

export type ExamPhase = "基础期" | "强化期" | "冲刺期" | "临考期";

export type ExamPlan = {
  daysRemaining: number;
  phase: ExamPhase;
  reviewReserveDays: number;
  remainingWords: number;
  requiredDailyNew: number;
  projectedDays: number;
  onTrack: boolean;
  focusSection: "必考词" | "基础词" | "超纲词" | "复习";
};

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
export const FSRS_REQUEST_RETENTION = 0.9;
const scheduler = fsrs({ request_retention: FSRS_REQUEST_RETENTION });
const FSRS_RATINGS = [
  FsrsRating.Again,
  FsrsRating.Hard,
  FsrsRating.Good,
  FsrsRating.Easy,
] as const;

function progressStatus(
  state: FsrsState,
  consecutiveSuccesses: number,
  scheduledDays: number,
): MemoryStatus {
  if (
    state === FsrsState.New
    || state === FsrsState.Learning
    || state === FsrsState.Relearning
  ) {
    return "learning";
  }
  return consecutiveSuccesses >= 3 && scheduledDays >= 30
    ? "mastered"
    : "reviewing";
}

function serializeCard(card: Card): SerializedFsrsCard {
  return {
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    lastReview: card.last_review?.toISOString(),
  };
}

function restoreCard(card: SerializedFsrsCard): CardInput {
  return {
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsedDays,
    scheduled_days: card.scheduledDays,
    learning_steps: card.learningSteps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.lastReview,
  };
}

function intervalFromCard(card: Card, reviewedAt: Date) {
  return Math.max(MINUTE, card.due.getTime() - reviewedAt.getTime());
}

export function nextInterval(
  previous: WordProgress | undefined,
  rating: Rating,
  now = new Date(),
) {
  const card = previous?.fsrsCard
    ? restoreCard(previous.fsrsCard)
    : createEmptyCard(now);
  const preview = scheduler.repeat(card, now)[FSRS_RATINGS[rating]].card;
  return intervalFromCard(preview, now);
}

export function createReviewId(wordId: number, reviewedAt: string) {
  const random = Math.random().toString(36).slice(2, 9);
  return `${canonicalWordId(wordId)}:${reviewedAt}:${random}`;
}

export function applyRating(
  previous: WordProgress | undefined,
  input: {
    wordId: number;
    word: string;
    rating: Rating;
    reviewedAt: string;
    section?: string;
    unit?: number | string;
    reviewId?: string;
    recallMs?: number;
    sessionId?: string;
  },
): RatingResult {
  const wordId = canonicalWordId(input.wordId);
  const rating = input.rating;
  const reviewedAt = new Date(input.reviewedAt);
  const previousCard = previous?.fsrsCard
    ? restoreCard(previous.fsrsCard)
    : createEmptyCard(reviewedAt);
  const scheduled = scheduler.next(
    previousCard,
    reviewedAt,
    FSRS_RATINGS[rating],
  );
  const intervalMs = intervalFromCard(scheduled.card, reviewedAt);
  const dueAt = scheduled.card.due.toISOString();
  const success = rating >= 2;
  const consecutiveSuccesses = success
    ? (previous?.consecutiveSuccesses ?? 0) + 1
    : 0;
  const progress: WordProgress = {
    wordId,
    status: progressStatus(
      scheduled.card.state,
      consecutiveSuccesses,
      scheduled.card.scheduled_days,
    ),
    firstLearnedAt: previous?.firstLearnedAt ?? input.reviewedAt,
    lastReviewedAt: input.reviewedAt,
    nextDueAt: dueAt,
    lastRating: rating,
    reviewCount: (previous?.reviewCount ?? 0) + 1,
    successCount: (previous?.successCount ?? 0) + (success ? 1 : 0),
    lapseCount: (previous?.lapseCount ?? 0) + (rating === 0 ? 1 : 0),
    consecutiveSuccesses,
    intervalMs,
    fsrsCard: serializeCard(scheduled.card),
    weakResolvedAt: rating <= 1
      ? undefined
      : previous?.weakResolvedAt
        ? input.reviewedAt
        : undefined,
  };
  return {
    review: {
      id: input.reviewId ?? createReviewId(wordId, input.reviewedAt),
      sessionId: input.sessionId,
      wordId,
      word: input.word,
      rating,
      kind: previous ? "review" : "new",
      intervalMs,
      dueAt,
      reviewedAt: input.reviewedAt,
      recallMs: input.recallMs,
      section: input.section,
      unit: input.unit,
    },
    progress,
  };
}

export function rebuildWordProgress(reviews: ReviewEvent[]) {
  const progress: WordProgressMap = {};
  const grouped = new Map<number, ReviewEvent[]>();
  for (const review of reviews) {
    if (!review.wordId) continue;
    const wordId = canonicalWordId(review.wordId);
    const items = grouped.get(wordId) ?? [];
    items.push(review);
    grouped.set(wordId, items);
  }
  for (const [wordId, items] of grouped) {
    const sorted = items.sort((first, second) =>
      first.reviewedAt.localeCompare(second.reviewedAt));
    const histories: FSRSHistory[] = sorted.map((review) => ({
      rating: FSRS_RATINGS[review.rating] as Grade,
      review: review.reviewedAt,
    }));
    const replay = scheduler.reschedule(
      createEmptyCard(sorted[0].reviewedAt),
      histories,
      { update_memory_state: true },
    );
    const card = replay.collections.at(-1)?.card;
    if (!card) continue;
    const last = sorted.at(-1)!;
    const successCount = sorted.filter((review) => review.rating >= 2).length;
    const lapseCount = sorted.filter((review) => review.rating === 0).length;
    let consecutiveSuccesses = 0;
    for (let index = sorted.length - 1; index >= 0; index -= 1) {
      if (sorted[index].rating < 2) break;
      consecutiveSuccesses += 1;
    }
    progress[wordId] = {
      wordId,
      status: progressStatus(
        card.state,
        consecutiveSuccesses,
        card.scheduled_days,
      ),
      firstLearnedAt: sorted[0].reviewedAt,
      lastReviewedAt: last.reviewedAt,
      nextDueAt: card.due.toISOString(),
      lastRating: last.rating,
      reviewCount: sorted.length,
      successCount,
      lapseCount,
      consecutiveSuccesses,
      intervalMs: intervalFromCard(card, new Date(last.reviewedAt)),
      fsrsCard: serializeCard(card),
    };
  }
  return progress;
}

export function isWeakProgress(progress?: WordProgress) {
  if (!progress) return false;
  if (
    progress.weakResolvedAt
    && progress.weakResolvedAt >= progress.lastReviewedAt
  ) {
    return false;
  }
  return progress.lastRating <= 1
    || (progress.lapseCount > 0 && progress.consecutiveSuccesses < 2);
}

export function resolveWeakProgress(progress: WordProgress, resolvedAt: string) {
  return { ...progress, weakResolvedAt: resolvedAt };
}

export function dueWordIds(progress: WordProgressMap, now = new Date()) {
  const nowTime = now.getTime();
  return Object.values(progress)
    .filter((item) => new Date(item.nextDueAt).getTime() <= nowTime)
    .sort((first, second) => {
      const ratingDifference = first.lastRating - second.lastRating;
      if (ratingDifference) return ratingDifference;
      const dueDifference = first.nextDueAt.localeCompare(second.nextDueAt);
      if (dueDifference) return dueDifference;
      return second.lapseCount - first.lapseCount;
    })
    .map((item) => item.wordId);
}

export function weakWordIds(progress: WordProgressMap) {
  return Object.values(progress)
    .filter(isWeakProgress)
    .sort((first, second) => {
      const lapseDifference = second.lapseCount - first.lapseCount;
      if (lapseDifference) return lapseDifference;
      return first.nextDueAt.localeCompare(second.nextDueAt);
    })
    .map((item) => item.wordId);
}

export function rebuildStubbornWords(
  reviews: ReviewEvent[],
  now = new Date(),
): StubbornWordMap {
  const grouped = new Map<number, ReviewEvent[]>();
  for (const review of reviews) {
    if (!review.wordId) continue;
    const wordId = canonicalWordId(review.wordId);
    const items = grouped.get(wordId) ?? [];
    items.push(review);
    grouped.set(wordId, items);
  }
  const records: StubbornWordMap = {};
  for (const [wordId, items] of grouped) {
    const sorted = items.sort((first, second) =>
      first.reviewedAt.localeCompare(second.reviewedAt));
    let recentLow: ReviewEvent[] = [];
    let successStreak = 0;
    let active = false;
    let record: StubbornWordRecord | undefined;
    for (const review of sorted) {
      const reviewTime = new Date(review.reviewedAt).getTime();
      recentLow = recentLow.filter((item) =>
        reviewTime - new Date(item.reviewedAt).getTime() <= 30 * DAY);
      if (review.rating <= 1) {
        recentLow.push(review);
        successStreak = 0;
        const againCount = recentLow.filter((item) => item.rating === 0).length;
        const reason = againCount >= 3
          ? "again-3"
          : recentLow.length >= 5
            ? "low-5"
            : undefined;
        if (!active && reason) {
          active = true;
          record = {
            wordId,
            active: true,
            reason,
            triggeredAt: review.reviewedAt,
            lastChangedAt: review.reviewedAt,
            triggerCount: (record?.triggerCount ?? 0) + 1,
          };
        }
      } else {
        successStreak += 1;
        if (active && record && successStreak >= 3) {
          active = false;
          record = {
            ...record,
            active: false,
            lastChangedAt: review.reviewedAt,
            resolvedAt: review.reviewedAt,
          };
        }
      }
    }
    if (active && record && recentLow.length) {
      const lastLowAt = new Date(recentLow.at(-1)!.reviewedAt).getTime();
      if (now.getTime() - lastLowAt > 30 * DAY) {
        const resolvedAt = new Date(lastLowAt + 30 * DAY).toISOString();
        record = {
          ...record,
          active: false,
          lastChangedAt: resolvedAt,
          resolvedAt,
        };
      }
    }
    if (record) records[wordId] = record;
  }
  return records;
}

export function stubbornWordIds(
  records: StubbornWordMap,
  progress: WordProgressMap,
) {
  return Object.values(records)
    .filter((record) => record.active)
    .sort((first, second) => {
      const lapseDifference = (progress[second.wordId]?.lapseCount ?? 0)
        - (progress[first.wordId]?.lapseCount ?? 0);
      if (lapseDifference) return lapseDifference;
      return first.triggeredAt.localeCompare(second.triggeredAt);
    })
    .map((record) => record.wordId);
}

/** 基于种子的确定性洗牌（与 quiz/study 共用同一 FNV-1a 评分） */
function shuffleWordIds(wordIds: number[], seed: number) {
  return [...wordIds].sort(
    (first, second) =>
      seededScore(String(first), seed) - seededScore(String(second), seed),
  );
}

function buildTodayQueueParts(
  primaryWordIds: number[],
  progress: WordProgressMap,
  dailyNewGoal: number,
  now = new Date(),
  options?: TodayQueueOptions,
) {
  const dueIds = dueWordIds(progress, now);
  const dueSet = new Set(dueIds);
  const familyKeys = options?.familyKeyByWordId ?? {};
  const reviewedTodaySet = new Set(
    (options?.reviewedTodayWordIds ?? []).map(canonicalWordId),
  );
  const usedFamilyKeys = new Set(
    [...reviewedTodaySet]
      .map((wordId) => familyKeys[canonicalWordId(wordId)])
      .filter((key): key is string => Boolean(key)),
  );
  // 划词补漏：已到期词不重复进队，同词族当天错开逻辑与到期/新词保持一致
  const priorityIds: number[] = [];
  const prioritySet = new Set<number>();
  for (const wordId of (options?.lookupPriorityIds ?? [])) {
    const canonical = canonicalWordId(wordId);
    if (dueSet.has(canonical) || prioritySet.has(canonical)) continue;
    const familyKey = familyKeys[canonical];
    if (familyKey && usedFamilyKeys.has(familyKey)) continue;
    priorityIds.push(canonical);
    prioritySet.add(canonical);
    if (familyKey) usedFamilyKeys.add(familyKey);
  }
  const newIds: number[] = [];
  const candidates = primaryWordIds
    .map(canonicalWordId)
    .filter((wordId, index, items) =>
      !progress[wordId]
      && !dueSet.has(wordId)
      && !prioritySet.has(wordId)
      && !reviewedTodaySet.has(wordId)
      && items.indexOf(wordId) === index);
  if (dailyNewGoal > 0) {
    for (const wordId of candidates) {
      const familyKey = familyKeys[wordId];
      if (familyKey && usedFamilyKeys.has(familyKey)) continue;
      newIds.push(wordId);
      if (familyKey) usedFamilyKeys.add(familyKey);
      if (newIds.length >= dailyNewGoal) break;
    }
  }
  const orderedIds = [...dueIds, ...priorityIds, ...newIds];
  const wordIds = options?.shuffleSeed !== undefined
    ? shuffleWordIds(orderedIds, options.shuffleSeed)
    : orderedIds;
  return {
    wordIds,
    dueWordIds: dueIds,
    lookupWordIds: priorityIds,
    newWordIds: newIds,
  };
}

export function buildTodayQueue(
  primaryWordIds: number[],
  progress: WordProgressMap,
  dailyNewGoal: number,
  now = new Date(),
  options?: TodayQueueOptions,
) {
  return buildTodayQueueParts(
    primaryWordIds,
    progress,
    dailyNewGoal,
    now,
    options,
  ).wordIds;
}

/** 今日任务的共享派生结果：预览与实际会话直接复用同一组 wordIds。 */
export function buildTodayTaskPreview(input: {
  primaryWordIds: number[];
  progress: WordProgressMap;
  configuredNewGoal: number;
  effectiveNewGoal: number;
  learnedTodayCount: number;
  adaptiveEnabled: boolean;
  now?: Date;
  options?: TodayQueueOptions;
}): TodayTaskPreview {
  const remainingNewGoal = Math.max(
    0,
    input.effectiveNewGoal - input.learnedTodayCount,
  );
  const parts = buildTodayQueueParts(
    input.primaryWordIds,
    input.progress,
    remainingNewGoal,
    input.now,
    input.options,
  );
  const totalCount = parts.wordIds.length;
  let goalExplanation: string;
  if (remainingNewGoal === 0) {
    goalExplanation = "今日新词已完成，本轮只安排到期和补漏。";
  } else if (input.effectiveNewGoal < input.configuredNewGoal) {
    goalExplanation = `到期复习较多，新词目标已从 ${input.configuredNewGoal} 调整到 ${input.effectiveNewGoal}；今日已完成 ${input.learnedTodayCount} 个，剩余队列含 ${parts.newWordIds.length} 个新词。`;
  } else if (input.adaptiveEnabled) {
    goalExplanation = `当前到期复习量未触发调整，新词目标保持 ${input.effectiveNewGoal}；今日已完成 ${input.learnedTodayCount} 个，剩余队列含 ${parts.newWordIds.length} 个新词。`;
  } else {
    goalExplanation = `自适应调整已关闭，新词目标按设置为 ${input.effectiveNewGoal}；今日已完成 ${input.learnedTodayCount} 个，剩余队列含 ${parts.newWordIds.length} 个新词。`;
  }
  return {
    ...parts,
    totalCount,
    dueCount: parts.dueWordIds.length,
    lookupCount: parts.lookupWordIds.length,
    newCount: parts.newWordIds.length,
    estimatedMinutes: Math.ceil(totalCount * 45 / 60),
    goalExplanation,
    complete: totalCount === 0,
  };
}

/** 从完整今日剩余队列统一截取本次会话，不复制来源排序规则。 */
export function buildTodaySessionBatch(
  preview: TodayTaskPreview,
  sessionBatchSize: SessionBatchSize,
): TodaySessionBatch {
  const batchWordIds = preview.wordIds.slice(0, sessionBatchSize);
  return {
    batchWordIds,
    batchCount: batchWordIds.length,
    totalRemainingCount: preview.totalCount,
    estimatedMinutes: Math.ceil(batchWordIds.length * 45 / 60),
    complete: preview.complete,
  };
}

/** 当前词进入学习卡的可解释来源；无法细分时回退到会话级说明。 */
export function buildStudyWordSource(input: {
  session?: StudySession;
  progress?: WordProgress;
  lookupPriority: boolean;
  now?: Date;
}): StudyWordSource {
  const { session } = input;
  if (!session) {
    return {
      label: "当前词书额外练习",
      description: "你正在当前词书中自由学习，这个词不属于专项会话。",
    };
  }
  if (session.kind === "today") {
    if (session.title === "今日任务 · 补漏") {
      return {
        label: "手动加入今日任务",
        description: "你从学习卡将这个词加入了本次今日任务。",
      };
    }
    const dueAt = input.progress
      ? new Date(input.progress.nextDueAt).getTime()
      : Number.NaN;
    if (Number.isFinite(dueAt) && dueAt <= (input.now ?? new Date()).getTime()) {
      return {
        label: "今日到期",
        description: "这个词的下一次复习时间已经到达。",
      };
    }
    if (input.lookupPriority) {
      return {
        label: "反复查词补漏",
        description: "这个词因反复查询且尚未被后续掌握覆盖而进入本轮。",
      };
    }
    if (!input.progress) {
      return {
        label: "今日新词",
        description: "这个词尚无学习进度，来自今天的新词名额。",
      };
    }
    return {
      label: "今日任务",
      description: "这个词来自当前今日任务；现有记录不足以可靠区分更具体原因。",
    };
  }
  const byKind: Record<Exclude<SessionKind, "today">, StudyWordSource> = {
    favorites: {
      label: "收藏复习",
      description: "这个词来自你收藏的词汇。",
    },
    mistakes: {
      label: "错词强化",
      description: "这个词来自当前仍需强化的错词。",
    },
    stubborn: {
      label: "顽固词专项",
      description: "这个词来自顽固词的专项强化会话。",
    },
    search: {
      label: "搜索专项",
      description: "这个词来自你刚刚选择的搜索结果。",
    },
    lookups: {
      label: "划词集学习",
      description: "这个词来自你保存的划词集。",
    },
    article: {
      label: "文章提词",
      description: "这个词来自你粘贴并确认的英文文章。",
    },
    sprint: {
      label: "薄弱冲刺",
      description: "这个词来自当前薄弱冲刺会话。",
    },
    "vocab-test": {
      label: "词汇量测试补漏",
      description: "这个词来自你刚完成词汇量测试时标记的“不认识”词。",
    },
    reinforcement: {
      label: "本轮再强化",
      description: "这个词在上一轮完成后被选中再次强化。",
    },
  };
  return byKind[session.kind];
}

export function adaptiveNewWordGoal(input: {
  dailyGoal: number;
  minimumNewWords: number;
  dueCount: number;
  enabled: boolean;
}) {
  const dailyGoal = Math.max(0, Math.round(input.dailyGoal));
  const minimum = Math.min(
    dailyGoal,
    Math.max(0, Math.round(input.minimumNewWords)),
  );
  if (!input.enabled || input.dueCount < dailyGoal / 2) return dailyGoal;
  if (input.dueCount >= dailyGoal * 2) return minimum;
  if (input.dueCount >= dailyGoal) {
    return Math.max(minimum, Math.round(dailyGoal * 0.5));
  }
  return Math.max(minimum, Math.round(dailyGoal * 0.75));
}

export function buildExamPlan(input: {
  examDate: string;
  remainingBySection: Record<"必考词" | "基础词" | "超纲词", number>;
  dailyNewGoal: number;
  now?: Date;
}): ExamPlan | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.examDate)) return null;
  const examTime = new Date(`${input.examDate}T23:59:59`).getTime();
  if (!Number.isFinite(examTime)) return null;
  const now = input.now ?? new Date();
  const daysRemaining = Math.max(
    0,
    Math.ceil((examTime - now.getTime()) / DAY),
  );
  const phase: ExamPhase = daysRemaining > 180
    ? "基础期"
    : daysRemaining > 90
      ? "强化期"
      : daysRemaining > 30
        ? "冲刺期"
        : "临考期";
  const reviewReserveDays = Math.min(
    30,
    Math.max(7, Math.ceil(daysRemaining * 0.15)),
  );
  const learningDays = Math.max(1, daysRemaining - reviewReserveDays);
  const remainingWords = Object.values(input.remainingBySection)
    .reduce((total, count) => total + Math.max(0, count), 0);
  const requiredDailyNew = Math.ceil(remainingWords / learningDays);
  const projectedDays = Math.ceil(
    remainingWords / Math.max(1, input.dailyNewGoal),
  );
  const focusSection = input.remainingBySection["必考词"] > 0
    ? "必考词"
    : input.remainingBySection["基础词"] > 0
      ? "基础词"
      : input.remainingBySection["超纲词"] > 0
        ? "超纲词"
        : "复习";
  return {
    daysRemaining,
    phase,
    reviewReserveDays,
    remainingWords,
    requiredDailyNew,
    projectedDays,
    onTrack: projectedDays <= learningDays,
    focusSection,
  };
}

export function createStudySession(
  kind: SessionKind,
  title: string,
  wordIds: number[],
  now = new Date(),
  originKind?: Exclude<SessionKind, "reinforcement">,
): StudySession {
  const canonicalIds = wordIds.map(canonicalWordId);
  return {
    id: `${kind}:${now.toISOString()}`,
    kind,
    originKind,
    title,
    wordIds: canonicalIds.filter((wordId, index) =>
      canonicalIds.indexOf(wordId) === index),
    index: 0,
    createdAt: now.toISOString(),
  };
}

export function sessionProgress(session?: StudySession) {
  if (!session || !session.wordIds.length) {
    return { completed: 0, total: 0, percent: 0 };
  }
  const completed = Math.min(session.index, session.wordIds.length);
  return {
    completed,
    total: session.wordIds.length,
    percent: Math.round((completed / session.wordIds.length) * 100),
  };
}

export function formatInterval(intervalMs: number) {
  const minutes = Math.round(intervalMs / MINUTE);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.round(intervalMs / (60 * MINUTE));
  if (hours < 24) return `${hours} 小时`;
  const days = Math.round(intervalMs / DAY);
  if (days < 30) return `${days} 天`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} 个月`;
  return `${Math.round(months / 12)} 年`;
}

export function wordRetrievability(
  progress: WordProgress,
  now = new Date(),
) {
  return Math.round(
    scheduler.get_retrievability(restoreCard(progress.fsrsCard), now, false)
    * 100,
  );
}

export function averageRetrievability(
  progress: WordProgressMap,
  now = new Date(),
) {
  const items = Object.values(progress);
  if (!items.length) return 0;
  const total = items.reduce(
    (sum, item) => sum + wordRetrievability(item, now),
    0,
  );
  return Math.round(total / items.length);
}

export type ExamProgressTiers = {
  /** 已覆盖：至少评分过一次 */
  covered: number;
  /** 已掌握：达到稳定性/连续成功门槛（status === "mastered"） */
  mastered: number;
  /** 考试日就绪：预测考试当天可提取率 ≥ threshold */
  examReady: number;
  /** 就绪判定使用的可提取率门槛（百分比） */
  thresholdPercent: number;
  examDate: string;
};

/** 考研就绪判定：预测考试当天仍可提取的最低可提取率 */
export const EXAM_READY_RETENTION = 0.9;

/**
 * 考研进度三层口径：已覆盖（至少学过）/ 已掌握（达到稳定门槛）/
 * 考试日就绪（FSRS 预测考试当天仍可提取）。
 * 考试日期无效时返回 null。
 */
export function examProgressTiers(
  progress: WordProgressMap,
  examDate: string,
  threshold = EXAM_READY_RETENTION,
): ExamProgressTiers | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(examDate)) return null;
  const examTime = new Date(`${examDate}T23:59:59`).getTime();
  if (!Number.isFinite(examTime)) return null;
  const examDateObj = new Date(examTime);
  let covered = 0;
  let mastered = 0;
  let examReady = 0;
  for (const item of Object.values(progress)) {
    covered += 1;
    if (item.status === "mastered") mastered += 1;
    const retrievability = wordRetrievability(item, examDateObj);
    if (retrievability >= threshold * 100) examReady += 1;
  }
  return {
    covered,
    mastered,
    examReady,
    thresholdPercent: Math.round(threshold * 100),
    examDate,
  };
}
