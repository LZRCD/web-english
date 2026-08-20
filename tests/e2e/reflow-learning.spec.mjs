import { expect, test } from "@playwright/test";
import { createState, RADIATE_ENRICHMENT } from "./fixtures.mjs";
import { installStateSeed, openApp } from "./helpers.mjs";

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

const REFLOW_CASES = [
  { zoom: "200%", viewport: { width: 720, height: 450 } },
  { zoom: "400%", viewport: { width: 360, height: 225 } },
];

async function openFreshCase(browser, viewport) {
  const context = await browser.newContext({ viewport });
  await installStateSeed(
    context,
    createState({ enrichments: RADIATE_ENRICHMENT }),
  );
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

async function finishAnimations(locator) {
  await locator.evaluate(async (element) => {
    await Promise.all(element.getAnimations({ subtree: true }).map(
      (animation) => animation.finished.catch(() => undefined),
    ));
  });
}

async function reflowGeometry(page, mode) {
  return page.evaluate((currentMode) => {
    const learnView = document.querySelector(".learn-view");
    const stack = document.querySelector(".study-main-stack");
    const core = document.querySelector(
      currentMode === "detail" ? ".detail-word" : ".word-face h1",
    );
    const meaning = document.querySelector(".study-detail .meaning-sense");
    const revealHint = document.querySelector(".word-face span");
    const rating = document.querySelector(".rating-bar.visible");
    if (!learnView || !stack || !core) throw new Error("高缩放学习节点不完整");

    const scrollport = learnView.getBoundingClientRect();
    const box = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const intersection = {
        left: Math.max(0, rect.left),
        top: Math.max(0, rect.top),
        right: Math.min(innerWidth, rect.right),
        bottom: Math.min(innerHeight, rect.bottom),
      };
      const scrollportIntersection = {
        left: Math.max(0, scrollport.left, rect.left),
        top: Math.max(0, scrollport.top, rect.top),
        right: Math.min(innerWidth, scrollport.right, rect.right),
        bottom: Math.min(innerHeight, scrollport.bottom, rect.bottom),
      };
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        intersectionWidth: Math.max(0, intersection.right - intersection.left),
        intersectionHeight: Math.max(0, intersection.bottom - intersection.top),
        scrollportIntersectionWidth: Math.max(
          0,
          scrollportIntersection.right - scrollportIntersection.left,
        ),
        scrollportIntersectionHeight: Math.max(
          0,
          scrollportIntersection.bottom - scrollportIntersection.top,
        ),
      };
    };
    const metrics = (element) => ({
      ...box(element),
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
      overflowY: getComputedStyle(element).overflowY,
    });
    return {
      viewport: { width: innerWidth, height: innerHeight },
      document: {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      },
      body: {
        clientWidth: document.body.clientWidth,
        scrollWidth: document.body.scrollWidth,
      },
      learnView: metrics(learnView),
      stack: metrics(stack),
      core: box(core),
      meaning: box(meaning),
      revealHint: box(revealHint),
      rating: box(rating),
      ratingButtons: rating
        ? [...rating.querySelectorAll("button")].map((button) => box(button))
        : [],
      coreFontSize: Number.parseFloat(getComputedStyle(core).fontSize),
      meaningFontSize: meaning
        ? Number.parseFloat(getComputedStyle(meaning).fontSize)
        : null,
      ratingPosition: rating ? getComputedStyle(rating).position : null,
      ratingBottom: rating ? getComputedStyle(rating).bottom : null,
    };
  }, mode);
}

function expectFullyInViewport(box, label) {
  expect(box, `${label} 存在`).not.toBeNull();
  expect(box.intersectionWidth, `${label} 水平完整可见`)
    .toBeGreaterThanOrEqual(box.width - 1);
  expect(box.intersectionHeight, `${label} 垂直完整可见`)
    .toBeGreaterThanOrEqual(box.height - 1);
  expect(box.scrollportIntersectionWidth, `${label} 在主滚动窗内水平完整可见`)
    .toBeGreaterThanOrEqual(box.width - 1);
  expect(box.scrollportIntersectionHeight, `${label} 在主滚动窗内垂直完整可见`)
    .toBeGreaterThanOrEqual(box.height - 1);
}

