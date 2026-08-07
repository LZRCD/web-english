import assert from "node:assert/strict";
import test from "node:test";
import type {
  ReviewEvent,
  StubbornWordMap,
  WordProgressMap,
} from "../lib/learning.ts";
import type { LookupWord, Word } from "../lib/study.ts";
import {
  buildSprintCsv,
  buildSprintEffectiveness,
  buildSprintHistory,
  buildSprintRecordWordIds,
  buildSprintSummary,
  buildSprintWordIds,
  buildWeakConcentration,
  buildWeakDimensionTrend,
  buildWeakDimensionTrendSeries,
  buildWeakProfiles,
  buildWordWeakSignals,
  DEFAULT_WEAK_THRESHOLDS,
  emphasizedWeakDimensions,
  lookupPriorityWordIds,
  lookupStatForWordId,
  lookupWeakCandidateIds,
  wordRecallStats,
  type WeakSignalInput,
  type WeakThresholds,
} from "../lib/weak-signals.ts";

function makeReview(
  wordId: number,
  rating: 0 | 1 | 2 | 3,
  reviewedAt: string,
  recallMs?: number,
): ReviewEvent {
  return {
    id: `r:${wordId}:${reviewedAt}`,
    wordId,
    word: `word-${wordId}`,
    rating,
    kind: "review",
    intervalMs: 0,
    dueAt: reviewedAt,
    reviewedAt,
    ...(recallMs !== undefined ? { recallMs } : {}),
  };
}

function lookupWord(
  query: string,
  linkedWordId: number | undefined,
): LookupWord {
  return {
    id: 9_000_000_000 + linkedWordId!,
    query,
    kind: "word",
    phonetic: "",
    part: "v.",
    meaning: "释义",
    note: "",
    source: "redbook",
    addedAt: "2026-07-01T00:00:00.000Z",
    ...(linkedWordId !== undefined ? { linkedWordId } : {}),
  };
}

function baseInput(overrides: Partial<WeakSignalInput> = {}): WeakSignalInput {
  return {
    lookupStats: {},
    lookupWords: [],
    guessMistakes: {},
    quizAttempts: [],
    reviews: [],
    stubbornWords: {},
    wordProgress: {},
    ...overrides,
  };
}

test("薄弱画像：聚合查词/猜错/各模式测验/回忆/顽固/lapse 六类信号", () => {
  const input = baseInput({
    lookupStats: {
      abandon: {
        count: 5,
        firstAt: "2026-07-01T00:00:00.000Z",
        lastAt: "2026-07-28T00:00:00.000Z",
      },
    },
    lookupWords: [lookupWord("abandon", 10)],
    guessMistakes: { 10: 3 },
    quizAttempts: [
      { id: "q1", wordId: 10, mode: "listening-spelling", correct: false, recallMs: 3000, answeredAt: "2026-07-27T00:00:00.000Z", appliedToSchedule: false },
      { id: "q2", wordId: 10, mode: "listening-spelling", correct: false, recallMs: 2000, answeredAt: "2026-07-27T01:00:00.000Z", appliedToSchedule: false },
      { id: "q3", wordId: 10, mode: "chinese-to-english", correct: false, recallMs: 3000, answeredAt: "2026-07-27T02:00:00.000Z", appliedToSchedule: false },
      { id: "q4", wordId: 10, mode: "meaning-choice", correct: true, recallMs: 3000, answeredAt: "2026-07-27T03:00:00.000Z", appliedToSchedule: false },
      { id: "q5", wordId: 10, mode: "meaning-choice", correct: false, recallMs: 3000, answeredAt: "2026-07-27T04:00:00.000Z", appliedToSchedule: false },
    ],
    reviews: [makeReview(10, 1, "2026-07-27T00:00:00.000Z", 16_000)],
    stubbornWords: {
      10: {
        wordId: 10,
        active: true,
        reason: "again-3",
        triggeredAt: "2026-07-26T00:00:00.000Z",
        lastChangedAt: "2026-07-26T00:00:00.000Z",
        triggerCount: 1,
      },
    },
    wordProgress: {
      10: {
        wordId: 10,
        lapseCount: 2,
        lastRating: 1,
        lastReviewedAt: "2026-07-27T00:00:00.000Z",
      },
    } as unknown as WordProgressMap,
  });

  assert.deepEqual(buildWordWeakSignals(10, input), [
    "查过5次",
    "猜错3次",
    "拼写测验错2次",
    "中译英错1次",
    "辨析错1次",
    "回忆偏慢1次",
    "顽固词",
    "FSRS lapse 2",
  ]);
  const profiles = buildWeakProfiles(input);
  assert.equal(profiles[10].lookupCount, 5);
  assert.deepEqual(profiles[10].signals, buildWordWeakSignals(10, input));
});

