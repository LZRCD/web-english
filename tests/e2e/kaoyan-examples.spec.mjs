import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { createState, DATABASE_NAME } from "./fixtures.mjs";
import {
  installStateSeed,
  openApp,
  selectText,
} from "./helpers.mjs";

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function example(overrides) {
  return {
    id: "0123456789abcdef01234567",
    wordId: 1,
    word: "radiate",
    matchedText: "radiate",
    sentence: "Careful stars radiate energy while patient researchers compare reliable evidence.",
    year: 2024,
    paperType: "english-one",
    paperId: "2024-english-one",
    section: "reading",
    sourceUrl: "https://english-exam.lazynote.cn/kaoyan/paper/2024-english-one/",
    ...overrides,
  };
}

function makeRelease(shards) {
  const releaseFiles = {};
  const shardHashes = {};
  const shardBytes = {};
  const shardBodies = {};
  let exampleCount = 0;
  let coveredWordCount = 0;
  for (const [prefix, examplesByWordId] of Object.entries(shards)) {
    const body = stableJson({ schemaVersion: 1, prefix, examplesByWordId });
    const hash = sha256(body);
    const filename = `${prefix}.${hash.slice(0, 16)}.json`;
    releaseFiles[prefix] = filename;
    shardHashes[prefix] = hash;
    shardBytes[prefix] = Buffer.byteLength(body);
    shardBodies[filename] = body;
    coveredWordCount += Object.keys(examplesByWordId).length;
    exampleCount += Object.values(examplesByWordId).flat().length;
  }
  const manifestCore = {
    schemaVersion: 1,
    corpusSource: "https://english-exam.lazynote.cn/kaoyan/",
    corpusFetchedAt: "2026-08-11T21:06:46+08:00",
    corpusManifestSha256: "0f89e538bb57699188b0d4224c59a84f20b01b2402bf6ab2a27118dadec6c373",
    sourceFiles: [{
      paperId: "2024-english-one",
      sha256: "1".repeat(64),
      bytes: 1234,
    }],
    releaseFiles,
    shardHashes,
    shardBytes,
    paperCount: 1,
    sourceSentenceCount: exampleCount,
    exampleCount,
    coveredWordCount,
    uncoveredWordCount: 6550 - coveredWordCount,
    statistics: {
      candidateSentenceCount: exampleCount,
      validSentenceCount: exampleCount,
      filteredReasons: {},
      byPaperType: {},
      byYear: {},
    },
  };
  manifestCore.statistics.byPaperType = Object.values(shards).flatMap((items) =>
    Object.values(items).flat()).reduce((counts, item) => ({
    ...counts,
    [item.paperType ?? "english-one"]: (counts[item.paperType ?? "english-one"] ?? 0) + 1,
  }), {});
  manifestCore.statistics.byYear = Object.values(shards).flatMap((items) =>
    Object.values(items).flat()).reduce((counts, item) => ({
    ...counts,
    [String(item.year ?? 2024)]: (counts[String(item.year ?? 2024)] ?? 0) + 1,
  }), {});
  const manifest = {
    schemaVersion: 1,
    contentVersion: sha256(JSON.stringify(manifestCore)).slice(0, 16),
    ...Object.fromEntries(Object.entries(manifestCore).filter(([key]) => key !== "schemaVersion")),
  };
  return { manifest, shardBodies };
}

async function routeRelease(page, release, options = {}) {
  const counts = { manifest: 0, shards: {} };
  await page.route("**/data/kaoyan-examples/manifest.json", async (route) => {
    counts.manifest += 1;
    if (options.manifestStatus) {
      await route.fulfill({ status: options.manifestStatus, body: "missing" });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: stableJson(release.manifest),
    });
  });
  await page.route("**/data/kaoyan-examples/*.json", async (route) => {
    const name = new URL(route.request().url()).pathname.split("/").at(-1);
    if (name === "manifest.json") {
      await route.fallback();
      return;
    }
    counts.shards[name] = (counts.shards[name] ?? 0) + 1;
    if (options.onShard) {
      const handled = await options.onShard({ route, name, body: release.shardBodies[name] });
      if (handled) return;
    }
    const body = release.shardBodies[name];
    await route.fulfill({
      status: body ? 200 : 404,
      contentType: "application/json",
      body: body ?? "missing",
    });
  });
  return counts;
}

