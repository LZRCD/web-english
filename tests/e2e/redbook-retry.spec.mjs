import { expect, test } from "@playwright/test";
import { createState } from "./fixtures.mjs";
import {
  installStateSeed,
  waitForApp,
} from "./helpers.mjs";

test("词库加载失败后可重复重试并在成功后恢复学习", async ({ context, page }) => {
  let redbookRequests = 0;
  await installStateSeed(context, createState());
  await page.route("**/data/redbook.json*", async (route) => {
    redbookRequests += 1;
    if (redbookRequests <= 2) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "temporary" }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/");
  const errorPanel = page.getByRole("alert");
  const retryButton = page.getByRole("button", { name: "重新读取词库" });
  await expect(errorPanel).toContainText("暂时无法读取本地词库");
  await expect(errorPanel).toContainText("请确认词环仍在运行，然后重试");
  await expect(errorPanel).not.toContainText(/503|Error|stack/i);

  await retryButton.focus();
  await expect(retryButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => redbookRequests).toBe(2);
  await expect(errorPanel).toBeVisible();
  await expect(retryButton).toBeEnabled();

  await page.setViewportSize({ width: 320, height: 720 });
  await expect.poll(() => page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))).toEqual({ clientWidth: 320, scrollWidth: 320 });
  await retryButton.click();
  await expect.poll(() => redbookRequests).toBe(3);
  await waitForApp(page);

  await expect(errorPanel).toHaveCount(0);
  await expect(page.getByRole("button", { name: "显示单词释义" })).toBeEnabled();
  await expect(page.getByRole("heading", { name: "radiate" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))).toEqual({ clientWidth: 320, scrollWidth: 320 });
});
