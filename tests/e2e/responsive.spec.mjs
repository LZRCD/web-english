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

async function learningGeometry(page) {
  return page.evaluate(() => {
    const learnView = document.querySelector(".learn-view");
    const learningContext = document.querySelector(".learning-context");
    const studyMainStack = document.querySelector(".study-main-stack");
    const orbitStage = document.querySelector(".orbit-stage");
    if (!learnView || !learningContext || !studyMainStack || !orbitStage) {
      throw new Error("学习页布局节点不完整");
    }

    const rect = (element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, width: box.width };
    };
    return {
      detailMode: learnView.classList.contains("detail-mode"),
      learnView: rect(learnView),
      learningContext: rect(learningContext),
      studyMainStack: rect(studyMainStack),
      orbitStage: rect(orbitStage),
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
    };
  });
}

async function openRailView(rail, name, verify) {
  const control = rail.getByRole("button", { name });
  await expect(control).toBeVisible();
  await control.click();
  await expect(control).toHaveAttribute("aria-current", "page");
  await verify();
}

async function expectInViewport(control) {
  await expect.poll(() => control.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return rect.left >= 0
      && rect.top >= 0
      && rect.right <= window.innerWidth
      && rect.bottom <= window.innerHeight;
  })).toBe(true);
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

test("200% 与 400% 等效布局视口下核心导航与 AI 教练可操作", async ({ context, page }) => {
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
  const zoomViewports = [
    { zoom: 2, width: 720, height: 450 },
    { zoom: 4, width: 360, height: 225 },
  ];

  for (const viewport of zoomViewports) {
    await page.setViewportSize(viewport);
    await openApp(page);
    await page.getByRole("button", { name: "显示单词释义" }).click();
    await expect(
      page.getByRole("button", { name: /认识/ }),
    ).toBeVisible();

    if (viewport.zoom === 4) {
      const rail = page.getByRole("complementary", { name: "主导航" });
      await openRailView(rail, /词书$/, async () => {
        await expect(page.getByRole("heading", { name: "按红宝书顺序开始" }))
          .toBeVisible();
      });
      await openRailView(rail, /词本$/, async () => {
        await expect(page.getByRole("tablist", { name: "词本分类" })).toBeVisible();
      });
      await openRailView(rail, /测验$/, async () => {
        await expect(page.getByRole("heading", { name: "主动写出来，才算真正会" }))
          .toBeVisible();
      });
      await openRailView(rail, /轨迹$/, async () => {
        await expect(page.getByRole("heading", { name: "每一次回忆都算数" }))
          .toBeVisible();
      });
      await openRailView(rail, /设置$/, async () => {
        await expect(page.getByRole("heading", { name: "把节奏调成你的样子" }))
          .toBeVisible();
      });
      await openRailView(rail, /学习$/, async () => {
        await expect(page.locator(".learn-view")).toBeVisible();
      });

      const aiControl = rail.getByRole("button", { name: "打开 AI 记忆教练" });
      await expect(aiControl).toBeVisible();
      await aiControl.click();
      const coach = page.getByRole("complementary", { name: "AI 记忆教练" });
      const closeCoach = coach.getByRole("button", { name: "关闭 AI 教练" });
      const input = coach.getByRole("textbox", { name: "向 AI 教练提问" });

      await expect(coach).toHaveClass(/open/);
      await expectInViewport(coach);
      await expectInViewport(closeCoach);
      await expectInViewport(input);
      await expect(input).toBeFocused();

      const coachMetrics = await coach.evaluate((element) => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      }));
      expect(coachMetrics.scrollHeight).toBeGreaterThan(coachMetrics.clientHeight);

      await input.evaluate((element) => {
        element.scrollIntoView({ block: "center", inline: "nearest" });
      });
      await expect.poll(() => coach.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(0);
      await expectInViewport(input);
      await input.focus();
      await input.fill("帮我生成一个记忆钩子");
      await expect(input).toBeFocused();
      await expect(input).toHaveValue("帮我生成一个记忆钩子");

      await coach.evaluate((element) => {
        element.scrollTop = 0;
      });
      await expect.poll(() => coach.evaluate((element) => element.scrollTop)).toBe(0);
      await expectInViewport(closeCoach);

      await coach.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await expect.poll(() => coach.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(0);
      await expectInViewport(closeCoach);
      await closeCoach.click();
      await expect(coach).not.toBeVisible();
    }
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

test("详情态学习工具栏与 960px 内容轴左缘对齐且不扩成宽卡", async ({ context, page }) => {
  await installStateSeed(context, createState());
  const viewports = [
    { width: 1366, height: 900 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
    { width: 820, height: 900 },
    { width: 390, height: 844 },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await openApp(page);

    const stateA = await learningGeometry(page);
    expect(stateA.detailMode).toBe(false);
    expect(Math.abs(stateA.learningContext.left - stateA.studyMainStack.left))
      .toBeLessThanOrEqual(1);
    if (viewport.width <= 820) {
      expect(Math.abs(stateA.learningContext.width - stateA.studyMainStack.width))
        .toBeLessThanOrEqual(1);
    } else {
      expect(stateA.learningContext.width).toBeLessThan(stateA.studyMainStack.width);
    }
    expect(stateA.documentScrollWidth)
      .toBeLessThanOrEqual(stateA.documentClientWidth + 2);
    expect(stateA.bodyScrollWidth).toBeLessThanOrEqual(stateA.bodyClientWidth + 2);

    await page.getByRole("button", { name: "显示单词释义" }).click();
    const detail = await learningGeometry(page);
    expect(detail.detailMode).toBe(true);
    expect(Math.abs(detail.learningContext.left - detail.orbitStage.left))
      .toBeLessThanOrEqual(1);
    expect(detail.learningContext.width).toBeLessThan(detail.orbitStage.width - 8);
    expect(Math.abs(
      detail.orbitStage.width - Math.min(960, detail.studyMainStack.width - 48),
    )).toBeLessThanOrEqual(1);
    expect(detail.documentScrollWidth)
      .toBeLessThanOrEqual(detail.documentClientWidth + 2);
    expect(detail.bodyScrollWidth).toBeLessThanOrEqual(detail.bodyClientWidth + 2);

    await page.reload();
  }
});
