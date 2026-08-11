import assert from "node:assert/strict";
import test from "node:test";
import {
  buildActivityCalendar,
  buildDailyAggregates,
  buildStudyKey,
  clearLearningRecords,
  learningStats,
  lookupWordId,
  parseStoredState,
  splitMeaning,
  STORAGE_VERSION,
  type Review,
} from "../lib/study.ts";
import {
  adaptiveNewWordGoal,
  applyRating,
  buildExamPlan,
  buildStudyWordSource,
  buildTodaySessionBatch,
  buildTodayQueue,
  buildTodayTaskPreview,
  createStudySession,
  isWeakProgress,
  rebuildStubbornWords,
  resolveWeakProgress,
  sessionProgress,
  type WordProgress,
  examProgressTiers,
} from "../lib/learning.ts";
import { splitWordSenses } from "../lib/word-utils.ts";
import {
  BACKUP_FORMAT,
  createBackupDocument,
  parseBackupDocument,
} from "../lib/backup.ts";
import {
  appendQuizAttempt,
  type QuizAttempt,
} from "../lib/quiz.ts";
import {
  combineStoredState,
  DATABASE_VERSION,
  splitStoredState,
  STORES,
} from "../lib/storage.ts";
import {
  buildEtymologyCacheEntry,
  type EtymologyInput,
} from "../lib/etymology.ts";
import { mergeWordEnrichment } from "../lib/enrichment.ts";
import {
  buildDailyClozeCacheEntry,
  normalizeDailyClozeContent,
  type DailyClozeInput,
} from "../lib/daily-cloze.ts";
import {
  buildDailySentenceCacheEntry,
  normalizeDailySentenceContent,
  type DailySentenceInput,
} from "../lib/daily-sentence.ts";
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
import { buildRedbookLoadGuidance } from "../lib/redbook.ts";

function createQuizAttempts(count: number): QuizAttempt[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `attempt:${index}`,
    wordId: index + 1,
    mode: "meaning-choice",
    correct: index % 2 === 0,
    recallMs: index,
    answeredAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    appliedToSchedule: index % 3 === 0,
  }));
}

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

const ETYMOLOGY_INPUT: EtymologyInput = {
  wordId: 59,
  word: "saving",
  meaning: "n. 节省；存款",
  root: "save",
  relation: {
    kind: "derived",
    label: "save → saving · 派生词",
    note: "红宝书以独立词条收录。",
    lemma: "save",
    independent: true,
    confidence: "confirmed",
  },
};

const ETYMOLOGY_ENTRY = buildEtymologyCacheEntry(
  ETYMOLOGY_INPUT,
  {
    breakdown: "save + ing",
    root: "save：保留",
    affixes: [{ form: "-ing", kind: "suffix", meaning: "名词后缀" }],
    mnemonic: "把省下来的钱存起来。",
  },
  new Date("2026-08-11T08:00:00.000Z"),
);

const DAILY_CLOZE_INPUT: DailyClozeInput = {
  localDate: "2026-08-11",
  targets: [{ wordId: 1, word: "radiate", meaning: "散发；发出光线" }],
};
const DAILY_CLOZE_ENTRY = buildDailyClozeCacheEntry(
  DAILY_CLOZE_INPUT,
  normalizeDailyClozeContent({
    passage: ["Readers", "radiate", ...Array(78).fill("context")].join(" "),
    questions: [{
      wordId: 1,
      options: ["radiate", "reduce", "remove", "reflect"],
      explanation: "语境表示向外传递信心。",
    }],
  }, DAILY_CLOZE_INPUT)!,
  new Date("2026-08-11T08:00:00.000Z"),
);

const DAILY_SENTENCE_INPUT: DailySentenceInput = { localDate: "2026-08-11" };
const DAILY_SENTENCE_ENTRY = buildDailySentenceCacheEntry(
  DAILY_SENTENCE_INPUT,
  normalizeDailySentenceContent({
    sentence: "Although researchers who study memory often emphasize repeated practice, students who explain why an answer is correct may build knowledge that remains useful when unfamiliar questions require them to connect evidence across several apparently unrelated topics.",
    backbone: "students may build knowledge",
    clauses: [
      {
        text: "students who explain why an answer is correct may build knowledge",
        type: "main",
        function: "主句",
      },
      {
        text: "who study memory",
        type: "relative",
        function: "修饰 researchers",
      },
    ],
    modifiers: [{
      text: "across several apparently unrelated topics",
      target: "connect evidence",
      relation: "补充连接证据的范围",
    }],
    translation: "尽管研究记忆的学者常强调重复练习，但解释答案为何正确的学生，可能建立一种在陌生问题中仍然有用的知识。",
  }, DAILY_SENTENCE_INPUT)!,
  new Date("2026-08-11T08:00:00.000Z"),
);

