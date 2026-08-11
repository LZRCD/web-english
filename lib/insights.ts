import {
  rebuildStubbornWords,
  rebuildWordProgress,
  type ExamPlan,
  type Rating,
  type ReviewEvent,
  type StubbornWordMap,
  type WordProgress,
  type WordProgressMap,
} from "./learning.ts";
import {
  buildSprintEffectiveness,
  buildWeakDimensionTrend,
  type SprintEffectiveness,
  type WeakDimensionTrend,
  type WeakSignalInput,
  type WeakThresholds,
} from "./weak-signals.ts";
import {
  addLocalDays,
  localDateKey,
  localDayStart,
  localWeekStart,
} from "./date-utils.ts";

export type TrueRetentionReview = Pick<
  ReviewEvent,
  "id" | "reviewedAt" | "rating" | "kind" | "intervalMs" | "wordId" | "word" | "section" | "unit"
>;

export type LearningInsightReview = TrueRetentionReview & Pick<
  ReviewEvent,
  "recallMs"
>;

export type TrueRetentionBucket = {
  reviewCount: number;
  retainedCount: number;
  rate: number | null;
};

export type TrueRetentionSummary = {
  overall: TrueRetentionBucket;
  young: TrueRetentionBucket;
  mature: TrueRetentionBucket;
  /** 缺少同词上一条评分间隔、无法诚实分桶的复习次数。 */
  unclassifiedCount: number;
};

export type ReviewMetricBucket = {
  numerator: number;
  denominator: number;
  rate: number | null;
};

export type ReviewMetricTrendWeek = {
  weekStart: string;
  weekEnd: string;
  retention: ReviewMetricBucket;
  difficulty: ReviewMetricBucket;
};

export const TRUE_RETENTION_MATURE_INTERVAL_MS = 21 * 24 * 60 * 60 * 1000;

export type LearningInsights = {
  activeDays: number;
  reviewCount: number;
  uniqueWordCount: number;
  /** 当前窗口评分达标事件占比，范围为 0–100；无评分事件时为 null。 */
  successRate: number | null;
  /** 相比上一窗口的当场达标占比百分点差；任一窗口无评分时为 null。 */
  successRateDelta: number | null;
  /** 仅统计 kind=review；忘记（FSRS Again）失败，其余评分保持。 */
  trueRetention: TrueRetentionSummary;
  /** 合法回忆耗时的平均毫秒数；没有样本时为 null。 */
  averageRecallMs: number | null;
};

export type ReviewForecastProgress = Pick<WordProgress, "nextDueAt">;

export type ReviewForecastMap = Readonly<
  Record<number, ReviewForecastProgress>
>;

export type ReviewForecastDay = {
  date: string;
  count: number;
};

export type WeeklyLearningReport = {
  weekStart: string;
  weekEnd: string;
  masteredCount: number;
  masteredChange: number;
  forgottenWordCount: number;
  forgottenChange: number;
  stubbornCount: number;
  stubbornChange: number;
  nextWeekReviewCount: number;
  nextWeekDailyAverage: number;
  nextWeekPeak?: ReviewForecastDay;
  paceStatus: "on-track" | "adjust" | "complete" | "unset";
  paceAdvice: string;
  /** 本周各薄弱维度趋势（薄弱画像派生，见 lib/weak-signals.ts） */
  weakTrend: WeakDimensionTrend[];
  /** 本周冲刺成效（有本周冲刺评分时存在，见 lib/weak-signals.ts） */
  sprintEffectiveness?: SprintEffectiveness;
  /** 最近 4 个本地自然周的复习保持率与困难率，共用同一复习评分分母。 */
  reviewMetricTrend: ReviewMetricTrendWeek[];
};

type TimedReview = LearningInsightReview & {
  reviewedAtMs: number;
};

function normalizedDays(days: number) {
  return Number.isFinite(days) ? Math.max(0, Math.trunc(days)) : 0;
}

function validTimedReviews(reviews: readonly LearningInsightReview[]) {
  return reviews.flatMap<TimedReview>((review) => {
    const reviewedAtMs = new Date(review.reviewedAt).getTime();
    return Number.isFinite(reviewedAtMs)
      ? [{ ...review, reviewedAtMs }]
      : [];
  });
}

function successRate(reviews: readonly TimedReview[]) {
  if (!reviews.length) return null;
  const successes = reviews.filter((review) =>
    review.rating >= (2 satisfies Rating)).length;
  return (successes / reviews.length) * 100;
}

function reviewWordKey(review: TrueRetentionReview) {
  if (Number.isSafeInteger(review.wordId)) return `id:${review.wordId}`;
  return [
    review.section ?? "",
    review.unit ?? "",
    review.word.trim().toLowerCase(),
  ].join(":");
}

