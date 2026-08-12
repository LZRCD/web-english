import { expect, test } from "@playwright/test";
import { createState } from "./fixtures.mjs";
import {
  installStateSeed,
  openApp,
  readStoreRecord,
} from "./helpers.mjs";

function dueAndLookupState() {
  const reviewedAt = new Date(Date.now() - 7 * 86_400_000).toISOString();
  // dailyGoal 10 + 批次 15：整队（1 到期 + 1 补漏 + 10 新词 = 12 词）落入同一批次，逐词断言可穷尽
  return createState({
    dailyGoal: 10,
    sessionBatchSize: 15,
    reviews: [{
      id: "today-preview-due-1",
      wordId: 1,
      word: "radiate",
      rating: 0,
      kind: "new",
      intervalMs: 60_000,
      dueAt: new Date(Date.now() - 6 * 86_400_000).toISOString(),
      reviewedAt,
      section: "必考词",
      unit: 1,
    }],
    lookupWords: [{
      id: 9_100_000_005,
      linkedWordId: 5,
      query: "objective",
      kind: "word",
      phonetic: "/əbˈdʒektɪv/",
      part: "n.",
      meaning: "目标",
      note: "",
      source: "redbook",
      addedAt: reviewedAt,
    }],
    lookupStats: {
      objective: {
        count: 3,
        firstAt: reviewedAt,
        lastAt: new Date(Date.now() - 86_400_000).toISOString(),
      },
    },
  });
}

test("空白状态预览今日任务，实际会话复用同一队列并解释首词来源", async ({ context, page }) => {
  await installStateSeed(context, createState());
  await openApp(page);

  const preview = page.locator(".today-task-strip");
  await expect(preview).toContainText("今日任务预览");
  await expect(preview).toContainText("今日剩余 20 词");
  await expect(preview).toContainText("本批 10 词 · 约 8 分钟");
  await expect(preview).toContainText("到期 0");
  await expect(preview).toContainText("补漏 0");
  await expect(preview).toContainText("新词 20");
  await expect(preview).toContainText("当前到期复习量未触发调整，新词目标保持 20");
  await expect(preview).toContainText("粗略估算");

  await page.setViewportSize({ width: 320, height: 720 });
  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth + 1);

  await preview.click();
  await expect.poll(async () => {
    const settings = await readStoreRecord(page, "settings", "current");
    return settings?.activeSession?.wordIds?.length ?? 0;
  }).toBe(10);
  await expect(page.locator(".word-source")).toContainText("今日新词");
});

test("到期与反复查词补漏分开预览，并逐词显示真实来源", async ({ context, page }) => {
  // 整队 12 词逐词评分推进（每次揭示含卡片过渡动画），放宽用例超时
  test.setTimeout(90_000);
  await installStateSeed(context, dueAndLookupState());
  await openApp(page);

  const preview = page.locator(".today-task-strip");
  await expect(preview).toContainText("到期 1");
  await expect(preview).toContainText("补漏 1");
  await expect(preview).toContainText("新词 10");
  await preview.click();

  // 到期词置前：乱序只作用于补漏与新词，首词必为到期词
  await expect(page.locator(".word-source")).toContainText("今日到期");

  // 整队 12 词（1 到期 + 1 补漏 + 10 新词）逐词推进，逐词校验真实来源
  const seen = new Set();
  for (let index = 0; index < 12; index += 1) {
    const source = await page.locator(".word-source").textContent();
    if (source?.includes("今日到期")) seen.add("到期");
    if (source?.includes("反复查词补漏")) seen.add("补漏");
    if (source?.includes("今日新词")) seen.add("新词");
    await page.getByRole("button", { name: "显示单词释义" }).click();
    await page.getByRole("button", { name: /认识/ }).click();
  }
  expect([...seen].sort()).toEqual(["到期", "新词", "补漏"]);
});
