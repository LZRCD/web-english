import { expect, test } from "@playwright/test";
import {
  createBackup,
  createRecoveryCollection,
  createState,
  DATABASE_NAME,
  RADIATE_ENRICHMENT,
  RECOVERY_COPY_PREFIX,
  STORAGE_KEY,
} from "./fixtures.mjs";
import {
  dailyGoalSelect,
  installStateSeed,
  openApp,
  openSettings,
  openWordbook,
  readStoreCount,
  readStoreRecord,
  sessionBatchSizeSelect,
  waitForApp,
} from "./helpers.mjs";

async function readAutomaticBackups(page) {
  return page.evaluate((databaseName) => new Promise((resolve, reject) => {
    const openRequest = globalThis.indexedDB.open(databaseName);
    openRequest.onerror = () => reject(openRequest.error);
    openRequest.onsuccess = () => {
      const database = openRequest.result;
      const transaction = database.transaction("backups", "readonly");
      const request = transaction.objectStore("backups").getAll();
      request.onerror = () => {
        database.close();
        reject(request.error);
      };
      request.onsuccess = () => {
        const backups = request.result;
        transaction.oncomplete = () => {
          database.close();
          resolve(backups);
        };
      };
    };
  }), DATABASE_NAME);
}

test("导入备份会替换状态，并在刷新后保持", async ({ context, page }) => {
  await installStateSeed(context, createState({
    favorites: [{
      wordId: 2,
      addedAt: "2026-07-28T06:00:00.000Z",
    }],
  }));
  await openApp(page);
  await openSettings(page);
  await expect.poll(() => readStoreCount(page, "favorites")).toBe(1);
  await expect.poll(
    () => readStoreRecord(page, "favorites", 2),
  ).not.toBeNull();

  const importedState = createState({
    dailyGoal: 50,
    sessionBatchSize: 15,
    favorites: [{
      wordId: 1,
      addedAt: "2026-07-29T06:00:00.000Z",
    }],
  });
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator('input[type="file"]').setInputFiles({
    name: "wordloop-backup-e2e.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(createBackup(importedState))),
  });

  await expect(
    page.getByRole("status").filter({ hasText: "已导入 0 条评分记录" }),
  ).toBeVisible();
  await expect(dailyGoalSelect(page)).toHaveValue("50");
  await expect(sessionBatchSizeSelect(page)).toHaveValue("15");
  await expect.poll(() => readStoreCount(page, "favorites")).toBe(1);
  await expect.poll(
    () => readStoreRecord(page, "favorites", 1),
  ).not.toBeNull();
  await expect.poll(
    () => readStoreRecord(page, "favorites", 2),
  ).toBeNull();
  await expect.poll(() => readStoreCount(page, "backups")).toBeGreaterThanOrEqual(1);

  await page.reload();
  await waitForApp(page);
  await openSettings(page);
  await expect(dailyGoalSelect(page)).toHaveValue("50");
  await expect(sessionBatchSizeSelect(page)).toHaveValue("15");
  await openWordbook(page);
  await expect(
    page.getByRole("tabpanel").getByRole("heading", { name: "radiate" }),
  ).toBeVisible();
});

