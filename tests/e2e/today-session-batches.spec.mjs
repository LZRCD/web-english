import { expect, test } from "@playwright/test";
import { createState } from "./fixtures.mjs";
import {
  installStateSeed,
  openApp,
  openSettings,
  readStoreRecord,
  sessionBatchSizeSelect,
  waitForApp,
} from "./helpers.mjs";

async function openLearn(page) {
  await page
    .getByRole("complementary", { name: "主导航" })
    .getByRole("button", { name: /学习$/ })
    .click();
}

async function finishCurrentBatch(page, count) {
  for (let index = 0; index < count; index += 1) {
    await page.getByRole("button", { name: "显示单词释义" }).click();
    await page.locator(".rating-bar.visible button").nth(3).focus();
    await page.keyboard.press("Enter");
  }
}

async function storedSession(page) {
  return (await readStoreRecord(page, "settings", "current"))?.activeSession;
}

test("旧状态缺少每批字段时默认 10，并以 10 词创建今日批次", async ({ context, page }) => {
  const legacy = createState();
  delete legacy.sessionBatchSize;
  await installStateSeed(context, legacy);
  await openApp(page);
  await openSettings(page);

  await expect(sessionBatchSizeSelect(page)).toHaveValue("10");
  await openLearn(page);
  const preview = page.locator(".today-task-strip");
  await expect(preview).toContainText("今日剩余 20 词");
  await expect(preview).toContainText("本批 10 词");
  await expect(preview).toHaveAccessibleName(/今日剩余 20 词，本批 10 词/);
  await preview.click();
  await expect.poll(async () => (await storedSession(page))?.wordIds?.length).toBe(10);
});

test("选择 5 词后跨两批不重复，最后一批后才显示今日完成", async ({ context, page }) => {
  await installStateSeed(context, createState({ dailyGoal: 10 }));
  await openApp(page);
  await openSettings(page);
  await sessionBatchSizeSelect(page).selectOption("5");

  await page.setViewportSize({ width: 320, height: 720 });
  let viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth + 1);

  await openLearn(page);
  const preview = page.locator(".today-task-strip");
  await expect(preview).toContainText("今日剩余 10 词");
  await expect(preview).toContainText("本批 5 词");
  await preview.click();
  await expect.poll(async () => (await storedSession(page))?.wordIds?.length).toBe(5);
  const firstSession = await storedSession(page);
  const firstWordIds = firstSession.wordIds;
  expect(firstWordIds).toHaveLength(5);

  await finishCurrentBatch(page, 5);
  await expect(page.getByText("本批已完成", { exact: true })).toBeVisible();
  await expect(page.getByText(/今日剩余 5 词 · 下一批 5 词/)).toBeVisible();
  await expect(page.getByText("今日任务已完成", { exact: true })).toHaveCount(0);
  const continueButton = page.getByRole("button", { name: "继续下一批（5 词）" });
  await expect(continueButton).toBeVisible();
  viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth + 1);

  await continueButton.click();
  await expect.poll(async () => (await storedSession(page))?.id).not.toBe(firstSession.id);
  const secondWordIds = (await storedSession(page)).wordIds;
  expect(secondWordIds).toHaveLength(5);
  expect(secondWordIds.filter((wordId) => firstWordIds.includes(wordId))).toEqual([]);
  await finishCurrentBatch(page, 5);

  await expect(page.getByText("今日任务已完成", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /继续下一批/ })).toHaveCount(0);
});

test("批中刷新保持原词序与进度，设置变化只影响下一批", async ({ context, page }) => {
  await installStateSeed(context, createState());
  await openApp(page);
  await page.locator(".today-task-strip").click();
  await finishCurrentBatch(page, 2);
  await expect.poll(async () => (await storedSession(page))?.index).toBe(2);
  const beforeChange = await storedSession(page);
  expect(beforeChange.wordIds).toHaveLength(10);
  expect(beforeChange.index).toBe(2);

  await openSettings(page);
  await sessionBatchSizeSelect(page).selectOption("5");
  await expect.poll(async () =>
    (await readStoreRecord(page, "settings", "current"))?.sessionBatchSize,
  ).toBe(5);
  await page.reload();
  await waitForApp(page);
  const restored = await storedSession(page);
  expect(restored.wordIds).toEqual(beforeChange.wordIds);
  expect(restored.index).toBe(2);
  expect(restored.createdAt).toBe(beforeChange.createdAt);

  await finishCurrentBatch(page, 8);
  await expect(page.getByText(/今日剩余 10 词 · 下一批 5 词/)).toBeVisible();
  await page.getByRole("button", { name: "继续下一批（5 词）" }).click();
  await expect.poll(async () => (await storedSession(page))?.wordIds?.length).toBe(5);
  const nextBatch = await storedSession(page);
  expect(nextBatch.wordIds).toHaveLength(5);
  expect(nextBatch.wordIds.filter((wordId) => beforeChange.wordIds.includes(wordId))).toEqual([]);
});