function retentionBucket(reviewCount = 0, retainedCount = 0): TrueRetentionBucket {
  return {
    reviewCount,
    retainedCount,
    rate: reviewCount ? (retainedCount / reviewCount) * 100 : null,
  };
}

function emptyTrueRetention(): TrueRetentionSummary {
  return {
    overall: retentionBucket(),
    young: retentionBucket(),
    mature: retentionBucket(),
    unclassifiedCount: 0,
  };
}

/**
 * True Retention：只统计真正的复习评分；Again 失败，Hard/Good/Easy 成功。
 * young/mature 使用同词上一条评分写下的调度间隔，避免把本次评分后的新间隔当成旧间隔。
 */
export function buildTrueRetention(
  reviews: readonly TrueRetentionReview[],
  window: { startAt?: Date; endAt?: Date } = {},
): TrueRetentionSummary {
  const startAtMs = window.startAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  const endAtMs = window.endAt?.getTime() ?? Number.POSITIVE_INFINITY;
  if (!Number.isFinite(startAtMs) && startAtMs !== Number.NEGATIVE_INFINITY) {
    return emptyTrueRetention();
  }
  if (!Number.isFinite(endAtMs) && endAtMs !== Number.POSITIVE_INFINITY) {
    return emptyTrueRetention();
  }
  if (startAtMs > endAtMs) return emptyTrueRetention();

  const grouped = new Map<string, Array<TrueRetentionReview & {
    reviewedAtMs: number;
    sourceIndex: number;
  }>>();
  reviews.forEach((review, sourceIndex) => {
    const reviewedAtMs = new Date(review.reviewedAt).getTime();
    if (!Number.isFinite(reviewedAtMs)) return;
    const key = reviewWordKey(review);
    const items = grouped.get(key) ?? [];
    items.push({ ...review, reviewedAtMs, sourceIndex });
    grouped.set(key, items);
  });

  let reviewCount = 0;
  let retainedCount = 0;
  let youngCount = 0;
  let youngRetainedCount = 0;
  let matureCount = 0;
  let matureRetainedCount = 0;
  let unclassifiedCount = 0;

  for (const items of grouped.values()) {
    items.sort((first, second) =>
      first.reviewedAtMs - second.reviewedAtMs
      || first.id.localeCompare(second.id)
      || first.sourceIndex - second.sourceIndex);
    let previous: (typeof items)[number] | undefined;
    for (const review of items) {
      const inWindow = review.reviewedAtMs >= startAtMs
        && review.reviewedAtMs <= endAtMs;
      if (inWindow && review.kind === "review") {
        const retained = review.rating !== (0 satisfies Rating);
        reviewCount += 1;
        if (retained) retainedCount += 1;

        const intervalBefore = previous?.intervalMs;
        if (typeof intervalBefore !== "number" || !Number.isFinite(intervalBefore) || intervalBefore < 0) {
          unclassifiedCount += 1;
        } else if (intervalBefore < TRUE_RETENTION_MATURE_INTERVAL_MS) {
          youngCount += 1;
          if (retained) youngRetainedCount += 1;
        } else {
          matureCount += 1;
          if (retained) matureRetainedCount += 1;
        }
      }
      previous = review;
    }
  }

  return {
    overall: retentionBucket(reviewCount, retainedCount),
    young: retentionBucket(youngCount, youngRetainedCount),
    mature: retentionBucket(matureCount, matureRetainedCount),
    unclassifiedCount,
  };
}

/** 最近 N 个本地自然周的复习保持率与困难率；含本周，按时间升序。 */
export function buildReviewMetricTrend(
  reviews: readonly TrueRetentionReview[],
  now: Date,
  weeks = 4,
): ReviewMetricTrendWeek[] {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs) || !Number.isSafeInteger(weeks) || weeks <= 0) {
    return [];
  }

  const currentWeekStart = localWeekStart(now);
  const firstWeekStart = addLocalDays(currentWeekStart, -(weeks - 1) * 7);

  return Array.from({ length: weeks }, (_, index) => {
    const weekStart = addLocalDays(firstWeekStart, index * 7);
    const nextWeekStart = addLocalDays(weekStart, 7);
    const endAt = index === weeks - 1
      ? new Date(nowMs)
      : new Date(nextWeekStart.getTime() - 1);
    const retention = buildTrueRetention(reviews, {
      startAt: weekStart,
      endAt,
    }).overall;
    const weekStartMs = weekStart.getTime();
    const endAtMs = endAt.getTime();
    const difficultCount = reviews.reduce((count, review) => {
      const reviewedAtMs = new Date(review.reviewedAt).getTime();
      return review.kind === "review"
        && reviewedAtMs >= weekStartMs
        && reviewedAtMs <= endAtMs
        && (review.rating === 0 || review.rating === 1)
        ? count + 1
        : count;
    }, 0);

    return {
      weekStart: localDateKey(weekStart),
      weekEnd: localDateKey(addLocalDays(weekStart, 6)),
      retention: {
        numerator: retention.retainedCount,
        denominator: retention.reviewCount,
        rate: retention.rate,
      },
      difficulty: {
        numerator: difficultCount,
        denominator: retention.reviewCount,
        rate: retention.reviewCount
          ? (difficultCount / retention.reviewCount) * 100
          : null,
      },
    };
  });
}