test("薄弱画像：无信号时返回空数组，划词查询按学习项 id 归并", () => {
  const input = baseInput({
    lookupStats: {
      abandon: {
        count: 4,
        firstAt: "2026-07-01T00:00:00.000Z",
        lastAt: "2026-07-28T00:00:00.000Z",
      },
    },
    // 同一红宝书词多次划选，id 归并到 linkedWordId 10
    lookupWords: [lookupWord("abandon", 10), lookupWord("Abandon", 10)],
  });
  assert.deepEqual(buildWordWeakSignals(10, input), ["查过4次"]);
  assert.deepEqual(buildWordWeakSignals(999, input), []);
  const stat = lookupStatForWordId(10, input);
  assert.equal(stat?.count, 4);
});

test("划词补漏：≥3 次进插队队列，答对且查询不再增长自动降级，按次数排序", () => {
  const input = baseInput({
    lookupStats: {
      a: { count: 4, firstAt: "2026-07-01T00:00:00.000Z", lastAt: "2026-07-28T00:00:00.000Z" },
      b: { count: 3, firstAt: "2026-07-01T00:00:00.000Z", lastAt: "2026-07-28T00:00:00.000Z" },
      c: { count: 2, firstAt: "2026-07-01T00:00:00.000Z", lastAt: "2026-07-28T00:00:00.000Z" },
      d: { count: 3, firstAt: "2026-07-01T00:00:00.000Z", lastAt: "2026-07-28T00:00:00.000Z" },
    },
    lookupWords: [
      lookupWord("a", 11),
      lookupWord("b", 12),
      lookupWord("c", 13),
      lookupWord("d", 14),
    ],
    wordProgress: {
      14: {
        wordId: 14,
        lapseCount: 0,
        lastRating: 2,
        lastReviewedAt: "2026-07-29T00:00:00.000Z",
      },
    } as unknown as WordProgressMap,
  });

  // 11(4次)、12(3次) 插队；13 仅 2 次不足；14 答对且查询不再增长 → 降级
  assert.deepEqual(lookupPriorityWordIds(input), [11, 12]);
  // 薄弱候选按 ≥2 次标注，不参与降级（同次数保持插入顺序）
  assert.deepEqual(lookupWeakCandidateIds(input), [11, 12, 14, 13]);
});

