import { expect, test } from "@playwright/test";
import { createState } from "./fixtures.mjs";
import {
  blockPrivateDatasets,
  installStateSeed,
  openApp,
  readStoreRecord,
  waitForApp,
} from "./helpers.mjs";

const GENERATED_ETYMOLOGY = {
  breakdown: "sav(e) + -ing",
  root: "save：保留、节省",
  affixes: [
    { form: "save", kind: "root", meaning: "保留、节省" },
    { form: "-ing", kind: "suffix", meaning: "构成名词" },
  ],
  mnemonic: "把节省下来的钱保留下来，就形成 saving。",
};

function savingSession(id) {
  return {
    id,
    kind: "search",
    title: "词根助记验证",
    wordIds: [59],
    index: 0,
    createdAt: "2026-08-11T08:00:00.000Z",
  };
}

function savingEnrichment(etymology) {
  return {
    59: {
      sentence: "Regular saving can reduce financial stress.",
      translation: "定期储蓄可以减轻财务压力。",
      collocations: ["regular saving"],
      source: "dictionary",
      verified: true,
      ...(etymology ? { etymology } : {}),
    },
  };
}

test("词根助记场景A：显式生成、合并写回、刷新命中且失败不覆盖", async ({ context, page }) => {
  await blockPrivateDatasets(page);
  let requestCount = 0;
  let failRegeneration = false;
  let capturedBody;
  await page.route("**/api/etymology", async (route) => {
    requestCount += 1;
    capturedBody = route.request().postDataJSON();
    if (failRegeneration) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "未配置云端模型，已保留本地词根与词族线索" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(GENERATED_ETYMOLOGY),
    });
  });
  await installStateSeed(context, createState({
    activeSession: savingSession("etymology-success"),
    enrichments: savingEnrichment(),
  }));
  await openApp(page);
  expect(requestCount).toBe(0);

  await page.getByRole("button", { name: "显示单词释义" }).click();
  expect(requestCount).toBe(0);
  await expect(page.getByText("Regular saving can reduce financial stress.", { exact: true }))
    .toBeVisible();

  await page.getByRole("button", { name: "生成 AI 词根拆解与助记" }).click();
  await expect(page.getByRole("heading", { name: "AI 词根拆解与助记" }))
    .toBeVisible();
  expect(requestCount).toBe(1);
  expect(capturedBody).toEqual({
    word: "saving",
    meaning: "n. 存款;节省下来的钱 (或物)",
    root: "",
    relation: {
      kind: "derived",
      label: "save → saving · 派生词",
      note: "红宝书以独立 n. 词条收录，关联词族但不合并掌握度。",
      lemma: "save",
      independent: true,
      confidence: "confirmed",
    },
  });
  const region = page.getByRole("region", { name: "AI 词根拆解与助记" });
  await expect(region).toContainText("AI 助记 · 非词源考据");
  await expect(region).toContainText(GENERATED_ETYMOLOGY.breakdown);
  await expect(region).toContainText(GENERATED_ETYMOLOGY.root);
  await expect(region).toContainText("词根 · 保留、节省");
  await expect(region).toContainText("后缀 · 构成名词");
  await expect(region).toContainText(GENERATED_ETYMOLOGY.mnemonic);

  await expect.poll(async () => {
    const stored = await readStoreRecord(page, "enrichments", 59);
    return {
      sentence: stored?.sentence,
      collocations: stored?.collocations,
      promptVersion: stored?.etymology?.promptVersion,
      source: stored?.etymology?.source,
    };
  }).toEqual({
    sentence: "Regular saving can reduce financial stress.",
    collocations: ["regular saving"],
    promptVersion: "etymology-v1",
    source: "ai",
  });
  const firstInputKey = (await readStoreRecord(page, "enrichments", 59))
    ?.etymology?.inputKey;

  await page.reload();
  await waitForApp(page);
  await page.getByRole("button", { name: "显示单词释义" }).click();
  await expect(page.getByRole("heading", { name: "AI 词根拆解与助记" }))
    .toBeVisible();
  expect(requestCount).toBe(1);

  failRegeneration = true;
  await page.getByRole("button", { name: "重新生成", exact: true }).click();
  await expect(region.getByRole("alert")).toContainText("未配置云端模型");
  await expect(region).toContainText(GENERATED_ETYMOLOGY.mnemonic);
  await expect.poll(async () =>
    (await readStoreRecord(page, "enrichments", 59))?.etymology?.inputKey)
    .toBe(firstInputKey);
  expect(requestCount).toBe(2);
});

