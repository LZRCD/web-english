import assert from "node:assert/strict";
import test from "node:test";
import { applyRating, type WordProgressMap } from "../lib/learning.ts";
import {
  createQuizSession,
  recoverQuizSession,
  restoreQuizQuestions,
  shouldApplyQuizToSchedule,
  buildQuizQuestions,
  isQuizAnswerCorrect,
  snapshotQuizQuestions,
  type QuizSessionState,
} from "../lib/quiz.ts";
import type { Word } from "../lib/study.ts";
import {
  buildDailyClozeCacheEntry,
  buildDailyClozeQuestions,
  normalizeDailyClozeContent,
  type DailyClozeInput,
} from "../lib/daily-cloze.ts";
import { clozeSentence } from "../lib/word-utils.ts";
import { localDateKey } from "../lib/date-utils.ts";

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

test("三种专项测验解析说明题干答案关系并复用现有上下文", () => {
  const words = WORDS.map((word) => word.id === 1
    ? {
        ...word,
        phonetic: "/ˈreɪdieɪt/",
        part: "vt.",
        sentence: "Stars radiate energy.",
        translation: "恒星辐射能量。",
      }
    : word);
  const progress = progressFor([2, 2, 2, 2, 2]);
  const questions = ([
    "listening-spelling",
    "chinese-to-english",
    "meaning-choice",
  ] as const).map((mode) => buildQuizQuestions({
    words,
    progress,
    familiarMeanings: { 1: ["散发"] },
    mode,
    count: 5,
    seed: 7,
  }).find((question) => question.wordId === 1));

  assert.ok(questions.every(Boolean));
  assert.match(questions[0]!.explanation, /本题播放的发音对应单词“radiate”/);
  assert.match(
    questions[1]!.explanation,
    /题干“vt\. 散发;发出光线”对应英文单词“radiate”/,
  );
  assert.match(
    questions[2]!.explanation,
    /单词“radiate”的义项“发出光线”是本题的正确答案/,
  );
  for (const question of questions) {
    assert.match(question!.explanation, /音标：\/ˈreɪdieɪt\//);
    assert.match(question!.explanation, /词性：vt\./);
    assert.match(question!.explanation, /例句：Stars radiate energy\./);
    assert.match(question!.explanation, /译文：恒星辐射能量。/);
  }

  const [fallback] = buildQuizQuestions({
    words: [WORDS[0]],
    progress: { 1: progress[1] },
    mode: "chinese-to-english",
    seed: 1,
  });
  assert.match(
    fallback.explanation,
    /题干“vt\. 散发;发出光线”对应英文单词“radiate”/,
  );
  assert.doesNotMatch(fallback.explanation, /音标：|词性：|例句：|译文：|undefined/);
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

  // 同日任意旧模式已作答时，短文填词不得再次改写排程。
  assert.equal(shouldApplyQuizToSchedule([attempt], 1, now), false);
})

test("测验每日首次作答按本地自然日判定，凌晨/深夜不因 UTC 日期前缀跨日", () => {
  // ISO 字符串前缀是 UTC 日期：本地凌晨（东半球）或深夜（西半球）时，
  // 它与本地自然日相差一天。任一主机时区下，下面两组场景至少有一组
  // 落在“前缀跨日”窗口内，必须仍按本地同日判定为已作答。
  const attemptAt = (month: number, day: number, hour: number, minute: number) => ({
    id: `quiz:local:1:${month}-${day}-${hour}`,
    wordId: 1,
    mode: "listening-spelling" as const,
    correct: true,
    recallMs: 1200,
    answeredAt: new Date(2026, month - 1, day, hour, minute, 0).toISOString(),
    appliedToSchedule: true,
  });

  // 场景一：本地凌晨（00:10 作答，00:30 判定）——东半球 UTC 前缀为前一天
  const earlyMorning = new Date(2026, 7, 3, 0, 30, 0);
  const earlyAttempt = attemptAt(8, 3, 0, 10);
  assert.equal(shouldApplyQuizToSchedule([earlyAttempt], 1, earlyMorning), false);
  assert.equal(localDateKey(new Date(earlyAttempt.answeredAt)), localDateKey(earlyMorning));

  // 场景二：本地深夜（23:10 作答，23:50 判定）——西半球 UTC 前缀为后一天
  const lateEvening = new Date(2026, 7, 3, 23, 50, 0);
  const lateAttempt = attemptAt(8, 3, 23, 10);
  assert.equal(shouldApplyQuizToSchedule([lateAttempt], 1, lateEvening), false);
  assert.equal(localDateKey(new Date(lateAttempt.answeredAt)), localDateKey(lateEvening));

  // 场景三：本地昨日深夜作答不阻止本地今日首次写入
  const yesterdayAttempt = attemptAt(8, 2, 23, 50);
  assert.equal(shouldApplyQuizToSchedule([yesterdayAttempt], 1, earlyMorning), true);
})

test("clozeSentence 兼容大小写与正则字符，并且不会误挖单词子串", () => {
  assert.equal(clozeSentence("Radiate and radiate.", "radiate"), "＿＿＿＿ and ＿＿＿＿.");
  assert.equal(clozeSentence("C++ can coexist with C.", "C++"), "＿＿＿＿ can coexist with C.");
  assert.equal(clozeSentence("A rational plan should not hide ratio.", "ratio"), "A rational plan should not hide ＿＿＿＿.");
  assert.equal(clozeSentence("A rational plan.", "ratio"), "");
});

test("passage-cloze 只从合法缓存构建完整快照并保持原题恢复", () => {
  const input: DailyClozeInput = {
    localDate: "2026-08-11",
    targets: [
      { wordId: 1, word: "radiate", meaning: "散发；发出光线" },
      { wordId: 2, word: "objective", meaning: "目标；客观的" },
    ],
  };
  const passage = [
    "Careful", "students", "radiate", "confidence", "when", "they", "read", "widely",
    "and", "test", "their", "claims", "Their", "objective", "is", "not", "quick", "agreement",
    "but", "a", "clear", "account", "of", "evidence", "Each", "member", "asks", "questions",
    "compares", "sources", "and", "records", "doubts", "before", "the", "group", "reaches", "a",
    "decision", "This", "patient", "habit", "makes", "discussion", "more", "useful", "because", "weak",
    "assumptions", "become", "visible", "early", "and", "strong", "ideas", "receive", "better", "support",
    "By", "the", "end", "everyone", "can", "explain", "both", "the", "result", "and", "the", "limits",
    "of", "the", "method", "in", "plain", "language", "for", "future", "readers", "and", "new", "learners",
  ].join(" ");
  const content = normalizeDailyClozeContent({
    passage,
    questions: [
      { wordId: 1, options: ["radiate", "reduce", "remove", "reflect"], explanation: "语境表示传播信心。" },
      { wordId: 2, options: ["subjective", "ordinary", "objective", "optional"], explanation: "语境表示目标。" },
    ],
  }, input)!;
  const entry = buildDailyClozeCacheEntry(input, content, new Date("2026-08-11T08:00:00.000Z"));
  const questions = buildDailyClozeQuestions(entry, WORDS);
  assert.equal(questions.length, 2);
  assert.equal(questions[0].mode, "passage-cloze");
  assert.equal(questions[0].label, "短文填词");
  assert.doesNotMatch(questions[0].prompt, /radiate/i);
  assert.equal(questions[0].answer, "radiate");
  assert.equal(buildQuizQuestions({
    words: WORDS,
    progress: progressFor([2, 2]),
    mode: "passage-cloze",
  }).length, 0);

  const session: QuizSessionState = {
    id: "quiz:passage-cloze:2026-08-11",
    mode: "passage-cloze",
    inputKey: entry.inputKey,
    seed: 71,
    questionWordIds: questions.map(({ wordId }) => wordId),
    questionSnapshots: snapshotQuizQuestions(questions),
    index: 1,
    correctCount: 1,
    answers: { [questions[0].id]: { answer: "radiate", correct: true } },
    complete: false,
    startedAt: "2026-08-11T08:01:00.000Z",
  };
  const restored = restoreQuizQuestions(
    session,
    WORDS,
    progressFor([2, 2]),
    {},
  );
  assert.deepEqual(snapshotQuizQuestions(restored), snapshotQuizQuestions(questions));
  assert.deepEqual(recoverQuizSession(session, restored).session, session);
});

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

test("题目呈现快照在词条内容变化后保持题干、答案与选项", () => {
  const progress = progressFor([2, 2, 2, 2, 2]);
  const original = buildQuizQuestions({
    words: WORDS,
    progress,
    mode: "meaning-choice",
    count: 4,
    seed: 63,
  });
  assert.equal(original.length, 4);
  const removedWordId = original[0].wordId;
  const session: QuizSessionState = {
    id: "quiz:meaning-choice:63",
    mode: "meaning-choice",
    seed: 63,
    questionWordIds: original.map((question) => question.wordId),
    questionSnapshots: snapshotQuizQuestions(original),
    index: 2,
    correctCount: 2,
    answers: {
      [original[0].id]: { answer: original[0].answer, correct: true },
      [original[1].id]: { answer: "原提交答案", correct: false },
      [original[2].id]: { answer: original[2].answer, correct: true },
    },
    complete: true,
    startedAt: "2026-08-09T08:00:00.000Z",
  };
  const changedWords = WORDS
    .filter((word) => word.id !== removedWordId)
    .map((word) => ({
      ...word,
      word: `${word.word}-changed`,
      meaning: `${word.meaning}（已更新）`,
    }));
  const changedProgress = Object.fromEntries(
    Object.entries(progress).filter(([wordId]) => Number(wordId) !== removedWordId),
  ) as WordProgressMap;
  const restored = restoreQuizQuestions(
    session,
    changedWords,
    changedProgress,
    {},
  );

  assert.deepEqual(
    snapshotQuizQuestions(restored),
    snapshotQuizQuestions(original.slice(1)),
  );

  const recovery = recoverQuizSession(session, restored);
  assert.equal(recovery.status, "partial");
  assert.equal(recovery.removedCount, 1);
  assert.deepEqual(
    recovery.session?.questionWordIds,
    original.slice(1).map((question) => question.wordId),
  );
  assert.equal(recovery.session?.index, 1);
  assert.deepEqual(Object.keys(recovery.session?.answers ?? {}), [
    original[1].id,
    original[2].id,
  ]);
  assert.equal(recovery.session?.correctCount, 1);
  assert.equal(recovery.session?.complete, false);
});

test("题组全部失效时清除 activeQuiz，空题组不保留陈旧会话", () => {
  const session: QuizSessionState = {
    id: "quiz:listening-spelling:64",
    mode: "listening-spelling",
    seed: 64,
    questionWordIds: [9_999_999],
    index: 0,
    correctCount: 1,
    answers: {
      "listening-spelling:9999999:64": { answer: "missing", correct: true },
    },
    complete: true,
    startedAt: "2026-08-09T08:00:00.000Z",
  };

  assert.deepEqual(recoverQuizSession(session, []), {
    removedCount: 1,
    status: "cleared",
  });
});
