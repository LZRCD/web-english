import { expect, test } from "@playwright/test";
import { createState } from "./fixtures.mjs";
import {
  installStateSeed,
  openApp,
  readStoreCount,
  readStoreRecord,
} from "./helpers.mjs";

function localDateKey(value = new Date()) {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
}

function review(id, wordId, kind, reviewedAt) {
  return {
    id,
    wordId,
    word: `seed-${wordId}`,
    rating: 2,
    kind,
    intervalMs: 86_400_000,
    dueAt: new Date(new Date(reviewedAt).getTime() + 86_400_000).toISOString(),
    reviewedAt,
    section: "必考词",
    unit: 1,
  };
}

function todayReviewState(wordIds = [1, 5]) {
  const now = Date.now();
  return createState({
    reviews: [
      review("new-first", wordIds[0], "new", new Date(now - 8 * 60_000).toISOString()),
      ...(wordIds[1] ? [
        review("new-second", wordIds[1], "new", new Date(now - 6 * 60_000).toISOString()),
        review("new-duplicate", wordIds[0], "new", new Date(now - 4 * 60_000).toISOString()),
      ] : []),
      review("ordinary-review", 2, "review", new Date(now - 7 * 60_000).toISOString()),
      review("future-new", 3, "new", new Date(now + 60 * 60_000).toISOString()),
    ],
  });
}

function responseFor(input) {
  const passage = [
    "Today",
    ...input.targets.map(({ word }) => word),
    ...Array(85).fill("context"),
  ].join(" ");
  return {
    passage,
    questions: input.targets.map(({ wordId, word }) => ({
      wordId,
      options: [word, `choice${wordId}alpha`, `choice${wordId}beta`, `choice${wordId}gamma`],
      explanation: `结合上下文选择 ${word}。`,
    })),
  };
}

async function openQuiz(page) {
  await page.getByRole("complementary", { name: "主导航" })
    .getByRole("button", { name: /测验$/ }).click();
  await expect(page.locator(".quiz-view")).toBeVisible();
}

async function readDomainValues(page, key) {
  return page.evaluate((domainKey) => new Promise((resolve, reject) => {
    const open = indexedDB.open("wordloop-local");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      const transaction = database.transaction("state-domains", "readonly");
      const request = transaction.objectStore("state-domains").get(domainKey);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result?.value ?? []);
      transaction.oncomplete = () => database.close();
    };
  }), key);
}

async function appendReviewDomain(page, newReview) {
  await page.evaluate((item) => new Promise((resolve, reject) => {
    const open = indexedDB.open("wordloop-local");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      const transaction = database.transaction("state-domains", "readwrite");
      const store = transaction.objectStore("state-domains");
      const reviewsRequest = store.get("reviews");
      const settingsRequest = store.get("settings");
      reviewsRequest.onsuccess = () => {
        store.put({
          key: "reviews",
          value: [...(reviewsRequest.result?.value ?? []), item],
        });
      };
      settingsRequest.onsuccess = () => {
        const settings = settingsRequest.result;
        store.put({
          ...settings,
          revision: Number(settings?.revision ?? 0) + 1,
        });
      };
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    };
  }), newReview);
}

async function expectNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => ({
    bodyWidth: document.body.scrollWidth,
    documentWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.bodyWidth).toBeLessThanOrEqual(overflow.documentWidth + 2);
}

test("每日短文 A：真实当天新词、显式生成且作答前不泄漏答案", async ({ context, page }) => {
  await installStateSeed(context, todayReviewState());
  let requestCount = 0;
  let requestBody;
  let releaseResponse;
  const responseGate = new Promise((resolve) => {
    releaseResponse = resolve;
  });
  await page.route("**/api/daily-cloze", async (route) => {
    requestCount += 1;
    requestBody = route.request().postDataJSON();
    await responseGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(responseFor(requestBody)),
    });
  });
  await openApp(page);
  await openQuiz(page);

  expect(requestCount).toBe(0);
  await expect(page.getByText("AI 原创短文 · 非历年真题", { exact: true }).first()).toBeVisible();
  const panel = page.getByRole("region", { name: "今日短文填词生成" });
  await panel.getByRole("button", { name: "生成今日短文" }).click();
  await expect(panel).toHaveAttribute("aria-busy", "true");
  await expect.poll(() => requestCount).toBe(1);
  expect(Object.keys(requestBody)).toEqual(["localDate", "targets"]);
  expect(requestBody.localDate).toBe(localDateKey());
  expect(requestBody.targets.map(({ wordId }) => wordId)).toEqual([1, 5]);
  expect(requestBody.targets).toHaveLength(2);
  releaseResponse();

  const passage = page.locator(".quiz-question-card h1");
  await expect(passage).toContainText("＿＿＿＿");
  await expect(passage).not.toContainText(requestBody.targets[0].word);
  await expect(page.locator(".quiz-question-card")).not.toContainText(requestBody.targets[0].meaning);
  await expect(page.locator(".quiz-question-card")).not.toContainText("正确答案：");
  expect(await page.locator(".quiz-option").count()).toBe(4);
  const leakedAttributes = await page.locator(".quiz-option").evaluateAll((buttons) =>
    buttons.flatMap((button) => [...button.attributes]
      .filter(({ name, value }) =>
        name === "value"
        || name === "title"
        || name === "aria-label"
        || /data-(?:answer|correct)/.test(name)
        || /(?:answer|correct|wrong)/i.test(value))
      .map(({ name, value }) => [name, value])));
  expect(leakedAttributes).toEqual([]);

  await page.locator(".quiz-option").first().click();
  await expect(page.getByText(`正确答案：${requestBody.targets[0].word}`, { exact: true })).toBeVisible();
  await expect(page.locator(".quiz-feedback small")).toContainText(requestBody.targets[0].meaning);
  await expect(page.locator(".quiz-feedback small"))
    .toContainText(`结合上下文选择 ${requestBody.targets[0].word}`);
});

