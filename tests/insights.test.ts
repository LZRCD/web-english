import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLearningInsights,
  buildReviewForecast,
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
    reviewedAt,
    rating,
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
    successRate: 0,
    successRateDelta: null,
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
      reviewedAt: "not-a-date",
      rating: 3,
      wordId: 5,
      word: "invalid",
      recallMs: 7000,
    },
  ];

  const insights = buildLearningInsights(reviews, now, 3);

  assert.equal(insights.activeDays, 3);
  assert.equal(insights.reviewCount, 3);
  assert.equal(insights.uniqueWordCount, 2);
  assert.ok(Math.abs(insights.successRate - (2 / 3) * 100) < 1e-10);
  assert.ok(
    insights.successRateDelta !== null
    && Math.abs(insights.successRateDelta - ((2 / 3) * 100 - 50)) < 1e-10,
  );
  assert.equal(insights.averageRecallMs, 2000);
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