test("词库加载错误说明：只细分可靠的本地文件问题，其余使用通用修复步骤", () => {
  const missing = buildRedbookLoadGuidance(new Error("请求失败：404"));
  const invalidJson = buildRedbookLoadGuidance(new SyntaxError("Unexpected token"));
  const incomplete = buildRedbookLoadGuidance(new Error("redbook analysis incomplete"));
  const unavailable = buildRedbookLoadGuidance(new Error("请求失败：503"));
  const unknown = buildRedbookLoadGuidance("opaque failure");

  assert.equal(missing.title, "本地词库文件缺失或不完整");
  assert.equal(invalidJson.title, missing.title);
  assert.equal(incomplete.title, missing.title);
  assert.match(missing.detail, /重新启动词环/);
  assert.equal(unavailable.title, "暂时无法读取本地词库");
  assert.equal(unknown.title, unavailable.title);
  assert.match(unavailable.detail, /确认词环仍在运行.*重试/);
  assert.doesNotMatch(`${unavailable.title}${unavailable.detail}`, /503|stack|Error/i);
});

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

test("今日任务不会在进度投影短暂落后时重复加入当天已评分词", () => {
  const queue = buildTodayQueue(
    [1, 2, 3],
    {},
    3,
    new Date("2026-08-11T08:00:00.000Z"),
    { reviewedTodayWordIds: [1, 1] },
  );

  assert.deepEqual(queue, [2, 3]);
});

test("今日新词目标已完成时不会因零上限额外加入一个新词", () => {
  const preview = buildTodayTaskPreview({
    primaryWordIds: [1, 2, 3],
    progress: {},
    configuredNewGoal: 20,
    effectiveNewGoal: 20,
    learnedTodayCount: 20,
    adaptiveEnabled: true,
  });

  assert.deepEqual(preview.newWordIds, []);
  assert.equal(preview.complete, true);
});

test("今日任务预览与实际队列同源，并对到期、补漏和新词互斥计数", () => {
  const now = new Date("2026-07-28T00:11:00.000Z");
  const due = applyRating(undefined, {
    wordId: 1,
    word: "due",
    rating: 0,
    reviewedAt: "2026-07-28T00:00:00.000Z",
    reviewId: "preview-due",
  }).progress;
  const options = { lookupPriorityIds: [1, 3, 3] };
  const preview = buildTodayTaskPreview({
    primaryWordIds: [1, 2, 3, 4, 5],
    progress: { 1: due },
    configuredNewGoal: 20,
    effectiveNewGoal: 10,
    learnedTodayCount: 2,
    adaptiveEnabled: true,
    now,
    options,
  });

  assert.deepEqual(
    preview.wordIds,
    buildTodayQueue([1, 2, 3, 4, 5], { 1: due }, 8, now, options),
  );
  assert.deepEqual(preview.dueWordIds, [1]);
  assert.deepEqual(preview.lookupWordIds, [3]);
  assert.deepEqual(preview.newWordIds, [2, 4, 5]);
  assert.equal(preview.totalCount, 5);
  assert.equal(preview.dueCount + preview.lookupCount + preview.newCount, 5);
  assert.equal(new Set(preview.wordIds).size, preview.wordIds.length);
});

test("今日任务预览解释自适应目标、已完成新词和空任务", () => {
  const adjusted = buildTodayTaskPreview({
    primaryWordIds: [1, 2, 3],
    progress: {},
    configuredNewGoal: 20,
    effectiveNewGoal: 10,
    learnedTodayCount: 4,
    adaptiveEnabled: true,
  });
  assert.match(adjusted.goalExplanation, /到期复习较多，新词目标已从 20 调整到 10/);
  assert.match(adjusted.goalExplanation, /剩余队列含 3 个新词/);
  assert.equal(adjusted.estimatedMinutes, 3);

  const completed = buildTodayTaskPreview({
    primaryWordIds: [],
    progress: {},
    configuredNewGoal: 20,
    effectiveNewGoal: 20,
    learnedTodayCount: 20,
    adaptiveEnabled: true,
  });
  assert.deepEqual(completed.wordIds, []);
  assert.equal(completed.complete, true);
  assert.equal(completed.estimatedMinutes, 0);
  assert.equal(completed.goalExplanation, "今日新词已完成，本轮只安排到期和补漏。");
});