test("每日短文 B：QuizAttempt、每日首次 FSRS 与独立 weak-signals", async ({ context, page }) => {
  const seededState = todayReviewState();
  seededState.quizAttempts = [{
    id: "meaning-choice:5:existing",
    wordId: 5,
    mode: "meaning-choice",
    correct: true,
    recallMs: 900,
    answeredAt: new Date(Date.now() - 2 * 60_000).toISOString(),
    appliedToSchedule: true,
  }];
  await installStateSeed(context, seededState);
  let requestCount = 0;
  await page.route("**/api/daily-cloze", async (route) => {
    requestCount += 1;
    const body = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(responseFor(body)),
    });
  });
  await openApp(page);
  await openQuiz(page);
  const initialReviewCount = await readStoreCount(page, "reviews");
  await page.getByRole("button", { name: "生成今日短文" }).click();
  await page.locator(".quiz-option").nth(1).click();

  await expect.poll(async () => (await readDomainValues(page, "quiz-attempts")).length).toBe(2);
  let attempts = (await readDomainValues(page, "quiz-attempts"))
    .filter(({ mode }) => mode === "passage-cloze");
  expect(attempts[0]).toMatchObject({
    wordId: 1,
    mode: "passage-cloze",
    correct: false,
    appliedToSchedule: true,
  });
  await expect.poll(async () => (await readDomainValues(page, "reviews")).length)
    .toBe(initialReviewCount + 1);

  await page.getByRole("button", { name: "下一题" }).click();
  await page.locator(".quiz-option").nth(1).click();
  await expect.poll(async () => (await readDomainValues(page, "quiz-attempts")).length).toBe(3);
  attempts = (await readDomainValues(page, "quiz-attempts"))
    .filter(({ mode }) => mode === "passage-cloze");
  expect(attempts[1]).toMatchObject({
    wordId: 5,
    mode: "passage-cloze",
    correct: false,
    appliedToSchedule: false,
  });
  expect(await readStoreCount(page, "reviews")).toBe(initialReviewCount + 1);

  await page.getByRole("button", { name: "查看结果" }).click();
  await page.getByRole("button", { name: "更换模式" }).click();
  await page.getByRole("button", { name: "开始今日短文" }).click();
  await page.locator(".quiz-option").nth(1).click();
  await expect.poll(async () => (await readDomainValues(page, "quiz-attempts")).length).toBe(4);
  attempts = (await readDomainValues(page, "quiz-attempts"))
    .filter(({ mode }) => mode === "passage-cloze");
  expect(attempts[2]).toMatchObject({ mode: "passage-cloze", appliedToSchedule: false });
  expect(await readStoreCount(page, "reviews")).toBe(initialReviewCount + 1);
  expect(requestCount).toBe(1);

  await page.getByRole("complementary", { name: "主导航" })
    .getByRole("button", { name: /词本$/ }).click();
  await page.getByRole("tab", { name: /错词记录/ }).click();
  await expect(page.getByText("短文填词错2次", { exact: true })).toBeVisible();
  await expect(page.getByText("辨析错2次", { exact: true })).toHaveCount(0);
});

