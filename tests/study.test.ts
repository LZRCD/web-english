import assert from "node:assert/strict";
import test from "node:test";
import {
  buildActivityCalendar,
  buildDailyAggregates,
  buildStudyKey,
  learningStats,
  lookupWordId,
  parseStoredState,
  splitMeaning,
  type Review,
} from "../lib/study.ts";
import {
  adaptiveNewWordGoal,
  applyRating,
  buildExamPlan,
  buildTodayQueue,
  createStudySession,
  isWeakProgress,
  rebuildStubbornWords,
  resolveWeakProgress,
  sessionProgress,
  type WordProgress,
  examProgressTiers,
} from "../lib/learning.ts";
import {
  createBackupDocument,
  parseBackupDocument,
} from "../lib/backup.ts";
import {
  combineStoredState,
  splitStoredState,
} from "../lib/storage.ts";
import {
  addLocalDays,
  localDateKey,
  localDayStart,
  localWeekStart,
} from "../lib/date-utils.ts";
import {
  buildWordTextIndex,
  recordLookupStat,
  rememberLookupResult,
  resolveKnownLookupResult,
  upsertLookupWord,
  type LookupResult,
} from "../lib/selection-lookup.ts";

function createReview(
  input: Omit<Review, "id" | "kind" | "intervalMs"> & Partial<Pick<Review, "id" | "kind" | "intervalMs">>,
): Review {
  return {
    ...input,
    id: input.id ?? `test:${input.wordId}:${input.reviewedAt}`,
    kind: input.kind ?? "new",
    intervalMs: input.intervalMs
      ?? new Date(input.dueAt).getTime() - new Date(input.reviewedAt).getTime(),
  };
}