function expectNaturalReflow(geometry, label) {
  expect(geometry.learnView.overflowY, `${label} 主滚动源`).toBe("auto");
  expect(geometry.learnView.scrollHeight, `${label} 主滚动范围`)
    .toBeGreaterThan(geometry.learnView.clientHeight);
  expect(geometry.stack.overflowY, `${label} 内层不形成第二滚动源`).toBe("visible");
  expect(geometry.stack.scrollHeight, `${label} 内层内容完整展开`)
    .toBeLessThanOrEqual(geometry.stack.clientHeight + 1);
  expect(geometry.stack.clientHeight, `${label} 主学习区不得塌缩为窄条`)
    .toBeGreaterThan(200);
  expect(geometry.document.scrollWidth, `${label} document 横向溢出`)
    .toBeLessThanOrEqual(geometry.document.clientWidth + 1);
  expect(geometry.body.scrollWidth, `${label} body 横向溢出`)
    .toBeLessThanOrEqual(geometry.body.clientWidth + 1);
}

for (const reflowCase of REFLOW_CASES) {
  test(`${reflowCase.zoom} 未揭示词面与揭示入口完整可达`, async ({ browser }) => {
    const { context, page } = await openFreshCase(browser, reflowCase.viewport);
    try {
      const reveal = page.getByRole("button", { name: "显示单词释义", exact: true });
      await expect(reveal).toBeEnabled();
      await finishAnimations(page.locator(".word-card"));

      const word = page.locator(".word-face h1");
      await word.scrollIntoViewIfNeeded();
      const wordGeometry = await reflowGeometry(page, "unrevealed");
      expectNaturalReflow(wordGeometry, `${reflowCase.zoom} 未揭示`);
      expectFullyInViewport(wordGeometry.core, `${reflowCase.zoom} 主词`);
      expect(wordGeometry.coreFontSize, `${reflowCase.zoom} 主词字号`)
        .toBeGreaterThanOrEqual(44);

      const revealHint = page.locator(".word-face span");
      await revealHint.scrollIntoViewIfNeeded();
      const hintGeometry = await reflowGeometry(page, "unrevealed");
      expectFullyInViewport(hintGeometry.revealHint, `${reflowCase.zoom} 揭示入口提示`);

      await reveal.focus();
      await expect(reveal).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.locator(".study-detail")).toBeVisible();
      await expect(page.getByRole("button", { name: "播放发音", exact: true }))
        .toBeFocused();
    } finally {
      await context.close();
    }
  });

  test(`${reflowCase.zoom} 详情与评分栏保持完整自然流`, async ({ browser }) => {
    const { context, page } = await openFreshCase(browser, reflowCase.viewport);
    try {
      const reveal = page.getByRole("button", { name: "显示单词释义", exact: true });
      await reveal.focus();
      await expect(reveal).toBeFocused();
      await page.keyboard.press("Enter");

      const detail = page.locator(".study-detail");
      const speak = page.getByRole("button", { name: "播放发音", exact: true });
      await expect(detail).toBeVisible();
      await expect(speak).toBeFocused();
      await finishAnimations(detail);

      const detailWord = page.locator(".detail-word");
      await detailWord.scrollIntoViewIfNeeded();
      const wordGeometry = await reflowGeometry(page, "detail");
      expectNaturalReflow(wordGeometry, `${reflowCase.zoom} 详情`);
      expectFullyInViewport(wordGeometry.core, `${reflowCase.zoom} 详情主词`);
      expect(wordGeometry.coreFontSize, `${reflowCase.zoom} 详情主词字号`)
        .toBeGreaterThanOrEqual(40);
      expect(wordGeometry.meaningFontSize, `${reflowCase.zoom} 义项字号`)
        .toBeGreaterThanOrEqual(17);
      expect(wordGeometry.ratingPosition).toBe("sticky");
      expect(wordGeometry.ratingBottom, `${reflowCase.zoom} 评分栏参与自然流`).toBe("auto");
      expect(wordGeometry.rating.top, `${reflowCase.zoom} 评分栏不覆盖详情正文`)
        .toBeGreaterThanOrEqual(wordGeometry.stack.bottom - 1);

      const meaning = page.locator(".study-detail .meaning-sense").first();
      await meaning.scrollIntoViewIfNeeded();
      await expect(meaning).toBeVisible();
      const meaningGeometry = await reflowGeometry(page, "detail");
      expectFullyInViewport(meaningGeometry.meaning, `${reflowCase.zoom} 义项`);

      const rating = page.locator(".rating-bar.visible");
      await rating.scrollIntoViewIfNeeded();
      const ratingButtons = rating.getByRole("button");
      await expect(ratingButtons).toHaveCount(4);
      for (let index = 0; index < 4; index += 1) {
        const button = ratingButtons.nth(index);
        await button.scrollIntoViewIfNeeded();
        await button.focus();
        await expect(button).toBeFocused();
        const ratingGeometry = await reflowGeometry(page, "detail");
        expectFullyInViewport(
          ratingGeometry.ratingButtons[index],
          `${reflowCase.zoom} 评分按钮 ${index + 1}`,
        );
      }
    } finally {
      await context.close();
    }
  });
}
