import assert from "node:assert/strict";
import test from "node:test";
import { applyRating, type WordProgressMap } from "../lib/learning.ts";
import {
  createQuizSession,
  shouldApplyQuizToSchedule,
  buildQuizQuestions,
  isQuizAnswerCorrect,
} from "../lib/quiz.ts";
import type { Word } from "../lib/study.ts";

const WORDS: Word[] = [
  { id: 1, word: "radiate", meaning: "vt. 散发;发出光线", section: "必考词", unit: 1 },
  { id: 2, word: "objective", meaning: "n. 目标 adj. 客观的", section: "必考词", unit: 1 },
  { id: 3, word: "obligation", meaning: "n. 义务,责任", section: "必考词", unit: 1 },
  { id: 4, word: "radical", meaning: "adj. 根本的;激进的 n. 激进分子", section: "必考词", unit: 1 },
  { id: 5, word: "oblige", meaning: "vt. 强迫;迫使;帮忙", section: "必考词", unit: 1 },
];

function progressFor(ratings: Array<0 | 1 | 2 | 3>) {
  return Object.fromEntries(ratings.map((rating, index) => {
    const word = WORDS[index];
    const result = applyRating(undefined, {
      wordId: word.id!,
      word: word.word,
      rating,
      reviewedAt: `2026-08-0${index + 1}T08:00:00.000Z`,
      section: word.section,
      unit: word.unit,
    });
    return [word.id!, result.progress];
  })) as WordProgressMap;
}

test("专项测验优先抽取薄弱词并只使用已学习词", () => {
  const questions = buildQuizQuestions({
    words: WORDS,
    progress: progressFor([2, 0, 2, 2]),
    mode: "listening-spelling",
    count: 2,
    seed: 42,
  });

  assert.equal(questions.length, 2);
  assert.equal(questions[0].wordId, 2);
  assert.ok(questions.every((question) => question.wordId !== 5));
});

test("拼写答案忽略大小写、空格和连字符差异", () => {
  const progress = applyRating(undefined, {
    wordId: 8,
    word: "passer-by",
    rating: 2,
    reviewedAt: "2026-08-01T08:00:00.000Z",
    section: "必考词",
    unit: 1,
  }).progress;
  const [question] = buildQuizQuestions({
    words: [{ id: 8, word: "passer-by", meaning: "n. 过路人" }],
    progress: { 8: progress },
    mode: "chinese-to-english",
    seed: 1,
  });

  assert.equal(isQuizAnswerCorrect(question, "Passer by"), true);
  assert.equal(isQuizAnswerCorrect(question, "passer"), false);
  assert.equal(isQuizAnswerCorrect(question, "   "), false);
});

test("熟词僻义与近义辨析题包含唯一正确选项", () => {
  const questions = buildQuizQuestions({
    words: WORDS,
    progress: progressFor([2, 2, 2, 2, 2]),
    familiarMeanings: { 1: ["散发"] },
    mode: "meaning-choice",
    count: 5,
    seed: 7,
  });

  assert.ok(questions.length >= 4);
  for (const question of questions) {
    assert.equal(question.options?.length, 4);
    assert.equal(
      question.options?.filter((option) => option === question.answer).length,
      1,
    );
    assert.ok(["熟词僻义", "近义辨析"].includes(question.label));
    assert.equal(isQuizAnswerCorrect(question, question.answer), true);
  }
});