test("周报薄弱维度趋势：按本地周一统计本周数量与变化", () => {
  const now = new Date(2026, 6, 30, 12); // 2026-07-30 周四，周起始 07-27
  const input = baseInput({
    lookupStats: {
      a: { count: 3, firstAt: "2026-07-01T00:00:00.000Z", lastAt: "2026-07-28T00:00:00.000Z" },
      b: { count: 2, firstAt: "2026-07-01T00:00:00.000Z", lastAt: "2026-07-21T00:00:00.000Z" },
    },
    lookupWords: [lookupWord("a", 21), lookupWord("b", 22)],
    quizAttempts: [
      { id: "q1", wordId: 21, mode: "listening-spelling", correct: false, recallMs: 0, answeredAt: "2026-07-28T00:00:00.000Z", appliedToSchedule: false },
      { id: "q2", wordId: 22, mode: "listening-spelling", correct: false, recallMs: 0, answeredAt: "2026-07-21T00:00:00.000Z", appliedToSchedule: false },
    ],
    reviews: [
      makeReview(21, 1, "2026-07-28T00:00:00.000Z", 16_000),
      makeReview(23, 0, "2026-07-29T00:00:00.000Z"),
      makeReview(24, 0, "2026-07-22T00:00:00.000Z"),
    ],
    stubbornWords: {
      25: {
        wordId: 25,
        active: true,
        reason: "again-3",
        triggeredAt: "2026-07-29T00:00:00.000Z",
        lastChangedAt: "2026-07-29T00:00:00.000Z",
        triggerCount: 1,
      },
      26: {
        wordId: 26,
        active: true,
        reason: "low-5",
        triggeredAt: "2026-07-21T00:00:00.000Z",
        lastChangedAt: "2026-07-21T00:00:00.000Z",
        triggerCount: 1,
      },
    },
    guessMistakes: { 27: 2 },
  });

  const trend = buildWeakDimensionTrend(input, now);
  const byKey = new Map(trend.map((row) => [row.key, row]));
  assert.equal(byKey.get("lookup")!.count, 1);
  assert.equal(byKey.get("lookup")!.change, 0);
  assert.equal(byKey.get("quiz-spelling")!.count, 1);
  assert.equal(byKey.get("quiz-spelling")!.change, 0);
  assert.equal(byKey.get("slow-recall")!.count, 1);
  assert.equal(byKey.get("slow-recall")!.change, 1);
  assert.equal(byKey.get("lapse")!.count, 1);
  assert.equal(byKey.get("lapse")!.change, 0);
  assert.equal(byKey.get("stubborn")!.count, 1);
  assert.equal(byKey.get("stubborn")!.change, 0);
  assert.equal(byKey.get("guess")!.count, 1);
  assert.equal(byKey.get("guess")!.change, null);
});

test("考前薄弱冲刺：只选已学且命中薄弱信号的词，按薄弱程度排序", () => {
  const input = baseInput({
    lookupStats: {
      a: { count: 3, firstAt: "2026-07-01T00:00:00.000Z", lastAt: "2026-07-28T00:00:00.000Z" },
    },
    lookupWords: [lookupWord("a", 1)],
    reviews: [
      makeReview(1, 2, "2026-07-28T00:00:00.000Z", 16_000), // 回忆偏慢
      makeReview(2, 0, "2026-07-28T00:00:00.000Z"), // lapse + 薄弱
      makeReview(3, 2, "2026-07-28T00:00:00.000Z"), // 已学但无信号
    ],
    wordProgress: {
      1: { wordId: 1, lapseCount: 0, lastRating: 2, lastReviewedAt: "2026-07-28T00:00:00.000Z" },
      2: { wordId: 2, lapseCount: 2, lastRating: 0, lastReviewedAt: "2026-07-28T00:00:00.000Z" },
      3: { wordId: 3, lapseCount: 0, lastRating: 2, lastReviewedAt: "2026-07-28T00:00:00.000Z" },
    } as unknown as WordProgressMap,
  });
  // 词 2（lapse 2）最靠前；词 1（回忆慢 + 查过）次之；词 3 无信号不入选
  assert.deepEqual(buildSprintWordIds(input), [2, 1]);
});

test("考前薄弱冲刺：未学词不入选，冲刺清单复用薄弱标签", () => {
  const input = baseInput({
    lookupStats: {
      a: { count: 4, firstAt: "2026-07-01T00:00:00.000Z", lastAt: "2026-07-28T00:00:00.000Z" },
      b: { count: 2, firstAt: "2026-07-01T00:00:00.000Z", lastAt: "2026-07-28T00:00:00.000Z" },
    },
    lookupWords: [lookupWord("a", 1), lookupWord("b", 99)],
    wordProgress: {
      1: { wordId: 1, lapseCount: 1, lastRating: 1, lastReviewedAt: "2026-07-28T00:00:00.000Z" },
    } as unknown as WordProgressMap,
  });
  // 词 99 查过 2 次但未学（无 wordProgress）→ 不入选
  assert.deepEqual(buildSprintWordIds(input), [1]);
  const wordById = new Map([
    [1, { id: 1, word: "abandon", meaning: "vt. 抛弃" }],
    [99, { id: 99, word: "zebra", meaning: "n. 斑马" }],
  ]) as Map<number, import("../lib/study.ts").Word>;
  const summary = buildSprintSummary(input, wordById);
  assert.equal(summary.length, 1);
  assert.equal(summary[0].word, "abandon");
  assert.ok(summary[0].signals.includes("查过4次"));
  assert.ok(summary[0].signals.includes("FSRS lapse 1"));
});

