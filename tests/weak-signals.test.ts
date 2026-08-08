import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRating,
  type ReviewEvent,
  type StubbornWordMap,
  type WordProgress,
  type WordProgressMap,
} from "../lib/learning.ts";
import type { LookupWord, Word } from "../lib/study.ts";
import type { QuizAttempt, QuizMode } from "../lib/quiz.ts";
import {
  buildSprintCsv,
  buildSprintEffectiveness,
  buildSprintEffectivenessSeries,
  buildSprintHistory,
  buildSprintRecordWordIds,
  buildSprintRelapse,
  buildSprintSummary,
  buildSprintWordIds,
  buildWeakCandidateSummary,
  buildScopedSprintWordIds,
  buildWeakConcentration,
  buildWeakDimensionTrend,
  buildWeakDimensionTrendSeries,
  buildWeakProfiles,
  buildWordSignalTimeline,
  buildWordWeakSignals,
  DEFAULT_WEAK_THRESHOLDS,
  emphasizedWeakDimensions,
  isLookupDemoted,
  isLookupStabilized,
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

function makeQuizAttempt(
  id: string,
  mode: QuizMode,
  correct: boolean,
  answeredAt: string,
): QuizAttempt {
  return {
    id,
    wordId: 10,
    mode,
    correct,
    recallMs: 1000,
    answeredAt,
    appliedToSchedule: false,
  };
}

function assertQuizModeLifecycle(mode: QuizMode, label: string, otherMode: QuizMode) {
  const wrong = makeQuizAttempt("wrong-1", mode, false, "2026-07-20T00:00:00.000Z");
  const oneCorrect = makeQuizAttempt("correct-1", mode, true, "2026-07-21T00:00:00.000Z");
  const crossModeCorrect = makeQuizAttempt("other-correct", otherMode, true, "2026-07-22T00:00:00.000Z");
  const twoCorrect = makeQuizAttempt("correct-2", mode, true, "2026-07-23T00:00:00.000Z");
  const wrongAgain = makeQuizAttempt("wrong-2", mode, false, "2026-07-24T00:00:00.000Z");
  const signalsFor = (quizAttempts: QuizAttempt[]) =>
    buildWordWeakSignals(10, baseInput({ quizAttempts }));

  assert.deepEqual(signalsFor([wrong]), [`${label}1次`]);
  assert.deepEqual(signalsFor([wrong, oneCorrect]), [`${label}1次`]);
  assert.deepEqual(signalsFor([wrong, oneCorrect, crossModeCorrect]), [`${label}1次`]);
  assert.deepEqual(signalsFor([wrong, oneCorrect, crossModeCorrect, twoCorrect]), []);
  assert.deepEqual(
    signalsFor([wrong, oneCorrect, crossModeCorrect, twoCorrect, wrongAgain]),
    [`${label}2次`],
  );
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

test("lapse 标签随既有薄弱恢复淡出，再次遗忘后重新出现", () => {
  const rate = (
    previous: WordProgress | undefined,
    rating: 0 | 2,
    reviewedAt: string,
  ) => applyRating(previous, {
    wordId: 10,
    word: "abandon",
    rating,
    reviewedAt,
  }).progress;
  const signalsFor = (progress: WordProgress) => buildWordWeakSignals(10, baseInput({
    guessMistakes: { 10: 2 },
    wordProgress: { 10: progress },
  }));

  const forgotten = rate(undefined, 0, "2026-07-20T00:00:00.000Z");
  const oneSuccess = rate(forgotten, 2, "2026-07-21T00:00:00.000Z");
  const recovered = rate(oneSuccess, 2, "2026-07-22T00:00:00.000Z");
  const forgottenAgain = rate(recovered, 0, "2026-07-23T00:00:00.000Z");

  assert.deepEqual(signalsFor(forgotten), ["猜错2次", "FSRS lapse 1"]);
  assert.deepEqual(signalsFor(oneSuccess), ["猜错2次", "FSRS lapse 1"]);
  assert.deepEqual(signalsFor(recovered), ["猜错2次"]);
  assert.deepEqual(signalsFor(forgottenAgain), ["猜错2次", "FSRS lapse 2"]);
});

test("慢回忆标签连续两次成功快速回忆后淡出，再次变慢立即重现", () => {
  const slow = makeReview(10, 2, "2026-07-20T00:00:00.000Z", 18_000);
  const oneFast = makeReview(10, 2, "2026-07-21T00:00:00.000Z", 8_000);
  const twoFast = makeReview(10, 3, "2026-07-22T00:00:00.000Z", 7_000);
  const slowAgain = makeReview(10, 2, "2026-07-23T00:00:00.000Z", 20_000);
  const inputFor = (reviews: ReviewEvent[]) => baseInput({
    guessMistakes: { 10: 2 },
    reviews,
  });

  assert.deepEqual(buildWordWeakSignals(10, inputFor([slow])), [
    "猜错2次",
    "回忆偏慢1次",
  ]);
  assert.deepEqual(buildWordWeakSignals(10, inputFor([slow, oneFast])), [
    "猜错2次",
    "回忆偏慢1次",
  ]);
  assert.deepEqual(buildWordWeakSignals(10, inputFor([slow, oneFast, twoFast])), [
    "猜错2次",
  ]);
  assert.deepEqual(buildWordWeakSignals(10, inputFor([slow, oneFast, twoFast, slowAgain])), [
    "猜错2次",
    "回忆偏慢2次",
  ]);
});

test("慢回忆恢复只接受有测时的成功快速回忆", () => {
  const slow = makeReview(10, 2, "2026-07-20T00:00:00.000Z", 18_000);
  const fast = makeReview(10, 2, "2026-07-21T00:00:00.000Z", 8_000);
  const unmeasured = makeReview(10, 3, "2026-07-22T00:00:00.000Z");
  const fastButFailed = makeReview(10, 1, "2026-07-22T00:00:00.000Z", 5_000);

  assert.deepEqual(buildWordWeakSignals(10, baseInput({
    reviews: [slow, fast, unmeasured],
  })), ["回忆偏慢1次"]);
  assert.deepEqual(buildWordWeakSignals(10, baseInput({
    reviews: [slow, fast, fastButFailed],
  })), ["回忆偏慢1次"]);
});

test("慢回忆恢复实时跟随阈值，历史时间线与周趋势不被降级改写", () => {
  const input = baseInput({
    reviews: [
      makeReview(10, 2, "2026-07-28T08:00:00.000Z", 18_000),
      makeReview(10, 2, "2026-07-29T08:00:00.000Z", 12_000),
      makeReview(10, 3, "2026-07-30T08:00:00.000Z", 11_000),
    ],
  });
  const threshold15 = { ...DEFAULT_WEAK_THRESHOLDS, slowRecallMs: 15_000 };
  const threshold10 = { ...DEFAULT_WEAK_THRESHOLDS, slowRecallMs: 10_000 };

  assert.deepEqual(buildWordWeakSignals(10, input, undefined, threshold15), []);
  assert.deepEqual(buildWordWeakSignals(10, input, undefined, threshold10), [
    "回忆偏慢3次",
  ]);
  assert.equal(
    buildWordSignalTimeline(10, input, threshold15)
      .filter((event) => event.type === "slow-recall").length,
    1,
  );
  assert.equal(
    buildWeakDimensionTrend(input, new Date(2026, 6, 30, 12), threshold15)
      .find((dimension) => dimension.key === "slow-recall")?.count,
    1,
  );
  assert.equal(wordRecallStats(input.reviews, 10)?.sampleCount, 3);
});

test("拼写测验标签：同模式连续两次答对后淡出，跨模式不替代且答错复发", () => {
  assertQuizModeLifecycle("listening-spelling", "拼写测验错", "chinese-to-english");
});

test("中译英标签：同模式连续两次答对后淡出，跨模式不替代且答错复发", () => {
  assertQuizModeLifecycle("chinese-to-english", "中译英错", "meaning-choice");
});

test("辨析标签：同模式连续两次答对后淡出，跨模式不替代且答错复发", () => {
  assertQuizModeLifecycle("meaning-choice", "辨析错", "listening-spelling");
});

test("测验标签恢复按 answeredAt 稳定排序，重复 ID 不重复充当连续答对", () => {
  const wrong = makeQuizAttempt("wrong", "listening-spelling", false, "2026-07-20T00:00:00.000Z");
  const firstCorrect = makeQuizAttempt("correct-1", "listening-spelling", true, "2026-07-21T00:00:00.000Z");
  const secondCorrect = makeQuizAttempt("correct-2", "listening-spelling", true, "2026-07-22T00:00:00.000Z");

  assert.deepEqual(buildWordWeakSignals(10, baseInput({
    quizAttempts: [secondCorrect, wrong, firstCorrect],
  })), []);
  assert.deepEqual(buildWordWeakSignals(10, baseInput({
    quizAttempts: [wrong, firstCorrect, { ...firstCorrect }],
  })), ["拼写测验错1次"]);

  const sameTimeWrong = makeQuizAttempt("same-wrong", "listening-spelling", false, "2026-07-23T00:00:00.000Z");
  const sameTimeCorrect = makeQuizAttempt("same-correct", "listening-spelling", true, "2026-07-23T00:00:00.000Z");
  assert.deepEqual(buildWordWeakSignals(10, baseInput({
    quizAttempts: [wrong, firstCorrect, secondCorrect, sameTimeWrong, sameTimeCorrect],
  })), ["拼写测验错2次"]);
});

test("测验标签恢复拒绝无效时间证据，历史时间线与周统计保持历史口径", () => {
  const wrong = makeQuizAttempt("wrong", "listening-spelling", false, "2026-07-28T08:00:00.000Z");
  const firstCorrect = makeQuizAttempt("correct-1", "listening-spelling", true, "2026-07-29T08:00:00.000Z");
  const secondCorrect = makeQuizAttempt("correct-2", "listening-spelling", true, "2026-07-30T08:00:00.000Z");
  const invalidCorrect = makeQuizAttempt("invalid-correct", "listening-spelling", true, "invalid");
  const invalidWrong = makeQuizAttempt("invalid-wrong", "listening-spelling", false, "invalid");

  assert.deepEqual(buildWordWeakSignals(10, baseInput({
    quizAttempts: [wrong, firstCorrect, invalidCorrect],
  })), ["拼写测验错1次"]);
  assert.deepEqual(buildWordWeakSignals(10, baseInput({
    quizAttempts: [wrong, firstCorrect, secondCorrect, invalidWrong],
  })), ["拼写测验错2次"]);

  const recoveredInput = baseInput({ quizAttempts: [wrong, firstCorrect, secondCorrect] });
  assert.deepEqual(buildWordWeakSignals(10, recoveredInput), []);
  assert.equal(
    buildWordSignalTimeline(10, recoveredInput)
      .filter((event) => event.type === "quiz").length,
    1,
  );
  assert.equal(
    buildWeakDimensionTrend(recoveredInput, new Date(2026, 6, 30, 12))
      .find((dimension) => dimension.key === "quiz-spelling")?.count,
    1,
  );
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
  // 薄弱候选同样复用全态画像：14 已降级且无其他信号，不再入选
  assert.deepEqual(lookupWeakCandidateIds(input), [11, 12, 13]);
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
      1: { wordId: 1, lapseCount: 0, lastRating: 2, lastReviewedAt: "2026-07-20T00:00:00.000Z" },
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
      1: { wordId: 1, lapseCount: 0, lastRating: 2, lastReviewedAt: "2026-07-20T00:00:00.000Z" },
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
  // 划词候选与画像使用同一可调阈值
  assert.deepEqual(lookupWeakCandidateIds(input), [1]);
  assert.deepEqual(lookupWeakCandidateIds(input, strict), []);
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
    wordProgress: {
      1: { wordId: 1, lapseCount: 0, lastRating: 1, lastReviewedAt: "2026-07-27T00:00:00.000Z" },
      2: { wordId: 2, lapseCount: 0, lastRating: 1, lastReviewedAt: "2026-07-27T00:00:00.000Z" },
    } as unknown as WordProgressMap,
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

test("冲刺成效 4 周：多周聚合、空周返回 null、与单周口径一致", () => {
  const reviews = [
    // 本周（2026-08-10 周一）冲刺
    { ...makeReview(1, 2, "2026-08-10T08:05:00.000Z", 8_000), sessionId: "sprint:2026-08-10" },
    { ...makeReview(1, 1, "2026-08-08T08:00:00.000Z", 10_000) },
    // 上周（2026-08-03 周一）冲刺
    { ...makeReview(2, 2, "2026-08-05T08:00:00.000Z", 6_000), sessionId: "sprint:2026-08-05" },
    { ...makeReview(2, 1, "2026-08-01T08:00:00.000Z", 12_000) },
  ];
  const series = buildSprintEffectivenessSeries(
    reviews,
    new Date("2026-08-14T12:00:00.000Z"),
    3,
  );
  assert.equal(series.length, 3);
  assert.deepEqual(
    series.map((week) => week.weekStart),
    ["2026-07-27", "2026-08-03", "2026-08-10"],
  );
  // 本周
  assert.equal(series[2].effectiveness?.sprintCount, 1);
  assert.equal(series[2].effectiveness?.resolvedCount, 1);
  assert.equal(series[2].effectiveness?.beforeAverageRecallMs, 10_000);
  assert.equal(series[2].effectiveness?.sprintAverageRecallMs, 8_000);
  // 上周
  assert.equal(series[1].effectiveness?.sprintCount, 1);
  assert.equal(series[1].effectiveness?.beforeAverageRecallMs, 12_000);
  // 前周无冲刺
  assert.equal(series[0].effectiveness, null);
  // 与单周口径一致
  const single = buildSprintEffectiveness(
    reviews,
    new Date("2026-08-14T12:00:00.000Z"),
  );
  assert.deepEqual(series[2].effectiveness, single);
});

test("限定范围冲刺：按 section 精确过滤、unit 字符串归一、空 scope 全量", () => {
  const input = baseInput({
    guessMistakes: { 1: 2, 2: 3, 3: 1 },
    wordProgress: {
      1: { wordId: 1, lapseCount: 0, lastRating: 1, lastReviewedAt: "2026-07-27T00:00:00.000Z" },
      2: { wordId: 2, lapseCount: 0, lastRating: 1, lastReviewedAt: "2026-07-27T00:00:00.000Z" },
      3: { wordId: 3, lapseCount: 0, lastRating: 1, lastReviewedAt: "2026-07-27T00:00:00.000Z" },
    } as unknown as WordProgressMap,
  });
  const wordById = new Map<number, Word>([
    [1, makeWord(1, "必考词", 1)],
    [2, makeWord(2, "必考词", 2)],
    [3, makeWord(3, "基础词", 5)],
  ]);
  // 全量：三个词均薄弱（猜错 > 0）
  assert.deepEqual(
    [...buildScopedSprintWordIds(input, wordById)].sort(),
    [1, 2, 3],
  );
  // 按 section 过滤
  assert.deepEqual(
    [...buildScopedSprintWordIds(input, wordById, { section: "必考词" })].sort(),
    [1, 2],
  );
  // section + unit（unit 传字符串，数字 unit 归一匹配）
  assert.deepEqual(
    buildScopedSprintWordIds(input, wordById, { section: "必考词", unit: "1" }),
    [1],
  );
  // 无匹配
  assert.deepEqual(buildScopedSprintWordIds(input, wordById, { section: "超纲词" }), []);
});

test("限定范围冲刺：无薄弱词返回空，阈值参数生效", () => {
  const input = baseInput({
    lookupStats: {
      "word-1": { count: 3, firstAt: "2026-07-01T00:00:00.000Z", lastAt: "2026-07-28T00:00:00.000Z" },
      "word-2": { count: 1, firstAt: "2026-07-01T00:00:00.000Z", lastAt: "2026-07-28T00:00:00.000Z" },
    },
    lookupWords: [lookupWord("word-1", 1), lookupWord("word-2", 2)],
    wordProgress: {
      1: { wordId: 1, lapseCount: 0, lastRating: 3, lastReviewedAt: "2026-07-27T00:00:00.000Z" },
      2: { wordId: 2, lapseCount: 0, lastRating: 3, lastReviewedAt: "2026-07-27T00:00:00.000Z" },
    } as unknown as WordProgressMap,
  });
  const wordById = new Map<number, Word>([
    [1, makeWord(1, "必考词", 1)],
    [2, makeWord(2, "必考词", 2)],
  ]);
  assert.deepEqual(buildScopedSprintWordIds(baseInput(), wordById), []);
  // 默认 lookupWeak=2：词 1 命中
  assert.deepEqual(
    buildScopedSprintWordIds(input, wordById, { section: "必考词" }),
    [1],
  );
  // 阈值提高到 4：都不命中
  assert.deepEqual(
    buildScopedSprintWordIds(
      input,
      wordById,
      { section: "必考词" },
      { ...DEFAULT_WEAK_THRESHOLDS, lookupWeak: 4 },
    ),
    [],
  );
});

test("词级信号时间线：评分/测验/查词/顽固词各源提取并按时间升序", () => {
  const input = baseInput({
    reviews: [
      makeReview(10, 0, "2026-07-27T01:00:00.000Z", 18_000), // 慢 + lapse
      makeReview(10, 3, "2026-07-28T01:00:00.000Z", 5_000), // 普通正向复习进入时间线
    ],
    quizAttempts: [
      {
        id: "q1",
        wordId: 10,
        mode: "listening-spelling",
        correct: false,
        recallMs: 3_000,
        answeredAt: "2026-07-26T00:00:00.000Z",
        appliedToSchedule: false,
      },
    ],
    lookupStats: {
      "word-10": { count: 3, firstAt: "2026-07-20T00:00:00.000Z", lastAt: "2026-07-25T00:00:00.000Z" },
    },
    lookupWords: [lookupWord("word-10", 10)],
    stubbornWords: {
      10: {
        wordId: 10,
        active: true,
        reason: "again-3",
        triggeredAt: "2026-07-29T00:00:00.000Z",
        lastChangedAt: "2026-07-29T00:00:00.000Z",
        triggerCount: 1,
      },
    },
  });
  const events = buildWordSignalTimeline(10, input);
  assert.ok(events.length >= 5);
  // 时间升序
  for (let index = 1; index < events.length; index += 1) {
    assert.ok(events[index - 1].at <= events[index].at);
  }
  // 慢样本标记
  assert.ok(events.some((event) =>
    event.type === "slow-recall" && event.detail.includes("18.0")));
  // lapse
  assert.ok(events.some((event) => event.type === "lapse"));
  // 测验答错
  assert.ok(events.some((event) =>
    event.type === "quiz" && event.detail.includes("拼写测验")));
  // 查词首次/最近
  assert.ok(events.some((event) =>
    event.type === "lookup" && event.detail.includes("首次")));
  assert.ok(events.some((event) =>
    event.type === "lookup" && event.detail.includes("最近")));
  // 顽固词
  assert.ok(events.some((event) => event.type === "stubborn"));
  // 普通正向复习
  assert.ok(events.some((event) =>
    event.type === "review" && event.detail === "复习 · 熟练（评分 3）"));
});

test("词级信号时间线：普通评分保留四档语义，冲刺复习沿用既有 session 标记", () => {
  const forgotten = makeReview(10, 0, "2026-07-27T00:00:00.000Z", 5_000);
  const input = baseInput({
    reviews: [
      forgotten,
      makeReview(10, 1, "2026-07-27T01:00:00.000Z", 5_000),
      makeReview(10, 2, "2026-07-27T02:00:00.000Z", 5_000),
      {
        ...makeReview(10, 3, "2026-07-27T03:00:00.000Z", 5_000),
        sessionId: "sprint:2026-07-27T03:00:00.000Z",
      },
    ],
  });

  assert.deepEqual(
    buildWordSignalTimeline(10, input).map((event) => [event.type, event.detail]),
    [
      ["lapse", "遗忘（评分 0）"],
      ["review", "复习 · 模糊（评分 1）"],
      ["review", "复习 · 认识（评分 2）"],
      ["review", "冲刺复习 · 熟练（评分 3）"],
    ],
  );
});

test("词级信号时间线：重复 review id 只形成一组事件且不破坏时间排序", () => {
  const duplicate = makeReview(10, 2, "2026-07-28T02:00:00.000Z", 16_000);
  const input = baseInput({
    reviews: [
      duplicate,
      makeReview(10, 3, "2026-07-28T01:00:00.000Z", 5_000),
      { ...duplicate },
    ],
  });

  const events = buildWordSignalTimeline(10, input);
  assert.deepEqual(events.map((event) => event.at), [
    "2026-07-28T01:00:00.000Z",
    "2026-07-28T02:00:00.000Z",
    "2026-07-28T02:00:00.000Z",
  ]);
  assert.equal(events.filter((event) => event.type === "review").length, 2);
  assert.equal(events.filter((event) => event.type === "slow-recall").length, 1);
});

test("词级信号时间线：无记录返回空，非目标词不混入", () => {
  const input = baseInput({
    reviews: [makeReview(1, 0, "2026-07-27T01:00:00.000Z", 18_000)],
    guessMistakes: { 2: 3 },
  });
  assert.deepEqual(buildWordSignalTimeline(99, input), []);
  assert.deepEqual(buildWordSignalTimeline(1, baseInput()), []);
});

test("薄弱候选清单：映射词名与信号，仅含查询达标的词", () => {
  const input = baseInput({
    lookupStats: {
      "word-1": { count: 3, firstAt: "2026-07-01T00:00:00.000Z", lastAt: "2026-07-28T00:00:00.000Z" },
      "word-2": { count: 1, firstAt: "2026-07-01T00:00:00.000Z", lastAt: "2026-07-28T00:00:00.000Z" },
    },
    lookupWords: [lookupWord("word-1", 1), lookupWord("word-2", 2)],
    guessMistakes: { 1: 2 },
  });
  const wordById = new Map<number, Word>([
    [1, makeWord(1, "必考词", 1)],
    [2, makeWord(2, "必考词", 2)],
  ]);
  const summary = buildWeakCandidateSummary(input, wordById);
  // 词 1 查过 3 次（达标）且有猜错信号；词 2 查过 1 次（不达标）不入列
  assert.deepEqual(summary, [{ word: "word-1", signals: ["查过3次", "猜错2次"] }]);
});

test("薄弱候选清单：无候选返回空，未映射词跳过，阈值生效", () => {
  const wordById = new Map<number, Word>([[1, makeWord(1, "必考词", 1)]]);
  assert.deepEqual(buildWeakCandidateSummary(baseInput(), wordById), []);
  // 查过但 wordById 无映射 → 跳过
  const input = baseInput({
    lookupStats: {
      "word-9": { count: 3, firstAt: "2026-07-01T00:00:00.000Z", lastAt: "2026-07-28T00:00:00.000Z" },
    },
    lookupWords: [lookupWord("word-9", 9)],
  });
  assert.deepEqual(buildWeakCandidateSummary(input, wordById), []);
  // 阈值提高后不再命中
  const hit = baseInput({
    lookupStats: {
      "word-1": { count: 3, firstAt: "2026-07-01T00:00:00.000Z", lastAt: "2026-07-28T00:00:00.000Z" },
    },
    lookupWords: [lookupWord("word-1", 1)],
  });
  assert.deepEqual(
    buildWeakCandidateSummary(hit, wordById, { ...DEFAULT_WEAK_THRESHOLDS, lookupWeak: 4 }),
    [],
  );
});

test("薄弱候选清单：与 buildSprintCsv 组合导出含 BOM 表头", () => {
  const input = baseInput({
    lookupStats: {
      "word-1": { count: 2, firstAt: "2026-07-01T00:00:00.000Z", lastAt: "2026-07-28T00:00:00.000Z" },
    },
    lookupWords: [lookupWord("word-1", 1)],
  });
  const wordById = new Map<number, Word>([[1, makeWord(1, "必考词", 1)]]);
  const csv = buildSprintCsv(buildWeakCandidateSummary(input, wordById));
  assert.ok(csv.startsWith("\uFEFF词,信号列表\n"));
  assert.ok(csv.includes("word-1,查过2次"));
});

test("冲刺复发：上周冲刺解决词中当前仍薄弱者计为复发", () => {
  // 2026-08-10 周一（本周）；上周 = 08-03 ~ 08-10
  const reviews = [
    // 上周冲刺：词 1 解决（rating 2）、词 2 解决（rating 3）
    { ...makeReview(1, 2, "2026-08-05T08:00:00.000Z"), sessionId: "sprint:2026-08-05" },
    { ...makeReview(2, 3, "2026-08-06T08:00:00.000Z"), sessionId: "sprint:2026-08-05" },
    // 本周冲刺：词 3 解决（不计入上周）
    { ...makeReview(3, 2, "2026-08-11T08:00:00.000Z"), sessionId: "sprint:2026-08-11" },
  ];
  const input = baseInput({
    reviews,
    // 词 1 查词仍多 → 当前薄弱（复发）；词 2 无新薄弱信号 → 未复发
    lookupStats: {
      "word-1": { count: 4, firstAt: "2026-07-01T00:00:00.000Z", lastAt: "2026-08-07T00:00:00.000Z" },
    },
    lookupWords: [lookupWord("word-1", 1)],
    wordProgress: {
      1: { wordId: 1, lapseCount: 0, lastRating: 3, lastReviewedAt: "2026-08-05T08:00:00.000Z" },
      2: { wordId: 2, lapseCount: 0, lastRating: 3, lastReviewedAt: "2026-08-06T08:00:00.000Z" },
      3: { wordId: 3, lapseCount: 0, lastRating: 2, lastReviewedAt: "2026-08-11T08:00:00.000Z" },
    } as unknown as WordProgressMap,
  });
  const result = buildSprintRelapse(
    reviews,
    input,
    new Date("2026-08-14T12:00:00.000Z"),
  );
  assert.ok(result);
  assert.equal(result.solvedCount, 2);
  assert.equal(result.relapsedCount, 1);
  assert.equal(result.relapseRate, 50);
  assert.deepEqual(result.relapsedIds, [1]);
});

test("冲刺复发：上周无冲刺解决词返回 null", () => {
  const reviews = [
    { ...makeReview(1, 2, "2026-08-11T08:00:00.000Z"), sessionId: "sprint:2026-08-11" },
  ];
  const input = baseInput({ reviews });
  assert.equal(
    buildSprintRelapse(reviews, input, new Date("2026-08-14T12:00:00.000Z")),
    null,
  );
});

test("冲刺复发：全部解决词无复发则复发率 0", () => {
  const reviews = [
    { ...makeReview(1, 2, "2026-08-05T08:00:00.000Z"), sessionId: "sprint:2026-08-05" },
  ];
  // 词 1 无任何薄弱信号源
  const input = baseInput({ reviews });
  const result = buildSprintRelapse(
    reviews,
    input,
    new Date("2026-08-14T12:00:00.000Z"),
  );
  assert.ok(result);
  assert.equal(result.solvedCount, 1);
  assert.equal(result.relapsedCount, 0);
  assert.equal(result.relapseRate, 0);
  assert.deepEqual(result.relapsedIds, []);
});

test("薄弱降级贯通：答对且查询不再增长 → 查词标签消失，其他信号保留", () => {
  const input = baseInput({
    lookupStats: {
      "word-1": { count: 5, firstAt: "2026-07-01T00:00:00.000Z", lastAt: "2026-07-25T00:00:00.000Z" },
    },
    lookupWords: [lookupWord("word-1", 1)],
    guessMistakes: { 1: 2 },
    wordProgress: {
      1: { wordId: 1, lapseCount: 0, lastRating: 3, lastReviewedAt: "2026-07-28T00:00:00.000Z" },
    } as unknown as WordProgressMap,
  });
  // lastRating 3 且 lastReviewedAt(07-28) >= lastAt(07-25) → 降级：查词标签消失，猜错保留
  assert.deepEqual(buildWordWeakSignals(1, input), ["猜错2次"]);
});

test("全态入口统一：纯查词降级词退出画像/划词候选/冲刺，其他薄弱信号仍保留", () => {
  const input = baseInput({
    lookupStats: {
      "word-1": { count: 5, firstAt: "2026-07-01T00:00:00.000Z", lastAt: "2026-07-25T00:00:00.000Z" },
      "word-2": { count: 4, firstAt: "2026-07-01T00:00:00.000Z", lastAt: "2026-07-25T00:00:00.000Z" },
    },
    lookupWords: [lookupWord("word-1", 1), lookupWord("word-2", 2)],
    guessMistakes: { 2: 1 },
    wordProgress: {
      1: { wordId: 1, lapseCount: 0, lastRating: 3, lastReviewedAt: "2026-07-28T00:00:00.000Z" },
      2: { wordId: 2, lapseCount: 0, lastRating: 3, lastReviewedAt: "2026-07-28T00:00:00.000Z" },
    } as unknown as WordProgressMap,
  });

  const profiles = buildWeakProfiles(input);
  const weakProfileIds = Object.entries(profiles)
    .filter(([, profile]) => profile.signals.length > 0)
    .map(([wordId]) => Number(wordId));
  assert.deepEqual(weakProfileIds, [2]);
  assert.deepEqual(profiles[2].signals, ["猜错1次"]);
  assert.deepEqual(lookupWeakCandidateIds(input), [2]);
  assert.deepEqual(buildSprintWordIds(input), [2]);
});

test("薄弱降级贯通：查询仍增长（最近查询晚于评分）不降级", () => {
  const input = baseInput({
    lookupStats: {
      "word-1": { count: 5, firstAt: "2026-07-01T00:00:00.000Z", lastAt: "2026-07-30T00:00:00.000Z" },
    },
    lookupWords: [lookupWord("word-1", 1)],
    wordProgress: {
      1: { wordId: 1, lapseCount: 0, lastRating: 3, lastReviewedAt: "2026-07-28T00:00:00.000Z" },
    } as unknown as WordProgressMap,
  });
  // lastAt(07-30) 晚于 lastReviewedAt(07-28) → 查询还在增长，不降级
  assert.deepEqual(buildWordWeakSignals(1, input), ["查过5次"]);
});

test("薄弱降级贯通：未答对（lastRating<2）不降级", () => {
  const input = baseInput({
    lookupStats: {
      "word-1": { count: 3, firstAt: "2026-07-01T00:00:00.000Z", lastAt: "2026-07-20T00:00:00.000Z" },
    },
    lookupWords: [lookupWord("word-1", 1)],
    wordProgress: {
      1: { wordId: 1, lapseCount: 1, lastRating: 1, lastReviewedAt: "2026-07-28T00:00:00.000Z" },
    } as unknown as WordProgressMap,
  });
  assert.deepEqual(buildWordWeakSignals(1, input), ["查过3次", "FSRS lapse 1"]);
});

test("已稳定判定 isLookupDemoted：答对且查询不再增长 → true", () => {
  const input = baseInput({
    lookupStats: {
      "word-1": { count: 5, firstAt: "2026-07-01T00:00:00.000Z", lastAt: "2026-07-25T00:00:00.000Z" },
    },
    lookupWords: [lookupWord("word-1", 1)],
    wordProgress: {
      1: { wordId: 1, lapseCount: 0, lastRating: 3, lastReviewedAt: "2026-07-28T00:00:00.000Z" },
    } as unknown as WordProgressMap,
  });
  const stat = lookupStatForWordId(1, input)!;
  assert.equal(isLookupDemoted(1, stat, input), true);
});

test("已稳定判定 isLookupDemoted：查询仍增长 → false", () => {
  const input = baseInput({
    lookupStats: {
      "word-1": { count: 5, firstAt: "2026-07-01T00:00:00.000Z", lastAt: "2026-07-30T00:00:00.000Z" },
    },
    lookupWords: [lookupWord("word-1", 1)],
    wordProgress: {
      1: { wordId: 1, lapseCount: 0, lastRating: 3, lastReviewedAt: "2026-07-28T00:00:00.000Z" },
    } as unknown as WordProgressMap,
  });
  const stat = lookupStatForWordId(1, input)!;
  assert.equal(isLookupDemoted(1, stat, input), false);
});

test("已稳定判定 isLookupDemoted：未答对 → false", () => {
  const input = baseInput({
    lookupStats: {
      "word-1": { count: 3, firstAt: "2026-07-01T00:00:00.000Z", lastAt: "2026-07-20T00:00:00.000Z" },
    },
    lookupWords: [lookupWord("word-1", 1)],
    wordProgress: {
      1: { wordId: 1, lapseCount: 1, lastRating: 1, lastReviewedAt: "2026-07-28T00:00:00.000Z" },
    } as unknown as WordProgressMap,
  });
  const stat = lookupStatForWordId(1, input)!;
  assert.equal(isLookupDemoted(1, stat, input), false);
});

test("查词已稳定：查询次数未达当前薄弱阈值时不提示", () => {
  const input = baseInput({
    lookupStats: {
      "word-1": { count: 1, firstAt: "2026-07-01T00:00:00.000Z", lastAt: "2026-07-25T00:00:00.000Z" },
    },
    lookupWords: [lookupWord("word-1", 1)],
    wordProgress: {
      1: { wordId: 1, lapseCount: 0, lastRating: 3, lastReviewedAt: "2026-07-28T00:00:00.000Z" },
    } as unknown as WordProgressMap,
  });

  assert.equal(isLookupDemoted(1, lookupStatForWordId(1, input)!, input), true);
  assert.equal(isLookupStabilized(1, input), false);
});

test("查词已稳定：达到薄弱阈值且随后降级、无其他信号时提示", () => {
  const input = baseInput({
    lookupStats: {
      "word-1": { count: 2, firstAt: "2026-07-01T00:00:00.000Z", lastAt: "2026-07-25T00:00:00.000Z" },
    },
    lookupWords: [lookupWord("word-1", 1)],
    wordProgress: {
      1: { wordId: 1, lapseCount: 0, lastRating: 3, lastReviewedAt: "2026-07-28T00:00:00.000Z" },
    } as unknown as WordProgressMap,
  });

  assert.equal(isLookupStabilized(1, input), true);
});

test("查词已稳定：达到阈值但未降级或仍有其他薄弱信号时不提示", () => {
  const common = {
    lookupStats: {
      "word-1": { count: 2, firstAt: "2026-07-01T00:00:00.000Z", lastAt: "2026-07-25T00:00:00.000Z" },
    },
    lookupWords: [lookupWord("word-1", 1)],
  };
  const notDemoted = baseInput({
    ...common,
    wordProgress: {
      1: { wordId: 1, lapseCount: 0, lastRating: 1, lastReviewedAt: "2026-07-28T00:00:00.000Z" },
    } as unknown as WordProgressMap,
  });
  const withOtherSignal = baseInput({
    ...common,
    guessMistakes: { 1: 1 },
    wordProgress: {
      1: { wordId: 1, lapseCount: 0, lastRating: 3, lastReviewedAt: "2026-07-28T00:00:00.000Z" },
    } as unknown as WordProgressMap,
  });

  assert.equal(isLookupStabilized(1, notDemoted), false);
  assert.equal(isLookupStabilized(1, withOtherSignal), false);
});

test("查词已稳定：实时使用当前查询薄弱阈值", () => {
  const input = baseInput({
    lookupStats: {
      "word-1": { count: 3, firstAt: "2026-07-01T00:00:00.000Z", lastAt: "2026-07-25T00:00:00.000Z" },
    },
    lookupWords: [lookupWord("word-1", 1)],
    wordProgress: {
      1: { wordId: 1, lapseCount: 0, lastRating: 3, lastReviewedAt: "2026-07-28T00:00:00.000Z" },
    } as unknown as WordProgressMap,
  });
  const thresholdThree: WeakThresholds = {
    ...DEFAULT_WEAK_THRESHOLDS,
    lookupWeak: 3,
  };
  const thresholdFour: WeakThresholds = {
    ...DEFAULT_WEAK_THRESHOLDS,
    lookupWeak: 4,
  };

  assert.equal(isLookupStabilized(1, input, thresholdThree), true);
  assert.equal(isLookupStabilized(1, input, thresholdFour), false);
});
