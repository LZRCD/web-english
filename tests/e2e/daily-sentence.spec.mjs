import { expect, test } from "@playwright/test";
import { createState, DATABASE_NAME } from "./fixtures.mjs";
import {
  installStateSeed,
  openApp,
  readStoreRecord,
} from "./helpers.mjs";

const SENTENCE = "Although researchers who study memory often emphasize repeated practice, students who explain why an answer is correct may build knowledge that remains useful when unfamiliar questions require them to connect evidence across several apparently unrelated topics.";
const SECOND_SENTENCE = "While readers who approach difficult arguments patiently can identify the assumptions that organize each paragraph, those who compare claims with evidence often discover connections that make an initially confusing passage easier to evaluate and remember during later study.";

const CONTENT = {
  sentence: SENTENCE,
  backbone: "students may build knowledge",
  clauses: [
    {
      text: "students who explain why an answer is correct may build knowledge",
      type: "main",
      function: "主句说明学生可能建立知识。",
    },
    {
      text: "who study memory",
      type: "relative",
      function: "定语从句修饰 researchers。",
    },
    {
      text: "Although researchers who study memory often emphasize repeated practice",
      type: "adverbial",
      function: "让步状语从句。",
    },
  ],
  modifiers: [{
    text: "across several apparently unrelated topics",
    target: "connect evidence",
    relation: "介词短语补充证据连接的范围。",
  }],
  translation: "尽管研究记忆的学者常强调重复练习，但解释答案为何正确的学生，可能建立一种在陌生问题中仍然有用的知识。",
};

const SECOND_CONTENT = {
  sentence: SECOND_SENTENCE,
  backbone: "readers can identify assumptions; readers discover connections",
  clauses: [
    {
      text: "readers who approach difficult arguments patiently can identify the assumptions",
      type: "main",
      function: "主句说明读者可以识别假设。",
    },
    {
      text: "who approach difficult arguments patiently",
      type: "relative",
      function: "定语从句修饰 readers。",
    },
    {
      text: "that organize each paragraph",
      type: "relative",
      function: "定语从句修饰 assumptions。",
    },
  ],
  modifiers: [{
    text: "during later study",
    target: "remember",
    relation: "介词短语补充记忆发生的阶段。",
  }],
  translation: "耐心处理困难论证的读者能够识别组织各段的假设，而比较主张与证据的人常会发现让文章更易评价和记忆的联系。",
};

function localDateKey(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

/** 从顶部导航栏打开「今日长难句」弹层（桌面与窄屏均可用，aria-label 固定）。 */
async function openDailySentence(page) {
  await page.getByRole("button", { name: "今日长难句", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "今日长难句" }),
  ).toBeVisible();
}

function inputKey(localDate) {
  return JSON.stringify({
    schemaVersion: 1,
    promptVersion: "daily-sentence-v1",
    localDate,
  });
}

function cacheEntry(localDate, content = CONTENT) {
  return {
    schemaVersion: 1,
    promptVersion: "daily-sentence-v1",
    inputKey: inputKey(localDate),
    localDate,
    content,
    generatedAt: new Date().toISOString(),
    source: "ai",
  };
}

async function readLearningSnapshot(page) {
  return page.evaluate((databaseName) => new Promise((resolve, reject) => {
    const open = indexedDB.open(databaseName);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      const transaction = database.transaction("state-domains", "readonly");
      const store = transaction.objectStore("state-domains");
      const keys = ["reviews", "quiz-attempts", "word-progress", "fsrs-cards"];
      const values = {};
      let remaining = keys.length;
      for (const key of keys) {
        const request = store.get(key);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          values[key] = structuredClone(request.result?.value ?? []);
          remaining -= 1;
          if (!remaining) {
            database.close();
            resolve(values);
          }
        };
      }
    };
  }), DATABASE_NAME);
}

