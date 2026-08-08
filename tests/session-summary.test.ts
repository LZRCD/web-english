import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRating,
  createStudySession,
  type ReviewEvent,
  type WordProgressMap,
} from "../lib/learning.ts";
import {
  buildSessionCompletionSummary,
  buildSprintCompletionSummary,
  mergeSprintWithTrend,
  reviewsForSession,
  selectReinforcementWords,
} from "../lib/session-summary.ts";
import type { WeakDimensionTrend } from "../lib/weak-signals.ts";
import type { WeakSignalInput } from "../lib/weak-signals.ts";
import { parseStoredState } from "../lib/study.ts";

function review(
  wordId: number,
  rating: 0 | 1 | 2 | 3,
  reviewedAt: string,
  options: Partial<ReviewEvent> = {},
): ReviewEvent {
  return {
    id: options.id ?? `review:${wordId}:${reviewedAt}`,
    wordId,
    word: options.word ?? `word-${wordId}`,
    rating,
    kind: options.kind ?? "new",
    intervalMs: options.intervalMs ?? 60_000,
    dueAt: options.dueAt ?? new Date(
      new Date(reviewedAt).getTime() + 60_000,
    ).toISOString(),
    reviewedAt,
    recallMs: options.recallMs,
    section: options.section ?? "必考词",
    unit: options.unit ?? 1,
    sessionId: options.sessionId,
  };
}

test("会话评分优先按 sessionId 精确归属，并兼容旧会话记录", () => {
  const session = {
    ...createStudySession(
      "today",
      "今日任务",
      [1, 2, 3],
      new Date("2026-07-29T08:00:00.000Z"),
    ),
    id: "session:target",
    index: 2,
  };
  const reviews = [
    review(1, 1, "2026-07-29T08:05:00.000Z", {
      sessionId: session.id,
    }),
    review(1, 3, "2026-07-29T08:06:00.000Z", {
      sessionId: "session:other",
    }),
    review(2, 2, "2026-07-29T08:07:00.000Z"),
    review(3, 0, "2026-07-29T08:08:00.000Z", {
      sessionId: session.id,
    }),
  ];

  assert.deepEqual(
    reviewsForSession(session, reviews).map((item) => [
      item.wordId,
      item.rating,
    ]),
    [[1, 1], [2, 2]],
  );
});

test("强化候选按评分、回忆耗时排序，去重并最多返回五词", () => {
  const reviews = [
    review(1, 1, "2026-07-29T08:01:00.000Z", { recallMs: 1_000 }),
    review(2, 0, "2026-07-29T08:02:00.000Z", { recallMs: 2_000 }),
    review(3, 1, "2026-07-29T08:03:00.000Z", { recallMs: 5_000 }),
    review(4, 2, "2026-07-29T08:04:00.000Z", { recallMs: 9_000 }),
    review(5, 3, "2026-07-29T08:05:00.000Z", { recallMs: 10_000 }),
    review(6, 0, "2026-07-29T08:06:00.000Z", { recallMs: 100 }),
    review(7, 2, "2026-07-29T08:07:00.000Z", { recallMs: 20_000 }),
    review(7, 3, "2026-07-29T08:08:00.000Z", { recallMs: 200 }),
  ];

  assert.deepEqual(
    selectReinforcementWords(reviews, {}, new Date("2026-07-29T09:00:00.000Z"))
      .map((item) => item.wordId),
    [2, 6, 3, 1, 4],
  );
  assert.equal(selectReinforcementWords(reviews.slice(0, 2), {}).length, 2);
});