test("每日短文 C：缓存刷新恢复、离线命中与当天输入变化失效", async ({ context, page }) => {
  await installStateSeed(context, todayReviewState([1]));
  let requestCount = 0;
  let regenerationStatus = 0;
  await page.route("**/api/daily-cloze", async (route) => {
    requestCount += 1;
    if (regenerationStatus) {
      await route.fulfill({
        status: regenerationStatus,
        contentType: "application/json",
        body: JSON.stringify({ error: "模拟重新生成失败" }),
      });
      return;
    }
    const body = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(responseFor(body)),
    });
  });
  await openApp(page);
  await openQuiz(page);
  await page.getByRole("button", { name: "生成今日短文" }).click();
  const options = await page.locator(".quiz-option").allTextContents();
  await expect.poll(async () => {
    const settings = await readStoreRecord(page, "settings", "current");
    return Boolean(settings?.dailyCloze && settings?.activeQuiz?.inputKey);
  }).toBe(true);

  await page.reload();
  await openApp(page);
  await openQuiz(page);
  await expect(page.locator(".quiz-option")).toHaveText(options);
  expect(requestCount).toBe(1);

  const cachedInputKey = (await readStoreRecord(page, "settings", "current"))?.dailyCloze?.inputKey;
  await page.getByRole("button", { name: "← 退出本组" }).click();
  regenerationStatus = 502;
  await page.getByRole("button", { name: "重新生成" }).click();
  await expect(page.getByRole("alert")).toContainText("模拟重新生成失败");
  await expect(page.getByRole("button", { name: "开始今日短文" })).toBeVisible();
  expect((await readStoreRecord(page, "settings", "current"))?.dailyCloze?.inputKey)
    .toBe(cachedInputKey);
  expect(requestCount).toBe(2);
  regenerationStatus = 0;
  await page.getByRole("button", { name: "开始今日短文" }).click();
  await expect(page.locator(".quiz-option")).toHaveText(options);
  // 等缓存启动的 activeQuiz 落盘（自动保存有 150ms 防抖），再离线重载
  await expect.poll(async () =>
    Boolean((await readStoreRecord(page, "settings", "current"))
      ?.activeQuiz?.inputKey),
  ).toBe(true);

  await page.unroute("**/api/daily-cloze");
  await page.route("**/api/daily-cloze", (route) => route.abort("internetdisconnected"));
  await page.reload();
  await openApp(page);
  await openQuiz(page);
  await expect(page.locator(".quiz-option")).toHaveText(options);
  expect(requestCount).toBe(2);

  const changedAt = new Date(Date.now() - 30_000).toISOString();
  await appendReviewDomain(page, review("new-input-change", 5, "new", changedAt));
  await page.reload();
  await openApp(page);
  await expect(page.getByRole("status").filter({
    hasText: "上次短文填词已因日期或当天新学词变化失效",
  })).toBeVisible();
  await expect.poll(async () =>
    (await readStoreRecord(page, "settings", "current"))?.activeQuiz,
  ).toBeUndefined();
  await openQuiz(page);
  await expect(page.getByRole("button", { name: "开始今日短文" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "生成今日短文" })).toBeVisible();
});

test("每日短文 D：空目标、诚实失败、键盘与窄屏缩放", async ({ browser }) => {
  const emptyContext = await browser.newContext();
  const emptyPage = await emptyContext.newPage();
  await installStateSeed(emptyContext, createState());
  let emptyRequests = 0;
  await emptyPage.route("**/api/daily-cloze", (route) => {
    emptyRequests += 1;
    return route.fulfill({ status: 200, body: "{}" });
  });
  await openApp(emptyPage);
  await openQuiz(emptyPage);
  await expect(emptyPage.getByText("今天还没有新学词", { exact: false })).toBeVisible();
  await expect(emptyPage.getByRole("button", { name: "生成今日短文" })).toBeDisabled();
  expect(emptyRequests).toBe(0);
  await emptyContext.close();

  const context = await browser.newContext({ viewport: { width: 320, height: 720 } });
  const page = await context.newPage();
  await installStateSeed(context, todayReviewState([1]));
  let failureStatus = 503;
  await page.route("**/api/daily-cloze", async (route) => {
    if (failureStatus) {
      await route.fulfill({
        status: failureStatus,
        contentType: "application/json",
        body: JSON.stringify({ error: `模拟 ${failureStatus} 失败` }),
      });
      return;
    }
    const body = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(responseFor(body)),
    });
  });
  await openApp(page);
  await openQuiz(page);
  const initialReviewCount = await readStoreCount(page, "reviews");
  const generate = page.getByRole("button", { name: "生成今日短文" });
  for (const status of [503, 429, 502]) {
    failureStatus = status;
    await generate.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alert")).toContainText(`模拟 ${status} 失败`);
    expect(await readStoreCount(page, "quiz-attempts")).toBe(0);
    expect(await readStoreCount(page, "reviews")).toBe(initialReviewCount);
    expect((await readStoreRecord(page, "settings", "current"))?.dailyCloze).toBeUndefined();
  }

  failureStatus = 0;
  await generate.focus();
  await page.keyboard.press("Space");
  await expect(page.locator(".quiz-option")).toHaveCount(4);
  await expectNoHorizontalOverflow(page);
  await page.locator(".quiz-option").first().focus();
  await page.keyboard.press("Space");
  await expect(page.getByText("正确答案：", { exact: false })).toBeVisible();

  for (const zoom of ["2", "4"]) {
    await page.evaluate((level) => {
      document.documentElement.style.zoom = level;
    }, zoom);
    await expect(page.getByText("AI 原创短文 · 非历年真题", { exact: true })).toBeVisible();
    await expect(page.getByText("正确答案：", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "查看结果" })).toBeVisible();
    await page.evaluate(() => {
      document.documentElement.style.zoom = "1";
    });
  }
  await context.close();
});