test("每批学习词数：旧状态与非法值默认 10，四个合法值完整往返", () => {
  for (const value of [undefined, "10", 0, 6, 25, null]) {
    const state = parseStoredState(JSON.stringify({
      schemaVersion: 5,
      ...(value === undefined ? {} : { sessionBatchSize: value }),
    }));
    assert.equal(state.sessionBatchSize, 10);
  }

  for (const sessionBatchSize of [5, 10, 15, 20] as const) {
    const state = parseStoredState(JSON.stringify({
      schemaVersion: 5,
      sessionBatchSize,
    }));
    assert.equal(state.sessionBatchSize, sessionBatchSize);
    assert.equal(
      combineStoredState(splitStoredState(state)).sessionBatchSize,
      sessionBatchSize,
    );
  }
});

test("今日任务批次只截取完整队列前 5/10/15/20 词，完成态仍由完整队列决定", () => {
  const preview = buildTodayTaskPreview({
    primaryWordIds: Array.from({ length: 25 }, (_, index) => index + 1),
    progress: {},
    configuredNewGoal: 50,
    effectiveNewGoal: 50,
    learnedTodayCount: 0,
    adaptiveEnabled: false,
  });

  for (const batchSize of [5, 10, 15, 20] as const) {
    const batch = buildTodaySessionBatch(preview, batchSize);
    assert.deepEqual(batch.batchWordIds, preview.wordIds.slice(0, batchSize));
    assert.equal(batch.batchCount, batchSize);
    assert.equal(batch.totalRemainingCount, 25);
    assert.equal(batch.complete, false);
  }

  const exact = buildTodaySessionBatch({ ...preview, wordIds: preview.wordIds.slice(0, 10), totalCount: 10 }, 10);
  const short = buildTodaySessionBatch({ ...preview, wordIds: preview.wordIds.slice(0, 3), totalCount: 3 }, 10);
  const empty = buildTodaySessionBatch({ ...preview, wordIds: [], totalCount: 0, complete: true }, 10);
  assert.equal(exact.batchCount, 10);
  assert.deepEqual(short.batchWordIds, [1, 2, 3]);
  assert.equal(short.batchCount, 3);
  assert.equal(short.estimatedMinutes, 3);
  assert.deepEqual(empty.batchWordIds, []);
  assert.equal(empty.complete, true);
});

test("今日任务跨两批重新派生时不重复已处理词，最后一批后才完成", () => {
  const primaryWordIds = Array.from({ length: 12 }, (_, index) => index + 1);
  const firstPreview = buildTodayTaskPreview({
    primaryWordIds,
    progress: {},
    configuredNewGoal: 20,
    effectiveNewGoal: 20,
    learnedTodayCount: 0,
    adaptiveEnabled: true,
  });
  const firstBatch = buildTodaySessionBatch(firstPreview, 5);
  const progress = Object.fromEntries(firstBatch.batchWordIds.map((wordId) => [
    wordId,
    applyRating(undefined, {
      wordId,
      word: `word-${wordId}`,
      rating: 2,
      reviewedAt: "2026-08-11T08:00:00.000Z",
      reviewId: `batch:${wordId}`,
    }).progress,
  ]));
  const secondPreview = buildTodayTaskPreview({
    primaryWordIds,
    progress,
    configuredNewGoal: 20,
    effectiveNewGoal: 20,
    learnedTodayCount: 5,
    adaptiveEnabled: true,
    now: new Date("2026-08-11T08:01:00.000Z"),
  });
  const secondBatch = buildTodaySessionBatch(secondPreview, 5);

  assert.equal(secondPreview.complete, false);
  assert.deepEqual(secondBatch.batchWordIds, [6, 7, 8, 9, 10]);
  assert.deepEqual(
    firstBatch.batchWordIds.filter((wordId) => secondBatch.batchWordIds.includes(wordId)),
    [],
  );

  const completedProgress = { ...progress };
  for (const wordId of secondPreview.wordIds) {
    completedProgress[wordId] = applyRating(undefined, {
      wordId,
      word: `word-${wordId}`,
      rating: 2,
      reviewedAt: "2026-08-11T08:02:00.000Z",
      reviewId: `complete:${wordId}`,
    }).progress;
  }
  const completed = buildTodayTaskPreview({
    primaryWordIds,
    progress: completedProgress,
    configuredNewGoal: 20,
    effectiveNewGoal: 20,
    learnedTodayCount: 12,
    adaptiveEnabled: true,
    now: new Date("2026-08-11T08:03:00.000Z"),
  });
  assert.equal(buildTodaySessionBatch(completed, 5).complete, true);
});