test("完成摘要使用本轮口径，并按本地自然日统计今日与明日", () => {
  const now = new Date(2026, 6, 29, 12);
  const session = {
    ...createStudySession(
      "favorites",
      "收藏复习",
      [1, 2, 3, 4],
      new Date(2026, 6, 29, 8),
    ),
    id: "session:summary",
    index: 4,
  };
  const first = applyRating(undefined, {
    wordId: 1,
    word: "one",
    rating: 0,
    reviewedAt: new Date(2026, 6, 29, 9).toISOString(),
    recallMs: 1_000,
    section: "必考词",
    unit: 1,
    sessionId: session.id,
  });
  const beforeSession = applyRating(undefined, {
    wordId: 2,
    word: "two",
    rating: 2,
    reviewedAt: new Date(2026, 6, 28, 9).toISOString(),
    section: "必考词",
    unit: 1,
  });
  const second = applyRating(beforeSession.progress, {
    wordId: 2,
    word: "two",
    rating: 1,
    reviewedAt: new Date(2026, 6, 29, 9, 1).toISOString(),
    recallMs: 3_000,
    section: "必考词",
    unit: 1,
    sessionId: session.id,
  });
  const third = applyRating(undefined, {
    wordId: 3,
    word: "three",
    rating: 2,
    reviewedAt: new Date(2026, 6, 29, 9, 2).toISOString(),
    section: "必考词",
    unit: 1,
    sessionId: session.id,
  });
  const fourth = applyRating(undefined, {
    wordId: 4,
    word: "four",
    rating: 3,
    reviewedAt: new Date(2026, 6, 29, 9, 3).toISOString(),
    recallMs: 5_000,
    section: "必考词",
    unit: 1,
    sessionId: session.id,
  });
  const tomorrowDueAt = new Date(2026, 6, 30, 10).toISOString();
  const progress: WordProgressMap = {
    1: { ...first.progress, nextDueAt: tomorrowDueAt },
    2: { ...second.progress, nextDueAt: tomorrowDueAt },
    3: third.progress,
    4: fourth.progress,
  };
  const reviews = [
    beforeSession.review,
    first.review,
    second.review,
    third.review,
    fourth.review,
    review(99, 2, new Date(2026, 6, 29, 10).toISOString()),
  ];

  const summary = buildSessionCompletionSummary({
    session,
    reviews,
    wordProgress: progress,
    now,
  });

  assert.equal(summary.completedCount, 4);
  assert.equal(summary.newCount, 3);
  assert.equal(summary.reviewCount, 1);
  assert.equal(summary.successRate, 50);
  assert.equal(summary.averageRecallMs, 3_000);
  assert.equal(summary.weakCount, 2);
  assert.equal(summary.todayNewCount, 4);
  assert.equal(summary.todayReviewCount, 1);
  assert.equal(summary.tomorrowDueCount, 2);
  assert.deepEqual(
    summary.reinforcementWords.map((item) => item.wordId),
    [1, 2, 3, 4],
  );
});

test("sessionId 经评分创建与状态解析后保持不变", () => {
  const result = applyRating(undefined, {
    wordId: 1,
    word: "abandon",
    rating: 2,
    reviewedAt: "2026-07-29T08:00:00.000Z",
    section: "必考词",
    unit: 1,
    sessionId: "today:2026-07-29",
  });
  assert.equal(result.review.sessionId, "today:2026-07-29");

  const state = parseStoredState(JSON.stringify({
    schemaVersion: 5,
    reviews: [result.review],
    activeSession: {
      id: "reinforcement:2026-07-29",
      kind: "reinforcement",
      originKind: "lookups",
      title: "本次薄弱词 · 再强化",
      wordIds: [1],
      index: 0,
      createdAt: "2026-07-29T08:01:00.000Z",
    },
  }));
  assert.equal(state.reviews[0]?.sessionId, "today:2026-07-29");
  assert.equal(state.activeSession?.kind, "reinforcement");
  assert.equal(state.activeSession?.originKind, "lookups");
});