test("出题优先级纳入划词查询、低频考频与顽固词信号", () => {
  // 全部已学习且非薄弱：基础分相同，只靠信号区分
  const progress = progressFor([2, 2, 2, 2, 2]);
  const lookupWords: import("../lib/study.ts").LookupWord[] = [
    {
      id: 9_000_000_001,
      linkedWordId: 1,
      query: "radiate",
      kind: "word",
      phonetic: "",
      part: "vt.",
      meaning: "散发",
      note: "",
      source: "redbook",
      addedAt: "2026-08-01T00:00:00.000Z",
    },
  ];
  const questions = buildQuizQuestions({
    words: WORDS,
    progress,
    mode: "listening-spelling",
    count: 4,
    seed: 42,
    // 词 1 查过 5 次 → 最高加分
    lookupStats: {
      radiate: {
        count: 5,
        firstAt: "2026-08-01T00:00:00.000Z",
        lastAt: "2026-08-05T00:00:00.000Z",
      },
    },
    lookupWords,
    // 词 2 有两个低频义项 → 次高
    senseFrequency: {
      2: [
        { meaning: "n. 目标", level: "low" },
        { meaning: "adj. 客观的", level: "low" },
      ],
    },
    // 词 3 活跃顽固词 → 第二
    stubbornWords: {
      3: {
        wordId: 3,
        active: true,
        reason: "again-3",
        triggeredAt: "2026-08-01T00:00:00.000Z",
        lastChangedAt: "2026-08-01T00:00:00.000Z",
        triggerCount: 1,
      },
    },
  });

  assert.deepEqual(
    questions.map((question) => question.wordId),
    [1, 3, 2, 4],
  );
});

test("出题优先级：未生成考频的多义词按义项数冷启动代理加分", () => {
  const words: Word[] = [
    { id: 1, word: "state", meaning: "n. 状态;州;国家 vt. 陈述", section: "必考词", unit: 1 },
    { id: 2, word: "abandon", meaning: "vt. 抛弃,放弃", section: "必考词", unit: 1 },
    { id: 3, word: "objective", meaning: "n. 目标 adj. 客观的", section: "必考词", unit: 1 },
  ];
  const progress = progressFor([2, 2, 2]);
  // 全部非薄弱、无考频；词 1 有三个义项 → 代理加分排最前
  const questions = buildQuizQuestions({
    words,
    progress,
    mode: "listening-spelling",
    count: 3,
    seed: 42,
    senseFrequency: {},
    stubbornWords: {},
  });
  assert.equal(questions[0].wordId, 1);
});

test("出题优先级：无信号时保持原有薄弱词优先语义", () => {
  const progress = progressFor([2, 0, 2, 2, 2]);
  const questions = buildQuizQuestions({
    words: WORDS,
    progress,
    mode: "listening-spelling",
    count: 2,
    seed: 42,
    lookupStats: {},
    lookupWords: [],
    senseFrequency: {},
    stubbornWords: {},
  });
  // 词 2 薄弱（上次评分 0），仍最先出题
  assert.equal(questions[0].wordId, 2);
});

test("测验每日首次作答才写入 FSRS，重复作答不再改写排程", () => {
  const now = new Date("2026-08-03T12:00:00.000Z");
  // 空记录：首次作答应写入
  assert.equal(shouldApplyQuizToSchedule([], 1, now), true);

  // 同日已有作答：不再写入
  const attempt = {
    id: "quiz:a:1:now",
    wordId: 1,
    mode: "listening-spelling" as const,
    correct: true,
    recallMs: 1200,
    answeredAt: "2026-08-03T09:00:00.000Z",
    appliedToSchedule: true,
  };
  assert.equal(shouldApplyQuizToSchedule([attempt], 1, now), false);

  // 其他词的作答不影响本词判定
  assert.equal(shouldApplyQuizToSchedule([attempt], 2, now), true);

  // 昨天的作答不阻止今天首次写入
  const yesterday = { ...attempt, answeredAt: "2026-08-02T09:00:00.000Z" };
  assert.equal(shouldApplyQuizToSchedule([yesterday], 1, now), true);
})

test("测验会话按 seed 可重建同一组题目", () => {
  const session = createQuizSession("chinese-to-english", 2026);
  const first = buildQuizQuestions({
    words: WORDS,
    progress: progressFor([2, 2, 2, 2, 2]),
    mode: "chinese-to-english",
    count: 3,
    seed: 2026,
  });
  const restored = buildQuizQuestions({
    words: WORDS,
    progress: progressFor([2, 2, 2, 2, 2]),
    mode: session.mode,
    count: 3,
    seed: session.seed,
  });
  assert.deepEqual(restored.map((question) => question.id), first.map((question) => question.id));
})
