import { expect, test } from "@playwright/test";
import { createState } from "./fixtures.mjs";
import {
  installStateSeed,
  openApp,
  readStoreRecord,
} from "./helpers.mjs";

const MISSING_WORD_ID = 1_234_567;

function activeSession(wordIds, index) {
  return {
    id: "restored-session",
    kind: "search",
    title: "刷新恢复会话",
    wordIds,
    index,
    createdAt: "2026-08-09T07:00:00.000Z",
  };
}

test("刷新后部分失效词被移除，剩余顺序与当前进度安全恢复", async ({ context, page }) => {
  await installStateSeed(context, createState({
    activeSession: activeSession([1, MISSING_WORD_ID, 2], 2),
  }));
  await openApp(page);

  await expect(page.getByRole("status").filter({
    hasText: "本次任务有 1 个词已不可用，已保留其余词并继续",
  })).toBeVisible();
  await expect(page.getByText("刷新恢复会话 · 1/2", { exact: true })).toBeVisible();
  await expect.poll(async () => {
    const settings = await readStoreRecord(page, "settings", "current");
    return {
      wordIds: settings?.activeSession?.wordIds,
      index: settings?.activeSession?.index,
    };
  }).toEqual({ wordIds: [1, 2], index: 1 });

  await page.reload();
  await openApp(page);
  await expect(page.getByText("刷新恢复会话 · 1/2", { exact: true })).toBeVisible();
});

test("刷新后全部词失效时清除会话并提示可以重新开始", async ({ context, page }) => {
  await installStateSeed(context, createState({
    activeSession: activeSession([MISSING_WORD_ID], 0),
  }));
  await openApp(page);

  await expect(page.getByRole("status").filter({
    hasText: "本次任务的词条已不可用，已结束会话；可以重新开始",
  })).toBeVisible();
  await expect.poll(async () =>
    (await readStoreRecord(page, "settings", "current"))?.activeSession,
  ).toBeUndefined();
  await expect(page.getByRole("button", { name: /开始今日任务/ })).toBeVisible();

  await page.reload();
  await openApp(page);
  await expect.poll(async () =>
    (await readStoreRecord(page, "settings", "current"))?.activeSession,
  ).toBeUndefined();
});
