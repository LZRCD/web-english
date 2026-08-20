import { expect, test } from "@playwright/test";
import { createState, RADIATE_ENRICHMENT } from "./fixtures.mjs";
import { blockPrivateDatasets, installStateSeed, openApp } from "./helpers.mjs";

async function isolateNetwork(page) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") {
      await route.abort();
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      await route.abort();
      return;
    }
    await route.continue();
  });
}

async function waitForDetailLayout(page) {
  await expect(page.locator(".learn-view")).toHaveClass(/detail-mode/);
  await page.locator(".study-detail").evaluate(async (element) => {
    await Promise.all(element.getAnimations({ subtree: true }).map(
      (animation) => animation.finished.catch(() => undefined),
    ));
  });
}

async function detailGeometry(page) {
  return page.evaluate(() => {
    const learnView = document.querySelector(".learn-view");
    const stack = document.querySelector(".study-main-stack");
    const learningContext = document.querySelector(".learning-context");
    const detail = document.querySelector(".study-detail");
    const meaning = document.querySelector(".study-detail .meaning-main");
    const rating = document.querySelector(".rating-bar.visible");
    const word = document.querySelector(".detail-word");
    if (!learnView || !stack || !learningContext || !detail || !meaning || !rating || !word) {
      throw new Error("Study Detail 几何节点不完整");
    }

    const rect = (element) => {
      const box = element.getBoundingClientRect();
      return {
        left: box.left,
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
      };
    };
    const clippedRect = (element, clip) => {
      const elementBox = rect(element);
      const clipBox = rect(clip);
      return {
        left: Math.max(elementBox.left, clipBox.left),
        top: Math.max(elementBox.top, clipBox.top),
        right: Math.min(elementBox.right, clipBox.right),
        bottom: Math.min(elementBox.bottom, clipBox.bottom),
      };
    };
    const visibleChildren = [...detail.children]
      .filter((element) => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return style.display !== "none" && box.height > 0;
      });
    const lastContent = visibleChildren.at(-1);
    const learnStyle = getComputedStyle(learnView);
    const stackStyle = getComputedStyle(stack);
    const ratingSmall = rating.querySelector("small");
    return {
      viewport: { width: innerWidth, height: innerHeight },
      learnView: {
        ...rect(learnView),
        clientHeight: learnView.clientHeight,
        scrollHeight: learnView.scrollHeight,
        scrollTop: learnView.scrollTop,
        overflowY: learnStyle.overflowY,
      },
      stack: {
        ...rect(stack),
        clientHeight: stack.clientHeight,
        scrollHeight: stack.scrollHeight,
        scrollTop: stack.scrollTop,
        overflowY: stackStyle.overflowY,
      },
      detail: rect(detail),
      word: rect(word),
      meaning: clippedRect(meaning, stack),
      rating: rect(rating),
      lastContent: lastContent ? clippedRect(lastContent, stack) : null,
      ratingDescriptionSize: ratingSmall
        ? Number.parseFloat(getComputedStyle(ratingSmall).fontSize)
        : 0,
      documentWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
    };
  });
}

function intersects(first, second) {
  return first.left < second.right - 1
    && second.left < first.right - 1
    && first.top < second.bottom - 1
    && second.top < first.bottom - 1;
}

