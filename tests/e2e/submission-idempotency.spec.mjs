import { expect, test } from "@playwright/test";
import { createState } from "./fixtures.mjs";
import {
  installStateSeed,
  openApp,
  readStoreCount,
  readStoreRecord,
  readStoreSnapshot,
} from "./helpers.mjs";

function learnedProgress(wordId) {
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

test.beforeEach(async ({ context }) => {
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
      return route.continue();
    }
    return route.abort();
  });
});

test("学习评分双点击与键盘点击连发均只生成一条复习与撤销事实", async ({ context, page }) => {
  await installStateSeed(context, createState());
  await openApp(page);

  await page.getByRole("button", { name: "显示单词释义" }).click();
  const fluentButton = page.getByRole("button", { name: /熟练/ });
  await fluentButton.evaluate((button) => {
    button.click();
    button.click();
  });

  await expect.poll(() => readStoreCount(page, "reviews")).toBe(1);
  await expect.poll(async () => {
    const settings = await readStoreRecord(page, "settings", "current");
    return settings?.ratingUndoStack?.length ?? 0;
  }).toBe(1);
  await expect.poll(async () =>
    (await readStoreRecord(page, "word-progress", 1))?.reviewCount).toBe(1);

  await page.getByRole("button", { name: "显示单词释义" }).click();
  await page.getByRole("button", { name: /熟练/ }).evaluate((button) => {
    window.dispatchEvent(new KeyboardEvent("keydown", {
      key: "4",
      code: "Digit4",
      bubbles: true,
      cancelable: true,
    }));
    button.click();
  });
  await expect.poll(() => readStoreCount(page, "reviews")).toBe(2);
  await expect.poll(async () => {
    const settings = await readStoreRecord(page, "settings", "current");
    return settings?.ratingUndoStack?.length ?? 0;
  }).toBe(2);

  await page.getByRole("button", { name: "显示单词释义" }).click();
  const enterAndClickButton = page.getByRole("button", { name: /熟练/ });
  await enterAndClickButton.evaluate((button) => {
    button.addEventListener("click", () => button.click(), {
      capture: true,
      once: true,
    });
  });
  await enterAndClickButton.press("Enter");
  await expect.poll(() => readStoreCount(page, "reviews")).toBe(3);
  await expect.poll(async () => {
    const settings = await readStoreRecord(page, "settings", "current");
    return settings?.ratingUndoStack?.length ?? 0;
  }).toBe(3);
});

test("测验同帧双提交只记录一次且不改变结果分母", async ({ context, page }) => {
  await installStateSeed(context, createState({
    wordProgress: { 1: learnedProgress(1) },
  }));
  await openApp(page);

  await page
    .getByRole("complementary", { name: "主导航" })
    .getByRole("button", { name: /测验$/ })
    .click();
  await page.getByRole("button", { name: /听音拼写/ }).click();
  await page.getByRole("textbox", { name: "你的答案" }).fill("radiate");
  await page.locator("form.quiz-answer-form").evaluate((form) => {
    form.requestSubmit();
    form.requestSubmit();
  });

  await expect(page.locator(".quiz-feedback")).toContainText("回答正确");
  await expect.poll(() => readStoreCount(page, "quiz-attempts")).toBe(1);
  await expect.poll(() => readStoreCount(page, "reviews")).toBe(1);
  await expect.poll(async () =>
    (await readStoreRecord(page, "word-progress", 1))?.reviewCount).toBe(2);
  await expect.poll(async () => {
    const attempts = await readStoreSnapshot(page, "quiz-attempts");
    return attempts?.map(({ correct, appliedToSchedule }) => ({
      correct,
      appliedToSchedule,
    }));
  }).toEqual([{ correct: true, appliedToSchedule: true }]);

  await page.getByRole("button", { name: "查看结果" }).click();
  await expect(page.getByText(/1 题中答对 1 题/)).toBeVisible();

  await page.getByRole("button", { name: "再来一组" }).click();
  await page.getByRole("textbox", { name: "你的答案" }).fill("radiate");
  await page.getByRole("button", { name: "提交" }).click();

  await expect.poll(() => readStoreCount(page, "quiz-attempts")).toBe(2);
  await expect.poll(() => readStoreCount(page, "reviews")).toBe(1);
  await expect.poll(async () =>
    (await readStoreRecord(page, "word-progress", 1))?.reviewCount).toBe(2);
  await expect.poll(async () => {
    const attempts = await readStoreSnapshot(page, "quiz-attempts");
    return attempts?.map(({ appliedToSchedule }) => appliedToSchedule);
  }).toEqual([true, false]);

  await page.getByRole("button", { name: "查看结果" }).click();
  await expect(page.getByText(/1 题中答对 1 题/)).toBeVisible();

  await page.getByRole("button", { name: "再来一组" }).click();
  await page.getByRole("textbox", { name: "你的答案" }).fill("incorrect");
  await page.getByRole("button", { name: "提交" }).click();
  await expect(page.locator(".quiz-feedback")).toContainText("已加入薄弱词");
  await expect.poll(() => readStoreCount(page, "quiz-attempts")).toBe(3);
  await expect.poll(() => readStoreCount(page, "reviews")).toBe(1);
  await expect.poll(() => readStoreCount(page, "mistakes")).toBe(1);

  await page.getByRole("button", { name: "查看结果" }).click();
  await expect(page.getByText(/1 题中答对 0 题/)).toBeVisible();
});
