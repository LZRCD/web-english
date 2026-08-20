import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createState } from "./fixtures.mjs";
import {
  blockPrivateDatasets,
  installStateSeed,
  openApp,
} from "./helpers.mjs";

const GLOBAL_CSS = readFileSync(
  new URL("../../app/globals.css", import.meta.url),
  "utf8",
);

async function isolateToastNetwork(page) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      !["127.0.0.1", "localhost"].includes(url.hostname)
      || url.pathname.startsWith("/api/")
    ) {
      await route.abort();
      return;
    }
    await route.continue();
  });
  await blockPrivateDatasets(page);
}

async function triggerRatingToast(context, page) {
  await isolateToastNetwork(page);
  await installStateSeed(context, createState());
  await openApp(page);
  await page.getByRole("button", { name: "显示单词释义" }).click();
  await page.getByRole("button", { name: /认识/ }).click();

  const toast = page.locator(".toast");
  await expect(toast).toHaveCount(1);
  await expect(toast).toBeVisible();
  await expect(toast.locator("span")).toHaveText(
    /^认识 · .+后复习.* · Z 撤销$/,
  );
  await expect(toast.getByRole("button", { name: "撤销" })).toBeVisible();
  return toast;
}

async function readGeometry(page) {
  return page.evaluate(() => {
    const toast = document.querySelector(".toast");
    const navigation = document.querySelector('.side-rail[aria-label="主导航"]');
    const undo = toast?.querySelector("button");
    const message = toast?.querySelector("span");
    if (!toast || !navigation || !undo || !message) {
      throw new Error("Toast、撤销按钮或主导航不存在");
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
    const rootStyle = getComputedStyle(document.querySelector(".app-shell"));
    const messageStyle = getComputedStyle(message);
    return {
      toast: rect(toast),
      navigation: rect(navigation),
      undo: rect(undo),
      message: rect(message),
      viewport: { width: innerWidth, height: innerHeight },
      toastFontSize: Number.parseFloat(getComputedStyle(toast).fontSize),
      mobileNavHeight: rootStyle.getPropertyValue("--mobile-main-nav-height").trim(),
      mobileNavBottom: rootStyle.getPropertyValue("--mobile-main-nav-bottom").trim(),
      messageOverflow: messageStyle.overflow,
      messageTextOverflow: messageStyle.textOverflow,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
    };
  });
}

for (const viewport of [
  { width: 320, height: 640 },
  { width: 390, height: 844 },
]) {
  test(`${viewport.width}×${viewport.height} Toast 避开底部主导航并可撤销`, async ({
    context,
    page,
  }) => {
    await page.setViewportSize(viewport);
    const toast = await triggerRatingToast(context, page);
    await expect.poll(async () => {
      const current = await readGeometry(page);
      return current.navigation.top - current.toast.bottom;
    }, { message: "Toast 应与底部主导航保持清晰间距" })
      .toBeGreaterThanOrEqual(8);
    const geometry = await readGeometry(page);

    expect(geometry.toast.left).toBeGreaterThanOrEqual(0);
    expect(geometry.toast.top).toBeGreaterThanOrEqual(0);
    expect(geometry.toast.right).toBeLessThanOrEqual(geometry.viewport.width);
    expect(geometry.toast.bottom).toBeLessThanOrEqual(geometry.viewport.height);
    expect(geometry.undo.width).toBeGreaterThanOrEqual(44);
    expect(geometry.undo.height).toBeGreaterThanOrEqual(44);
    expect(geometry.toastFontSize).toBeGreaterThanOrEqual(11);
    expect(geometry.message.left).toBeGreaterThanOrEqual(geometry.toast.left);
    expect(geometry.message.right).toBeLessThanOrEqual(geometry.toast.right);
    expect(geometry.messageOverflow).not.toBe("hidden");
    expect(geometry.messageTextOverflow).not.toBe("ellipsis");
    expect(geometry.documentScrollWidth)
      .toBeLessThanOrEqual(geometry.documentClientWidth + 1);
    expect(geometry.bodyScrollWidth)
      .toBeLessThanOrEqual(geometry.bodyClientWidth + 1);
    expect(GLOBAL_CSS.includes("env(safe-area-inset-bottom)")).toBe(true);
    expect(geometry.mobileNavHeight).not.toBe("");
    expect(geometry.mobileNavBottom).not.toBe("");

    const undo = toast.getByRole("button", { name: "撤销" });
    await undo.focus();
    await expect(undo).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(undo).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator(".toast span")).toHaveText(/^已撤销 /);
  });
}

test("1440×900 Toast 保持桌面底部居中布局", async ({ context, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await triggerRatingToast(context, page);
  const geometry = await readGeometry(page);
  const toastCenter = (geometry.toast.left + geometry.toast.right) / 2;

  expect(Math.abs(toastCenter - geometry.viewport.width / 2))
    .toBeLessThanOrEqual(1);
  expect(geometry.toast.left).toBeGreaterThanOrEqual(geometry.navigation.right);
  expect(geometry.toast.width).toBeLessThan(geometry.viewport.width / 2);
  expect(geometry.viewport.height - geometry.toast.bottom)
    .toBeLessThan(geometry.navigation.width);
  expect(geometry.toastFontSize).toBeGreaterThanOrEqual(11);
  expect(geometry.mobileNavHeight).toBe("");
  expect(geometry.mobileNavBottom).toBe("");
  expect(geometry.documentScrollWidth)
    .toBeLessThanOrEqual(geometry.documentClientWidth + 1);
  expect(geometry.bodyScrollWidth)
    .toBeLessThanOrEqual(geometry.bodyClientWidth + 1);
});
