import { expect, test } from "@playwright/test";
import { createState, RADIATE_ENRICHMENT } from "./fixtures.mjs";
import { blockPrivateDatasets, installStateSeed, openApp } from "./helpers.mjs";

async function isolateNetwork(page) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1" || url.pathname.startsWith("/api/")) {
      await route.abort();
      return;
    }
    await route.continue();
  });
}

async function typography(page) {
  return page.evaluate(() => {
    const size = (selector) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`缺少字号节点：${selector}`);
      return Number.parseFloat(getComputedStyle(element).fontSize);
    };
    return {
      word: size(".study-detail .detail-word"),
      phonetic: size(".study-detail .detail-phonetic"),
      meaning: size(".study-detail .meaning-sense"),
      example: size(".study-detail .context-sentence"),
      section: size(".study-detail .detail-section-title"),
      meta: size(".study-detail .detail-summary-status"),
    };
  });
}

test("Study Detail 采用有限字号层级并在手机端显式 reflow", async ({ context, page }) => {
  await isolateNetwork(page);
  await blockPrivateDatasets(page);
  await installStateSeed(context, createState({ enrichments: RADIATE_ENRICHMENT }));

  for (const viewport of [
    { width: 320, height: 640, mobile: true },
    { width: 390, height: 844, mobile: true },
    { width: 1440, height: 900, mobile: false },
  ]) {
    await page.setViewportSize(viewport);
    await openApp(page);
    await page.getByRole("button", { name: "显示单词释义" }).click();
    await expect(page.locator(".study-detail")).toBeVisible();

    const type = await typography(page);
    if (viewport.mobile) {
      expect(type.word, `${viewport.width}px Hero`).toBeGreaterThanOrEqual(40);
      expect(type.word, `${viewport.width}px Hero`).toBeLessThanOrEqual(46);
      expect(type.phonetic, `${viewport.width}px 音标`).toBeGreaterThanOrEqual(17);
      expect(type.phonetic, `${viewport.width}px 音标`).toBeLessThanOrEqual(18);
      expect(type.meaning, `${viewport.width}px Core`).toBeGreaterThanOrEqual(17);
      expect(type.meaning, `${viewport.width}px Core`).toBeLessThanOrEqual(18);
      expect(type.example, `${viewport.width}px Body`).toBeGreaterThanOrEqual(15);
      expect(type.example, `${viewport.width}px Body`).toBeLessThanOrEqual(16);
    } else {
      expect(type.word, "1440px Hero").toBeGreaterThanOrEqual(48);
      expect(type.word, "1440px Hero").toBeLessThanOrEqual(56);
      expect(type.phonetic, "1440px 音标").toBeGreaterThanOrEqual(17);
      expect(type.phonetic, "1440px 音标").toBeLessThanOrEqual(19);
      expect(type.meaning, "1440px Core").toBeGreaterThanOrEqual(18);
      expect(type.meaning, "1440px Core").toBeLessThanOrEqual(19);
      expect(type.example, "1440px Body").toBeGreaterThanOrEqual(16);
      expect(type.example, "1440px Body").toBeLessThanOrEqual(17);
    }
    expect(type.section, `${viewport.width}px Control`).toBeGreaterThanOrEqual(11);
    expect(type.meta, `${viewport.width}px Meta`).toBeGreaterThanOrEqual(11);

    await page.reload();
  }
});