async function expectNoHorizontalOverflow(page) {
  const widths = await page.evaluate(() => ({
    documentClientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    bodyClientWidth: document.body.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  expect(widths.documentScrollWidth).toBeLessThanOrEqual(widths.documentClientWidth + 1);
  expect(widths.bodyScrollWidth).toBeLessThanOrEqual(widths.bodyClientWidth + 1);
}

test("每日长难句 A：显式单请求并展示完整结构且零学习事实写入", async ({ context, page }) => {
  await installStateSeed(context, createState());
  let requestCount = 0;
  let capturedBody;
  let releaseResponse;
  const responseGate = new Promise((resolve) => {
    releaseResponse = resolve;
  });
  await page.route("**/api/daily-sentence", async (route) => {
    requestCount += 1;
    capturedBody = route.request().postDataJSON();
    await responseGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(CONTENT),
    });
  });
  await openApp(page);
  // 主页不再内嵌大卡片：入口收进顶部导航栏
  await expect(page.locator(".study-main-stack .daily-sentence-card")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "今日长难句", exact: true })).toBeVisible();
  await openDailySentence(page);
  const region = page.getByRole("region", { name: "今日长难句" });
  await expect(region).toContainText("AI 原创长难句 · 非历年真题");
  expect(requestCount).toBe(0);
  const before = await readLearningSnapshot(page);
  const taskBefore = await page.locator(".today-task-strip").textContent();

  await page.getByRole("button", { name: "生成今日长难句" }).click();
  await expect(region).toHaveAttribute("aria-busy", "true");
  expect(requestCount).toBe(1);
  expect(capturedBody).toEqual({ localDate: localDateKey() });
  expect(Object.keys(capturedBody)).toEqual(["localDate"]);
  releaseResponse();

  await expect(region).toContainText(SENTENCE);
  await expect(region).toContainText(CONTENT.translation);
  await expect(region).toContainText(CONTENT.backbone);
  await expect(region).toContainText("定语从句");
  await expect(region).toContainText("介词短语补充证据连接的范围");
  await expect(region).toHaveAttribute("aria-busy", "false");
  await expect(page.getByText("真题原句", { exact: true })).toHaveCount(0);
  await expect(page.getByText("官方例句", { exact: true })).toHaveCount(0);

  await expect.poll(async () =>
    (await readStoreRecord(page, "settings", "current"))?.dailySentence?.inputKey,
  ).toBe(inputKey(localDateKey()));
  expect(await readLearningSnapshot(page)).toEqual(before);
  expect(await page.locator(".today-task-strip").textContent()).toBe(taskBefore);
});

test("每日长难句 B：刷新与离线复用当日缓存，昨天缓存不冒充今天", async ({ browser, context, page }) => {
  const today = localDateKey();
  await installStateSeed(context, createState({ dailySentence: cacheEntry(today) }));
  let requestCount = 0;
  await page.route("**/api/daily-sentence", (route) => {
    requestCount += 1;
    return route.abort("internetdisconnected");
  });
  await openApp(page);
  await openDailySentence(page);
  await expect(page.getByText(SENTENCE, { exact: true })).toBeVisible();
  expect(requestCount).toBe(0);
  await page.reload();
  await openDailySentence(page);
  await expect(page.getByText(SENTENCE, { exact: true })).toBeVisible();
  expect(requestCount).toBe(0);

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const staleContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const stalePage = await staleContext.newPage();
    let staleRequests = 0;
    await stalePage.route("**/api/daily-sentence", (route) => {
      staleRequests += 1;
      return route.fulfill({ status: 200, body: JSON.stringify(CONTENT) });
    });
    await installStateSeed(staleContext, createState({
      dailySentence: cacheEntry(localDateKey(yesterday)),
    }));
    await openApp(stalePage);
    await openDailySentence(stalePage);
    await expect(stalePage.getByText(SENTENCE, { exact: true })).toHaveCount(0);
    await expect(stalePage.getByRole("button", { name: "生成今日长难句" })).toBeVisible();
    expect(staleRequests).toBe(0);
  } finally {
    await staleContext.close();
  }
});

test("每日长难句 C：重新生成失败保留旧缓存，无缓存失败诚实降级", async ({ browser, context, page }) => {
  const today = localDateKey();
  const oldCache = cacheEntry(today);
  await installStateSeed(context, createState({ dailySentence: oldCache }));
  await page.route("**/api/daily-sentence", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ error: "未配置云端模型，暂时无法生成今日长难句" }),
  }));
  await openApp(page);
  await openDailySentence(page);
  const before = await readLearningSnapshot(page);
  await page.getByRole("button", { name: "重新生成", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("未配置云端模型");
  await expect(page.getByText(SENTENCE, { exact: true })).toBeVisible();
  expect((await readStoreRecord(page, "settings", "current"))?.dailySentence?.content)
    .toEqual(oldCache.content);
  expect(await readLearningSnapshot(page)).toEqual(before);

  const emptyContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const emptyPage = await emptyContext.newPage();
    await installStateSeed(emptyContext, createState());
    await emptyPage.route("**/api/daily-sentence", (route) => route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "AI 原创长难句生成失败，请稍后重试" }),
    }));
    await openApp(emptyPage);
    await openDailySentence(emptyPage);
    await emptyPage.getByRole("button", { name: "生成今日长难句" }).click();
    await expect(emptyPage.getByRole("alert")).toContainText("生成失败");
    await expect(emptyPage.getByText(SENTENCE, { exact: true })).toHaveCount(0);
    expect((await readStoreRecord(emptyPage, "settings", "current"))?.dailySentence)
      .toBeUndefined();
  } finally {
    await emptyContext.close();
  }
});