test("学习卡来源覆盖今日任务明细、全部会话类型和通用回退", () => {
  const now = new Date("2026-07-28T00:11:00.000Z");
  const due = applyRating(undefined, {
    wordId: 1,
    word: "due",
    rating: 0,
    reviewedAt: "2026-07-28T00:00:00.000Z",
    reviewId: "source-due",
  }).progress;
  const future = applyRating(undefined, {
    wordId: 2,
    word: "future",
    rating: 3,
    reviewedAt: "2026-07-28T00:00:00.000Z",
    reviewId: "source-future",
  }).progress;
  const today = createStudySession("today", "今日任务", [1], now);

  assert.equal(buildStudyWordSource({
    session: today,
    progress: due,
    lookupPriority: true,
    now,
  }).label, "今日到期");
  assert.equal(buildStudyWordSource({
    session: today,
    lookupPriority: true,
    now,
  }).label, "反复查词补漏");
  assert.equal(buildStudyWordSource({
    session: today,
    lookupPriority: false,
    now,
  }).label, "今日新词");
  assert.equal(buildStudyWordSource({
    session: createStudySession("today", "今日任务 · 补漏", [1], now),
    progress: future,
    lookupPriority: false,
    now,
  }).label, "手动加入今日任务");
  assert.equal(buildStudyWordSource({
    session: today,
    progress: future,
    lookupPriority: false,
    now,
  }).label, "今日任务");

  const labels = {
    mistakes: "错词强化",
    stubborn: "顽固词专项",
    lookups: "划词集学习",
    favorites: "收藏复习",
    search: "搜索专项",
    article: "文章提词",
    sprint: "薄弱冲刺",
    reinforcement: "本轮再强化",
  } as const;
  for (const [kind, label] of Object.entries(labels)) {
    assert.equal(buildStudyWordSource({
      session: createStudySession(
        kind as keyof typeof labels,
        label,
        [1],
        now,
      ),
      progress: future,
      lookupPriority: false,
      now,
    }).label, label);
  }
  assert.deepEqual(buildStudyWordSource({
    session: createStudySession("article", "文章提词", [1], now),
    progress: future,
    lookupPriority: false,
    now,
  }), {
    label: "文章提词",
    description: "这个词来自你粘贴并确认的英文文章。",
  });
  assert.equal(buildStudyWordSource({
    progress: future,
    lookupPriority: false,
    now,
  }).label, "当前词书额外练习");
});

test("article 会话和强化来源经规范化、分域与备份无损往返，非法 kind 仍拒绝", () => {
  const articleSession = {
    id: "article:2026-08-11T08:00:00.000Z",
    kind: "article",
    title: "文章提词",
    wordIds: [1, 9_000_321, 1],
    index: 1,
    createdAt: "2026-08-11T08:00:00.000Z",
  };
  const state = parseStoredState(JSON.stringify({
    schemaVersion: 5,
    activeSession: articleSession,
  }));
  assert.deepEqual(state.activeSession, {
    ...articleSession,
    wordIds: [1, 9_000_321],
  });
  assert.equal(state.schemaVersion, 5);

  const reinforcement = parseStoredState(JSON.stringify({
    schemaVersion: 5,
    activeSession: {
      ...articleSession,
      id: "reinforcement:article",
      kind: "reinforcement",
      originKind: "article",
    },
  }));
  assert.equal(reinforcement.activeSession?.originKind, "article");

  const restoredDomain = combineStoredState(splitStoredState(state));
  const restoredBackup = parseBackupDocument(JSON.stringify(
    createBackupDocument(state, "2026-08-11T08:01:00.000Z"),
  )).state;
  assert.deepEqual(restoredDomain.activeSession, state.activeSession);
  assert.deepEqual(restoredBackup.activeSession, state.activeSession);
  assert.equal(clearLearningRecords(state).activeSession, undefined);

  const invalid = parseStoredState(JSON.stringify({
    schemaVersion: 5,
    activeSession: { ...articleSession, kind: "article-history" },
  }));
  assert.equal(invalid.activeSession, undefined);
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
    sessionBatchSize: 15,
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
  assert.equal(snapshot.settings.sessionBatchSize, 15);
  assert.deepEqual(restored, state);
});