test("词根助记场景B：失效缓存、云端失败、本地关系降级与无线索静默", async ({ browser, context, page }) => {
  await blockPrivateDatasets(page);
  const staleEntry = {
    schemaVersion: 1,
    promptVersion: "etymology-v0",
    inputKey: "stale-input",
    content: {
      breakdown: "不应显示的旧拆解",
      root: "旧词根",
      affixes: [],
      mnemonic: "不应显示的旧助记",
    },
    generatedAt: "2026-08-10T08:00:00.000Z",
    source: "ai",
  };
  await page.route("**/api/etymology", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ error: "未配置云端模型，已保留本地词根与词族线索" }),
  }));
  await installStateSeed(context, createState({
    activeSession: savingSession("etymology-fallback"),
    enrichments: savingEnrichment(staleEntry),
    senseFrequency: {
      59: [{ meaning: "存款", level: "high", note: "测试缓存" }],
    },
  }));
  await openApp(page);
  await page.getByRole("button", { name: "显示单词释义" }).click();

  await expect(page.getByText("不应显示的旧拆解", { exact: true })).toHaveCount(0);
  await expect(page.getByText("save → saving · 派生词", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "生成 AI 词根拆解与助记" }).click();
  const fallbackRegion = page.getByRole("region", { name: "AI 词根拆解与助记" });
  await expect(fallbackRegion.getByRole("alert")).toContainText("未配置云端模型");
  await expect(page.getByText("AI 助记 · 非词源考据", { exact: true })).toHaveCount(0);
  await expect(page.getByText("save → saving · 派生词", { exact: true })).toBeVisible();
  await expect(page.getByText("Regular saving can reduce financial stress.", { exact: true }))
    .toBeVisible();
  const storedAfterFailure = await readStoreRecord(page, "enrichments", 59);
  expect(storedAfterFailure?.sentence).toBe("Regular saving can reduce financial stress.");
  expect(storedAfterFailure?.etymology).toBeUndefined();
  expect((await readStoreRecord(page, "settings", "current"))?.senseFrequency?.[59])
    .toEqual([{ meaning: "存款", level: "high", note: "测试缓存" }]);

  const noClueContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });
  try {
    const noCluePage = await noClueContext.newPage();
    await blockPrivateDatasets(noCluePage);
    await noCluePage.route("**/api/etymology", (route) => route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "AI 词根助记生成失败，请稍后重试" }),
    }));
    await installStateSeed(noClueContext, createState({
      activeSession: {
        ...savingSession("etymology-no-clue"),
        wordIds: [1],
      },
      enrichments: {
        1: {
          sentence: "Stars radiate energy into space.",
          translation: "恒星向太空辐射能量。",
          source: "dictionary",
        },
      },
    }));
    await openApp(noCluePage);
    await noCluePage.getByRole("button", { name: "显示单词释义" }).click();
    await noCluePage.getByRole("button", { name: "生成 AI 词根拆解与助记" }).click();
    await expect(noCluePage.getByRole("alert")).toContainText("生成失败");
    await expect(noCluePage.locator(".etymology-card")).toHaveCount(0);
    await expect(noCluePage.locator(".word-relation, .local-root-hint")).toHaveCount(0);
    await expect(noCluePage.getByText("Stars radiate energy into space.", { exact: true }))
      .toBeVisible();
  } finally {
    await noClueContext.close();
  }
});

test("词根助记场景C：键盘生成、可访问加载态、320px 与 200%/400%", async ({ context, page }) => {
  await blockPrivateDatasets(page);
  let requestCount = 0;
  let releaseResponse;
  const responseGate = new Promise((resolve) => {
    releaseResponse = resolve;
  });
  await page.route("**/api/etymology", async (route) => {
    requestCount += 1;
    await responseGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(GENERATED_ETYMOLOGY),
    });
  });
  await installStateSeed(context, createState({
    activeSession: savingSession("etymology-accessibility"),
  }));
  await page.setViewportSize({ width: 320, height: 700 });
  await openApp(page);
  await page.getByRole("button", { name: "显示单词释义" }).click();

  const generate = page.getByRole("button", { name: "生成 AI 词根拆解与助记" });
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  for (let index = 0; index < 30; index += 1) {
    if (await generate.evaluate((element) => document.activeElement === element)) break;
    await page.keyboard.press("Tab");
  }
  await expect(generate).toBeFocused();
  await page.keyboard.press("Enter");

  const region = page.getByRole("region", { name: "AI 词根拆解与助记" });
  await expect(region).toHaveAttribute("aria-busy", "true");
  await expect(region).toContainText("正在生成 AI 词根拆解与助记");
  expect(requestCount).toBe(1);
  releaseResponse();
  await expect(page.getByRole("heading", { name: "AI 词根拆解与助记" }))
    .toBeVisible();
  await expect(region).toHaveAttribute("aria-busy", "false");
  await expect(region).toContainText("词根 · 保留、节省");

  const narrowOverflow = await page.evaluate(() => ({
    documentClientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    bodyClientWidth: document.body.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  expect(narrowOverflow.documentScrollWidth)
    .toBeLessThanOrEqual(narrowOverflow.documentClientWidth + 1);
  expect(narrowOverflow.bodyScrollWidth)
    .toBeLessThanOrEqual(narrowOverflow.bodyClientWidth + 1);

  await page.setViewportSize({ width: 1280, height: 900 });
  for (const zoom of ["2", "4"]) {
    await page.evaluate((level) => {
      document.documentElement.style.zoom = level;
    }, zoom);
    await region.scrollIntoViewIfNeeded();
    await expect(page.getByRole("heading", { name: "AI 词根拆解与助记" }))
      .toBeVisible();
    await expect(region.getByText("AI 助记 · 非词源考据", { exact: true }))
      .toBeVisible();
    await expect(region.getByText(GENERATED_ETYMOLOGY.breakdown, { exact: true }))
      .toBeVisible();
    await expect(region.getByRole("button", { name: "重新生成", exact: true }))
      .toBeVisible();
    await page.evaluate(() => {
      document.documentElement.style.zoom = "1";
    });
  }
});