export function buildLearningInsights(
  reviews: readonly LearningInsightReview[],
  now: Date,
  days = 7,
): LearningInsights {
  const windowDays = normalizedDays(days);
  if (!windowDays || !Number.isFinite(now.getTime())) {
    return {
      activeDays: 0,
      reviewCount: 0,
      uniqueWordCount: 0,
      successRate: null,
      successRateDelta: null,
      trueRetention: emptyTrueRetention(),
      averageRecallMs: null,
    };
  }

  const currentStart = addLocalDays(localDayStart(now), -(windowDays - 1));
  const previousStart = addLocalDays(currentStart, -windowDays);
  const currentStartMs = currentStart.getTime();
  const previousStartMs = previousStart.getTime();
  const nowMs = now.getTime();
  const timedReviews = validTimedReviews(reviews);
  const currentReviews = timedReviews.filter((review) =>
    review.reviewedAtMs >= currentStartMs && review.reviewedAtMs <= nowMs);
  const previousReviews = timedReviews.filter((review) =>
    review.reviewedAtMs >= previousStartMs
    && review.reviewedAtMs < currentStartMs);
  const currentSuccessRate = successRate(currentReviews);
  const previousSuccessRate = successRate(previousReviews);
  const trueRetention = buildTrueRetention(reviews, {
    startAt: currentStart,
    endAt: now,
  });
  const recallSamples = currentReviews
    .map((review) => review.recallMs)
    .filter((recallMs): recallMs is number =>
      typeof recallMs === "number"
      && Number.isFinite(recallMs)
      && recallMs >= 0);

  return {
    activeDays: new Set(
      currentReviews.map((review) =>
        localDateKey(new Date(review.reviewedAtMs))),
    ).size,
    reviewCount: currentReviews.length,
    uniqueWordCount: new Set(currentReviews.map(reviewWordKey)).size,
    successRate: currentSuccessRate,
    successRateDelta: currentSuccessRate !== null && previousSuccessRate !== null
      ? currentSuccessRate - previousSuccessRate
      : null,
    trueRetention,
    averageRecallMs: recallSamples.length
      ? recallSamples.reduce((sum, recallMs) => sum + recallMs, 0)
        / recallSamples.length
      : null,
  };
}

export function buildReviewForecast(
  wordProgress: ReviewForecastMap,
  now: Date,
  days = 7,
): ReviewForecastDay[] {
  const windowDays = normalizedDays(days);
  if (!windowDays || !Number.isFinite(now.getTime())) return [];

  const firstDay = localDayStart(now);
  const buckets = Array.from({ length: windowDays }, (_, index) => ({
    date: localDateKey(addLocalDays(firstDay, index)),
    count: 0,
  }));
  const lastDayStart = addLocalDays(firstDay, windowDays);

  for (const progress of Object.values(wordProgress)) {
    const dueAt = new Date(progress.nextDueAt);
    if (!Number.isFinite(dueAt.getTime())) continue;

    const dueDay = localDayStart(dueAt);
    if (dueDay < firstDay) {
      buckets[0].count += 1;
      continue;
    }
    if (dueDay >= lastDayStart) continue;

    const bucketIndex = buckets.findIndex(
      (bucket) => bucket.date === localDateKey(dueDay),
    );
    if (bucketIndex >= 0) buckets[bucketIndex].count += 1;
  }

  return buckets;
}

function uniqueForgottenWords(reviews: readonly ReviewEvent[]) {
  return new Set(
    reviews
      .filter((review) => review.rating === 0)
      .map(reviewWordKey),
  ).size;
}

function activeStubbornCount(records: StubbornWordMap) {
  return Object.values(records).filter((record) => record.active).length;
}