test("词根助记沿现有 enrichment 兼容读取，非法缓存只移除自身", () => {
  const legacy = parseStoredState(JSON.stringify({
    schemaVersion: 5,
    enrichments: {
      59: {
        sentence: "Saving regularly builds resilience.",
        phonetic: "/ˈseɪvɪŋ/",
        source: "dictionary",
      },
    },
  }));
  assert.equal(legacy.enrichments[59].etymology, undefined);
  assert.equal(legacy.enrichments[59].sentence, "Saving regularly builds resilience.");

  const valid = parseStoredState(JSON.stringify({
    schemaVersion: 5,
    enrichments: {
      59: {
        sentence: "Saving regularly builds resilience.",
        phonetic: "/ˈseɪvɪŋ/",
        source: "dictionary",
        etymology: ETYMOLOGY_ENTRY,
      },
    },
  }));
  assert.deepEqual(valid.enrichments[59].etymology, ETYMOLOGY_ENTRY);

  const invalid = parseStoredState(JSON.stringify({
    schemaVersion: 5,
    enrichments: {
      59: {
        sentence: "Saving regularly builds resilience.",
        phonetic: "/ˈseɪvɪŋ/",
        source: "dictionary",
        etymology: { ...ETYMOLOGY_ENTRY, source: "local" },
      },
    },
  }));
  assert.equal(invalid.enrichments[59].etymology, undefined);
  assert.equal(invalid.enrichments[59].sentence, "Saving regularly builds resilience.");
  assert.equal(invalid.enrichments[59].phonetic, "/ˈseɪvɪŋ/");
});

test("词根助记经分域、备份导入与清空学习记录完整保留", () => {
  const state = parseStoredState(JSON.stringify({
    schemaVersion: 5,
    enrichments: {
      59: {
        sentence: "Saving regularly builds resilience.",
        source: "dictionary",
        etymology: ETYMOLOGY_ENTRY,
      },
    },
  }));
  const restoredDomain = combineStoredState(splitStoredState(state));
  const backup = createBackupDocument(state, "2026-08-11T08:01:00.000Z");
  const restoredBackup = parseStoredState(JSON.stringify(
    parseBackupDocument(JSON.stringify(backup)).state,
  ));

  assert.deepEqual(restoredDomain.enrichments[59].etymology, ETYMOLOGY_ENTRY);
  assert.deepEqual(restoredBackup.enrichments[59].etymology, ETYMOLOGY_ENTRY);
  assert.deepEqual(clearLearningRecords(state).enrichments[59].etymology, ETYMOLOGY_ENTRY);
});

test("enrichment 双向合并保护例句、音标与词根助记", () => {
  const existing = {
    phonetic: "/ˈseɪvɪŋ/",
    sentence: "Saving regularly builds resilience.",
    translation: "定期储蓄能增强抗风险能力。",
    senseExamples: [{
      meaning: "节省",
      sentence: "Saving regularly builds resilience.",
      translation: "定期储蓄能增强抗风险能力。",
    }],
    collocations: ["energy saving"],
    targetMeanings: ["节省"],
    source: "dictionary" as const,
    generatedAt: "2026-08-10T08:00:00.000Z",
    verified: true,
  };
  const withEtymology = mergeWordEnrichment(existing, {
    source: "dictionary",
    etymology: ETYMOLOGY_ENTRY,
  });
  assert.equal(withEtymology.sentence, existing.sentence);
  assert.equal(withEtymology.phonetic, existing.phonetic);
  assert.deepEqual(withEtymology.senseExamples, existing.senseExamples);
  assert.deepEqual(withEtymology.etymology, ETYMOLOGY_ENTRY);

  const rewritten = mergeWordEnrichment(withEtymology, {
    sentence: "The revised example focuses on saving resources.",
    translation: "新例句聚焦节约资源。",
    senseExamples: [{
      meaning: "节省",
      sentence: "The revised example focuses on saving resources.",
      translation: "新例句聚焦节约资源。",
    }],
    collocations: ["resource saving"],
    targetMeanings: ["节省"],
    source: "ai",
    generatedAt: "2026-08-11T08:00:00.000Z",
    verified: false,
  });
  assert.equal(rewritten.sentence, "The revised example focuses on saving resources.");
  assert.equal(rewritten.phonetic, existing.phonetic);
  assert.deepEqual(rewritten.etymology, ETYMOLOGY_ENTRY);
});

