import { test, expect } from "@playwright/test";
import { createState } from "./fixtures.mjs";
import {
  installStateSeed,
  openApp,
  readStoreCount,
  readStoreRecord,
} from "./helpers.mjs";

const REDBOOK = {
  metadata: {
    title: "合成红宝书",
    total: 3,
    sectionCounts: { "必考词": 3, "基础词": 0, "超纲词": 0 },
  },
  words: [
    {
      id: 1,
      word: "radiate",
      phonetic: "/ˈreɪdieɪt/",
      meaning: "v. 辐射；散发",
      section: "必考词",
      unit: 1,
    },
    {
      id: 2,
      word: "objective",
      phonetic: "/əbˈdʒektɪv/",
      meaning: "n. 目标；adj. 客观的",
      section: "必考词",
      unit: 1,
    },
    {
      id: 3,
      word: "concise",
      phonetic: "/kənˈsaɪs/",
      meaning: "adj. 简明的",
      section: "必考词",
      unit: 1,
    },
  ],
};

const ANALYSIS = {
  metadata: { auditedEntries: 6550, learningItemCount: 3 },
  entries: {},
};

function localDateKey(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function auditState(activeSession) {
  const now = new Date();
  const reviewedAt = new Date(now.getTime() - 2 * 86_400_000).toISOString();
  const dueAt = new Date(new Date(reviewedAt).getTime() + 600_000).toISOString();
  return createState({
    activeSession,
    reviews: [{
      id: "wl-aud-008-review",
      wordId: 2,
      word: "objective",
      rating: 0,
      kind: "new",
      intervalMs: 600_000,
      dueAt,
      reviewedAt,
      recallMs: 21_000,
      section: "必考词",
      unit: 1,
    }],
    wordProgress: {},
    lookupWords: [{
      id: 9_000_000_002,
      linkedWordId: 2,
      query: "objective",
      kind: "word",
      phonetic: "/əbˈdʒektɪv/",
      part: "n.",
      meaning: "目标",
      note: "",
      source: "redbook",
      addedAt: reviewedAt,
    }],
    lookupStats: {
      objective: { count: 5, firstAt: reviewedAt, lastAt: reviewedAt },
    },
  });
}

async function installSyntheticData(page) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/data/redbook.json") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(REDBOOK),
      });
      return;
    }
    if (url.pathname === "/data/redbook-analysis.json") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(ANALYSIS),
      });
      return;
    }
    if (
      url.pathname.startsWith("/api/")
      || /^\/data\/(sense-frequency|sense-examples|etymology)\//.test(url.pathname)
      || !["127.0.0.1", "localhost"].includes(url.hostname)
    ) {
      await route.abort();
      return;
    }
    await route.continue();
  });
}

async function storedSession(page) {
  return (await readStoreRecord(page, "settings", "current"))?.activeSession;
}

test("未完成会话需明确确认，取消或 Escape 保留原进度", async ({ context, page }) => {
  const oldSession = {
    id: "search:wl-aud-008:old",
    kind: "search",
    title: "搜索专项学习",
    wordIds: [1, 2, 3],
    index: 1,
    createdAt: new Date().toISOString(),
  };
  await installStateSeed(context, auditState(oldSession), {
    "wordloop-last-auto-backup": localDateKey(),
  });
  await installSyntheticData(page);
  await openApp(page);

  await expect(page.locator(".learn-topbar .topbar-title"))
    .toHaveText("搜索专项学习 · 1/3");
  const reviewBefore = await readStoreRecord(page, "reviews", "wl-aud-008-review");
  await page.getByRole("button", { name: "显示单词释义" }).click();
  const trigger = page.getByRole("button", { name: "开始一词补漏" });
  await expect(trigger).toBeVisible();

  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "切换到一词补漏" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog).toContainText("旧会话不会自动保留");
  await expect(dialog.getByRole("button", { name: "保留当前会话" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect.poll(() => storedSession(page)).toEqual(oldSession);

  await trigger.click();
  await dialog.getByRole("button", { name: "保留当前会话" }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => storedSession(page)).toEqual(oldSession);

  await trigger.click();
  await expect(dialog).toBeVisible();
  await page.locator(".search-backdrop").click({ position: { x: 5, y: 5 } });
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect.poll(() => storedSession(page)).toEqual(oldSession);
  expect(await readStoreCount(page, "reviews")).toBe(1);
  expect(await readStoreRecord(page, "reviews", "wl-aud-008-review"))
    .toEqual(reviewBefore);
});

test("确认后才切换为一词补漏，评分历史与刷新状态一致", async ({ context, page }) => {
  const oldSession = {
    id: "search:wl-aud-008:replace",
    kind: "search",
    title: "搜索专项学习",
    wordIds: [1, 2, 3],
    index: 1,
    createdAt: new Date().toISOString(),
  };
  await installStateSeed(context, auditState(oldSession), {
    "wordloop-last-auto-backup": localDateKey(),
  });
  await installSyntheticData(page);
  await openApp(page);

  const reviewBefore = await readStoreRecord(page, "reviews", "wl-aud-008-review");
  await page.getByRole("button", { name: "显示单词释义" }).click();
  await page.getByRole("button", { name: "开始一词补漏" }).click();
  const dialog = page.getByRole("dialog", { name: "切换到一词补漏" });
  await dialog.getByRole("button", { name: "切换并开始一词补漏" }).click();

  await expect(page.locator(".learn-topbar .topbar-title"))
    .toHaveText("今日任务 · 补漏 · 0/1");
  await expect.poll(() => storedSession(page)).toMatchObject({
    kind: "today",
    title: "今日任务 · 补漏",
    wordIds: [2],
    index: 0,
  });
  expect(await readStoreRecord(page, "reviews", "wl-aud-008-review"))
    .toEqual(reviewBefore);

  const replacement = await storedSession(page);
  await page.reload();
  await expect(page.getByRole("button", { name: "显示单词释义" })).toBeEnabled();
  await expect(page.locator(".learn-topbar .topbar-title"))
    .toHaveText("今日任务 · 补漏 · 0/1");
  await expect.poll(() => storedSession(page)).toEqual(replacement);
  expect(await readStoreCount(page, "reviews")).toBe(1);
  expect(await readStoreRecord(page, "reviews", "wl-aud-008-review"))
    .toEqual(reviewBefore);
});

test("已在今日会话时去重保留原队列与 current index", async ({ context, page }) => {
  const todaySession = {
    id: "today:wl-aud-008:keep",
    kind: "today",
    title: "今日任务",
    wordIds: [1, 2, 3],
    index: 1,
    createdAt: new Date().toISOString(),
  };
  await installStateSeed(context, auditState(todaySession), {
    "wordloop-last-auto-backup": localDateKey(),
  });
  await installSyntheticData(page);
  await openApp(page);

  await page.getByRole("button", { name: "显示单词释义" }).click();
  await page.getByRole("button", { name: "当前词已在今日任务" }).click();
  await expect(page.getByRole("status")).toContainText("未重复加入");
  await expect.poll(() => storedSession(page)).toEqual(todaySession);

  await page.reload();
  await expect(page.getByRole("button", { name: "显示单词释义" })).toBeEnabled();
  await expect.poll(() => storedSession(page)).toEqual(todaySession);
  expect(await readStoreCount(page, "reviews")).toBe(1);
});
