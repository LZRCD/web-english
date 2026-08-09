import { expect, test } from "@playwright/test";
import { createState } from "./fixtures.mjs";
import {
  installStateSeed,
  openApp,
  readStoreCount,
  readStoreRecord,
} from "./helpers.mjs";

const MISSING_WORD_ID = 1_234_567;
const SEED = 63_000;

function progress(wordId) {
  const reviewedAt = new Date(Date.now() - 60_000).toISOString();
  const dueAt = new Date(Date.now() + 86_400_000).toISOString();
  return {
    wordId,
    status: "reviewing",
    firstLearnedAt: reviewedAt,
    lastReviewedAt: reviewedAt,
    nextDueAt: dueAt,
    lastRating: 2,
    reviewCount: 1,
    successCount: 1,
    lapseCount: 0,
    consecutiveSuccesses: 1,
    intervalMs: 86_400_000,
    fsrsCard: {
      due: dueAt,
      stability: 1,
      difficulty: 5,
      elapsedDays: 1,
      scheduledDays: 1,
      learningSteps: 0,
      reps: 1,
      lapses: 0,
      state: 2,
      lastReview: reviewedAt,
    },
  };
}

function question(wordId, prompt, answer, options) {
  return {
    id: `meaning-choice:${wordId}:${SEED + wordId}`,
    mode: "meaning-choice",
    wordId,
    prompt,
    answer,
    options,
    label: "熟词僻义",
    explanation: `快照解析 ${wordId}`,
  };
}

test("activeQuiz 部分失效后协调进度与分母，并保持完整题目快照", async ({ context, page }) => {
  const missing = question(
    MISSING_WORD_ID,
    "失效题干",
    "失效答案",
    ["失效答案", "甲", "乙", "丙"],
  );
  const first = question(
    1,
    "刷新前题干一",
    "刷新前答案一",
    ["刷新前答案一", "干扰甲", "干扰乙", "干扰丙"],
  );
  const second = question(
    5,
    "刷新前题干二",
    "刷新前答案二",
    ["刷新前答案二", "选项甲", "选项乙", "选项丙"],
  );
  await installStateSeed(context, createState({
    wordProgress: { 1: progress(1), 5: progress(5) },
    activeQuiz: {
      id: "quiz:meaning-choice:63000",
      mode: "meaning-choice",
      seed: SEED,
      questionWordIds: [MISSING_WORD_ID, 1, 5],
      questionSnapshots: [missing, first, second],
      index: 2,
      correctCount: 2,
      answers: {
        [missing.id]: { answer: "失效答案", correct: true },
        [first.id]: { answer: "用户原答案", correct: false },
      },
      complete: true,
      startedAt: "2026-08-09T08:00:00.000Z",
    },
  }));
  await openApp(page);

  await expect(page.getByRole("status").filter({
    hasText: "本组有 1 题因词条更新无法继续，已保留其余 2 题；结果按剩余题目计算",
  })).toBeVisible();
  await expect.poll(async () => {
    const activeQuiz = (await readStoreRecord(page, "settings", "current"))?.activeQuiz;
    return {
      wordIds: activeQuiz?.questionWordIds,
      snapshotPrompts: activeQuiz?.questionSnapshots?.map(({ prompt }) => prompt),
      index: activeQuiz?.index,
      answerIds: Object.keys(activeQuiz?.answers ?? {}),
      correctCount: activeQuiz?.correctCount,
      complete: activeQuiz?.complete,
    };
  }).toEqual({
    wordIds: [1, 5],
    snapshotPrompts: ["刷新前题干一", "刷新前题干二"],
    index: 1,
    answerIds: [first.id],
    correctCount: 0,
    complete: false,
  });

  await page.getByRole("complementary", { name: "主导航" })
    .getByRole("button", { name: /测验$/ }).click();
  await expect(page.getByRole("heading", { name: "刷新前题干二" })).toBeVisible();
  await expect(page.getByText("2 / 2", { exact: true })).toBeVisible();
  await expect(page.getByText("答对 0", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "刷新前答案二" })).toBeVisible();

  await page.reload();
  await openApp(page);
  await expect.poll(async () =>
    (await readStoreRecord(page, "settings", "current"))?.activeQuiz?.questionWordIds,
  ).toEqual([1, 5]);
});

test("activeQuiz 全部失效后清除陈旧会话并提供重新开始入口", async ({ context, page }) => {
  const missing = question(
    MISSING_WORD_ID,
    "失效题干",
    "失效答案",
    ["失效答案", "甲", "乙", "丙"],
  );
  await installStateSeed(context, createState({
    wordProgress: { 1: progress(1) },
    quizAttempts: [{
      id: "existing-attempt",
      wordId: 1,
      mode: "meaning-choice",
      correct: true,
      recallMs: 2_000,
      answeredAt: "2026-08-09T08:00:00.000Z",
      appliedToSchedule: false,
    }],
    activeQuiz: {
      id: "quiz:meaning-choice:63000",
      mode: "meaning-choice",
      seed: SEED,
      questionWordIds: [MISSING_WORD_ID],
      questionSnapshots: [missing],
      index: 0,
      correctCount: 1,
      answers: { [missing.id]: { answer: "失效答案", correct: true } },
      complete: true,
      startedAt: "2026-08-09T08:00:00.000Z",
    },
  }));
  await openApp(page);

  await expect(page.getByRole("status").filter({
    hasText: "本组题目已不可用，已结束本组；既有测验记录不受影响，可以重新开始",
  })).toBeVisible();
  await expect.poll(async () =>
    (await readStoreRecord(page, "settings", "current"))?.activeQuiz,
  ).toBeUndefined();
  await expect.poll(() => readStoreCount(page, "quiz-attempts")).toBe(1);

  await page.getByRole("complementary", { name: "主导航" })
    .getByRole("button", { name: /测验$/ }).click();
  await expect(page.getByText("上次测验已结束", { exact: true })).toBeVisible();
  await expect(page.locator('.quiz-rule-note[role="status"]'))
    .toContainText("既有测验记录不受影响");
  await expect(page.getByText("重新开始 10 题 →", { exact: true }).first()).toBeVisible();

  await page.reload();
  await openApp(page);
  await expect.poll(async () =>
    (await readStoreRecord(page, "settings", "current"))?.activeQuiz,
  ).toBeUndefined();
});