test("冲刺历史：按 sessionId 分组、去重词数、时间倒序，无记录返回空", () => {
  const reviews = [
    makeReview(1, 2, "2026-08-11T08:05:00.000Z", 8_000),
    makeReview(2, 0, "2026-08-11T08:06:00.000Z", 12_000),
    makeReview(1, 2, "2026-08-11T08:07:00.000Z", 6_000),
    makeReview(3, 2, "2026-08-12T09:00:00.000Z", 9_000),
    makeReview(4, 1, "2026-08-12T09:01:00.000Z", 15_000),
    // 非冲刺会话不参与
    makeReview(5, 2, "2026-08-12T10:00:00.000Z"),
  ].map((review, index) => ({
    ...review,
    id: `s:${index}`,
    sessionId: index < 3
      ? "sprint:2026-08-11T08:00:00.000Z"
      : index < 5
        ? "sprint:2026-08-12T09:00:00.000Z"
        : "today:2026-08-12T10:00:00.000Z",
  }));
  const history = buildSprintHistory(reviews);
  assert.equal(history.totalCount, 2);
  assert.equal(history.totalWordCount, 4);
  assert.deepEqual(
    history.records.map((record) => record.sessionId),
    ["sprint:2026-08-12T09:00:00.000Z", "sprint:2026-08-11T08:00:00.000Z"],
  );
  const latest = history.records[0];
  assert.equal(latest.wordCount, 2); // 词 3、词 4 去重
  assert.equal(latest.successCount, 1); // 词 3 rating 2
  assert.equal(latest.averageRecallMs, 12_000); // (9+15)/2
  assert.equal(history.records[1].wordCount, 2); // 词 1、词 2
  assert.equal(history.records[1].averageRecallMs, 8_667); // (8+12+6)/3 取整
  assert.equal(buildSprintHistory([]).totalCount, 0);
  assert.deepEqual(buildSprintHistory([]).records, []);
});

test("冲刺历史再跑：按 sessionId 提取去重词 id，其他会话不混入", () => {
  const reviews = [
    makeReview(1, 2, "2026-08-11T08:05:00.000Z"),
    makeReview(2, 0, "2026-08-11T08:06:00.000Z"),
    makeReview(1, 3, "2026-08-11T08:07:00.000Z"),
    makeReview(3, 2, "2026-08-12T09:00:00.000Z"),
  ].map((review, index) => ({
    ...review,
    id: `s:${index}`,
    sessionId: index < 3
      ? "sprint:2026-08-11T08:00:00.000Z"
      : "today:2026-08-12T09:00:00.000Z",
  }));
  const wordIds = buildSprintRecordWordIds(
    reviews,
    "sprint:2026-08-11T08:00:00.000Z",
  );
  assert.deepEqual(wordIds.sort((a, b) => a - b), [1, 2]);
  // 非冲刺会话返回空
  assert.deepEqual(buildSprintRecordWordIds(reviews, "today:2026-08-12T09:00:00.000Z"), [3]);
  assert.deepEqual(buildSprintRecordWordIds(reviews, "sprint:missing"), []);
});