test("词根助记不升级存储、数据库、store/domain 或备份格式", () => {
  assert.equal(STORAGE_VERSION, 5);
  assert.equal(DATABASE_VERSION, 3);
  assert.equal(BACKUP_FORMAT, "wordloop-backup");
  assert.deepEqual(Object.keys(STORES), [
    "settings",
    "reviews",
    "wordProgress",
    "favorites",
    "mistakes",
    "positions",
    "enrichments",
    "backups",
    "fsrsCards",
    "stubbornWords",
    "quizAttempts",
    "stateDomains",
  ]);
});

test("每日短文缓存经旧状态、分域、备份与恢复完整往返，非法字段只移除自身", () => {
  const legacy = parseStoredState(JSON.stringify({ schemaVersion: 5, dailyGoal: 30 }));
  assert.equal(legacy.dailyCloze, undefined);

  const state = parseStoredState(JSON.stringify({
    schemaVersion: 5,
    dailyGoal: 30,
    dailyCloze: DAILY_CLOZE_ENTRY,
    activeQuiz: {
      id: "quiz:passage-cloze:restore",
      mode: "passage-cloze",
      inputKey: DAILY_CLOZE_ENTRY.inputKey,
      seed: 71,
      questionWordIds: [1],
      questionSnapshots: [{
        id: "passage-cloze:2026-08-11:1:0",
        mode: "passage-cloze",
        wordId: 1,
        prompt: DAILY_CLOZE_ENTRY.content.passage.replace(/radiate/i, "＿＿＿＿"),
        answer: "radiate",
        options: ["radiate", "reduce", "remove", "reflect"],
        label: "短文填词",
        explanation: "语境表示向外传递信心。",
      }],
      index: 0,
      correctCount: 0,
      answers: {},
      complete: false,
      startedAt: "2026-08-11T08:01:00.000Z",
    },
  }));
  assert.deepEqual(state.dailyCloze, DAILY_CLOZE_ENTRY);
  assert.equal(state.activeQuiz?.mode, "passage-cloze");
  assert.deepEqual(combineStoredState(splitStoredState(state)), state);
  assert.deepEqual(
    parseBackupDocument(JSON.stringify(createBackupDocument(state))).state.dailyCloze,
    DAILY_CLOZE_ENTRY,
  );

  const invalid = parseStoredState(JSON.stringify({
    schemaVersion: 5,
    dailyGoal: 30,
    dailyCloze: { ...DAILY_CLOZE_ENTRY, source: "local" },
    activeQuiz: state.activeQuiz,
  }));
  assert.equal(invalid.dailyCloze, undefined);
  assert.equal(invalid.dailyGoal, 30);
  assert.equal(invalid.activeQuiz?.mode, "passage-cloze");
});

test("passage-cloze 作答正常归一化，清空学习记录同时清除缓存和会话但快照保留", () => {
  const state = parseStoredState(JSON.stringify({
    schemaVersion: 5,
    dailyCloze: DAILY_CLOZE_ENTRY,
    quizAttempts: [{
      id: "passage-attempt",
      wordId: 1,
      mode: "passage-cloze",
      correct: false,
      recallMs: 3_000,
      answeredAt: "2026-08-11T08:02:00.000Z",
      appliedToSchedule: true,
    }],
  }));
  const recovery = createBackupDocument(state, "2026-08-11T08:03:00.000Z");
  const cleared = clearLearningRecords(state);
  assert.equal(state.quizAttempts[0].mode, "passage-cloze");
  assert.equal(cleared.dailyCloze, undefined);
  assert.equal(cleared.activeQuiz, undefined);
  assert.deepEqual(cleared.quizAttempts, []);
  assert.deepEqual(recovery.state.dailyCloze, DAILY_CLOZE_ENTRY);
});

test("每日长难句缓存经旧状态、settings 分域、备份导入和恢复完整往返", () => {
  const legacy = parseStoredState(JSON.stringify({ schemaVersion: 5 }));
  assert.equal(legacy.dailySentence, undefined);

  const state = parseStoredState(JSON.stringify({
    schemaVersion: 5,
    dailyGoal: 30,
    dailySentence: DAILY_SENTENCE_ENTRY,
    reviews: [],
    quizAttempts: [],
  }));
  assert.deepEqual(state.dailySentence, DAILY_SENTENCE_ENTRY);
  assert.deepEqual(combineStoredState(splitStoredState(state)), state);
  assert.deepEqual(
    parseBackupDocument(JSON.stringify(createBackupDocument(state))).state.dailySentence,
    DAILY_SENTENCE_ENTRY,
  );

  const invalid = parseStoredState(JSON.stringify({
    schemaVersion: 5,
    dailyGoal: 30,
    dailySentence: { ...DAILY_SENTENCE_ENTRY, source: "local" },
  }));
  assert.equal(invalid.dailySentence, undefined);
  assert.equal(invalid.dailyGoal, 30);
});

