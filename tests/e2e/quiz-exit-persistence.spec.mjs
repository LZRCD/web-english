import { expect, test } from "@playwright/test";
import { createState, DATABASE_NAME } from "./fixtures.mjs";
import {
  installStateSeed,
  openApp,
  readStoreCount,
  readStoreRecord,
} from "./helpers.mjs";

const SEED = 82_000;
const FIRST_QUESTION_ID = `meaning-choice:1:${SEED + 1}`;

test.beforeEach(async ({ context }) => {
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (["127.0.0.1", "localhost"].includes(url.hostname)) return route.continue();
    return route.abort();
  });
});

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
    explanation: `退出持久化测试 ${wordId}`,
  };
}

function activeQuizState() {
  const first = question(
    1,
    "退出测试题干一",
    "退出测试答案一",
    ["退出测试答案一", "干扰甲", "干扰乙", "干扰丙"],
  );
  const second = question(
    5,
    "退出测试题干二",
    "退出测试答案二",
    ["退出测试答案二", "选项甲", "选项乙", "选项丙"],
  );
  return createState({
    wordProgress: { 1: progress(1), 5: progress(5) },
    quizAttempts: [{
      id: "existing-attempt",
      wordId: 1,
      mode: "meaning-choice",
      correct: true,
      recallMs: 2_000,
      answeredAt: "2026-08-20T08:00:00.000Z",
      appliedToSchedule: false,
    }],
    activeQuiz: {
      id: `quiz:meaning-choice:${SEED}`,
      mode: "meaning-choice",
      seed: SEED,
      questionWordIds: [1, 5],
      questionSnapshots: [first, second],
      index: 1,
      correctCount: 1,
      answers: {
        [FIRST_QUESTION_ID]: { answer: "退出测试答案一", correct: true },
      },
      complete: false,
      startedAt: "2026-08-20T08:00:00.000Z",
    },
  });
}

async function openSavedQuiz(page) {
  await page.getByRole("complementary", { name: "主导航" })
    .getByRole("button", { name: /测验$/ }).click();
  await expect(page.getByRole("heading", { name: "退出测试题干二" })).toBeVisible();
  await expect(page.getByText("2 / 2", { exact: true })).toBeVisible();
}

async function bumpStoredRevision(page) {
  await page.evaluate((databaseName) => new Promise((resolve, reject) => {
    const openRequest = indexedDB.open(databaseName);
    openRequest.onerror = () => reject(openRequest.error);
    openRequest.onsuccess = () => {
      const database = openRequest.result;
      const transaction = database.transaction("state-domains", "readwrite");
      const store = transaction.objectStore("state-domains");
      const request = store.get("settings");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        store.put({ ...request.result, revision: request.result.revision + 1 });
      };
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    };
  }), DATABASE_NAME);
}

test("退出本组持久化完成后才离开，立即刷新不复活旧题组", async ({ context, page }) => {
  await installStateSeed(context, activeQuizState());
  await openApp(page);
  await expect.poll(async () =>
    (await readStoreRecord(page, "settings", "current"))?.activeQuiz?.index,
  ).toBe(1);
  await openSavedQuiz(page);

  await page.getByRole("button", { name: "退出本组" }).click();
  await expect(page.getByRole("heading", { name: "主动写出来，才算真正会" })).toBeVisible();
  await page.reload();
  await openApp(page);

  await expect.poll(async () =>
    (await readStoreRecord(page, "settings", "current"))?.activeQuiz,
  ).toBeUndefined();
  await expect.poll(() => readStoreCount(page, "quiz-attempts")).toBe(1);
  await page.getByRole("complementary", { name: "主导航" })
    .getByRole("button", { name: /测验$/ }).click();
  await expect(page.getByRole("heading", { name: "主动写出来，才算真正会" })).toBeVisible();
});

test("未退出的未完成题组在普通刷新后继续恢复", async ({ context, page }) => {
  await installStateSeed(context, activeQuizState());
  await openApp(page);
  await openSavedQuiz(page);

  await page.reload();
  await openApp(page);
  await openSavedQuiz(page);
  await expect.poll(async () =>
    (await readStoreRecord(page, "settings", "current"))?.activeQuiz?.index,
  ).toBe(1);
});

test("修订冲突时不宣称退出成功，保留题组并提供重试路径", async ({ context, page }) => {
  await installStateSeed(context, activeQuizState());
  await openApp(page);
  await openSavedQuiz(page);
  await bumpStoredRevision(page);

  await page.getByRole("button", { name: "退出本组" }).click();

  await expect(page.getByRole("heading", { name: "退出测试题干二" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "退出未完成，本组仍保留；请前往设置重试保存后再退出",
  );
  await expect.poll(async () =>
    (await readStoreRecord(page, "settings", "current"))?.activeQuiz?.id,
  ).toBe(`quiz:meaning-choice:${SEED}`);
  await expect.poll(() => readStoreCount(page, "quiz-attempts")).toBe(1);

  await page.getByRole("complementary", { name: "主导航" })
    .getByRole("button", { name: /设置$/ }).click();
  await expect(page.getByRole("button", { name: "重试保存" })).toBeVisible();
});