async function readLearningSnapshot(page) {
  return page.evaluate((databaseName) => new Promise((resolve, reject) => {
    const open = indexedDB.open(databaseName);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      const transaction = database.transaction("state-domains", "readonly");
      const store = transaction.objectStore("state-domains");
      const keys = [
        "reviews",
        "quiz-attempts",
        "word-progress",
        "fsrs-cards",
        "active-session",
        "active-quiz",
      ];
      const values = {};
      let remaining = keys.length;
      for (const key of keys) {
        const request = store.get(key);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          values[key] = structuredClone(request.result?.value ?? null);
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

const radiateExamples = [
  example({
    id: "111111111111111111111111",
    year: 2026,
    paperId: "2026-english-one",
    sourceUrl: "https://english-exam.lazynote.cn/kaoyan/paper/2026-english-one/",
  }),
  example({
    id: "222222222222222222222222",
    sentence: "Older passages show how public institutions radiate influence across changing communities.",
    year: 2008,
    paperType: "old",
    paperId: "2008",
    section: "translation",
    sourceUrl: "https://english-exam.lazynote.cn/kaoyan/paper/2008/",
  }),
  example({
    id: "333333333333333333333333",
    sentence: "Modern networks radiate information when readers evaluate each unfamiliar connection.",
    year: 2025,
    paperType: "english-two",
    paperId: "2025-english-two",
    section: "new-type",
    sourceUrl: "https://english-exam.lazynote.cn/kaoyan/paper/2025-english-two/",
  }),
];

test("真题例句 A：按需单 shard、真实标签/链接、划词、零学习写入与响应式", async ({ context, page }) => {
  const release = makeRelease({ r: { 1: radiateExamples } });
  const counts = await routeRelease(page, release);
  let aiRequests = 0;
  await page.route("**/api/**", async (route) => {
    aiRequests += 1;
    await route.abort();
  });
  await installStateSeed(context, createState());
  await page.setViewportSize({ width: 320, height: 720 });
  await openApp(page);
  const before = await readLearningSnapshot(page);

  await page.getByRole("button", { name: "显示单词释义" }).click();
  const region = page.getByRole("region", { name: "考研真题原句" });
  await expect(region).toBeVisible();
  const displayOrder = await region.evaluate((node) => {
    const existingExample = document.querySelector(".context-block");
    const otherEnhancement = document.querySelector(".etymology-card, .etymology-generate");
    const follows = (candidate) => Boolean(
      candidate && (node.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING),
    );
    return {
      existingExampleFollows: follows(existingExample),
      otherEnhancementFollows: follows(otherEnhancement),
      enhancementFollowsExisting: Boolean(
        existingExample
        && otherEnhancement
        && (existingExample.compareDocumentPosition(otherEnhancement)
          & Node.DOCUMENT_POSITION_FOLLOWING),
      ),
    };
  });
  expect(displayOrder).toEqual({
    existingExampleFollows: true,
    otherEnhancementFollows: true,
    enhancementFollowsExisting: true,
  });
  await expect(region).toContainText("2026 · 英语一");
  await expect(region).toContainText("2008 · 旧卷");
  await expect(region).toContainText("2025 · 英语二");
  await expect(region).toContainText("阅读");
  await expect(region).toContainText("新题型");
  await expect(region).toContainText("翻译");
  await expect(region).toContainText("真题版权归相关考试主管机构；本站仅用于个人学习，来源页用于核对。");
  const firstLink = region.getByRole("link", { name: "来源页：懒笔记整理" }).first();
  await expect(firstLink).toHaveAttribute("href", radiateExamples[0].sourceUrl);
  await expect(firstLink).toHaveAttribute("target", "_blank");
  await expect(firstLink).toHaveAttribute("rel", "noopener noreferrer");
  await firstLink.focus();
  await expect(firstLink).toBeFocused();

  const sentence = region.getByText(radiateExamples[0].sentence, { exact: true });
  await selectText(sentence, "researchers");
  await expect(page.getByRole("dialog", { name: "划词查询：researchers" })).toBeVisible();
  expect(counts.manifest).toBe(1);
  expect(Object.values(counts.shards)).toEqual([1]);
  expect(aiRequests).toBe(0);
  expect(await readLearningSnapshot(page)).toEqual(before);
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 1280, height: 900 });
  for (const zoom of ["2", "4"]) {
    await page.evaluate((level) => { document.documentElement.style.zoom = level; }, zoom);
    await region.scrollIntoViewIfNeeded();
    await expect(region.getByRole("link", { name: "来源页：懒笔记整理" }).first()).toBeVisible();
    await expect(region.getByText(radiateExamples[0].sentence, { exact: true })).toBeVisible();
    await page.evaluate(() => { document.documentElement.style.zoom = "1"; });
  }
});

test("真题例句 B：切词不串旧异步结果，同 manifest/shard 复用缓存", async ({ context, page }) => {
  const pioneer = example({
    id: "444444444444444444444444",
    wordId: 1857,
    word: "pioneer",
    matchedText: "pioneer",
    sentence: "A patient pioneer can connect reliable evidence with practical innovation.",
  });
  const release = makeRelease({ r: { 1: radiateExamples }, p: { 1857: [pioneer] } });
  let releaseRadiate;
  const radiateGate = new Promise((resolve) => { releaseRadiate = resolve; });
  const counts = await routeRelease(page, release, {
    async onShard({ route, name, body }) {
      if (!name.startsWith("r.")) return false;
      await radiateGate;
      await route.fulfill({ status: 200, contentType: "application/json", body });
      return true;
    },
  });
  await installStateSeed(context, createState());
  await openApp(page);
  await page.getByRole("button", { name: "显示单词释义" }).click();
  await page.getByRole("combobox", { name: "选择红宝书词汇分组" }).selectOption({ label: "基础词" });
  await expect(page.getByRole("heading", { name: "pioneer" })).toBeVisible();
  await page.getByRole("button", { name: "显示单词释义" }).click();
  const region = page.getByRole("region", { name: "考研真题原句" });
  await expect(region).toContainText(pioneer.sentence);
  releaseRadiate();
  await expect(region).not.toContainText(radiateExamples[0].sentence);
  await expect(region).toContainText(pioneer.sentence);
  expect(counts.manifest).toBe(1);
  expect(Object.values(counts.shards).sort()).toEqual([1, 1]);
});

test("真题例句 C：manifest/shard 缺失、篡改或结构非法时静默空态且主链可用", async ({ browser, context, page }) => {
  const release = makeRelease({ r: { 1: radiateExamples } });
  await routeRelease(page, release, { manifestStatus: 404 });
  await installStateSeed(context, createState());
  await openApp(page);
  await page.getByRole("button", { name: "显示单词释义" }).click();
  await expect(page.getByRole("region", { name: "考研真题原句" })).toHaveCount(0);
  await expect(page.locator(".meaning-main")).toContainText("散发");

  for (const mode of ["hash", "structure"]) {
    const invalidContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
    try {
      const invalidPage = await invalidContext.newPage();
      const invalidRelease = mode === "structure"
        ? makeRelease({ r: { 1: [{ bad: true }] } })
        : release;
      await routeRelease(invalidPage, invalidRelease, {
        async onShard({ route }) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: mode === "hash"
              ? "{}\n"
              : Object.values(invalidRelease.shardBodies)[0],
          });
          return true;
        },
      });
      await installStateSeed(invalidContext, createState());
      await openApp(invalidPage);
      await invalidPage.getByRole("button", { name: "显示单词释义" }).click();
      await expect(invalidPage.getByRole("region", { name: "考研真题原句" })).toHaveCount(0);
      await expect(invalidPage.getByRole("button", { name: "将 radiate 加入词本" })).toBeEnabled();
      await expect(invalidPage.getByText(/模型失败|AI 失败/)).toHaveCount(0);
    } finally {
      await invalidContext.close();
    }
  }
});
