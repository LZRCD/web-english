import { expect, test } from "@playwright/test";
import { createState } from "./fixtures.mjs";
import {
  installStateSeed,
  openApp,
  readStoreCount,
} from "./helpers.mjs";

test("核心学习页与完成页在桌面和移动布局保持可用", async ({
  context,
  page,
}, testInfo) => {
  await installStateSeed(context, createState({
    activeSession: {
      id: "visual-session",
      kind: "search",
      title: "视觉验收",
      wordIds: [1],
      index: 0,
      createdAt: "2026-07-29T07:00:00.000Z",
    },
  }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await openApp(page);

  await page.screenshot({
    path: testInfo.outputPath("learning-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "显示单词释义" }).click();
  await page.getByRole("button", { name: /认识/ }).click();

  await expect(
    page.getByRole("heading", { name: "这一轮记忆已闭合" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "这一轮记忆已闭合" }),
  ).toBeFocused();
  await expect(page.getByText("完成 1/1 个词")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "再强化 1 词" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "继续搜索" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "返回自由学习" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "撤销最后评分" }),
  ).toBeVisible();
  await page.keyboard.press("f");
  await expect.poll(() => readStoreCount(page, "favorites")).toBe(0);
  await page.keyboard.press("a");
  await expect(page.getByRole("dialog", { name: /AI/ })).toHaveCount(0);
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("heading", { name: "这一轮记忆已闭合" }),
  ).toBeVisible();

  const ratingNotice = page
    .getByRole("status")
    .filter({ hasText: "Z 撤销" });
  await ratingNotice.waitFor({ state: "hidden", timeout: 8_000 });
  await page.screenshot({
    path: testInfo.outputPath("completion-desktop.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 900, height: 800 });
  const mediumViewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(mediumViewport.scrollWidth)
    .toBeLessThanOrEqual(mediumViewport.clientWidth + 1);
  await page.screenshot({
    path: testInfo.outputPath("completion-medium.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 821, height: 800 });
  const breakpointViewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(breakpointViewport.scrollWidth)
    .toBeLessThanOrEqual(breakpointViewport.clientWidth + 1);
  await page.screenshot({
    path: testInfo.outputPath("completion-breakpoint-821.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "这一轮记忆已闭合" }),
  ).toBeVisible();
  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth + 1);
  await page.screenshot({
    path: testInfo.outputPath("completion-mobile.png"),
    fullPage: true,
  });

  await page.getByRole("button", { name: "再强化 1 词" }).click();
  await expect(page.locator(".word-card")).toBeFocused();
  // 移动端（≤480px）顶部标题按设计隐藏，此处校验会话已建立即可
  await expect(
    page.getByText("本次薄弱词 · 再强化 · 0/1", { exact: true }),
  ).toHaveText("本次薄弱词 · 再强化 · 0/1");
  await expect(
    page.getByRole("button", { name: "显示单词释义" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "显示单词释义" }).click();
  await page.getByRole("button", { name: /认识/ }).click();
  await expect(
    page.getByRole("button", { name: "继续搜索" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "继续搜索" }).click();
  await expect(
    page.getByRole("dialog", { name: "全局查词" }),
  ).toBeVisible();
});
