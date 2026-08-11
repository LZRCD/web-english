import { expect, test } from "@playwright/test";
import { createState } from "./fixtures.mjs";
import {
  installStateSeed,
  openWordbook,
  readStoreCount,
  readStoreRecord,
} from "./helpers.mjs";

async function openFirstUseGuide(context, page) {
  await installStateSeed(context, createState({ started: false }));
  await page.goto("/");
  await expect(page.getByRole("dialog", { name: "从今日任务开始" })).toBeVisible();
  const guide = page.locator(".welcome");
  await expect(guide.getByRole("button", { name: "先测词汇量" }))
    .toBeEnabled({ timeout: 25_000 });
  return guide;
}

async function completeVocabTest(page, answerUnknown) {
  let unknownCount = 0;
  for (let index = 0; index < 80; index += 1) {
    if (await page.getByRole("heading", { name: "本轮估算完成" }).isVisible()) {
      return unknownCount;
    }
    const useUnknown = answerUnknown(index);
    if (useUnknown) {
      unknownCount += 1;
      await page.getByRole("button", { name: /^不认识/ }).click();
    } else {
      await page.getByRole("button", { name: /^认识/ }).click();
    }
  }
  throw new Error("词汇量测试未在 80 题内完成");
}

async function expectNoHorizontalOverflow(page) {
  const widths = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  expect(widths.body).toBeLessThanOrEqual(widths.viewport);
}

test("词汇量测试从欢迎页完成自评并进入补漏学习", async ({ context, page }) => {
  const guide = await openFirstUseGuide(context, page);
  await guide.getByRole("button", { name: "先测词汇量" }).click();

  const testDialog = page.getByRole("dialog", { name: "词汇量测试" });
  await expect(testDialog).toBeVisible();
  await expect(testDialog.getByRole("button", { name: /^认识/ })).toBeFocused();
  const shownWord = await testDialog.locator(".vocab-test-word").innerText();
  expect(shownWord).not.toMatch(/[\u3400-\u9fff]/);
  await expect.poll(async () => {
    const settings = await readStoreRecord(page, "settings", "current");
    return {
      started: settings?.started,
      activeSession: settings?.activeSession ?? null,
    };
  }).toEqual({ started: false, activeSession: null });
  await expect.poll(() => readStoreCount(page, "reviews")).toBe(0);
  await expect.poll(() => readStoreCount(page, "word-progress")).toBe(0);
  await expect.poll(() => readStoreCount(page, "mistakes")).toBe(0);

  const unknownCount = await completeVocabTest(page, (index) => index % 9 === 0);
  const result = testDialog.locator(".vocab-test-result");
  await expect(result.getByText(/\/ 6550/)).toBeVisible();
  await expect(result.getByText(/\/ 1856/)).toBeVisible();
  await expect(result.getByText(/\/ 3680/)).toBeVisible();
  await expect(result.getByText(/\/ 1014/)).toBeVisible();
  await expect(result).toContainText("本轮实际题数");
  await expect(result).toContainText(`不认识题数${unknownCount}`);
  await expect(result).toContainText(
    "这是基于红宝书分层抽样的自评估算，不等于已完成学习、FSRS 掌握或考研达标。",
  );

  const learnButton = result.getByRole("button", {
    name: `一键补漏学习（${unknownCount} 词）`,
  });
  await expect(learnButton).toBeVisible();
  await learnButton.click();

  await expect(page.locator(".topbar-title")).toContainText("词汇量测试补漏");
  await expect(page.getByRole("note", {
    name: /当前单词来源：词汇量测试补漏.*刚完成词汇量测试.*不认识/,
  })).toBeVisible();
  await expect.poll(async () => {
    const settings = await readStoreRecord(page, "settings", "current");
    return {
      started: settings?.started,
      kind: settings?.activeSession?.kind,
      title: settings?.activeSession?.title,
    };
  }).toEqual({
    started: true,
    kind: "vocab-test",
    title: "词汇量测试补漏",
  });
  await expect.poll(() => readStoreCount(page, "reviews")).toBe(0);
  await expect.poll(() => readStoreCount(page, "word-progress")).toBe(0);
  await expect.poll(() => readStoreCount(page, "mistakes")).toBe(0);
});

test("词汇量测试退出后恢复入口且320px无横向溢出", async ({ context, page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  const guide = await openFirstUseGuide(context, page);
  const welcomeTrigger = guide.getByRole("button", { name: "先测词汇量" });
  await welcomeTrigger.click();
  await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: "退出测试" }).click();
  await expect(guide).toBeVisible();
  await expect(welcomeTrigger).toBeFocused();

  await guide.getByRole("button", { name: "下一步" }).click();
  await guide.getByRole("button", { name: "下一步" }).click();
  await guide.getByRole("button", { name: "开始今日任务" }).click();
  await expect(guide).toBeHidden();

  await openWordbook(page);
  const tab = page.getByRole("tab", { name: /划词集/ });
  await tab.click();
  const wordbookTrigger = page.getByRole("button", { name: "测试我的词汇量" });
  await expect(wordbookTrigger).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await wordbookTrigger.click();
  await expectNoHorizontalOverflow(page);

  await completeVocabTest(page, () => false);
  await expect(page.getByRole("heading", { name: "本轮估算完成" })).toBeVisible();
  await expect(page.getByText("本轮没有标记“不认识”的词，无需创建补漏学习。"))
    .toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: "返回词本" }).click();

  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(wordbookTrigger).toBeFocused();
  await expectNoHorizontalOverflow(page);
});
