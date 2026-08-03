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