test("Study Detail 评分栏在目标视口不遮挡正文且保持单一滚动源", async ({ context, page }) => {
  await isolateNetwork(page);
  await blockPrivateDatasets(page);
  await installStateSeed(context, createState({ enrichments: RADIATE_ENRICHMENT }));

  for (const viewport of [
    { width: 320, height: 640 },
    { width: 390, height: 844 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await openApp(page);
    await page.getByRole("button", { name: "显示单词释义" }).click();
    await waitForDetailLayout(page);

    const initial = await detailGeometry(page);
    expect.soft(initial.learnView.overflowY, `${viewport.width}px 外层不得滚动`).toBe("hidden");
    expect.soft(initial.learnView.scrollHeight, `${viewport.width}px 外层不得形成第二滚动源`)
      .toBeLessThanOrEqual(initial.learnView.clientHeight + 1);
    expect.soft(initial.stack.overflowY, `${viewport.width}px 主滚动源`).toBe("auto");
    expect.soft(initial.stack.scrollHeight, `${viewport.width}px 正文应可滚动`)
      .toBeGreaterThan(initial.stack.clientHeight);
    expect.soft(initial.stack.clientHeight, `${viewport.width}px 主学习区高度`)
      .toBeGreaterThanOrEqual(viewport.width === 320 ? 120 : 200);
    expect.soft(initial.meaning.bottom - initial.meaning.top, `${viewport.width}px 首屏不只剩标题`)
      .toBeGreaterThan(0);
    expect.soft(intersects(initial.meaning, initial.rating), `${viewport.width}px 首义项被评分栏遮挡`)
      .toBe(false);
    expect.soft(initial.ratingDescriptionSize, `${viewport.width}px 评分依据字号`)
      .toBeGreaterThanOrEqual(11);
    expect.soft(initial.documentScrollWidth, `${viewport.width}px document 横溢`)
      .toBeLessThanOrEqual(initial.documentWidth + 1);
    expect.soft(initial.bodyScrollWidth, `${viewport.width}px body 横溢`)
      .toBeLessThanOrEqual(initial.documentWidth + 1);

    for (const selector of [
      ".study-detail .detail-word",
      ".study-detail .meaning-sense",
      ".study-detail .context-sentence",
    ]) {
      const content = page.locator(selector).first();
      await content.scrollIntoViewIfNeeded();
      await expect(content, `${viewport.width}px ${selector} 可达`).toBeVisible();
      const contentRect = await content.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const clip = document.querySelector(".study-main-stack")?.getBoundingClientRect();
        if (!clip) throw new Error("缺少正文滚动区");
        return {
          left: Math.max(box.left, clip.left),
          top: Math.max(box.top, clip.top),
          right: Math.min(box.right, clip.right),
          bottom: Math.min(box.bottom, clip.bottom),
        };
      });
      expect(intersects(contentRect, initial.rating), `${viewport.width}px ${selector} 被评分栏遮挡`)
        .toBe(false);
    }

    const buttons = page.locator(".rating-bar button");
    await expect(buttons).toHaveCount(4);
    for (let index = 0; index < 4; index += 1) {
      const button = buttons.nth(index);
      await button.focus();
      await expect(button).toBeFocused();
      const target = await button.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return {
          left: box.left,
          top: box.top,
          right: box.right,
          bottom: box.bottom,
          width: box.width,
          height: box.height,
        };
      });
      expect(target.width, `${viewport.width}px 第 ${index + 1} 档触控宽度`)
        .toBeGreaterThanOrEqual(44);
      expect(target.height, `${viewport.width}px 第 ${index + 1} 档触控高度`)
        .toBeGreaterThanOrEqual(44);
      expect(target.left).toBeGreaterThanOrEqual(-1);
      expect(target.right).toBeLessThanOrEqual(viewport.width + 1);
      expect(target.top).toBeGreaterThanOrEqual(-1);
      expect(target.bottom).toBeLessThanOrEqual(viewport.height + 1);
    }

    await page.locator(".study-main-stack").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect.poll(() => page.locator(".study-main-stack").evaluate(
      (element) => element.scrollTop,
    )).toBeGreaterThan(0);
    const atBottom = await detailGeometry(page);
    expect(atBottom.lastContent, `${viewport.width}px 最后内容存在`).not.toBeNull();
    expect(intersects(atBottom.lastContent, atBottom.rating), `${viewport.width}px 最后内容被遮挡`)
      .toBe(false);

    await page.reload();
  }
});

test("200% 与 400% 等效视口回到完整流式布局且不产生第二滚动源", async ({ context, page }) => {
  await isolateNetwork(page);
  await blockPrivateDatasets(page);
  await installStateSeed(context, createState({ enrichments: RADIATE_ENRICHMENT }));

  for (const viewport of [
    { width: 720, height: 450, zoom: "200%" },
    { width: 360, height: 225, zoom: "400%" },
  ]) {
    await page.setViewportSize(viewport);
    await openApp(page);
    await page.getByRole("button", { name: "显示单词释义" }).click();
    await waitForDetailLayout(page);

    const model = await page.evaluate(() => {
      const learnView = document.querySelector(".learn-view");
      const stack = document.querySelector(".study-main-stack");
      const rating = document.querySelector(".rating-bar.visible");
      if (!learnView || !stack || !rating) throw new Error("高缩放详情节点不完整");
      return {
        learnOverflow: getComputedStyle(learnView).overflowY,
        learnClientHeight: learnView.clientHeight,
        learnScrollHeight: learnView.scrollHeight,
        stackOverflow: getComputedStyle(stack).overflowY,
        stackClientHeight: stack.clientHeight,
        stackScrollHeight: stack.scrollHeight,
        ratingPosition: getComputedStyle(rating).position,
        ratingBottom: getComputedStyle(rating).bottom,
        documentWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
      };
    });
    expect(model.learnOverflow, `${viewport.zoom} 主滚动源`).toBe("auto");
    expect(model.learnScrollHeight, `${viewport.zoom} 核心内容可滚动`)
      .toBeGreaterThan(model.learnClientHeight);
    expect(model.stackOverflow, `${viewport.zoom} 内层不得滚动`).toBe("visible");
    expect(model.stackScrollHeight, `${viewport.zoom} 内层不得形成第二滚动源`)
      .toBeLessThanOrEqual(model.stackClientHeight + 1);
    expect(model.stackClientHeight, `${viewport.zoom} 主学习区不得塌缩`).toBeGreaterThan(200);
    expect(model.ratingPosition).toBe("sticky");
    expect(model.ratingBottom, `${viewport.zoom} 评分栏参与自然流`).toBe("auto");
    expect(model.documentScrollWidth).toBeLessThanOrEqual(model.documentWidth + 1);

    for (const selector of [
      ".study-detail .detail-word",
      ".study-detail .meaning-sense",
      ".study-detail .context-sentence",
      ".study-detail > :last-child",
    ]) {
      const content = page.locator(selector).first();
      await content.scrollIntoViewIfNeeded();
      await expect(content, `${viewport.zoom} ${selector} 可达`).toBeVisible();
    }

    await page.reload();
  }
});
