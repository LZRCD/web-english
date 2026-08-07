import assert from "node:assert/strict";
import test from "node:test";
import type {
  ReviewEvent,
  StubbornWordMap,
  WordProgressMap,
} from "../lib/learning.ts";
import type { LookupWord } from "../lib/study.ts";
import {
  buildWeakDimensionTrend,
  buildWeakProfiles,
  buildWordWeakSignals,
  lookupPriorityWordIds,
  lookupStatForWordId,
  lookupWeakCandidateIds,
  type WeakSignalInput,
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