/** 生成按本地周一划分的周报；历史状态由评分事件重放，不依赖额外快照。 */
export function buildWeeklyLearningReport(input: {
  reviews: readonly ReviewEvent[];
  progress: WordProgressMap;
  stubbornWords: StubbornWordMap;
  now: Date;
  examPlan: ExamPlan | null;
  dailyNewGoal: number;
  /** 薄弱画像信号源（可选）：提供后周报追加「本周薄弱维度趋势」 */
  weakSignals?: WeakSignalInput;
  /** 薄弱判定阈值（可选）：覆盖默认薄弱画像阈值 */
  weakThresholds?: WeakThresholds;
}): WeeklyLearningReport {
  const now = Number.isFinite(input.now.getTime()) ? input.now : new Date();
  const weekStart = localWeekStart(now);
  const nextWeekStart = addLocalDays(weekStart, 7);
  const previousWeekStart = addLocalDays(weekStart, -7);
  const weekStartMs = weekStart.getTime();
  const nextWeekStartMs = nextWeekStart.getTime();
  const previousWeekStartMs = previousWeekStart.getTime();
  const timedReviews = input.reviews.flatMap((review) => {
    const reviewedAtMs = new Date(review.reviewedAt).getTime();
    return Number.isFinite(reviewedAtMs) ? [{ review, reviewedAtMs }] : [];
  });
  const beforeThisWeek = timedReviews
    .filter((item) => item.reviewedAtMs < weekStartMs)
    .map((item) => item.review);
  const thisWeekReviews = timedReviews
    .filter((item) =>
      item.reviewedAtMs >= weekStartMs
      && item.reviewedAtMs < nextWeekStartMs)
    .map((item) => item.review);
  const previousWeekReviews = timedReviews
    .filter((item) =>
      item.reviewedAtMs >= previousWeekStartMs
      && item.reviewedAtMs < weekStartMs)
    .map((item) => item.review);
  const progressAtWeekStart = rebuildWordProgress(beforeThisWeek);
  const masteredAtWeekStart = Object.values(progressAtWeekStart)
    .filter((item) => item.status === "mastered").length;
  const masteredCount = Object.values(input.progress)
    .filter((item) => item.status === "mastered").length;
  const stubbornAtWeekStart = rebuildStubbornWords(
    beforeThisWeek,
    new Date(weekStartMs - 1),
  );
  const forgottenWordCount = uniqueForgottenWords(thisWeekReviews);
  const previousForgottenCount = uniqueForgottenWords(previousWeekReviews);
  const stubbornCount = activeStubbornCount(input.stubbornWords);
  const nextWeekForecast = buildReviewForecast(
    input.progress,
    nextWeekStart,
    7,
  );
  const nextWeekReviewCount = nextWeekForecast.reduce(
    (sum, day) => sum + day.count,
    0,
  );
  const nextWeekPeak = nextWeekForecast.reduce<ReviewForecastDay | undefined>(
    (peak, day) => !peak || day.count > peak.count ? day : peak,
    undefined,
  );
  const reviewMetricTrend = buildReviewMetricTrend(input.reviews, now);

  let paceStatus: WeeklyLearningReport["paceStatus"] = "unset";
  let paceAdvice = `下周预计复习 ${nextWeekReviewCount} 词，设置考研日期后可获得每日新词调整建议。`;
  if (input.examPlan) {
    const required = input.examPlan.requiredDailyNew;
    const currentGoal = Math.max(0, Math.round(input.dailyNewGoal));
    if (input.examPlan.remainingWords === 0) {
      paceStatus = "complete";
      paceAdvice = `新词已经完成；下周预计复习 ${nextWeekReviewCount} 词，重点保持到期复习。`;
    } else if (!input.examPlan.onTrack || currentGoal < required) {
      paceStatus = "adjust";
      paceAdvice = `距考研 ${input.examPlan.daysRemaining} 天，建议每日新词由 ${currentGoal} 调到至少 ${required} 个；下周平均每天约 ${Math.ceil(nextWeekReviewCount / 7)} 个到期复习。`;
    } else {
      paceStatus = "on-track";
      paceAdvice = `当前每日新词 ${currentGoal} 个，达到建议的 ${required} 个；下周平均每天约 ${Math.ceil(nextWeekReviewCount / 7)} 个到期复习，保持当前节奏。`;
    }
  }

  return {
    weekStart: localDateKey(weekStart),
    weekEnd: localDateKey(addLocalDays(weekStart, 6)),
    masteredCount,
    masteredChange: masteredCount - masteredAtWeekStart,
    forgottenWordCount,
    forgottenChange: forgottenWordCount - previousForgottenCount,
    stubbornCount,
    stubbornChange: stubbornCount - activeStubbornCount(stubbornAtWeekStart),
    nextWeekReviewCount,
    nextWeekDailyAverage: Math.ceil(nextWeekReviewCount / 7),
    nextWeekPeak: nextWeekPeak?.count ? nextWeekPeak : undefined,
    paceStatus,
    paceAdvice,
    weakTrend: input.weakSignals
        ? buildWeakDimensionTrend(input.weakSignals, now, input.weakThresholds)
        : [],
    sprintEffectiveness: buildSprintEffectiveness(input.reviews, now) ?? undefined,
    reviewMetricTrend,
  };
}