test("清空学习记录保留合法每日长难句且不改变任何学习事实", () => {
  const state = parseStoredState(JSON.stringify({
    schemaVersion: 5,
    dailySentence: DAILY_SENTENCE_ENTRY,
    reviews: [],
    quizAttempts: [],
    wordProgress: {},
  }));
  const before = {
    reviews: structuredClone(state.reviews),
    quizAttempts: structuredClone(state.quizAttempts),
    wordProgress: structuredClone(state.wordProgress),
  };
  const cleared = clearLearningRecords(state);
  assert.deepEqual(cleared.dailySentence, DAILY_SENTENCE_ENTRY);
  assert.deepEqual(before, {
    reviews: state.reviews,
    quizAttempts: state.quizAttempts,
    wordProgress: state.wordProgress,
  });
  assert.equal(STORAGE_VERSION, 5);
  assert.equal(DATABASE_VERSION, 3);
  assert.equal(BACKUP_FORMAT, "wordloop-backup");
  assert.equal(Object.keys(STORES).length, 12);
});

test("每批设置变化只影响后续创建，不改写当前 activeSession 快照", () => {
  const state = parseStoredState(JSON.stringify({
    schemaVersion: 5,
    sessionBatchSize: 10,
    activeSession: {
      id: "today:stable-batch",
      kind: "today",
      title: "今日任务",
      wordIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      index: 3,
      createdAt: "2026-08-11T08:00:00.000Z",
    },
  }));
  const currentSession = structuredClone(state.activeSession);
  const changed = combineStoredState(splitStoredState({
    ...state,
    sessionBatchSize: 5,
  }));
  const restoredBackup = parseBackupDocument(JSON.stringify(
    createBackupDocument(changed, "2026-08-11T08:01:00.000Z"),
  )).state;

  assert.equal(changed.sessionBatchSize, 5);
  assert.deepEqual(changed.activeSession, currentSession);
  assert.equal(restoredBackup.sessionBatchSize, 5);
  assert.deepEqual(restoredBackup.activeSession, currentSession);
});

