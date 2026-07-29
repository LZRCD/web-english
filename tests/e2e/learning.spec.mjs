import { expect, test } from "@playwright/test";
import {
  createState,
  RADIATE_ENRICHMENT,
} from "./fixtures.mjs";
import {
  installStateSeed,
  openApp,
  openWordbook,
  readStoreCount,
  readStoreRecord,
  selectText,
  waitForApp,
} from "./helpers.mjs";

test("评分写入后可以撤销，并把持久化进度恢复到评分前", async ({ context, page }) => {
  await installStateSeed(context, createState());
  await openApp(page);

  const wordFace = page.getByRole("button", { name: "显示单词释义" });
  const wordHeading = wordFace.locator("h1");
  const originalWord = await wordHeading.textContent();
  await wordFace.click();
  await page.getByRole("button", { name: /认识/ }).click();
  await expect.poll(() => readStoreCount(page, "reviews")).toBe(1);

  const ratingNotice = page.getByRole("status").filter({ hasText: "Z 撤销" });
  await ratingNotice.getByRole("button", { name: "撤销" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "已撤销" }),
  ).toBeVisible();
  await expect(wordHeading).toHaveText(originalWord ?? "");
  await expect(page.getByRole("button", { name: /认识/ })).toBeVisible();
  await expect.poll(() => readStoreCount(page, "reviews")).toBe(0);
  await expect.poll(() => readStoreCount(page, "word-progress")).toBe(0);

  await page.reload();
  await waitForApp(page);
  await expect(
    page
      .getByRole("button", { name: "显示单词释义" })
      .locator("h1"),
  ).toHaveText(originalWord ?? "");
  await expect.poll(() => readStoreCount(page, "reviews")).toBe(0);
});

test("划选例句中的英文可查义、加入划词集并持久化", async ({ context, page }) => {
  await installStateSeed(context, createState({
    enrichments: RADIATE_ENRICHMENT,
  }));
  await openApp(page);

  await page.getByRole("button", { name: "显示单词释义" }).click();
  await selectText(
    page.getByText("Stars radiate energy into space.", { exact: true }),
    "radiate",
  );
  const popup = page.getByRole("dialog", { name: "划词查询：radiate" });
  await expect(popup).toBeVisible();
  await popup.getByRole("button", { name: "翻译" }).click();
  await expect(popup).toContainText("已加入划词集");

  await expect.poll(async () => {
    const settings = await readStoreRecord(page, "settings", "current");
    return settings?.lookupWords?.length ?? 0;
  }).toBe(1);
  await openWordbook(page);
  await page.getByRole("tab", { name: /划词集/ }).click();
  await expect(
    page.getByRole("tabpanel").getByRole("heading", { name: "radiate" }),
  ).toBeVisible();

  await page.reload();
  await waitForApp(page);
  await openWordbook(page);
  await page.getByRole("tab", { name: /划词集/ }).click();
  await expect(
    page.getByRole("tabpanel").getByRole("heading", { name: "radiate" }),
  ).toBeVisible();
});
