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

export type LearningInsightReview = Pick<
  ReviewEvent,
  "reviewedAt" | "rating" | "recallMs" | "wordId" | "word" | "section" | "unit"
>;

export type LearningInsights = {
  activeDays: number;
  reviewCount: number;
  uniqueWordCount: number;
  /** 当前窗口评分达标事件占比，范围为 0–100；无评分事件时为 null。 */
  successRate: number | null;
  /** 相比上一窗口的评分达标占比百分点差；任一窗口无评分时为 null。 */
  successRateDelta: number | null;
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
};

type TimedReview = LearningInsightReview & {
  reviewedAtMs: number;
};

function normalizedDays(days: number) {
  return Number.isFinite(days) ? Math.max(0, Math.trunc(days)) : 0;
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

function localDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function reviewWordKey(review: LearningInsightReview) {
  if (Number.isSafeInteger(review.wordId)) return `id:${review.wordId}`;
  return [
    review.section ?? "",
    review.unit ?? "",
    review.word.trim().toLowerCase(),
  ].join(":");
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
  };
}