test("冲刺完成总结：统计当场达标/仍需关注、回忆对比与薄弱维度分布", () => {
  const session = {
    ...createStudySession(
      "sprint",
      "考前薄弱冲刺",
      [1, 2, 3],
      new Date("2026-08-10T08:00:00.000Z"),
    ),
    id: "sprint:2026-08-10",
    index: 3,
  };
  // 词 1 冲刺期间当场达标；词 2 仍答错且 lapse；词 3 达标但查询次数仍高
  const reviews = [
    review(1, 2, "2026-08-10T08:05:00.000Z", {
      sessionId: session.id,
      recallMs: 8_000,
    }),
    review(2, 0, "2026-08-10T08:06:00.000Z", {
      sessionId: session.id,
      recallMs: 12_000,
    }),
    review(3, 2, "2026-08-10T08:07:00.000Z", {
      sessionId: session.id,
      recallMs: 16_000,
    }),
    // 冲刺前历史样本：词 1 曾 10s（不触发回忆偏慢）、词 2 曾 30s
    review(1, 1, "2026-08-08T08:00:00.000Z", { recallMs: 10_000 }),
    review(2, 0, "2026-08-08T08:00:00.000Z", { recallMs: 30_000 }),
  ];
  const weakSignals: WeakSignalInput = {
    lookupStats: {
      "word-3": { count: 4, firstAt: "2026-08-01T00:00:00.000Z", lastAt: "2026-08-10T00:00:00.000Z" },
    },
    lookupWords: [{
      id: 9_000_000_001,
      linkedWordId: 3,
      query: "word-3",
      kind: "word",
      phonetic: "",
      part: "n.",
      meaning: "释义",
      note: "",
      source: "redbook",
      addedAt: "2026-08-01T00:00:00.000Z",
    }],
    guessMistakes: {},
    quizAttempts: [],
    reviews,
    stubbornWords: {
      2: {
        wordId: 2,
        active: true,
        reason: "again-3",
        triggeredAt: "2026-08-05T00:00:00.000Z",
        lastChangedAt: "2026-08-05T00:00:00.000Z",
        triggerCount: 1,
      },
    },
    wordProgress: {
      2: {
        wordId: 2,
        lapseCount: 2,
        lastRating: 0,
        lastReviewedAt: "2026-08-10T08:06:00.000Z",
      },
    } as unknown as import("../lib/learning.ts").WordProgressMap,
  };

  const summary = buildSprintCompletionSummary({
    session,
    reviews,
    weakSignals,
  });

  assert.equal(summary.sprintWordCount, 3);
  assert.equal(summary.reviewedCount, 3);
  assert.equal(summary.resolvedCount, 2); // 词 1、词 3 答对
  // 冲刺后仍薄弱：词 2（顽固 + lapse）、词 3（查过 4 次）
  assert.equal(summary.stillWeakCount, 2);
  assert.deepEqual(
    summary.stillWeakWords.map((item) => item.wordId).sort(),
    [2, 3],
  );
  // 冲刺期间平均回忆：(8+12+16)/3 = 12s
  assert.equal(summary.sprintAverageRecallMs, 12_000);
  // 冲刺前历史平均：(10+30)/2 = 20s
  assert.equal(summary.beforeAverageRecallMs, 20_000);
  // 维度分布：lapse 词 2、顽固 词 2、反复查词 词 3
  const lookup = summary.dimensionCounts.find((row) => row.key === "lookup");
  assert.equal(lookup?.count, 1);
  const lapse = summary.dimensionCounts.find((row) => row.key === "lapse");
  assert.equal(lapse?.count, 1);
  const stubborn = summary.dimensionCounts.find((row) => row.key === "stubborn");
  assert.equal(stubborn?.count, 1);
});

test("冲刺维度与周报趋势联动：清零标记与本周对照", () => {
  const sprintCounts: WeakDimensionTrend[] = [
    { key: "lookup", label: "反复查词", count: 0, change: null },
    { key: "lapse", label: "遗忘词", count: 1, change: null },
    { key: "slow-recall", label: "回忆偏慢", count: 2, change: null },
    { key: "stubborn", label: "顽固词", count: 0, change: null },
  ];
  const weeklyCounts: WeakDimensionTrend[] = [
    { key: "lookup", label: "反复查词", count: 3, change: 1 },
    { key: "lapse", label: "遗忘词", count: 2, change: 0 },
    { key: "slow-recall", label: "回忆偏慢", count: 0, change: 0 },
  ];
  const merged = mergeSprintWithTrend(sprintCounts, weeklyCounts);

  const lookup = merged.find((row) => row.key === "lookup")!;
  assert.equal(lookup.sprintCount, 0);
  assert.equal(lookup.weeklyCount, 3);
  assert.equal(lookup.cleared, true);
  const lapse = merged.find((row) => row.key === "lapse")!;
  assert.equal(lapse.sprintCount, 1);
  assert.equal(lapse.weeklyCount, 2);
  assert.equal(lapse.cleared, false);
  // 周报缺失的 key：weeklyCount 为 null
  const stubborn = merged.find((row) => row.key === "stubborn")!;
  assert.equal(stubborn.sprintCount, 0);
  assert.equal(stubborn.weeklyCount, null);
  assert.equal(stubborn.cleared, true);
  // 周报存在但冲刺没有的维度不进入结果
  assert.equal(merged.some((row) => row.key === "guess"), false);
});
