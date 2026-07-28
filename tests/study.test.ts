import assert from "node:assert/strict";
import test from "node:test";
import {
  buildActivityCalendar,
  buildStudyKey,
  learningStats,
  parseStoredState,
  splitMeaning,
  type Review,
} from "../lib/study.ts";

test("旧状态迁移到 v2 并清理 CET 示例记录", () => {
  const legacy = JSON.stringify({
    wordIndex: 7,
    started: true,
    dailyGoal: 20,
    soundOn: true,
    studyMode: "ordered",
    selectedSection: "必考词",
    selectedUnit: 1,
    favorites: [
      { key: "redbook-12", word: { id: 12 }, addedAt: "2026-07-26T10:00:00.000Z" },
      { key: "sample-all-resilient", word: { word: "resilient", level: "CET-6" } },
    ],
    mistakes: [
      { key: "redbook-15", word: { id: 15 }, mistakeCount: 2, lastRating: 1 },
      { key: "sample-all-subtle", word: { word: "subtle", level: "CET-6" } },
    ],
    reviews: [
      {
        word: "abandon",
        rating: 2,
        reviewedAt: "2026-07-27T10:00:00.000Z",
        section: "必考词",
        unit: 1,
      },
      { word: "resilient", rating: 3, reviewedAt: "2026-07-27T11:00:00.000Z" },
    ],
  });

  const state = parseStoredState(legacy);
  const key = buildStudyKey("selection", "ordered", "必考词", 1, 1);

  assert.equal(state.schemaVersion, 2);
  assert.deepEqual(state.favorites.map((item) => item.wordId), [12]);
  assert.deepEqual(state.mistakes.map((item) => item.wordId), [15]);
  assert.equal(state.reviews.length, 1);
  assert.ok(state.reviews[0].dueAt);
  assert.equal(state.positions[key], 7);
  assert.notEqual(
    buildStudyKey("selection", "ordered", "必考词", 1, 1),
    buildStudyKey("selection", "ordered", "必考词", 2, 1),
  );
});

test("今日、连续天数和到期数量来自真实日期", () => {
  const reviews: Review[] = [
    { wordId: 1, word: "a", rating: 0, reviewedAt: "2026-07-26T01:00:00.000Z", dueAt: "2026-07-26T01:10:00.000Z", section: "必考词", unit: 1 },
    { wordId: 2, word: "b", rating: 1, reviewedAt: "2026-07-27T01:00:00.000Z", dueAt: "2026-07-28T01:00:00.000Z", section: "必考词", unit: 1 },
    { wordId: 1, word: "a", rating: 3, reviewedAt: "2026-07-28T01:00:00.000Z", dueAt: "2026-08-09T01:00:00.000Z", section: "必考词", unit: 1 },
    { wordId: 3, word: "c", rating: 2, reviewedAt: "2026-07-28T02:00:00.000Z", dueAt: "2026-08-01T02:00:00.000Z", section: "基础词", unit: 1 },
    { wordId: 3, word: "c", rating: 2, reviewedAt: "2026-07-28T03:00:00.000Z", dueAt: "2026-08-01T03:00:00.000Z", section: "基础词", unit: 1 },
  ];

  const stats = learningStats(reviews, new Date("2026-07-28T12:00:00.000Z"));
  assert.equal(stats.todayDone, 2);
  assert.equal(stats.streak, 3);
  assert.equal(stats.dueCount, 1);
  assert.equal(stats.memoryStrength, 60);
});

test("学习热力图按每天不同单词数分级", () => {
  const reviews: Review[] = Array.from({ length: 20 }, (_, index) => ({
    wordId: index + 1,
    word: `word-${index + 1}`,
    rating: 2,
    reviewedAt: "2026-07-28T02:00:00.000Z",
    dueAt: "2026-08-01T02:00:00.000Z",
    section: "必考词",
    unit: 1,
  }));
  reviews.push({ ...reviews[0], reviewedAt: "2026-07-28T03:00:00.000Z" });

  const calendar = buildActivityCalendar(reviews, 7, new Date("2026-07-28T12:00:00.000Z"));
  assert.equal(calendar.length, 7);
  assert.equal(calendar.at(-1)?.date, "2026-07-28");
  assert.equal(calendar.at(-1)?.count, 20);
  assert.equal(calendar.at(-1)?.level, 4);
});

test("学习热力图可查看历史区间且不会延伸到未来", () => {
  const reviews: Review[] = [
    {
      wordId: 1,
      word: "history",
      rating: 2,
      reviewedAt: "2026-07-20T02:00:00.000Z",
      dueAt: "2026-07-24T02:00:00.000Z",
      section: "必考词",
      unit: 1,
    },
  ];

  const calendar = buildActivityCalendar(
    reviews,
    7,
    new Date("2026-07-20T12:00:00.000Z"),
  );
  assert.equal(calendar[0].date, "2026-07-14");
  assert.equal(calendar.at(-1)?.date, "2026-07-20");
  assert.equal(calendar.at(-1)?.count, 1);
  assert.ok(calendar.every((day) => day.date <= "2026-07-20"));
});

test("释义中的词性只展示一次", () => {
  assert.deepEqual(splitMeaning("vt. vi. 放弃;抛弃"), {
    part: "vt. vi.",
    meaning: "放弃;抛弃",
  });
  assert.deepEqual(splitMeaning("modal. 可以;可能"), {
    part: "modal.",
    meaning: "可以;可能",
  });
});
