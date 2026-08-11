import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLearningInsights,
  buildReviewForecast,
  buildTrueRetention,
  buildWeeklyLearningReport,
  type LearningInsightReview,
  type ReviewForecastMap,
} from "../lib/insights.ts";
import type {
  ExamPlan,
  ReviewEvent,
  StubbornWordMap,
  WordProgressMap,
} from "../lib/learning.ts";

const EMPTY_TRUE_RETENTION = {
  overall: { reviewCount: 0, retainedCount: 0, rate: null },
  young: { reviewCount: 0, retainedCount: 0, rate: null },
  mature: { reviewCount: 0, retainedCount: 0, rate: null },
  unclassifiedCount: 0,
};

function localIso(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
) {
  return new Date(year, month - 1, day, hour, minute, second).toISOString();
}

function review(
  reviewedAt: string,
  rating: 0 | 1 | 2 | 3,
  wordId: number,
  recallMs?: number,
): LearningInsightReview {
  return {
    id: `${wordId}:${reviewedAt}:${rating}`,
    reviewedAt,
    rating,
    kind: "review",
    intervalMs: 86_400_000,
    wordId,
    word: `word-${wordId}`,
    recallMs,
  };
}

test("空数据返回稳定的学习洞察默认值", () => {
  const insights = buildLearningInsights(
    [],
    new Date(2026, 6, 28, 12),
  );

  assert.deepEqual(insights, {
    activeDays: 0,
    reviewCount: 0,
    uniqueWordCount: 0,
    successRate: null,
    successRateDelta: null,
    trueRetention: EMPTY_TRUE_RETENTION,
    averageRecallMs: null,
  });
  assert.deepEqual(
    buildReviewForecast({}, new Date(2026, 6, 28, 12), 0),
    [],
  );
});

test("学习洞察按本地自然日窗口统计并与上一窗口比较", () => {
  const now = new Date(2026, 6, 28, 12);
  const reviews: LearningInsightReview[] = [
    review(localIso(2026, 7, 22, 23, 59, 59), 3, 99, 9000),
    review(localIso(2026, 7, 23), 0, 10, 5000),
    review(localIso(2026, 7, 25, 23, 59, 59), 2, 11, 5000),
    review(localIso(2026, 7, 26), 2, 1, 1000),
    review(localIso(2026, 7, 27, 8), 1, 1, -1),
    review(localIso(2026, 7, 28, 11, 59, 59), 3, 2, 3000),
    review(localIso(2026, 7, 28, 12, 0, 1), 3, 3, 7000),
    review(localIso(2026, 7, 29), 3, 4, 7000),
    {
      id: "invalid",
      reviewedAt: "not-a-date",
      rating: 3,
      kind: "review",
      intervalMs: 86_400_000,
      wordId: 5,
      word: "invalid",
      recallMs: 7000,
    },
  ];

  const insights = buildLearningInsights(reviews, now, 3);

  assert.equal(insights.activeDays, 3);
  assert.equal(insights.reviewCount, 3);
  assert.equal(insights.uniqueWordCount, 2);
  assert.ok(
    insights.successRate !== null
    && Math.abs(insights.successRate - (2 / 3) * 100) < 1e-10,
  );
  assert.ok(
    insights.successRateDelta !== null
    && Math.abs(insights.successRateDelta - ((2 / 3) * 100 - 50)) < 1e-10,
  );
  assert.equal(insights.averageRecallMs, 2000);
});

test("当场达标占比区分当前无样本、真实零和上一窗无样本", () => {
  const now = new Date(2026, 6, 28, 12);
  const previousSuccess = review(localIso(2026, 7, 18, 8), 3, 1);

  assert.deepEqual(
    buildLearningInsights([previousSuccess], now, 7),
    {
      activeDays: 0,
      reviewCount: 0,
      uniqueWordCount: 0,
      successRate: null,
      successRateDelta: null,
      trueRetention: EMPTY_TRUE_RETENTION,
      averageRecallMs: null,
    },
  );

  const zeroWithPrevious = buildLearningInsights([
    previousSuccess,
    review(localIso(2026, 7, 28, 8), 0, 1),
  ], now, 7);
  assert.equal(zeroWithPrevious.successRate, 0);
  assert.equal(zeroWithPrevious.successRateDelta, -100);

  const zeroWithoutPrevious = buildLearningInsights([
    review(localIso(2026, 7, 28, 8), 1, 1),
  ], now, 7);
  assert.equal(zeroWithoutPrevious.successRate, 0);
  assert.equal(zeroWithoutPrevious.successRateDelta, null);
});