test("旧状态迁移到 v5 FSRS 并清理 CET 示例记录", () => {
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
        wordId: 1,
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

  assert.equal(state.schemaVersion, 5);
  assert.equal(state.wordProgress[1]?.reviewCount, 1);
  assert.equal(state.wordProgress[1]?.fsrsCard.reps, 1);
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

test("薄弱判定阈值：旧数据无 weakThresholds 时按默认值兼容，非法值被夹取", () => {
  const legacy = parseStoredState(JSON.stringify({ schemaVersion: 5 }));
  assert.deepEqual(legacy.weakThresholds, {
    lookupWeak: 2,
    lookupPriority: 3,
    slowRecallMs: 15_000,
  });
  const withInvalid = parseStoredState(JSON.stringify({
    schemaVersion: 5,
    weakThresholds: { lookupWeak: 99, lookupPriority: 0, slowRecallMs: 500 },
  }));
  assert.deepEqual(withInvalid.weakThresholds, {
    lookupWeak: 20,
    lookupPriority: 1,
    slowRecallMs: 1_000,
  });
  const withValid = parseStoredState(JSON.stringify({
    schemaVersion: 5,
    weakThresholds: { lookupWeak: 4, lookupPriority: 5, slowRecallMs: 20_000 },
  }));
  assert.deepEqual(withValid.weakThresholds, {
    lookupWeak: 4,
    lookupPriority: 5,
    slowRecallMs: 20_000,
  });
});

test("v5 迁移把 passer-by 旧记录归到 passersby 学习项", () => {
  const state = parseStoredState(JSON.stringify({
    schemaVersion: 2,
    favorites: [
      { wordId: 6177, addedAt: "2026-07-27T10:00:00.000Z" },
      { wordId: 2506, addedAt: "2026-07-28T10:00:00.000Z" },
    ],
    mistakes: [
      {
        wordId: 6177,
        addedAt: "2026-07-27T10:00:00.000Z",
        mistakeCount: 2,
        lastRating: 1,
        lastMistakeAt: "2026-07-27T10:00:00.000Z",
      },
    ],
    reviews: [
      {
        wordId: 6177,
        word: "passer-by",
        rating: 2,
        reviewedAt: "2026-07-27T10:00:00.000Z",
        dueAt: "2026-07-31T10:00:00.000Z",
        section: "超纲词",
        unit: 18,
      },
    ],
  }));

  assert.deepEqual(state.favorites.map((item) => item.wordId), [2506]);
  assert.deepEqual(state.mistakes.map((item) => item.wordId), [2506]);
  assert.deepEqual(state.reviews.map((item) => item.wordId), [2506]);
});

test("划词集单词保留音标、熟练义项并可进入独立复习会话", () => {
  const wordId = lookupWordId("intensive");
  const state = parseStoredState(JSON.stringify({
    schemaVersion: 5,
    lookupWords: [{
      id: wordId,
      query: "intensive",
      kind: "word",
      phonetic: "/ɪnˈtensɪv/",
      part: "adj.",
      meaning: "密集的；强化的",
      note: "ECDICT 离线释义",
      source: "dictionary",
      addedAt: "2026-07-28T10:00:00.000Z",
    }, {
      id: lookupWordId("contextualized"),
      query: "contextualized",
      kind: "word",
      phonetic: "/AI-generated/",
      part: "adj.",
      meaning: "置于语境中的",
      note: "旧缓存",
      source: "ai",
      addedAt: "2026-07-28T10:00:00.000Z",
    }],
    familiarMeanings: {
      [wordId]: ["密集的"],
    },
    activeSession: {
      id: "lookups:test",
      kind: "lookups",
      title: "划词集复习",
      wordIds: [wordId, wordId],
      index: 0,
      createdAt: "2026-07-28T10:00:00.000Z",
    },
  }));

  assert.equal(state.lookupWords[0].phonetic, "/ɪnˈtensɪv/");
  assert.equal(state.lookupWords[0].source, "dictionary");
  assert.equal(state.lookupWords[1].phonetic, "");
  assert.deepEqual(state.familiarMeanings[wordId], ["密集的"]);
  assert.deepEqual(state.activeSession?.wordIds, [wordId]);
  assert.equal(state.activeSession?.kind, "lookups");
});

test("今日、连续天数和到期数量来自真实日期", () => {
  const reviews: Review[] = [
    createReview({ wordId: 1, word: "a", rating: 0, reviewedAt: "2026-07-26T01:00:00.000Z", dueAt: "2026-07-26T01:10:00.000Z", section: "必考词", unit: 1 }),
    createReview({ wordId: 2, word: "b", rating: 1, reviewedAt: "2026-07-27T01:00:00.000Z", dueAt: "2026-07-28T01:00:00.000Z", section: "必考词", unit: 1 }),
    createReview({ wordId: 1, word: "a", rating: 3, kind: "review", reviewedAt: "2026-07-28T01:00:00.000Z", dueAt: "2026-08-09T01:00:00.000Z", section: "必考词", unit: 1 }),
    createReview({ wordId: 3, word: "c", rating: 2, reviewedAt: "2026-07-28T02:00:00.000Z", dueAt: "2026-08-01T02:00:00.000Z", section: "基础词", unit: 1 }),
    createReview({ wordId: 3, word: "c", rating: 2, kind: "review", reviewedAt: "2026-07-28T03:00:00.000Z", dueAt: "2026-08-01T03:00:00.000Z", section: "基础词", unit: 1 }),
  ];

  const stats = learningStats(reviews, new Date("2026-07-28T12:00:00.000Z"));
  assert.equal(stats.todayDone, 2);
  assert.equal(stats.newCount, 1);
  assert.equal(stats.reviewCount, 2);
  assert.equal(stats.completionCount, 3);
  assert.equal(stats.streak, 3);
  assert.equal(stats.dueCount, 1);
  assert.ok(stats.retrievability >= 0 && stats.retrievability <= 100);
});

test("学习热力图按每天不同单词数分级", () => {
  const reviews: Review[] = Array.from({ length: 20 }, (_, index) => createReview({
    wordId: index + 1,
    word: `word-${index + 1}`,
    rating: 2,
    reviewedAt: "2026-07-28T02:00:00.000Z",
    dueAt: "2026-08-01T02:00:00.000Z",
    section: "必考词",
    unit: 1,
  }));
  reviews.push(createReview({
    ...reviews[0],
    id: "repeat:1",
    kind: "review",
    reviewedAt: "2026-07-28T03:00:00.000Z",
  }));

  const calendar = buildActivityCalendar(reviews, 7, new Date("2026-07-28T12:00:00.000Z"));
  assert.equal(calendar.length, 7);
  assert.equal(calendar.at(-1)?.date, "2026-07-28");
  assert.equal(calendar.at(-1)?.count, 20);
  assert.equal(calendar.at(-1)?.level, 4);
});

test("学习热力图可查看历史区间且不会延伸到未来", () => {
  const reviews: Review[] = [
    createReview({
      wordId: 1,
      word: "history",
      rating: 2,
      reviewedAt: "2026-07-20T02:00:00.000Z",
      dueAt: "2026-07-24T02:00:00.000Z",
      section: "必考词",
      unit: 1,
    }),
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

test("四档评分映射到 FSRS 并支持解决薄弱状态", () => {
  const first = applyRating(undefined, {
    wordId: 12,
    word: "memory",
    rating: 2,
    reviewedAt: "2026-07-20T00:00:00.000Z",
    section: "必考词",
    unit: 1,
    reviewId: "first",
  });
  assert.equal(first.review.kind, "new");
  assert.equal(first.progress.reviewCount, 1);
  assert.equal(first.progress.intervalMs, 10 * 60 * 1000);
  assert.equal(first.progress.fsrsCard.reps, 1);

  const forgotten = applyRating(first.progress, {
    wordId: 12,
    word: "memory",
    rating: 0,
    reviewedAt: "2026-07-24T00:00:00.000Z",
    section: "必考词",
    unit: 1,
    reviewId: "forgotten",
  });
  assert.equal(forgotten.review.kind, "review");
  assert.equal(forgotten.progress.lapseCount, 1);
  assert.equal(forgotten.progress.intervalMs, 60 * 1000);
  assert.equal(forgotten.progress.fsrsCard.reps, 2);
  assert.equal(isWeakProgress(forgotten.progress), true);
  assert.equal(
    isWeakProgress(resolveWeakProgress(forgotten.progress, "2026-07-24T00:01:00.000Z")),
    false,
  );
});

test("忘记、模糊、认识、熟练映射到 FSRS 四档评分", () => {
  const intervals = ([0, 1, 2, 3] as const).map((rating) =>
    applyRating(undefined, {
      wordId: rating + 1,
      word: `rating-${rating}`,
      rating,
      reviewedAt: "2026-07-20T00:00:00.000Z",
      reviewId: `rating-${rating}`,
    }).progress.intervalMs);

  assert.deepEqual(intervals, [
    60 * 1000,
    6 * 60 * 1000,
    10 * 60 * 1000,
    8 * 24 * 60 * 60 * 1000,
  ]);
});

test("v4 评分历史按时间重放为 FSRS 卡片而不是从零开始", () => {
  const state = parseStoredState(JSON.stringify({
    schemaVersion: 4,
    reviews: [
      {
        id: "history:first",
        wordId: 42,
        word: "history",
        rating: 2,
        kind: "new",
        reviewedAt: "2026-07-01T00:00:00.000Z",
        dueAt: "2026-07-05T00:00:00.000Z",
        section: "必考词",
        unit: 1,
      },
      {
        id: "history:second",
        wordId: 42,
        word: "history",
        rating: 3,
        kind: "review",
        reviewedAt: "2026-07-05T00:00:00.000Z",
        dueAt: "2026-07-17T00:00:00.000Z",
        section: "必考词",
        unit: 1,
      },
    ],
    wordProgress: {
      42: {
        status: "mastered",
        firstLearnedAt: "2026-07-01T00:00:00.000Z",
        lastReviewedAt: "2026-07-05T00:00:00.000Z",
        nextDueAt: "2030-01-01T00:00:00.000Z",
        lastRating: 3,
        reviewCount: 99,
        successCount: 99,
        lapseCount: 0,
        consecutiveSuccesses: 99,
        intervalMs: 999999999,
      },
    },
  }));

  assert.equal(state.schemaVersion, 5);
  assert.equal(state.wordProgress[42].reviewCount, 2);
  assert.equal(state.wordProgress[42].fsrsCard.reps, 2);
  assert.equal(state.wordProgress[42].firstLearnedAt, "2026-07-01T00:00:00.000Z");
  assert.notEqual(state.wordProgress[42].nextDueAt, "2030-01-01T00:00:00.000Z");
});

test("考研日期生成阶段、关键词优先级和工作量预测", () => {
  const plan = buildExamPlan({
    examDate: "2026-12-20",
    remainingBySection: {
      必考词: 600,
      基础词: 1200,
      超纲词: 300,
    },
    dailyNewGoal: 20,
    now: new Date("2026-07-28T12:00:00.000Z"),
  });

  assert.ok(plan);
  assert.equal(plan.phase, "强化期");
  assert.equal(plan.focusSection, "必考词");
  assert.equal(plan.remainingWords, 2100);
  assert.ok(plan.requiredDailyNew > 0);
  assert.equal(plan.projectedDays, 105);
});

test("今日任务把到期词排在新词前并限制每日新词数", () => {
  const due = applyRating(undefined, {
    wordId: 1,
    word: "due",
    rating: 0,
    reviewedAt: "2026-07-28T00:00:00.000Z",
    reviewId: "due",
  }).progress;
  const future = applyRating(undefined, {
    wordId: 2,
    word: "future",
    rating: 3,
    reviewedAt: "2026-07-28T00:00:00.000Z",
    reviewId: "future",
  }).progress;
  const queue = buildTodayQueue(
    [1, 2, 3, 4, 5],
    { 1: due, 2: future },
    2,
    new Date("2026-07-28T00:11:00.000Z"),
  );
  assert.deepEqual(queue, [1, 3, 4]);

  const session = createStudySession("today", "今日任务", [1, 1, 3]);
  assert.deepEqual(session.wordIds, [1, 3]);
  assert.deepEqual(sessionProgress(session), { completed: 0, total: 2, percent: 0 });
});

test("到期积压动态减少新词并允许最低量和手动覆盖", () => {
  assert.equal(adaptiveNewWordGoal({
    dailyGoal: 20,
    minimumNewWords: 5,
    dueCount: 5,
    enabled: true,
  }), 20);
  assert.equal(adaptiveNewWordGoal({
    dailyGoal: 20,
    minimumNewWords: 5,
    dueCount: 20,
    enabled: true,
  }), 10);
  assert.equal(adaptiveNewWordGoal({
    dailyGoal: 20,
    minimumNewWords: 5,
    dueCount: 40,
    enabled: true,
  }), 5);
  assert.equal(adaptiveNewWordGoal({
    dailyGoal: 20,
    minimumNewWords: 5,
    dueCount: 40,
    enabled: false,
  }), 20);
});

test("今日新词埋藏已出现的同词族成员但不永久排除", () => {
  const queue = buildTodayQueue(
    [1, 2, 3, 4],
    {},
    3,
    new Date("2026-07-28T12:00:00.000Z"),
    {
      familyKeyByWordId: {
        1: "lemma:1",
        2: "lemma:1",
        3: "lemma:3",
        4: "lemma:4",
      },
      reviewedTodayWordIds: [1],
    },
  );

  assert.deepEqual(queue, [3, 4]);
  assert.deepEqual(
    buildTodayQueue([1, 2], {}, 2, new Date("2026-07-29T12:00:00.000Z"), {
      familyKeyByWordId: { 1: "lemma:1", 2: "lemma:1" },
    }),
    [1],
  );
});

test("今日任务划词补漏：反复查询词插在到期后、新词前，同词族当天错开", () => {
  const due = applyRating(undefined, {
    wordId: 1,
    word: "due",
    rating: 0,
    reviewedAt: "2026-07-28T00:00:00.000Z",
    reviewId: "due",
  }).progress;
  const queue = buildTodayQueue(
    [1, 2, 3, 4, 5],
    { 1: due },
    2,
    new Date("2026-07-28T00:11:00.000Z"),
    {
      lookupPriorityIds: [3, 4],
      familyKeyByWordId: { 3: "lemma:3", 4: "lemma:3" },
    },
  );
  // 到期 1 在前，补漏 3 插入，同族 4 错开；新词候选 2、5 补齐目标 2 个
  assert.deepEqual(queue, [1, 3, 2, 5]);
});

test("今日任务划词补漏：已到期或已入队的补漏词不重复进队", () => {
  const due = applyRating(undefined, {
    wordId: 1,
    word: "due",
    rating: 0,
    reviewedAt: "2026-07-28T00:00:00.000Z",
    reviewId: "due",
  }).progress;
  const queue = buildTodayQueue(
    [1, 2],
    { 1: due },
    1,
    new Date("2026-07-28T00:11:00.000Z"),
    { lookupPriorityIds: [1, 2, 2] },
  );
  // 1 已在到期队列不重复；2 补漏插入且去重
  assert.deepEqual(queue, [1, 2]);
});

test("回忆耗时随评分日志保存但不改变用户评分", () => {
  const state = parseStoredState(JSON.stringify({
    reviews: [{
      wordId: 9,
      word: "recall",
      rating: 1,
      recallMs: 12345,
      reviewedAt: "2026-07-28T00:00:00.000Z",
      section: "必考词",
      unit: 1,
    }],
  }));

  assert.equal(state.reviews[0].rating, 1);
  assert.equal(state.reviews[0].recallMs, 12345);
});

test("顽固词按明确条件触发并在连续成功后退出", () => {
  const lowReviews: Review[] = [1, 2, 3].map((day) => createReview({
    id: `stubborn:${day}`,
    wordId: 77,
    word: "stubborn",
    rating: 0,
    kind: day === 1 ? "new" : "review",
    reviewedAt: `2026-07-0${day}T00:00:00.000Z`,
    dueAt: `2026-07-0${day}T00:01:00.000Z`,
    section: "必考词",
    unit: 1,
  }));
  const active = rebuildStubbornWords(
    lowReviews,
    new Date("2026-07-10T00:00:00.000Z"),
  );
  assert.equal(active[77].active, true);
  assert.equal(active[77].reason, "again-3");

  const recovered = rebuildStubbornWords([
    ...lowReviews,
    ...[4, 5, 6].map((day) => createReview({
      id: `recovered:${day}`,
      wordId: 77,
      word: "stubborn",
      rating: 2,
      kind: "review",
      reviewedAt: `2026-07-0${day}T00:00:00.000Z`,
      dueAt: `2026-07-0${day}T00:10:00.000Z`,
      section: "必考词",
      unit: 1,
    })),
  ], new Date("2026-07-10T00:00:00.000Z"));
  assert.equal(recovered[77].active, false);
  assert.equal(recovered[77].resolvedAt, "2026-07-06T00:00:00.000Z");
});

test("顽固词超过 30 天没有低评分自动退出", () => {
  const reviews: Review[] = [1, 2, 3].map((day) => createReview({
    id: `stale:${day}`,
    wordId: 88,
    word: "stale",
    rating: 0,
    kind: day === 1 ? "new" : "review",
    reviewedAt: `2026-05-0${day}T00:00:00.000Z`,
    dueAt: `2026-05-0${day}T00:01:00.000Z`,
    section: "必考词",
    unit: 1,
  }));
  const records = rebuildStubbornWords(
    reviews,
    new Date("2026-07-28T00:00:00.000Z"),
  );

  assert.equal(records[88].active, false);
  assert.equal(records[88].resolvedAt, "2026-06-02T00:00:00.000Z");
});

test("备份文件带格式版本并拒绝无效输入", () => {
  const state = parseStoredState(JSON.stringify({
    schemaVersion: 5,
    reviews: [],
    favorites: [],
    mistakes: [],
    positions: {},
    wordProgress: {},
    enrichments: {},
  }));
  const document = createBackupDocument(state, "2026-07-28T12:00:00.000Z");
  assert.equal(document.format, "wordloop-backup");
  assert.equal(parseBackupDocument(JSON.stringify(document)).state.schemaVersion, 5);
  assert.throws(() => parseBackupDocument('{"format":"other"}'), /不是有效/);
});

test("IndexedDB 分域快照可无损重建学习状态", () => {
  const state = parseStoredState(JSON.stringify({
    schemaVersion: 5,
    reviews: [{
      id: "review:1",
      wordId: 1,
      word: "abandon",
      rating: 2,
      kind: "new",
      intervalMs: 345600000,
      dueAt: "2026-08-01T00:00:00.000Z",
      reviewedAt: "2026-07-28T00:00:00.000Z",
      section: "必考词",
      unit: 1,
    }],
    favorites: [{ wordId: 1, addedAt: "2026-07-28T00:00:00.000Z" }],
    mistakes: [],
    positions: { "selection:必考词:1:ordered": 3 },
    enrichments: {
      1: {
        sentence: "Never abandon hope.",
        source: "dictionary",
      },
    },
    started: true,
  }));
  state.ratingUndoStack = [{
    reviewId: "review:pending",
    wordId: 1,
    word: "abandon",
    previousProgress: state.wordProgress[1],
    previousPosition: 2,
    studyKey: "selection:必考词:1:ordered",
    selectedSection: "必考词",
    selectedUnit: 1,
    studyMode: "ordered",
    studyScope: "selection",
    shuffleSeed: 1,
  }];

  const snapshot = splitStoredState(state);
  const restored = combineStoredState(snapshot);

  assert.equal(snapshot.reviews.length, 1);
  assert.equal(snapshot.wordProgress.length, 1);
  assert.equal(snapshot.enrichments[0].wordId, 1);
  assert.equal(snapshot.fsrsCards[0].reps, 1);
  assert.equal(snapshot.settings.ratingUndoStack.length, 1);
  assert.deepEqual(restored, state);
});

test("释义中的词性只展示一次", () => {
  assert.deepEqual(splitMeaning("vt. vi. 放弃;抛弃"), {
    part: "vt. vi.",
    meaning: "放弃;抛弃",
    senses: [
      { part: "vt.", meaning: "放弃;抛弃" },
      { part: "vi.", meaning: "放弃;抛弃" },
    ],
  });
  assert.deepEqual(splitMeaning("modal. 可以;可能"), {
    part: "modal.",
    meaning: "可以;可能",
    senses: [{ part: "modal.", meaning: "可以;可能" }],
  });
  assert.deepEqual(splitMeaning("adv. prep. 穿过,从一边到另一边;在 对面 prep. 遍及"), {
    part: "adv. prep.",
    meaning: "穿过,从一边到另一边;在 对面；遍及",
    senses: [
      { part: "adv.", meaning: "穿过,从一边到另一边;在 对面" },
      { part: "prep.", meaning: "穿过,从一边到另一边;在 对面；遍及" },
    ],
  });
});

test("考研进度三层口径：看过不等于考试日就绪", () => {
  // 无效考试日期返回 null
  assert.equal(examProgressTiers({}, ""), null);
  assert.equal(examProgressTiers({}, "2026/08/03"), null);

  // 空进度全为 0
  const empty = examProgressTiers({}, "2027-12-25");
  assert.deepEqual(empty, {
    covered: 0, mastered: 0, examReady: 0, thresholdPercent: 90, examDate: "2027-12-25",
  });
})

test("只评分过一次的词计入已覆盖但不会误报考试日就绪", () => {
  const single = applyRating(undefined, {
    wordId: 1,
    word: "radiate",
    rating: 2,
    reviewedAt: "2027-01-01T10:00:00.000Z",
  }).progress;
  const tiers = examProgressTiers({ 1: single }, "2027-12-25");
  assert.equal(tiers?.covered, 1);
  assert.equal(tiers?.mastered, 0);
  // 距离考试还有近一年，单次评分无法预测考试当天仍可提取
  assert.equal(tiers?.examReady, 0);
})

test("多次稳定复习后计入已掌握且考试日就绪", () => {
  let progress: WordProgress | undefined;
  const reviews: Array<[string, 0 | 1 | 2 | 3]> = [
    ["2027-01-01T10:00:00.000Z", 2],
    ["2027-01-08T10:00:00.000Z", 2],
    ["2027-02-01T10:00:00.000Z", 3],
    ["2027-03-01T10:00:00.000Z", 3],
    ["2027-04-05T10:00:00.000Z", 3],
    ["2027-05-10T10:00:00.000Z", 3],
    ["2027-06-15T10:00:00.000Z", 3],
  ];
  for (const [reviewedAt, rating] of reviews) {
    progress = applyRating(progress, {
      wordId: 2,
      word: "radiant",
      rating,
      reviewedAt,
    }).progress;
  }
  const tiers = examProgressTiers({ 2: progress! }, "2027-12-25");
  assert.equal(tiers?.covered, 1);
  assert.equal(tiers?.mastered, 1);
  assert.equal(tiers?.examReady, 1);
})

test("每日聚合把评分日志折叠为按自然日的轻量汇总", () => {
  const reviews = [
    createReview({ wordId: 1, word: "radiate", rating: 2, reviewedAt: "2026-08-03T08:00:00.000Z", dueAt: "2026-08-04T08:00:00.000Z" }),
    createReview({ wordId: 2, word: "radiant", rating: 0, reviewedAt: "2026-08-03T09:00:00.000Z", dueAt: "2026-08-03T09:10:00.000Z", kind: "review" }),
    createReview({ wordId: 1, word: "radiate", rating: 3, reviewedAt: "2026-08-03T10:00:00.000Z", dueAt: "2026-08-10T10:00:00.000Z", kind: "review" }),
    createReview({ wordId: 3, word: "radical", rating: 2, reviewedAt: "2026-08-02T08:00:00.000Z", dueAt: "2026-08-03T08:00:00.000Z" }),
  ];
  const aggregates = buildDailyAggregates(reviews);
  assert.equal(aggregates["2026-08-03"].newCount, 1);
  assert.equal(aggregates["2026-08-03"].reviewCount, 2);
  assert.equal(aggregates["2026-08-03"].coveredCount, 2);
  assert.equal(aggregates["2026-08-02"].coveredCount, 1);
})

test("评分日志追加写入，不再静默截断旧历史", () => {
  const reviews = Array.from({ length: 10010 }, (_, index) => ({
    word: `word${index}`,
    rating: 2,
    reviewedAt: new Date(2026, 0, 1, 0, 0, index % 60).toISOString(),
    section: "必考词",
  }));
  const state = parseStoredState(JSON.stringify({ schemaVersion: 5, reviews, wordProgress: {} }));
  assert.ok(state.reviews.length > 10000, `完整保留历史（实际 ${state.reviews.length} 条）`);
})

test("日期工具：localDateKey 本地自然日 YYYY-MM-DD，string 输入等价", () => {
  // 本地构造器构造 2026-08-09，断言本地时区语义（不依赖 UTC 解析）
  assert.equal(localDateKey(new Date(2026, 7, 9)), "2026-08-09");
  assert.equal(localDateKey(new Date(2026, 0, 5)), "2026-01-05");
  // string 输入按本地解析等价（本地构造器 toISOString 再解析回本地同日）
  assert.equal(
    localDateKey(new Date(2026, 7, 9, 23, 59).toISOString()),
    "2026-08-09",
  );
})

test("日期工具：localDayStart 本地午夜归零", () => {
  const late = localDayStart(new Date(2026, 7, 9, 23, 59, 59));
  const midnight = localDayStart(new Date(2026, 7, 9, 0, 0, 0));
  assert.equal(late.getTime(), midnight.getTime());
  assert.equal(late.getHours(), 0);
  assert.equal(late.getMinutes(), 0);
  assert.equal(late.getSeconds(), 0);
})

test("日期工具：addLocalDays 跨月、跨年与负数天数", () => {
  // 7-31 +1 → 8-1（跨月）
  const monthEnd = addLocalDays(new Date(2026, 6, 31), 1);
  assert.equal(monthEnd.getMonth(), 7);
  assert.equal(monthEnd.getDate(), 1);
  // 12-31 +1 → 次年 1-1（跨年）
  const yearEnd = addLocalDays(new Date(2026, 11, 31), 1);
  assert.equal(yearEnd.getFullYear(), 2027);
  assert.equal(yearEnd.getMonth(), 0);
  assert.equal(yearEnd.getDate(), 1);
  // 负数天数回退
  const back = addLocalDays(new Date(2026, 7, 9), -9);
  assert.equal(back.getMonth(), 6);
  assert.equal(back.getDate(), 31);
  // 不修改入参
  const source = new Date(2026, 7, 9);
  addLocalDays(source, 1);
  assert.equal(source.getDate(), 9);
})

test("日期工具：localWeekStart 本地周一作为周起点", () => {
  // 2026-08-09 是周日 → 回退到本周一 08-03
  const sunday = localWeekStart(new Date(2026, 7, 9));
  assert.equal(sunday.getDay(), 1);
  assert.equal(sunday.getDate(), 3);
  assert.equal(sunday.getMonth(), 7);
  // 周一返回当天
  const monday = localWeekStart(new Date(2026, 7, 3, 12));
  assert.equal(monday.getDay(), 1);
  assert.equal(monday.getDate(), 3);
  // 边界 23:59:59 仍归到当日零点所在周的周一
  const boundary = localWeekStart(new Date(2026, 7, 8, 23, 59, 59));
  assert.equal(boundary.getDay(), 1);
  assert.equal(boundary.getDate(), 3);
  // 周六 → 本周一
  const saturday = localWeekStart(new Date(2026, 7, 8, 8));
  assert.equal(saturday.getDay(), 1);
  assert.equal(saturday.getDate(), 3);
})

test("划词纯投影：红宝书 exact/folded 命中优先级与音标来源保持", () => {
  const exactWord = {
    id: 1,
    word: "Abandon",
    phonetic: "/əˈbændən/",
    part: "v.",
    meaning: "放弃",
    section: "必考词",
    unit: 2,
  };
  const foldedFirst = {
    id: 2,
    word: "abandon",
    meaning: "遗弃",
    section: "基础词",
    unit: 1,
  };
  const foldedSecond = { ...foldedFirst, id: 3, meaning: "沉溺" };
  const wordByText = buildWordTextIndex([
    exactWord,
    foldedFirst,
    foldedSecond,
  ]);

  const exact = resolveKnownLookupResult({
    query: "Abandon",
    context: "",
    wordByText,
    lookupWords: [],
    lookupCache: {},
    phoneticIndex: {},
  });
  assert.deepEqual(exact, {
    result: {
      linkedWordId: 1,
      query: "Abandon",
      kind: "word",
      phonetic: "/əˈbændən/",
      phoneticSource: "redbook",
      part: "v.",
      meaning: "放弃",
      note: "必考词 · Unit 2",
      source: "redbook",
    },
    cached: false,
    linkedPhonetic: { wordId: 1, phonetic: "/əˈbændən/" },
  });

  const folded = resolveKnownLookupResult({
    query: "ABANDON",
    context: "",
    wordByText: buildWordTextIndex([foldedFirst, foldedSecond]),
    lookupWords: [],
    lookupCache: {},
    phoneticIndex: { abandon: "əˈbændən" },
  });
  assert.equal(folded?.result.linkedWordId, 2);
  assert.equal(folded?.result.meaning, "遗弃");
  assert.equal(folded?.result.phonetic, "əˈbændən");
  assert.equal(folded?.result.phoneticSource, "dictionary");
})

test("划词纯投影：已保存结果优先于 query/context 缓存且保留 AI 音标语义", () => {
  const saved = {
    id: -10,
    query: "careful elucidator",
    kind: "phrase" as const,
    phonetic: "old",
    part: "短语",
    meaning: "谨慎的阐释者",
    note: "saved",
    source: "ai" as const,
    addedAt: "2026-08-01T00:00:00.000Z",
  };
  const cached: LookupResult = {
    query: saved.query,
    kind: saved.kind,
    phonetic: "cached",
    part: saved.part,
    meaning: "缓存结果",
    note: "cache",
    source: "ai",
  };
  const lookupCache = rememberLookupResult(
    {},
    saved.query,
    "Example Context",
    cached,
  );
  const resolved = resolveKnownLookupResult({
    query: saved.query,
    context: "Example Context",
    wordByText: buildWordTextIndex([]),
    lookupWords: [saved],
    lookupCache,
    phoneticIndex: { "careful elucidator": "new" },
  });
  assert.equal(resolved?.cached, true);
  assert.equal(resolved?.result.meaning, saved.meaning);
  assert.equal(resolved?.result.phonetic, "new");
  assert.equal(resolved?.result.phoneticSource, "dictionary");

  const cacheOnly = resolveKnownLookupResult({
    query: saved.query,
    context: "EXAMPLE CONTEXT",
    wordByText: buildWordTextIndex([]),
    lookupWords: [],
    lookupCache,
    phoneticIndex: {},
  });
  assert.deepEqual(cacheOnly, { result: cached, cached: true });
})

test("划词纯投影：保存去重保留身份与时间，新词冲突继续分配不同 id", () => {
  const first: LookupResult = {
    linkedWordId: 1,
    query: "radiate",
    kind: "word",
    phonetic: "",
    part: "v.",
    meaning: "散发",
    note: "first",
    source: "redbook",
  };
  const existing = upsertLookupWord([], first, "2026-08-01T00:00:00.000Z");
  const updated = upsertLookupWord(
    [{
      id: -99,
      query: "other",
      kind: "word",
      phonetic: "",
      part: "n.",
      meaning: "其他",
      note: "other",
      source: "dictionary",
      addedAt: "2026-08-02T00:00:00.000Z",
    }, ...existing],
    { ...first, meaning: "发出", note: "updated" },
    "2026-08-03T00:00:00.000Z",
  );
  assert.equal(updated[0].id, existing[0].id);
  assert.equal(updated[0].addedAt, existing[0].addedAt);
  assert.equal(updated[0].meaning, "发出");
  assert.equal(updated[1].query, "other");

  const collisionId = lookupWordId("collision-a");
  const inserted = upsertLookupWord(
    [{
      id: collisionId,
      query: "collision-b",
      kind: "word",
      phonetic: "",
      part: "n.",
      meaning: "冲突",
      note: "",
      source: "dictionary",
      addedAt: "2026-08-01T00:00:00.000Z",
    }],
    { ...first, linkedWordId: undefined, query: "collision-a" },
    "2026-08-03T00:00:00.000Z",
  );
  assert.notEqual(inserted[0].id, collisionId);
})

test("划词纯投影：统计保留 firstAt，缓存按既有插入顺序裁剪到 120 项", () => {
  const first = recordLookupStat({}, "  Radiate  ", "2026-08-01T00:00:00.000Z");
  const second = recordLookupStat(first, "RADIATE", "2026-08-02T00:00:00.000Z");
  assert.deepEqual(second.radiate, {
    count: 2,
    firstAt: "2026-08-01T00:00:00.000Z",
    lastAt: "2026-08-02T00:00:00.000Z",
  });
  assert.equal(recordLookupStat(second, "   ", "later"), second);

  let cache: Record<string, LookupResult> = {};
  for (let index = 0; index < 121; index += 1) {
    cache = rememberLookupResult(cache, `word-${index}`, "Context", {
      query: `word-${index}`,
      kind: "word",
      phonetic: "",
      part: "n.",
      meaning: String(index),
      note: "",
      source: "ai",
    });
  }
  assert.equal(Object.keys(cache).length, 120);
  assert.equal(resolveKnownLookupResult({
    query: "WORD-120",
    context: "CONTEXT",
    wordByText: buildWordTextIndex([]),
    lookupWords: [],
    lookupCache: cache,
    phoneticIndex: {},
  })?.result.meaning, "120");
  assert.equal(resolveKnownLookupResult({
    query: "word-0",
    context: "Context",
    wordByText: buildWordTextIndex([]),
    lookupWords: [],
    lookupCache: cache,
    phoneticIndex: {},
  }), null);
})