test("薄弱阈值参数化：不同阈值产出不同薄弱画像", () => {
  const input = baseInput({
    lookupStats: {
      a: { count: 3, firstAt: "2026-07-01T00:00:00.000Z", lastAt: "2026-07-28T00:00:00.000Z" },
    },
    lookupWords: [lookupWord("a", 1)],
    reviews: [makeReview(1, 2, "2026-07-28T00:00:00.000Z", 16_000)],
    wordProgress: {
      1: { wordId: 1, lapseCount: 0, lastRating: 2, lastReviewedAt: "2026-07-28T00:00:00.000Z" },
    } as unknown as WordProgressMap,
  });
  // 默认阈值：查过 3 次 ≥2 命中；回忆 16s ≥15s 命中
  const defaultSignals = buildWordWeakSignals(1, input);
  assert.ok(defaultSignals.includes("查过3次"));
  assert.ok(defaultSignals.includes("回忆偏慢1次"));
  // 调高阈值：查过 <5、回忆 <20s 都不再命中
  const strict: WeakThresholds = { lookupWeak: 5, lookupPriority: 6, slowRecallMs: 20_000 };
  const strictSignals = buildWordWeakSignals(1, input, undefined, strict);
  assert.equal(strictSignals.length, 0);
  // 冲刺候选也随阈值变化
  assert.deepEqual(buildSprintWordIds(input), [1]);
  assert.deepEqual(buildSprintWordIds(input, strict), []);
  // 默认值对象内容正确
  assert.equal(DEFAULT_WEAK_THRESHOLDS.lookupWeak, 2);
  assert.equal(DEFAULT_WEAK_THRESHOLDS.lookupPriority, 3);
  assert.equal(DEFAULT_WEAK_THRESHOLDS.slowRecallMs, 15_000);
});

test("临考期薄弱强调：冲刺/临考期突出关键维度，其他阶段不强调", () => {
  assert.deepEqual(emphasizedWeakDimensions("临考期"), ["lookup", "lapse", "slow-recall"]);
  assert.deepEqual(emphasizedWeakDimensions("冲刺期"), ["lookup", "lapse", "slow-recall"]);
  assert.deepEqual(emphasizedWeakDimensions("强化期"), []);
  assert.deepEqual(emphasizedWeakDimensions(undefined), []);
});

test("薄弱维度 4 周趋势：按连续周返回序列且每周口径与单周一致", () => {
  const now = new Date(2026, 6, 30, 12); // 2026-07-30 周四，周起始 07-27
  const input = baseInput({
    lookupStats: {
      a: { count: 3, firstAt: "2026-07-01T00:00:00.000Z", lastAt: "2026-07-28T00:00:00.000Z" },
    },
    lookupWords: [lookupWord("a", 21)],
    quizAttempts: [
      { id: "q1", wordId: 21, mode: "listening-spelling", correct: false, recallMs: 0, answeredAt: "2026-07-28T00:00:00.000Z", appliedToSchedule: false },
    ],
    reviews: [
      makeReview(21, 1, "2026-07-28T00:00:00.000Z", 16_000),
      makeReview(23, 0, "2026-07-29T00:00:00.000Z"),
      makeReview(24, 0, "2026-07-22T00:00:00.000Z"),
      makeReview(25, 0, "2026-07-01T00:00:00.000Z"),
    ],
    stubbornWords: {
      26: {
        wordId: 26,
        active: true,
        reason: "again-3",
        triggeredAt: "2026-07-29T00:00:00.000Z",
        lastChangedAt: "2026-07-29T00:00:00.000Z",
        triggerCount: 1,
      },
    },
  });

  const series = buildWeakDimensionTrendSeries(input, now, 4);
  assert.equal(series.length, 4);
  // 按时间升序：7-06 / 7-13 / 7-20 / 7-27
  assert.deepEqual(
    series.map((week) => week.weekStart),
    ["2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27"],
  );
  // 最新一周口径与 buildWeakDimensionTrend 一致
  const latest = series.at(-1)!;
  const single = buildWeakDimensionTrend(input, now);
  assert.deepEqual(latest.dimensions, single);
  // 上周（07-20 周）的遗忘词只统计 07-22 的词，数量为 1
  const weekBefore = series[2];
  const lapse = weekBefore.dimensions.find((row) => row.key === "lapse");
  assert.equal(lapse?.count, 1);
  // 更早两周（07-06/07-13 周）无信号
  assert.equal(series[0].dimensions.every((row) => row.count === 0), true);
  assert.equal(series[1].dimensions.every((row) => row.count === 0), true);
});