test("当场达标占比按事件加权并混合 new、review 与 sprint 会话", () => {
  const now = new Date(2026, 6, 28, 12);
  const reviews: ReviewEvent[] = [
    {
      id: "new-1",
      wordId: 1,
      word: "same-word",
      rating: 3,
      kind: "new",
      intervalMs: 1,
      dueAt: localIso(2026, 7, 29),
      reviewedAt: localIso(2026, 7, 28, 8),
    },
    {
      id: "review-1",
      wordId: 1,
      word: "same-word",
      rating: 0,
      kind: "review",
      intervalMs: 1,
      dueAt: localIso(2026, 7, 29),
      reviewedAt: localIso(2026, 7, 28, 9),
    },
    {
      id: "sprint-1",
      sessionId: "sprint:event-weighting",
      wordId: 1,
      word: "same-word",
      rating: 2,
      kind: "review",
      intervalMs: 1,
      dueAt: localIso(2026, 7, 29),
      reviewedAt: localIso(2026, 7, 28, 10),
    },
    {
      id: "review-2",
      sessionId: "review:mixed",
      wordId: 2,
      word: "other-word",
      rating: 1,
      kind: "review",
      intervalMs: 1,
      dueAt: localIso(2026, 7, 29),
      reviewedAt: localIso(2026, 7, 28, 11),
    },
  ];

  const insights = buildLearningInsights(reviews, now, 7);
  assert.equal(insights.reviewCount, 4);
  assert.equal(insights.uniqueWordCount, 2);
  assert.equal(insights.successRate, 50);
});

test("True Retention 只计复习并按上一调度间隔区分 young 与 mature", () => {
  const day = 86_400_000;
  const makeReview = (
    id: string,
    wordId: number,
    kind: "new" | "review",
    rating: 0 | 1 | 2 | 3,
    reviewedAt: string,
    intervalMs: number,
  ): ReviewEvent => ({
    id,
    wordId,
    word: `word-${wordId}`,
    kind,
    rating,
    reviewedAt,
    intervalMs,
    dueAt: new Date(new Date(reviewedAt).getTime() + intervalMs).toISOString(),
  });
  const reviews = [
    makeReview("young-new", 1, "new", 3, localIso(2026, 6, 1), 10 * day),
    makeReview("young-again", 1, "review", 0, localIso(2026, 6, 10), 40 * day),
    makeReview("mature-hard", 1, "review", 1, localIso(2026, 7, 20), day),
    makeReview("young-edge-new", 2, "new", 3, localIso(2026, 6, 1), 21 * day - 1),
    makeReview("young-good", 2, "review", 2, localIso(2026, 6, 22), 60 * day),
    makeReview("mature-edge-new", 3, "new", 3, localIso(2026, 6, 1), 21 * day),
    makeReview("mature-easy", 3, "review", 3, localIso(2026, 6, 22), day),
    makeReview("truncated-review", 4, "review", 2, localIso(2026, 6, 22), 90 * day),
    { ...makeReview("invalid", 5, "review", 0, localIso(2026, 6, 22), day), reviewedAt: "invalid" },
  ];

  const retention = buildTrueRetention(reviews, {
    startAt: new Date(2026, 5, 10),
    endAt: new Date(2026, 6, 31, 23, 59, 59),
  });

  assert.deepEqual(retention, {
    overall: { reviewCount: 5, retainedCount: 4, rate: 80 },
    young: { reviewCount: 2, retainedCount: 1, rate: 50 },
    mature: { reviewCount: 2, retainedCount: 2, rate: 100 },
    unclassifiedCount: 1,
  });
});

test("当场达标占比保留窗口边界并排除未来与无效时间", () => {
  const now = new Date(2026, 6, 28, 12);
  const insights = buildLearningInsights([
    review(localIso(2026, 7, 14, 23, 59, 59), 0, 1),
    review(localIso(2026, 7, 15), 3, 2),
    review(localIso(2026, 7, 21, 23, 59, 59), 2, 4),
    review(localIso(2026, 7, 22), 3, 5),
    review(localIso(2026, 7, 28, 12), 3, 6),
    review(localIso(2026, 7, 28, 12, 0, 1), 0, 7),
    review(localIso(2026, 7, 29), 0, 8),
    review("invalid", 0, 9),
  ], now, 7);

  assert.equal(insights.reviewCount, 2);
  assert.equal(insights.successRate, 100);
  assert.equal(insights.successRateDelta, 0);
});