test("每日长难句 D：朗读控制、内容替换取消、不可用降级与响应式", async ({ browser, context, page }) => {
  await context.addInitScript(() => {
    const calls = { cancel: 0, pause: 0, resume: 0, speak: [] };
    class MockUtterance {
      constructor(text) {
        this.text = text;
        this.lang = "";
        this.rate = 1;
        this.onstart = null;
        this.onend = null;
        this.onerror = null;
      }
    }
    Object.defineProperty(globalThis, "SpeechSynthesisUtterance", {
      configurable: true,
      value: MockUtterance,
    });
    Object.defineProperty(globalThis, "speechSynthesis", {
      configurable: true,
      value: {
        cancel() { calls.cancel += 1; },
        pause() { calls.pause += 1; },
        resume() { calls.resume += 1; },
        speak(utterance) {
          calls.speak.push({ text: utterance.text, lang: utterance.lang, rate: utterance.rate });
          utterance.onstart?.();
        },
      },
    });
    globalThis.__dailySentenceSpeechCalls = calls;
  });
  const today = localDateKey();
  await installStateSeed(context, createState({ dailySentence: cacheEntry(today) }));
  await page.route("**/api/daily-sentence", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(SECOND_CONTENT),
  }));
  await page.setViewportSize({ width: 320, height: 720 });
  await openApp(page);
  await openDailySentence(page);
  expect((await page.evaluate(() => globalThis.__dailySentenceSpeechCalls.speak)).length).toBe(0);

  const readButton = page.getByRole("button", { name: "朗读", exact: true });
  await readButton.focus();
  await page.keyboard.press("Enter");
  let calls = await page.evaluate(() => globalThis.__dailySentenceSpeechCalls);
  expect(calls.speak.at(-1)).toEqual({ text: SENTENCE, lang: "en-US", rate: 0.8 });
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await page.getByRole("button", { name: "继续", exact: true }).click();
  const cancelBeforeReplay = calls.cancel;
  await page.getByRole("button", { name: "重播", exact: true }).focus();
  await page.keyboard.press("Space");
  calls = await page.evaluate(() => globalThis.__dailySentenceSpeechCalls);
  expect(calls.pause).toBe(1);
  expect(calls.resume).toBe(1);
  expect(calls.cancel).toBeGreaterThan(cancelBeforeReplay);
  expect(calls.speak).toHaveLength(2);

  const cancelBeforeReplace = calls.cancel;
  await page.getByRole("button", { name: "重新生成", exact: true }).click();
  await expect(page.getByText(SECOND_SENTENCE, { exact: true })).toBeVisible();
  await expect.poll(async () =>
    (await page.evaluate(() => globalThis.__dailySentenceSpeechCalls.cancel)),
  ).toBeGreaterThan(cancelBeforeReplace);
  await expectNoHorizontalOverflow(page);

  for (const zoom of ["2", "4"]) {
    await page.evaluate((level) => {
      document.documentElement.style.zoom = level;
    }, zoom);
    const region = page.getByRole("region", { name: "今日长难句" });
    await region.scrollIntoViewIfNeeded();
    await expect(region.getByText("AI 原创长难句 · 非历年真题", { exact: true })).toBeVisible();
    await expect(region.getByRole("button", { name: "重新生成", exact: true })).toBeVisible();
    await expect(region.getByRole("button", { name: "朗读", exact: true })).toBeVisible();
    await expect(region.getByRole("button", { name: "暂停", exact: true })).toBeVisible();
    await expect(region.getByRole("button", { name: "重播", exact: true })).toBeVisible();
    await expect(region.getByRole("button", { name: "收起句子解析" })).toBeVisible();
    await page.evaluate(() => {
      document.documentElement.style.zoom = "1";
    });
  }

  const unsupportedContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    await unsupportedContext.addInitScript(() => {
      Object.defineProperty(globalThis, "speechSynthesis", {
        configurable: true,
        value: undefined,
      });
      Object.defineProperty(globalThis, "SpeechSynthesisUtterance", {
        configurable: true,
        value: undefined,
      });
    });
    await installStateSeed(unsupportedContext, createState({
      dailySentence: cacheEntry(today),
    }));
    const unsupportedPage = await unsupportedContext.newPage();
    await openApp(unsupportedPage);
    await openDailySentence(unsupportedPage);
    await expect(unsupportedPage.getByText(
      "当前浏览器不支持长句朗读，文字与解析仍可正常使用。",
      { exact: true },
    )).toBeVisible();
    await expect(unsupportedPage.getByText(SENTENCE, { exact: true })).toBeVisible();
    await unsupportedPage.getByRole("button", { name: "展开句子解析" }).click();
    await expect(unsupportedPage.getByText(CONTENT.backbone, { exact: true })).toBeVisible();
  } finally {
    await unsupportedContext.close();
  }
});