test("词级回忆耗时：聚合最近 5 次合法样本的平均/中位数/最新值", () => {
  const input = baseInput({
    reviews: [
      makeReview(10, 2, "2026-07-27T08:00:00.000Z", 8_000),
      makeReview(10, 2, "2026-07-28T08:00:00.000Z", 16_000),
      makeReview(10, 1, "2026-07-29T08:00:00.000Z", 12_000),
      // 非法样本被忽略
      makeReview(10, 2, "2026-07-29T09:00:00.000Z", -100),
    ],
  });
  const recall = wordRecallStats(input.reviews, 10);
  assert.ok(recall);
  assert.equal(recall.sampleCount, 3);
  assert.equal(recall.averageMs, 12_000);
  assert.equal(recall.medianMs, 12_000);
  assert.equal(recall.latestMs, 12_000);
  // 无合法样本返回 undefined
  assert.equal(wordRecallStats(input.reviews, 999), undefined);
  // 全量画像携带 recall 字段
  const profiles = buildWeakProfiles(input);
  assert.equal(profiles[10].recall?.averageMs, 12_000);
});

test("周报薄弱维度趋势：不提供信号源时 insights 周报返回空趋势", async () => {
  const { buildWeeklyLearningReport } = await import("../lib/insights.ts");
  const report = buildWeeklyLearningReport({
    reviews: [],
    progress: {},
    stubbornWords: {} as StubbornWordMap,
    now: new Date(2026, 6, 30, 12),
    examPlan: null,
    dailyNewGoal: 20,
  });
  assert.deepEqual(report.weakTrend, []);
});

function makeWord(
  id: number,
  section?: string,
  unit?: number | string,
): Word {
  return {
    id,
    word: `word-${id}`,
    meaning: "释义",
    ...(section ? { section } : {}),
    ...(unit !== undefined ? { unit } : {}),
  };
}

test("冲刺成效：按本地周一聚合次数/覆盖词数/回忆降幅/解决词数", () => {
  // 2026-08-10 为周一（本周），2026-08-05 在上周
  const reviews = [
    // 本周冲刺 1
    { ...makeReview(1, 2, "2026-08-10T08:05:00.000Z", 8_000), sessionId: "sprint:2026-08-10" },
    { ...makeReview(2, 0, "2026-08-10T08:06:00.000Z", 12_000), sessionId: "sprint:2026-08-10" },
    { ...makeReview(3, 2, "2026-08-10T08:07:00.000Z", 16_000), sessionId: "sprint:2026-08-10" },
    // 本周冲刺 2（同周第二次，评分不应混入 baseline）
    { ...makeReview(1, 3, "2026-08-12T08:00:00.000Z", 5_000), sessionId: "sprint:2026-08-12" },
    // 冲刺前历史（早于本周首次冲刺、非冲刺会话）
    makeReview(1, 1, "2026-08-08T08:00:00.000Z", 10_000),
    makeReview(2, 0, "2026-08-08T08:00:00.000Z", 30_000),
    makeReview(3, 1, "2026-08-08T08:00:00.000Z", 20_000),
    // 上周冲刺（不属本周）
    { ...makeReview(1, 1, "2026-08-05T08:00:00.000Z", 25_000), sessionId: "sprint:2026-08-05" },
  ];
  const result = buildSprintEffectiveness(
    reviews,
    new Date("2026-08-14T12:00:00.000Z"),
  );
  assert.ok(result);
  assert.equal(result.sprintCount, 2);
  assert.equal(result.coveredWordCount, 3); // 去重词 1/2/3
  assert.equal(result.resolvedCount, 2); // 词 1、词 3（词 1 两次答对去重）
  // 冲刺期间平均：(8+12+16+5)/4 = 10.25s
  assert.equal(result.sprintAverageRecallMs, 10_250);
  // baseline：早于 08-10T08:05 且非冲刺：(10+30+20)/3 = 20s
  assert.equal(result.beforeAverageRecallMs, 20_000);
  // 降幅：20 − 10.25 = 9.75s
  assert.equal(result.recallImprovementMs, 9_750);
});

test("冲刺成效：无本周冲刺记录返回 null", () => {
  const reviews = [
    { ...makeReview(1, 2, "2026-08-05T08:00:00.000Z", 8_000), sessionId: "sprint:2026-08-05" },
  ];
  assert.equal(
    buildSprintEffectiveness(reviews, new Date("2026-08-14T12:00:00.000Z")),
    null,
  );
  assert.equal(
    buildSprintEffectiveness([], new Date("2026-08-14T12:00:00.000Z")),
    null,
  );
});