test("平均回忆耗时忽略负数、NaN 和无穷值，但保留零", () => {
  const now = new Date(2026, 6, 28, 12);
  const reviews = [
    review(localIso(2026, 7, 28, 8), 2, 1, 0),
    review(localIso(2026, 7, 28, 9), 2, 2, Number.NaN),
    review(localIso(2026, 7, 28, 10), 2, 3, Number.POSITIVE_INFINITY),
    review(localIso(2026, 7, 28, 11), 2, 4, -100),
  ];

  assert.equal(buildLearningInsights(reviews, now).averageRecallMs, 0);
});

test("复习预测把逾期和今天到期放入首日并跨月按本地日期分桶", () => {
  const now = new Date(2026, 6, 31, 15);
  const wordProgress: ReviewForecastMap = {
    1: { nextDueAt: localIso(2026, 7, 29) },
    2: { nextDueAt: localIso(2026, 7, 31, 10) },
    3: { nextDueAt: localIso(2026, 7, 31, 23, 59, 59) },
    4: { nextDueAt: localIso(2026, 8, 1) },
    5: { nextDueAt: localIso(2026, 8, 2, 23, 59, 59) },
    6: { nextDueAt: localIso(2026, 8, 3) },
    7: { nextDueAt: "invalid" },
  };

  assert.deepEqual(buildReviewForecast(wordProgress, now, 3), [
    { date: "2026-07-31", count: 3 },
    { date: "2026-08-01", count: 1 },
    { date: "2026-08-02", count: 1 },
  ]);
});

test("每周报告按本地周一统计变化并给出考研节奏建议", () => {
  const makeReview = (
    reviewedAt: string,
    rating: 0 | 1 | 2 | 3,
    wordId: number,
  ): ReviewEvent => ({
    id: `${wordId}:${reviewedAt}`,
    wordId,
    word: `word-${wordId}`,
    rating,
    kind: "review",
    intervalMs: 86_400_000,
    dueAt: localIso(2026, 8, 3),
    reviewedAt,
    section: "必考词",
    unit: 1,
  });
  const reviews = [
    makeReview(localIso(2026, 7, 22, 8), 0, 1),
    makeReview(localIso(2026, 7, 28, 8), 0, 2),
    makeReview(localIso(2026, 7, 29, 8), 0, 2),
  ];
  const progress = {
    1: { status: "mastered", nextDueAt: localIso(2026, 8, 3) },
    2: { status: "reviewing", nextDueAt: localIso(2026, 8, 4) },
    3: { status: "reviewing", nextDueAt: localIso(2026, 8, 1) },
  } as unknown as WordProgressMap;
  const stubbornWords = {
    2: {
      wordId: 2,
      active: true,
      reason: "again-3",
      triggeredAt: localIso(2026, 7, 29),
      lastChangedAt: localIso(2026, 7, 29),
      triggerCount: 1,
    },
  } satisfies StubbornWordMap;
  const examPlan = {
    daysRemaining: 140,
    phase: "强化期",
    reviewReserveDays: 21,
    remainingWords: 3000,
    requiredDailyNew: 25,
    projectedDays: 150,
    onTrack: false,
    focusSection: "必考词",
  } satisfies ExamPlan;

  const report = buildWeeklyLearningReport({
    reviews,
    progress,
    stubbornWords,
    now: new Date(2026, 7, 2, 12),
    examPlan,
    dailyNewGoal: 20,
  });

  assert.equal(report.weekStart, "2026-07-27");
  assert.equal(report.weekEnd, "2026-08-02");
  assert.equal(report.masteredCount, 1);
  assert.equal(report.masteredChange, 1);
  assert.equal(report.forgottenWordCount, 1);
  assert.equal(report.forgottenChange, 0);
  assert.equal(report.stubbornCount, 1);
  assert.equal(report.stubbornChange, 1);
  assert.equal(report.nextWeekReviewCount, 3);
  assert.equal(report.nextWeekPeak?.date, "2026-08-03");
  assert.equal(report.nextWeekPeak?.count, 2);
  assert.equal(report.paceStatus, "adjust");
  assert.match(report.paceAdvice, /每日新词由 20 调到至少 25 个/);
});