test("清空本机学习记录：清除测验与学习进度，保留收藏、内容缓存和设置", () => {
  const reviewedAt = "2026-08-09T08:00:00.000Z";
  const state = parseStoredState(JSON.stringify({
    schemaVersion: 5,
    reviews: [{
      id: "clear-review",
      wordId: 1,
      word: "radiate",
      rating: 0,
      kind: "new",
      intervalMs: 600_000,
      dueAt: "2026-08-09T08:10:00.000Z",
      reviewedAt,
      section: "必考词",
      unit: 1,
    }],
    favorites: [{ wordId: 1, addedAt: reviewedAt }],
    mistakes: [{
      wordId: 1,
      addedAt: reviewedAt,
      mistakeCount: 1,
      lastRating: 0,
      lastMistakeAt: reviewedAt,
    }],
    positions: { "selection:ordered:必考词:1:1": 7 },
    enrichments: { 1: { sentence: "Stars radiate energy." } },
    lookupWords: [{
      id: 9_000_000_001,
      linkedWordId: 1,
      query: "radiate",
      kind: "word",
      phonetic: "",
      part: "v.",
      meaning: "散发",
      note: "",
      source: "redbook",
      addedAt: reviewedAt,
    }],
    activeSession: {
      id: "clear-session",
      kind: "today",
      title: "今日任务",
      wordIds: [1],
      index: 0,
      createdAt: reviewedAt,
    },
    quizAttempts: [{
      id: "clear-attempt",
      wordId: 1,
      mode: "listening-spelling",
      correct: false,
      recallMs: 3_000,
      answeredAt: reviewedAt,
      appliedToSchedule: false,
    }],
    activeQuiz: {
      id: "quiz:listening-spelling:1:clear",
      mode: "listening-spelling",
      seed: 1,
      questionWordIds: [1],
      index: 0,
      correctCount: 0,
      answers: {},
      complete: false,
      startedAt: reviewedAt,
    },
    dailyGoal: 30,
    sessionBatchSize: 5,
  }));
  state.ratingUndoStack = [{
    reviewId: "clear-review",
    wordId: 1,
    word: "radiate",
    previousProgress: undefined,
    previousPosition: 0,
    studyKey: "selection:ordered:必考词:1:1",
    selectedSection: "必考词",
    selectedUnit: 1,
    studyMode: "ordered",
    studyScope: "selection",
    shuffleSeed: 1,
  }];

  const recoverySnapshot = createBackupDocument(state, reviewedAt);
  const cleared = clearLearningRecords(state);

  assert.deepEqual(cleared.reviews, []);
  assert.deepEqual(cleared.wordProgress, {});
  assert.deepEqual(cleared.mistakes, []);
  assert.deepEqual(cleared.stubbornWords, {});
  assert.deepEqual(cleared.positions, {});
  assert.equal(cleared.activeSession, undefined);
  assert.deepEqual(cleared.quizAttempts, []);
  assert.equal(cleared.activeQuiz, undefined);
  assert.deepEqual(cleared.ratingUndoStack, []);
  assert.deepEqual(cleared.favorites, state.favorites);
  assert.deepEqual(cleared.enrichments, state.enrichments);
  assert.deepEqual(cleared.lookupWords, state.lookupWords);
  assert.equal(cleared.dailyGoal, 30);
  assert.equal(cleared.sessionBatchSize, 5);
  assert.equal(recoverySnapshot.state.quizAttempts.length, 1);
  assert.equal(recoverySnapshot.state.activeQuiz?.id, "quiz:listening-spelling:1:clear");
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

test("展示义项与考频标注口径一致：逗号分隔的多义项不被合并", () => {
  // 红宝书原句：vi. vt. (使) 蒸发,(使) 挥发 vi. 逐渐消失 —— 无分号，需拆出三个义项
  assert.deepEqual(
    splitWordSenses({ meaning: "vi. vt. (使) 蒸发,(使) 挥发 vi. 逐渐消失" }),
    ["(使) 蒸发", "(使) 挥发", "逐渐消失"],
  );
  assert.deepEqual(
    splitWordSenses({ meaning: "n. 地址；演讲", part: "n." }),
    ["地址", "演讲"],
  );
  assert.deepEqual(
    splitWordSenses({ meaning: "v. 放弃;抛弃" }),
    ["放弃", "抛弃"],
  );
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

test("测验作答归一化完整保留 5001 条与 10010 条合法历史", () => {
  for (const count of [5001, 10010]) {
    const attempts = createQuizAttempts(count);
    const state = parseStoredState(JSON.stringify({
      schemaVersion: 5,
      quizAttempts: attempts,
    }));

    assert.equal(state.quizAttempts.length, count);
    assert.deepEqual(state.quizAttempts, attempts);
  }
});

test("测验作答完整保留不会放宽非法记录过滤", () => {
  const attempts = createQuizAttempts(5001);
  const invalidAttempt = {
    ...attempts[0],
    id: "attempt:invalid",
    answeredAt: "invalid",
  };
  const state = parseStoredState(JSON.stringify({
    schemaVersion: 5,
    quizAttempts: [invalidAttempt, ...attempts],
  }));

  assert.deepEqual(state.quizAttempts, attempts);
});

test("超过 5000 条测验作答可经 IndexedDB 分域无损往返", () => {
  const attempts = createQuizAttempts(5001);
  const state = parseStoredState(JSON.stringify({
    schemaVersion: 5,
    quizAttempts: attempts,
  }));
  const restored = combineStoredState(splitStoredState(state));

  assert.deepEqual(restored.quizAttempts, attempts);
});

test("超过 5000 条测验作答可经备份导入规范化无损往返", () => {
  const attempts = createQuizAttempts(5001);
  const state = parseStoredState(JSON.stringify({
    schemaVersion: 5,
    quizAttempts: attempts,
  }));
  const backup = createBackupDocument(state, "2026-08-09T00:00:00.000Z");
  const imported = parseBackupDocument(JSON.stringify(backup));
  const restored = parseStoredState(JSON.stringify(imported.state));

  assert.deepEqual(restored.quizAttempts, attempts);
});

test("追加第 5001 条测验作答时保留最早记录", () => {
  const attempts = createQuizAttempts(5001);
  const appended = appendQuizAttempt(attempts.slice(0, 5000), attempts[5000]);

  assert.equal(appended.length, 5001);
  assert.equal(appended[0].id, "attempt:0");
  assert.deepEqual(appended[5000], attempts[5000]);
});

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