test("可从多份恢复副本中恢复指定副本，并保留其余副本", async ({ context, page }) => {
  const firstRecovery = createState({ dailyGoal: 30, sessionBatchSize: 5 });
  const secondRecovery = createState({ dailyGoal: 50, sessionBatchSize: 20 });
  await installStateSeed(context, createState(), {
    [`${RECOVERY_COPY_PREFIX}first`]: createRecoveryCollection({
      id: "first",
      state: firstRecovery,
      createdAt: "2026-07-28T06:00:00.000Z",
    }),
    [`${RECOVERY_COPY_PREFIX}second`]: createRecoveryCollection({
      id: "second",
      state: secondRecovery,
      createdAt: "2026-07-29T06:00:00.000Z",
    }),
  });
  await openApp(page);
  await openSettings(page);

  await expect(page.getByText("发现 2 份未合并的恢复副本")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByText("副本 2", { exact: true })
    .locator("..")
    .getByRole("button", { name: "恢复", exact: true })
    .click();

  await expect(
    page.getByRole("status").filter({ hasText: "恢复副本已写入" }),
  ).toBeVisible();
  await expect(dailyGoalSelect(page)).toHaveValue("50");
  await expect(sessionBatchSizeSelect(page)).toHaveValue("20");
  await expect(page.getByText("发现 1 份未合并的恢复副本")).toBeVisible();
  await expect.poll(() => readStoreCount(page, "backups")).toBeGreaterThanOrEqual(1);

  await page.reload();
  await waitForApp(page);
  await openSettings(page);
  await expect(dailyGoalSelect(page)).toHaveValue("50");
  await expect(sessionBatchSizeSelect(page)).toHaveValue("20");
  await expect(page.getByText("发现 1 份未合并的恢复副本")).toBeVisible();
});

test("清空学习记录时清除测验与进度，保留收藏和内容缓存并创建恢复快照", async ({ context, page }) => {
  const reviewedAt = new Date(Date.now() - 60_000).toISOString();
  const dueAt = new Date(Date.now() + 10 * 60_000).toISOString();
  await installStateSeed(context, createState({
    sessionBatchSize: 5,
    reviews: [{
      id: "reset-review-1",
      sessionId: "reset-session",
      wordId: 1,
      word: "radiate",
      rating: 0,
      kind: "new",
      intervalMs: 10 * 60_000,
      dueAt,
      reviewedAt,
      section: "必考词",
      unit: 1,
    }],
    wordProgress: {
      1: {
        wordId: 1,
        status: "learning",
        firstLearnedAt: reviewedAt,
        lastReviewedAt: reviewedAt,
        nextDueAt: dueAt,
        lastRating: 0,
        reviewCount: 1,
        successCount: 0,
        lapseCount: 1,
        consecutiveSuccesses: 0,
        intervalMs: 10 * 60_000,
        fsrsCard: {
          due: dueAt,
          stability: 0.2,
          difficulty: 7,
          elapsedDays: 0,
          scheduledDays: 0,
          learningSteps: 1,
          reps: 1,
          lapses: 1,
          state: 1,
          lastReview: reviewedAt,
        },
      },
    },
    favorites: [{
      wordId: 1,
      addedAt: reviewedAt,
    }],
    mistakes: [{
      wordId: 1,
      addedAt: reviewedAt,
      mistakeCount: 1,
      lastRating: 0,
      lastMistakeAt: reviewedAt,
    }],
    stubbornWords: {
      1: {
        wordId: 1,
        active: true,
        reason: "again-3",
        triggeredAt: reviewedAt,
        lastChangedAt: reviewedAt,
        triggerCount: 3,
      },
    },
    positions: {
      "selection:ordered:必考词:1:1": 7,
    },
    activeSession: {
      id: "reset-session",
      kind: "today",
      title: "今日任务",
      wordIds: [1],
      index: 0,
      createdAt: reviewedAt,
    },
    quizAttempts: [{
      id: "reset-attempt-1",
      wordId: 1,
      mode: "listening-spelling",
      correct: false,
      recallMs: 4_000,
      answeredAt: reviewedAt,
      appliedToSchedule: false,
    }],
    activeQuiz: {
      id: "quiz:listening-spelling:1:reset",
      mode: "listening-spelling",
      seed: 1,
      questionWordIds: [1],
      index: 0,
      correctCount: 0,
      answers: {},
      complete: false,
      startedAt: reviewedAt,
    },
    enrichments: RADIATE_ENRICHMENT,
  }));
  await openApp(page);

  await expect.poll(() => readStoreCount(page, "reviews")).toBe(1);
  await expect.poll(() => readStoreCount(page, "word-progress")).toBe(1);
  await expect.poll(() => readStoreCount(page, "fsrs-cards")).toBe(1);
  await expect.poll(() => readStoreCount(page, "mistakes")).toBe(1);
  await expect.poll(() => readStoreCount(page, "stubborn-words")).toBe(1);
  await expect.poll(() => readStoreCount(page, "positions")).toBe(1);
  await expect.poll(() => readStoreCount(page, "quiz-attempts")).toBe(1);
  await expect.poll(() => readStoreCount(page, "favorites")).toBe(1);
  await expect.poll(() => readStoreCount(page, "enrichments")).toBe(1);

  await openSettings(page);
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toBe(
      "确定清空本机的评分与记忆进度、错词、测验记录、进行中学习任务和学习位置吗？收藏与内容缓存会保留。清空前会创建可恢复快照。",
    );
    await dialog.accept();
  });
  await page.getByRole("button", { name: "清空本机学习记录" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "本机学习记录已清空" }),
  ).toBeVisible();

  await expect.poll(() => readStoreCount(page, "reviews")).toBe(0);
  await expect.poll(() => readStoreCount(page, "word-progress")).toBe(0);
  await expect.poll(() => readStoreCount(page, "fsrs-cards")).toBe(0);
  await expect.poll(() => readStoreCount(page, "mistakes")).toBe(0);
  await expect.poll(() => readStoreCount(page, "stubborn-words")).toBe(0);
  await expect.poll(() => readStoreCount(page, "positions")).toBe(0);
  await expect.poll(() => readStoreCount(page, "quiz-attempts")).toBe(0);
  await expect.poll(() => readStoreCount(page, "favorites")).toBe(1);
  await expect.poll(() => readStoreCount(page, "enrichments")).toBe(1);
  await expect.poll(() => readStoreCount(page, "backups")).toBeGreaterThanOrEqual(1);
  const clearedSettings = await readStoreRecord(page, "settings", "current");
  expect(clearedSettings.activeSession).toBeUndefined();
  expect(clearedSettings.activeQuiz).toBeUndefined();
  expect(clearedSettings.sessionBatchSize).toBe(5);
  const recoveryBackup = (await readAutomaticBackups(page))
    .find((backup) => backup.reason === "manual");
  expect(recoveryBackup?.document.state.quizAttempts).toHaveLength(1);
  expect(recoveryBackup?.document.state.activeQuiz?.id)
    .toBe("quiz:listening-spelling:1:reset");

  await page.reload();
  await waitForApp(page);
  await expect.poll(() => readStoreCount(page, "quiz-attempts")).toBe(0);
  const refreshedSettings = await readStoreRecord(page, "settings", "current");
  expect(refreshedSettings.activeSession).toBeUndefined();
  expect(refreshedSettings.activeQuiz).toBeUndefined();
  expect(refreshedSettings.sessionBatchSize).toBe(5);
  await openSettings(page);
  await expect(sessionBatchSizeSelect(page)).toHaveValue("5");
  await openWordbook(page);
  await expect(
    page.getByRole("tabpanel").getByRole("heading", { name: "radiate" }),
  ).toBeVisible();
});

