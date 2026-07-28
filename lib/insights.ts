import type { Rating, ReviewEvent, WordProgress } from "./learning.ts";

export type LearningInsightReview = Pick<
  ReviewEvent,
  "reviewedAt" | "rating" | "recallMs" | "wordId" | "word" | "section" | "unit"
>;

export type LearningInsights = {
  activeDays: number;
  reviewCount: number;
  uniqueWordCount: number;
  /** 当前窗口成功率，范围为 0–100。 */
  successRate: number;
  /** 相比上一窗口的成功率百分点差；任一窗口无评分时为 null。 */
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
  if (!reviews.length) return 0;
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
      successRate: 0,
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
    successRateDelta: currentReviews.length && previousReviews.length
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
