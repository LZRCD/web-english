import { expect, test } from "@playwright/test";
import { createState } from "./fixtures.mjs";
import { installStateSeed, readStoreRecord } from "./helpers.mjs";

async function openFirstUseGuide(context, page) {
  await installStateSeed(context, createState({ started: false }));
  await page.goto("/");
  await expect(page.getByRole("dialog", { name: "从今日任务开始" })).toBeVisible();
  const guide = page.locator(".welcome");
  await expect(guide.getByRole("button", { name: "下一步" })).toBeFocused();
  return guide;
}

test("首次引导支持跳过，沿用现有今日任务入口", async ({ context, page }) => {
  const guide = await openFirstUseGuide(context, page);
  await guide.getByRole("button", { name: "跳过引导" }).click();
  await expect(guide).toBeHidden();
  await expect.poll(async () =>
    (await readStoreRecord(page, "settings", "current"))?.activeSession?.title,
  ).toBe("今日任务");
});

test("三步引导支持前进后退、键盘与 320px 布局", async ({ context, page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const guide = await openFirstUseGuide(context, page);

  await expect(guide.getByRole("button", { name: "上一步" })).toBeDisabled();
  await page.keyboard.press("Enter");
  await expect(guide.getByRole("heading", { name: "先回忆，再揭示并评分" })).toBeVisible();
  await expect(guide).toContainText("空格揭示 · 1～4 评分");

  await guide.getByRole("button", { name: "上一步" }).click();
  await expect(guide.getByRole("heading", { name: "从今日任务开始" })).toBeVisible();
  await guide.getByRole("button", { name: "下一步" }).click();
  await guide.getByRole("button", { name: "下一步" }).focus();
  await page.keyboard.press("Space");
  await expect(guide.getByRole("heading", { name: "随时查词，收进词本" })).toBeVisible();
  await expect(guide).toContainText("/ 查词 · F 收藏");

  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    guide: document.querySelector(".welcome")?.scrollWidth
      - document.querySelector(".welcome")?.clientWidth,
  }));
  expect(overflow).toEqual({ document: 0, guide: 0 });

  await guide.getByRole("button", { name: "开始今日任务" }).focus();
  await page.keyboard.press("Enter");
  await expect(guide).toBeHidden();
  await expect.poll(async () =>
    (await readStoreRecord(page, "settings", "current"))?.activeSession?.title,
  ).toBe("今日任务");
});