test("IndexedDB 被禁用时使用 localStorage 兼容存储", async ({ context, page }) => {
  await installStateSeed(context, createState());
  await context.addInitScript(() => {
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: undefined,
    });
  });
  await openApp(page, { expectIndexedDb: false });
  await openSettings(page);
  await dailyGoalSelect(page).selectOption("30");
  await sessionBatchSizeSelect(page).selectOption("15");

  await expect(page.getByText("已保存到本机兼容存储")).toBeVisible();
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(localStorage.getItem("wordloop-state") ?? "{}").dailyGoal,
  )).toBe(30);
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(localStorage.getItem("wordloop-state") ?? "{}").sessionBatchSize,
  )).toBe(15);
});

test("IndexedDB 损坏异常时载入兼容副本且不覆盖原记录", async ({ context, page }) => {
  await installStateSeed(context, createState({
    dailyGoal: 30,
    sessionBatchSize: 20,
  }));
  await context.addInitScript(() => {
    const original = globalThis.indexedDB;
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: {
        ...original,
        open() {
          throw new DOMException("database corrupted", "UnknownError");
        },
      },
    });
  });
  await openApp(page, { expectIndexedDb: false });
  await openSettings(page);

  await expect(dailyGoalSelect(page)).toHaveValue("30");
  await expect(sessionBatchSizeSelect(page)).toHaveValue("20");
  await expect(page.getByText("本地数据库暂不可用，已载入兼容存储副本"))
    .toBeVisible();
});

test("IndexedDB 不可用且 localStorage 配额耗尽时暂停写入", async ({ context, page }) => {
  const state = createState();
  await installStateSeed(context, state);
  await context.addInitScript(({ seedState, storageKey }) => {
    // 不依赖多个 init script 的执行顺序：先保证兼容副本存在，再模拟配额耗尽。
    globalThis.localStorage.setItem(storageKey, JSON.stringify(seedState));
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: undefined,
    });
    Storage.prototype.setItem = function setItem() {
      throw new DOMException("quota exhausted", "QuotaExceededError");
    };
  }, { seedState: state, storageKey: STORAGE_KEY });
  await openApp(page, { expectIndexedDb: false });
  await openSettings(page);
  await dailyGoalSelect(page).selectOption("30");

  await expect(page.getByText("保存失败，请先导出备份或重试")).toBeVisible();
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(localStorage.getItem("wordloop-state") ?? "{}").dailyGoal,
  )).toBe(20);
});

test("启动时清理旧数据版本的查词缓存", async ({ context, page }) => {
  const staleKey = "wordloop-selection-lookups-v1:stale-version";
  await installStateSeed(context, createState(), {
    [staleKey]: JSON.stringify({ stale: true }),
  });
  await openApp(page);

  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), staleKey))
    .toBeNull();
});