test("冲刺成效：baseline 排除冲刺会话样本", () => {
  const reviews = [
    { ...makeReview(1, 2, "2026-08-10T08:05:00.000Z", 8_000), sessionId: "sprint:2026-08-10" },
    makeReview(1, 1, "2026-08-08T08:00:00.000Z", 10_000), // 普通历史
    { ...makeReview(1, 1, "2026-08-07T08:00:00.000Z", 40_000), sessionId: "sprint:2026-08-07" }, // 旧冲刺，应排除
  ];
  const result = buildSprintEffectiveness(
    reviews,
    new Date("2026-08-14T12:00:00.000Z"),
  );
  assert.ok(result);
  assert.equal(result.beforeAverageRecallMs, 10_000);
});

test("薄弱集中度：按 section 分组、unit 聚合，total 与 count 降序", () => {
  const input = baseInput({
    guessMistakes: { 1: 2, 2: 3, 3: 1, 4: 2, 5: 1 },
  });
  const wordById = new Map<number, Word>([
    [1, makeWord(1, "必考词", 1)],
    [2, makeWord(2, "必考词", 1)],
    [3, makeWord(3, "必考词", 2)],
    [4, makeWord(4, "基础词", 5)],
    [5, makeWord(5, "基础词", 6)],
  ]);
  const result = buildWeakConcentration(input, wordById);
  assert.deepEqual(result.map((row) => row.section), ["必考词", "基础词"]);
  assert.deepEqual(result.map((row) => row.total), [3, 2]);
  assert.deepEqual(result[0].units, [
    { unit: "1", count: 2 },
    { unit: "2", count: 1 },
  ]);
});

test("薄弱集中度：无薄弱词返回空，section 缺失跳过", () => {
  const wordById = new Map<number, Word>([
    [1, makeWord(1, "必考词", 1)],
    [2, makeWord(2)],
  ]);
  assert.deepEqual(buildWeakConcentration(baseInput(), wordById), []);
  const input = baseInput({ guessMistakes: { 1: 2, 2: 1 } });
  const result = buildWeakConcentration(input, wordById);
  assert.deepEqual(result.map((row) => row.section), ["必考词"]);
  assert.equal(result[0].total, 1);
});

test("薄弱集中度：阈值参数生效（提高查词阈值后集中度下降）", () => {
  const input = baseInput({
    lookupStats: {
      "word-1": { count: 3, firstAt: "2026-07-01T00:00:00.000Z", lastAt: "2026-07-28T00:00:00.000Z" },
      "word-2": { count: 1, firstAt: "2026-07-01T00:00:00.000Z", lastAt: "2026-07-28T00:00:00.000Z" },
    },
    lookupWords: [lookupWord("word-1", 1), lookupWord("word-2", 2)],
  });
  const wordById = new Map<number, Word>([
    [1, makeWord(1, "必考词", 1)],
    [2, makeWord(2, "必考词", 1)],
  ]);
  const relaxed = buildWeakConcentration(input, wordById);
  assert.equal(relaxed[0]?.total, 1); // 默认 lookupWeak=2，count=3 命中
  const strict = buildWeakConcentration(
    input,
    wordById,
    { ...DEFAULT_WEAK_THRESHOLDS, lookupWeak: 4 },
  );
  assert.equal(strict.length, 0); // 提高到 4 后不再命中
});

test("冲刺清单 CSV：含 BOM 表头，逗号/双引号/换行转义", () => {
  const csv = buildSprintCsv([
    { word: "abandon", signals: ["查过2次", "回忆偏慢1次"] },
    { word: 'he said, "hi"', signals: ["含,逗号", "含\n换行"] },
  ]);
  assert.ok(csv.startsWith("\uFEFF词,信号列表\n"));
  assert.ok(csv.includes("abandon,查过2次、回忆偏慢1次"));
  // 含逗号的词被双引号包裹，内部双引号翻倍
  assert.ok(csv.includes('"he said, ""hi"""'));
  // 信号字段含逗号与换行，整体被双引号包裹
  assert.ok(csv.includes('"含,逗号、含\n换行"'));
});

test("冲刺清单 CSV：空清单返回空串", () => {
  assert.equal(buildSprintCsv([]), "");
});
