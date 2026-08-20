import { expect, test } from "@playwright/test";
import { createState } from "./fixtures.mjs";
import {
  installStateSeed,
  openApp,
  selectText,
} from "./helpers.mjs";

const SENTENCE = "Alpha appears in this synthetic grouping sentence.";

const SYNTHETIC_REDBOOK = {
  metadata: {
    title: "合成红宝书",
    total: 1,
    sectionCounts: { 必考词: 1, 基础词: 0, 超纲词: 0 },
  },
  words: [{
    id: 1,
    word: "alpha",
    phonetic: "/ˈælfə/",
    meaning: "n. 名词义一;名词义二;名词义三;名词义四 v. 动词义一;动词义二;动词义三;动词义四",
    sentence: SENTENCE,
    translation: "Alpha 出现在合成分组句子中。",
    section: "必考词",
    unit: 1,
  }],
};

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function installSyntheticNetwork(page) {
  const frequencyAborted = deferred();
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      !["127.0.0.1", "localhost"].includes(url.hostname)
      || url.pathname.startsWith("/api/")
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
    if (
      url.pathname.startsWith("/data/sense-frequency/")
      || url.pathname.startsWith("/data/sense-examples/")
      || url.pathname.startsWith("/data/etymology/")
    ) {
      await route.abort();
      if (url.pathname === "/data/sense-frequency/manifest.json") {
        frequencyAborted.resolve();
      }
      return;
    }
    await route.continue();
  });
  return { waitForFrequencyAbort: () => frequencyAborted.promise };
}

async function openPopup(page) {
  await selectText(page.getByText(SENTENCE, { exact: true }), "Alpha");
  return page.getByRole("dialog", { name: "划词查询：Alpha" });
}

async function waitForStableGeometry(popup) {
  await popup.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished));
  });
  await expect.poll(() => popup.evaluate(async (element) => {
    const before = element.getBoundingClientRect();
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
    const after = element.getBoundingClientRect();
    return Math.max(
      Math.abs(before.left - after.left),
      Math.abs(before.top - after.top),
      Math.abs(before.right - after.right),
      Math.abs(before.bottom - after.bottom),
    ) <= 0.5;
  })).toBe(true);
}

async function expectSafeViewportEdges(popup) {
  const edges = await popup.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      bottom: window.innerHeight - rect.bottom,
      left: rect.left,
      right: window.innerWidth - rect.right,
      top: rect.top,
    };
  });
  expect(edges.left).toBeGreaterThanOrEqual(11);
  expect(edges.right).toBeGreaterThanOrEqual(11);
  expect(edges.top).toBeGreaterThanOrEqual(11);
  expect(edges.bottom).toBeGreaterThanOrEqual(11);
}

test("无考频时保持两词性分组并默认展开第一主要词性", async ({ context, page }) => {
  const network = await installSyntheticNetwork(page);
  await installStateSeed(context, createState());
  await openApp(page);
  await page.getByRole("button", { name: "显示单词释义" }).click();
  const popup = await openPopup(page);
  await network.waitForFrequencyAbort();

  await expect(popup.locator(".selection-lookup-sense-group")).toHaveCount(2);
  await expect(popup.getByRole("button", { name: /^n\./ }))
    .toHaveAttribute("aria-expanded", "true");
  await expect(popup.getByRole("button", { name: /^v\./ }))
    .toHaveAttribute("aria-expanded", "false");
  await expect(popup.locator(".sense-frequency-highlight")).toHaveCount(0);
});

test("320/390 四边安全，Enter 切换 accordion，Escape 关闭且无观察器错误", async ({
  context,
  page,
}) => {
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push({
        text: message.text(),
        url: message.location().url,
      });
    }
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await installSyntheticNetwork(page);
  await installStateSeed(context, createState());
  await page.setViewportSize({ width: 320, height: 700 });
  await openApp(page);
  await page.getByRole("button", { name: "显示单词释义" }).click();

  for (const viewport of [
    { width: 320, height: 700 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    const popup = await openPopup(page);
    const verb = popup.getByRole("button", { name: /^v\./ });
    await waitForStableGeometry(popup);
    await expectSafeViewportEdges(popup);
    await expect(verb).toHaveAttribute("aria-expanded", "false");

    await verb.focus();
    await page.keyboard.press("Enter");
    await expect(verb).toHaveAttribute("aria-expanded", "true");
    await waitForStableGeometry(popup);
    await expectSafeViewportEdges(popup);

    await page.keyboard.press("Escape");
    await expect(popup).toHaveCount(0);
  }

  const unexpectedConsoleErrors = consoleErrors.filter(({ text, url }) => !(
    text === "Failed to load resource: net::ERR_FAILED"
    && /\/data\/(sense-frequency|sense-examples|etymology)\//.test(url)
  ));
  expect(unexpectedConsoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
