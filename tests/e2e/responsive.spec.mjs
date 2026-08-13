import { expect, test } from "@playwright/test";
import { createState } from "./fixtures.mjs";
import {
  installStateSeed,
  openApp,
  openWordbook,
} from "./helpers.mjs";

/** 检查视口内没有破坏性的横向溢出（排除滑出屏幕的 fixed 抽屉）。 */
async function expectNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => {
    const documentWidth = document.documentElement.clientWidth;
    const bodyWidth = document.body.scrollWidth;
    const offenders = [...document.querySelectorAll("body *")]
      .filter((element) => getComputedStyle(element).position !== "fixed")
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.right > documentWidth + 4 || rect.left < -4;
      })
      .slice(0, 5)
      .map((element) => ({
        tag: element.tagName,
        className: String(element.className).slice(0, 60),
        right: Math.round(element.getBoundingClientRect().right),
      }));
    return { bodyWidth, documentWidth, offenders };
  });
  expect(
    overflow.bodyWidth,
    JSON.stringify(overflow.offenders),
  ).toBeLessThanOrEqual(overflow.documentWidth + 2);
}

test("320px 手机宽度下核心学习页可用且无横向溢出", async ({ context, page }) => {
  await installStateSeed(context, createState({
    activeSession: {
      id: "narrow-session",
      kind: "search",
      title: "窄屏会话",
      wordIds: [1],
      index: 0,
      createdAt: "2026-07-29T07:00:00.000Z",
    },
  }));
  await page.setViewportSize({ width: 320, height: 640 });
  await openApp(page);
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "显示单词释义" }).click();
  await page.getByRole("button", { name: /认识/ }).click();
  await expect(
    page.getByRole("heading", { name: "这一轮记忆已闭合" }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("200% 与 400% 缩放下学习页保持可操作", async ({ context, page }) => {
  await installStateSeed(context, createState({
    activeSession: {
      id: "zoom-session",
      kind: "search",
      title: "缩放会话",
      wordIds: [1],
      index: 0,
      createdAt: "2026-07-29T07:00:00.000Z",
    },
  }));
  await page.setViewportSize({ width: 1280, height: 900 });

  for (const zoom of ["2", "4"]) {
    await openApp(page);
    await page.evaluate((level) => {
      document.documentElement.style.zoom = level;
    }, zoom);
    await page.getByRole("button", { name: "显示单词释义" }).click();
    await expect(
      page.getByRole("button", { name: /认识/ }),
    ).toBeVisible();
    await page.evaluate(() => {
      document.documentElement.style.zoom = "1";
    });
  }
});

test("词本四个分类 Tab 均可切换并显示对应操作", async ({ context, page }) => {
  await installStateSeed(context, createState({
    favorites: [
      { wordId: 1, addedAt: "2026-07-29T07:00:00.000Z" },
    ],
    lookupWords: [
      { wordId: 2, query: "objective", meaning: "目标", addedAt: "2026-07-29T07:00:00.000Z" },
    ],
  }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await openApp(page);
  await openWordbook(page);

  const tablist = page.getByRole("tablist", { name: "词本分类" });
  await expect(tablist.getByRole("tab", { name: /我的词本/ })).toBeVisible();
  await expect(tablist.getByRole("tab", { name: /错词记录/ })).toBeVisible();
  await expect(tablist.getByRole("tab", { name: /顽固词/ })).toBeVisible();
  await expect(tablist.getByRole("tab", { name: /划词集/ })).toBeVisible();

  await tablist.getByRole("tab", { name: /错词记录/ }).click();
  await expect(page.getByRole("button", { name: "强化当前错词" })).toBeVisible();
  await tablist.getByRole("tab", { name: /顽固词/ }).click();
  await expect(page.getByRole("button", { name: "开始顽固词专项" })).toBeVisible();
  await tablist.getByRole("tab", { name: /划词集/ }).click();
  await expect(page.getByRole("button", { name: "学习划词集" })).toBeVisible();
  await tablist.getByRole("tab", { name: /我的词本/ }).click();
  await expect(page.getByRole("button", { name: "复习全部收藏" })).toBeVisible();
});

test("学习顶栏显示会话标题与进度", async ({ context, page }) => {
  await installStateSeed(context, createState({
    activeSession: {
      id: "topbar-session",
      kind: "search",
      title: "专项复习",
      wordIds: [1, 2],
      index: 1,
      createdAt: "2026-07-29T07:00:00.000Z",
    },
  }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await openApp(page);

  await expect(page.getByText("专项复习 · 1/2", { exact: true })).toBeVisible();
  await expect(page.getByText("2027 红宝书伴学", { exact: true })).toBeVisible();
});
