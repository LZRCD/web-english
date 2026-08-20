import { expect, test } from "@playwright/test";
import { createState, RADIATE_ENRICHMENT } from "./fixtures.mjs";
import {
  installStateSeed,
  openApp,
  selectTextWithTouch,
} from "./helpers.mjs";

const SYNTHETIC_REDBOOK = {
  metadata: {
    title: "合成红宝书",
    total: 1,
    sectionCounts: { 必考词: 1, 基础词: 0, 超纲词: 0 },
  },
  words: [{
    id: 1,
    word: "radiate",
    phonetic: "/ˈreɪdieɪt/",
    meaning: "v. 散发;流露",
    sentence: "The lamp radiates a steady light.",
    translation: "这盏灯发出稳定的光。",
    section: "必考词",
    unit: 1,
  }],
};

async function openFreshApp(browser, state, contextOptions = {}) {
  const context = await browser.newContext(contextOptions);
  await installStateSeed(context, state);
  const page = await context.newPage();
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      !["127.0.0.1", "localhost"].includes(url.hostname)
      || url.pathname.startsWith("/api/")
      || ["sense-frequency", "sense-examples", "etymology"]
        .some((dataset) => url.pathname.startsWith(`/data/${dataset}/`))
    ) {
      await route.abort();
      return;
    }
    if (url.pathname === "/data/redbook.json") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(SYNTHETIC_REDBOOK),
      });
      return;
    }
    if (url.pathname === "/data/redbook-analysis.json") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          metadata: { auditedEntries: 6550, learningItemCount: 1 },
          entries: { 1: {} },
        }),
      });
      return;
    }
    await route.continue();
  });
  await openApp(page);
  return { context, page };
}

async function tabTo(page, target) {
  for (let index = 0; index < 40; index += 1) {
    if (await target.evaluate((element) => document.activeElement === element)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error("未能通过 Tab 到达目标控件");
}

async function openSearch(page) {
  const trigger = page.locator(".search-trigger");
  await expect(trigger).toHaveAccessibleName(/查词/);
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "全局查词" });
  await expect(dialog).toBeVisible();
  return { dialog, trigger };
}

test("键盘揭示释义后把焦点移交给详情锚点", async ({ browser }) => {
  const { context, page } = await openFreshApp(browser, createState());
  try {
    const reveal = page.getByRole("button", { name: "显示单词释义" });
    await tabTo(page, reveal);
    await expect(reveal).toBeFocused();
    await page.keyboard.press("Enter");

    const detail = page.locator(".study-detail");
    const speak = page.getByRole("button", { name: "播放发音", exact: true });
    await expect(detail).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName))
      .not.toBe("BODY");
    await expect.poll(async () => (
      await detail.evaluate((element) => document.activeElement === element)
      || await speak.evaluate((element) => document.activeElement === element)
    )).toBe(true);
  } finally {
    await context.close();
  }
});

test("主词的键盘焦点有未裁切的非颜色指示", async ({ browser }) => {
  const { context, page } = await openFreshApp(
    browser,
    createState(),
    { viewport: { width: 320, height: 568 } },
  );
  try {
    const reveal = page.getByRole("button", { name: "显示单词释义" });
    await tabTo(page, reveal);
    const focusStyle = await reveal.evaluate((element) => {
      const word = element.querySelector("h1");
      const card = element.closest(".word-card");
      if (!word || !card) throw new Error("主词焦点节点不完整");
      const style = getComputedStyle(word);
      const wordRect = word.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const extent = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
      return {
        focusVisible: element.matches(":focus-visible"),
        outlineStyle: style.outlineStyle,
        outlineWidth: parseFloat(style.outlineWidth),
        unclipped:
          wordRect.left - extent >= cardRect.left
          && wordRect.right + extent <= cardRect.right
          && wordRect.top - extent >= cardRect.top
          && wordRect.bottom + extent <= cardRect.bottom,
      };
    });
    expect(focusStyle.focusVisible).toBe(true);
    expect(focusStyle.outlineStyle).not.toBe("none");
    expect(focusStyle.outlineWidth).toBeGreaterThanOrEqual(2);
    expect(focusStyle.unclipped).toBe(true);
  } finally {
    await context.close();
  }
});

test("全局查词按 Escape 关闭后恢复原触发器", async ({ browser }) => {
  const { context, page } = await openFreshApp(browser, createState());
  try {
    const { dialog, trigger } = await openSearch(page);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  } finally {
    await context.close();
  }
});

test("全局查词由关闭按钮关闭后恢复原触发器", async ({ browser }) => {
  const { context, page } = await openFreshApp(browser, createState());
  try {
    const { dialog, trigger } = await openSearch(page);
    await dialog.getByRole("button", { name: "关闭查词" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  } finally {
    await context.close();
  }
});

test("全局查词由背景关闭后恢复原触发器", async ({ browser }) => {
  const { context, page } = await openFreshApp(browser, createState());
  try {
    const { dialog, trigger } = await openSearch(page);
    await page.locator(".search-backdrop").click({ position: { x: 5, y: 5 } });
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  } finally {
    await context.close();
  }
});

test("全局查词保持模态语义、可访问名称与 Tab trap", async ({ browser }) => {
  const { context, page } = await openFreshApp(browser, createState());
  try {
    const { dialog } = await openSearch(page);
    const input = dialog.getByRole("textbox", { name: "搜索红宝书词库" });
    const close = dialog.getByRole("button", { name: "关闭查词" });
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(dialog).toHaveAccessibleName("全局查词");
    await expect(close).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(input).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
  } finally {
    await context.close();
  }
});

test("AI 教练关闭后恢复原入口焦点", async ({ browser }) => {
  const { context, page } = await openFreshApp(browser, createState());
  try {
    const trigger = page.getByRole("button", { name: "打开 AI 记忆教练" });
    await trigger.click();
    const coach = page.getByRole("complementary", { name: "AI 记忆教练" });
    await expect(coach).toHaveClass(/open/);
    await coach.getByRole("button", { name: "关闭 AI 教练" }).click();
    await expect(page.locator(".coach-panel")).not.toHaveClass(/open/);
    await expect(trigger).toBeFocused();
  } finally {
    await context.close();
  }
});

test("触屏划词 Escape 关闭后恢复播放发音焦点", async ({ browser }) => {
  const { context, page } = await openFreshApp(
    browser,
    createState({ enrichments: RADIATE_ENRICHMENT }),
    { viewport: { width: 390, height: 844 } },
  );
  try {
    await page.getByRole("button", { name: "显示单词释义" }).click();
    const detailWord = page.getByRole("button", {
      name: "播放发音",
      exact: true,
    });
    await expect(detailWord).toBeFocused();
    await selectTextWithTouch(
      page.getByText("Stars radiate energy into space.", { exact: true }),
      "radiate",
    );
    const popup = page.getByRole("dialog", { name: "划词查询：radiate" });
    await expect(popup).toHaveAttribute("aria-modal", "true");
    await expect(popup.getByRole("button", { name: "关闭划词查询" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(popup).toHaveCount(0);
    await expect(detailWord).toBeFocused();
  } finally {
    await context.close();
  }
});
