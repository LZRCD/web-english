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

async function openHistory(page) {
  await openApp(page);
  await page
    .getByRole("complementary", { name: "主导航" })
    .getByRole("button", { name: /轨迹/ })
    .click();
  await expect(page.getByRole("heading", { name: "当前状态" })).toBeVisible();
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

async function expectOrderSwitchTouchTargets(page, sameRow) {
  const context = page.getByRole("group", { name: "学习范围" });
  const studyPicker = context.locator(".study-picker");
  const buttons = ["顺序", "乱序", "全书"].map((name) =>
    context.getByRole("button", { name, exact: true }));
  const geometry = await context.evaluate((element) => {
    const contextRect = element.getBoundingClientRect();
    const pickerRect = element.querySelector(".study-picker")?.getBoundingClientRect();
    const buttonRects = [...element.querySelectorAll(".order-switch button")]
      .map((button) => {
        const rect = button.getBoundingClientRect();
        return {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
      });
    return {
      context: {
        left: contextRect.left,
        top: contextRect.top,
        right: contextRect.right,
        bottom: contextRect.bottom,
      },
      picker: pickerRect && {
        top: pickerRect.top,
        bottom: pickerRect.bottom,
      },
      buttons: buttonRects,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });

  expect(geometry.buttons).toHaveLength(3);
  for (const [index, rect] of geometry.buttons.entries()) {
    expect(rect.width, `${buttons[index]} 宽度`).toBeGreaterThanOrEqual(39);
    expect(rect.height, `${buttons[index]} 高度`).toBeGreaterThanOrEqual(39);
    expect(rect.left).toBeGreaterThanOrEqual(geometry.context.left - 1);
    expect(rect.top).toBeGreaterThanOrEqual(geometry.context.top - 1);
    expect(rect.right).toBeLessThanOrEqual(geometry.context.right + 1);
    expect(rect.bottom).toBeLessThanOrEqual(geometry.context.bottom + 1);
    expect(rect.left).toBeGreaterThanOrEqual(-1);
    expect(rect.top).toBeGreaterThanOrEqual(-1);
    expect(rect.right).toBeLessThanOrEqual(geometry.viewport.width + 1);
    expect(rect.bottom).toBeLessThanOrEqual(geometry.viewport.height + 1);
  }
  for (let index = 1; index < geometry.buttons.length; index += 1) {
    expect(geometry.buttons[index].left)
      .toBeGreaterThanOrEqual(geometry.buttons[index - 1].right - 1);
  }
  if (sameRow) {
    await expect(studyPicker).toBeVisible();
    const pickerCenter = (geometry.picker.top + geometry.picker.bottom) / 2;
    const switchCenter = (
      geometry.buttons[0].top + geometry.buttons[0].bottom
    ) / 2;
    expect(Math.abs(pickerCenter - switchCenter)).toBeLessThanOrEqual(1);
  }
  await expectNoHorizontalOverflow(page);
  return { context, buttons };
}

async function expectWordbookTabTouchTargets(page) {
  const tablist = page.getByRole("tablist", { name: "词本分类" });
  const tabs = ["我的词本", "错词记录", "顽固词", "划词集"].map((name) =>
    tablist.getByRole("tab", { name: new RegExp(name) }));
  const geometry = await tablist.evaluate((element) => {
    const listRect = element.getBoundingClientRect();
    const tabRects = [...element.querySelectorAll('[role="tab"]')].map((tab) => {
      const rect = tab.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    });
    return {
      list: {
        left: listRect.left,
        top: listRect.top,
        right: listRect.right,
        bottom: listRect.bottom,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      },
      tabs: tabRects,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });

  expect(geometry.tabs).toHaveLength(4);
  expect(geometry.list.scrollWidth).toBeLessThanOrEqual(geometry.list.clientWidth);
  for (const rect of geometry.tabs) {
    expect(rect.width).toBeGreaterThanOrEqual(39);
    expect(rect.height).toBeGreaterThanOrEqual(39);
    expect(rect.left).toBeGreaterThanOrEqual(geometry.list.left - 1);
    expect(rect.top).toBeGreaterThanOrEqual(geometry.list.top - 1);
    expect(rect.right).toBeLessThanOrEqual(geometry.list.right + 1);
    expect(rect.bottom).toBeLessThanOrEqual(geometry.list.bottom + 1);
    expect(rect.left).toBeGreaterThanOrEqual(-1);
    expect(rect.top).toBeGreaterThanOrEqual(-1);
    expect(rect.right).toBeLessThanOrEqual(geometry.viewport.width + 1);
    expect(rect.bottom).toBeLessThanOrEqual(geometry.viewport.height + 1);
  }
  for (let index = 1; index < geometry.tabs.length; index += 1) {
    expect(geometry.tabs[index].left)
      .toBeGreaterThanOrEqual(geometry.tabs[index - 1].right - 1);
  }
  await expectNoHorizontalOverflow(page);
  return { tablist, tabs };
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

test("轨迹页七个目标视口保持首屏行动、局部滚动与页面级 reflow", async ({ context, page }) => {
  test.setTimeout(90_000);
  const now = new Date();
  const reviewedAt = new Date(now.getTime() - 86_400_000).toISOString();
  const nextDueAt = new Date(now.getTime() + 86_400_000).toISOString();
  await installStateSeed(context, createState({
    reviews: [{
      id: "trace-responsive-review",
      wordId: 1,
      word: "radiate",
      rating: 1,
      kind: "review",
      intervalMs: 86_400_000,
      dueAt: nextDueAt,
      reviewedAt,
      section: "必考词",
      unit: 1,
    }],
    wordProgress: {
      1: {
        wordId: 1,
        status: "reviewing",
        firstLearnedAt: reviewedAt,
        lastReviewedAt: reviewedAt,
        nextDueAt,
        lastRating: 1,
        reviewCount: 1,
        successCount: 0,
        lapseCount: 0,
        consecutiveSuccesses: 0,
        intervalMs: 86_400_000,
        fsrsCard: {
          due: nextDueAt,
          stability: 1,
          difficulty: 6,
          elapsedDays: 1,
          scheduledDays: 1,
          learningSteps: 0,
          reps: 1,
          lapses: 0,
          state: 2,
          lastReview: reviewedAt,
        },
      },
    },
    lookupWords: [{
      id: 1,
      linkedWordId: 1,
      query: "radiate",
      kind: "word",
      phonetic: "/ˈreɪdieɪt/",
      part: "v.",
      meaning: "辐射；散发",
      note: "",
      source: "redbook",
      addedAt: reviewedAt,
    }],
    lookupStats: {
      radiate: {
        count: 3,
        firstAt: reviewedAt,
        lastAt: now.toISOString(),
      },
    },
  }));
  const viewports = [
    { width: 1920, height: 1080 },
    { width: 1440, height: 900 },
    { width: 1600, height: 880 },
    { width: 390, height: 844 },
    { width: 320, height: 640 },
    { width: 720, height: 450 },
    { width: 360, height: 225 },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await openHistory(page);
    const currentStatus = page.locator('section[aria-labelledby="current-status-title"]');
    const action = currentStatus.locator(".trace-primary-action");
    const actionButton = action.getByRole("button");
    const forecastScroll = page.getByRole("region", {
      name: "未来 30 天到期复习图表，可横向滚动",
    });
    const metrics = page.locator('details[aria-label="近 7 日详细指标"]');
    const analysis = page.locator('details[aria-label="详细学习分析"]');

    const layout = await page.evaluate(() => {
      const current = document.querySelector('section[aria-labelledby="current-status-title"]');
      const actionElement = current?.querySelector(".trace-primary-action");
      const actionControl = actionElement?.querySelector("button");
      const weekly = document.getElementById("weekly-report-title");
      const hero = document.querySelector(".trace-hero");
      if (!current || !actionElement || !actionControl || !weekly || !hero) {
        throw new Error("轨迹首屏布局节点不完整");
      }
      const box = (element) => {
        const rect = element.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
      };
      return {
        documentClient: document.documentElement.clientWidth,
        documentScroll: document.documentElement.scrollWidth,
        bodyScroll: document.body.scrollWidth,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        hero: box(hero),
        current: box(current),
        action: box(actionElement),
        actionControl: box(actionControl),
        weekly: box(weekly),
      };
    });

    expect(layout.documentScroll).toBeLessThanOrEqual(layout.documentClient + 2);
    expect(layout.bodyScroll).toBeLessThanOrEqual(layout.innerWidth + 2);
    expect(layout.hero.top).toBeGreaterThanOrEqual(-1);
    expect(layout.hero.top).toBeLessThanOrEqual(170);
    if (viewport.height >= 450) {
      expect(layout.current.top).toBeLessThan(layout.innerHeight);
    }
    expect(layout.actionControl.width).toBeGreaterThanOrEqual(40);
    expect(layout.actionControl.height).toBeGreaterThanOrEqual(40);

    if (viewport.width >= 1000) {
      expect(layout.action.bottom).toBeLessThanOrEqual(layout.innerHeight);
      expect(layout.weekly.top).toBeLessThan(layout.innerHeight);
    } else if (viewport.height >= 640) {
      expect(layout.action.top).toBeLessThan(layout.innerHeight + 160);
    }

    await forecastScroll.scrollIntoViewIfNeeded();
    if (viewport.width <= 720) {
      await expect.poll(() => forecastScroll.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      )).toBe(true);
    }
    await expectNoHorizontalOverflow(page);

    const rail = page.getByRole("complementary", { name: "主导航" });
    await expect(rail).toBeVisible();
    if (viewport.height <= 450) await expectInViewport(rail);

    if (viewport.width <= 720) {
      await expect(actionButton).toBeVisible();
      const touchTargets = [
        metrics.locator(":scope > summary"),
        analysis.locator(":scope > summary"),
        page.locator(".activity-range").getByRole("button", { name: "20 周" }),
        page.locator(".activity-range").getByRole("button", { name: "半年" }),
        page.locator(".activity-range").getByRole("button", { name: "一年" }),
        page.locator(".activity-nav").getByRole("button", { name: "查看更早日期" }),
        page.locator(".activity-nav").getByRole("button", { name: "查看更近日期" }),
        page.locator(".concentration-sprint").first(),
      ];
      for (const target of touchTargets) {
        await target.scrollIntoViewIfNeeded();
        const size = await target.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        });
        expect(size.width).toBeGreaterThanOrEqual(39);
        expect(size.height).toBeGreaterThanOrEqual(39);
      }
    }

    if (viewport.height <= 450) {
      for (const details of [metrics, analysis]) {
        const summary = details.locator(":scope > summary");
        await summary.scrollIntoViewIfNeeded();
        await summary.click();
        await expect.poll(() => details.evaluate((element) => element.open)).toBe(true);
        await summary.click();
        await expect.poll(() => details.evaluate((element) => element.open)).toBe(false);
      }
      await rail.getByRole("button", { name: /学习/ }).click();
      await expect(page.locator(".learn-view")).toBeVisible();
    }
  }
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

test("390px 与 320px 下词本四分类 Tab 可触达且完整容纳", async ({ context, page }) => {
  await installStateSeed(context, createState({
    favorites: [
      { wordId: 1, addedAt: "2026-07-29T07:00:00.000Z" },
    ],
    lookupWords: [
      { wordId: 2, query: "objective", meaning: "目标", addedAt: "2026-07-29T07:00:00.000Z" },
    ],
  }));
  const viewports = [
    { width: 390, height: 844 },
    { width: 320, height: 640 },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await openApp(page);
    await openWordbook(page);
    const { tabs } = await expectWordbookTabTouchTargets(page);
    const [favorites, mistakes, stubborn, lookups] = tabs;

    await mistakes.click();
    await expect(mistakes).toHaveAttribute("aria-selected", "true");
    await expect(favorites).toHaveAttribute("aria-selected", "false");
    await expect(page.getByRole("button", { name: "强化当前错词" })).toBeVisible();

    await stubborn.click();
    await expect(stubborn).toHaveAttribute("aria-selected", "true");
    await expect(mistakes).toHaveAttribute("aria-selected", "false");
    await expect(page.getByRole("button", { name: "开始顽固词专项" })).toBeVisible();

    await lookups.click();
    await expect(lookups).toHaveAttribute("aria-selected", "true");
    await expect(stubborn).toHaveAttribute("aria-selected", "false");
    await expect(page.getByRole("button", { name: "学习划词集" })).toBeVisible();

    await favorites.click();
    await expect(favorites).toHaveAttribute("aria-selected", "true");
    await expect(lookups).toHaveAttribute("aria-selected", "false");
    await expect(page.getByRole("button", { name: "复习全部收藏" })).toBeVisible();
  }
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

/** 学习页几何快照：剩余学习区 + 学习舞台 + 词卡核心节点。 */
async function studyGeometry(page) {
  return page.evaluate(() => {
    const box = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2,
        paddingLeft: parseFloat(style.paddingLeft) || 0,
        paddingRight: parseFloat(style.paddingRight) || 0,
        paddingTop: parseFloat(style.paddingTop) || 0,
        paddingBottom: parseFloat(style.paddingBottom) || 0,
        clientWidth: element.clientWidth,
        clientHeight: element.clientHeight,
        scrollWidth: element.scrollWidth,
        scrollHeight: element.scrollHeight,
        scrollTop: element.scrollTop,
        overflowY: style.overflowY,
      };
    };
    const learnView = document.querySelector(".learn-view");
    const workspace = document.querySelector(".workspace");
    const stack = document.querySelector(".study-main-stack");
    const stage = document.querySelector(".study-card-stage");
    const orbit = document.querySelector(".orbit-stage");
    const card = document.querySelector(".word-card");
    const wordFace = document.querySelector(".word-face");
    const wordHeading = document.querySelector(".word-heading");
    const word = document.querySelector(".word-face h1");
    const taskStrip = document.querySelector(".today-task-strip");
    if (!learnView || !workspace || !stack || !stage || !orbit) {
      throw new Error("学习页布局节点不完整");
    }
    const stackBox = box(stack);
    return {
      detailMode: learnView.classList.contains("detail-mode"),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      learnView: box(learnView),
      workspace: box(workspace),
      stack: stackBox,
      stage: box(stage),
      orbit: box(orbit),
      card: box(card),
      wordFace: box(wordFace),
      wordHeading: box(wordHeading),
      word: box(word),
      taskStrip: box(taskStrip),
      sourceLabel: document.querySelector(".word-source span")?.textContent ?? null,
      // 内容盒中心：扣除 padding 与滚动条槽位（scrollbar-gutter: stable）
      stackContentCenterX: stackBox.left
        + stackBox.paddingLeft
        + (stackBox.clientWidth - stackBox.paddingLeft - stackBox.paddingRight) / 2,
      stackContentCenterY: stackBox.top
        + stackBox.paddingTop
        + (stackBox.clientHeight - stackBox.paddingTop - stackBox.paddingBottom) / 2,
      document: {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        clientHeight: document.documentElement.clientHeight,
        scrollHeight: document.documentElement.scrollHeight,
      },
    };
  });
}

/** 学习舞台居中契约：水平严格居中；放得下时垂直居中，放不下时顶部可达并可滚动。 */
function assertStudyStageCentering(geometry, label) {
  expect(
    Math.abs(geometry.orbit.centerX - geometry.stackContentCenterX),
    `${label} orbit 水平中心偏差`,
  ).toBeLessThanOrEqual(2);
  expect(
    Math.abs(geometry.stage.width - geometry.stack.clientWidth),
    `${label} 舞台宽度`,
  ).toBeLessThanOrEqual(2);

  const stackContentHeight = geometry.stack.clientHeight
    - geometry.stack.paddingTop - geometry.stack.paddingBottom;
  if (geometry.stage.height <= stackContentHeight + 1) {
    expect(geometry.card, `${label} 词卡存在`).not.toBeNull();
    expect(
      Math.abs(geometry.card.centerY - geometry.stackContentCenterY),
      `${label} 词卡垂直中心偏差`,
    ).toBeLessThanOrEqual(24);
  } else {
    expect(geometry.stage.top, `${label} 顶部可达`)
      .toBeGreaterThanOrEqual(geometry.stack.top - 1);
    expect(geometry.stack.scrollHeight, `${label} 栈内可滚动`)
      .toBeGreaterThan(geometry.stack.clientHeight);
    // 内部滚动时不叠加 learn-view 第二根滚动条
    expect(geometry.learnView.scrollHeight, `${label} 无嵌套双滚动`)
      .toBeLessThanOrEqual(geometry.learnView.clientHeight + 2);
  }
  expect(geometry.document.scrollWidth, `${label} 页面横向溢出`)
    .toBeLessThanOrEqual(geometry.document.clientWidth + 2);
  if (geometry.viewport.width > 820) {
    expect(geometry.document.scrollHeight, `${label} 页面纵向滚动`)
      .toBeLessThanOrEqual(geometry.document.clientHeight + 2);
  }
}

/** 「今日到期」来源所需的到期进度记录（nextDueAt 已过）。 */
function dueTodayProgress(wordId) {
  const nextDueAt = geometryDaysAgo(1, 9);
  return {
    wordId,
    status: "reviewing",
    firstLearnedAt: geometryDaysAgo(7, 8),
    lastReviewedAt: geometryDaysAgo(7, 8),
    nextDueAt,
    lastRating: 1,
    reviewCount: 1,
    successCount: 0,
    lapseCount: 0,
    consecutiveSuccesses: 0,
    intervalMs: 86_400_000,
    fsrsCard: {
      due: nextDueAt,
      stability: 1,
      difficulty: 6,
      elapsedDays: 1,
      scheduledDays: 1,
      learningSteps: 0,
      reps: 1,
      lapses: 0,
      state: 2,
      lastReview: geometryDaysAgo(7, 8),
    },
  };
}

const STUDY_VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1536, height: 864 },
  { width: 1366, height: 768 },
  { width: 1024, height: 768 },
  { width: 820, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 640 },
];

test("自由学习下主卡在七个目标视口随剩余学习区居中", async ({ context, page }) => {
  test.setTimeout(120_000);
  await installStateSeed(context, createState());

  for (const viewport of STUDY_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await openApp(page);

    const label = `${viewport.width}×${viewport.height} 自由学习`;
    const geometry = await studyGeometry(page);
    expect(geometry.taskStrip, `${label} 任务预览`).not.toBeNull();
    assertStudyStageCentering(geometry, label);
    await expectNoHorizontalOverflow(page);

    await page.reload();
  }
});

test("进入学习会话后任务预览消失且主卡仍在剩余区内居中", async ({ context, page }) => {
  test.setTimeout(120_000);
  await installStateSeed(context, createState({
    activeSession: {
      id: "today-geometry-session",
      kind: "today",
      title: "今日任务",
      wordIds: [1, 2],
      index: 0,
      // today 会话仅在 createdAt 为今天时才会被恢复（否则被清理为自由学习）
      createdAt: new Date().toISOString(),
    },
  }));

  for (const viewport of STUDY_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await openApp(page);

    const label = `${viewport.width}×${viewport.height} 会话中`;
    const geometry = await studyGeometry(page);
    expect(geometry.taskStrip, `${label} 任务预览`).toBeNull();
    assertStudyStageCentering(geometry, label);
    await expectNoHorizontalOverflow(page);

    await page.reload();
  }
});

test("开始今日任务后任务预览移除，舞台自动在扩大后的剩余区内重新居中", async ({ context, page }) => {
  await installStateSeed(context, createState());
  await page.setViewportSize({ width: 1600, height: 880 });
  await openApp(page);

  const free = await studyGeometry(page);
  expect(free.taskStrip).not.toBeNull();
  assertStudyStageCentering(free, "自由学习");

  await page.locator(".today-task-strip").click();
  await expect(page.locator(".today-task-strip")).toHaveCount(0);
  const session = await studyGeometry(page);
  expect(session.taskStrip).toBeNull();
  assertStudyStageCentering(session, "进入会话");

  // 剩余区随任务预览移除而增高，舞台在两个状态下都保持居中：
  // 词卡相对 stack 顶部的偏移应按（任务栏高度 + 间距）的一半下移
  const freeCardOffset = free.card.top - free.stack.top;
  const sessionCardOffset = session.card.top - session.stack.top;
  expect(session.stack.height)
    .toBeGreaterThanOrEqual(free.stack.height + free.taskStrip.height + 8);
  expect(sessionCardOffset)
    .toBeGreaterThanOrEqual(freeCardOffset + free.taskStrip.height / 2 + 4);
});

test("四种来源说明下词卡核心词面保持稳定", async ({ browser }) => {
  test.setTimeout(120_000);
  const viewport = { width: 1280, height: 900 };
  const scenarios = [
    { label: "当前词书额外练习", state: createState() },
    {
      label: "今日新词",
      state: createState({
        activeSession: {
          id: "source-today-new",
          kind: "today",
          title: "今日任务",
          wordIds: [1],
          index: 0,
          createdAt: new Date().toISOString(),
        },
      }),
    },
    {
      label: "今日到期",
      state: createState({
        activeSession: {
          id: "source-today-due",
          kind: "today",
          title: "今日任务",
          wordIds: [1],
          index: 0,
          createdAt: new Date().toISOString(),
        },
        wordProgress: { 1: dueTodayProgress(1) },
      }),
    },
    {
      label: "搜索专项",
      state: createState({
        activeSession: {
          id: "source-search",
          kind: "search",
          title: "搜索专项",
          wordIds: [1],
          index: 0,
          createdAt: "2026-07-29T07:00:00.000Z",
        },
      }),
    },
  ];

  const offsets = (geometry) => ({
    cardWidth: geometry.card.width,
    cardHeight: geometry.card.height,
    wordFaceLeft: geometry.wordFace.left - geometry.card.left,
    wordFaceTop: geometry.wordFace.top - geometry.card.top,
    wordFaceWidth: geometry.wordFace.width,
    wordFaceHeight: geometry.wordFace.height,
    wordX: geometry.word.centerX - geometry.card.left,
    wordY: geometry.word.centerY - geometry.card.top,
  });

  const snapshots = [];
  for (const scenario of scenarios) {
    const context = await browser.newContext({ viewport });
    try {
      const page = await context.newPage();
      await installStateSeed(context, scenario.state);
      await openApp(page);
      await expect(page.locator(".word-source span")).toHaveText(scenario.label);
      const geometry = await studyGeometry(page);
      expect(geometry.card, scenario.label).not.toBeNull();
      snapshots.push({ label: scenario.label, geometry });
    } finally {
      await context.close();
    }
  }

  const reference = offsets(snapshots[0].geometry);
  for (const { label, geometry } of snapshots.slice(1)) {
    const candidate = offsets(geometry);
    for (const key of Object.keys(reference)) {
      expect(
        Math.abs(candidate[key] - reference[key]),
        `${label} 词卡内部几何 ${key}`,
      ).toBeLessThanOrEqual(2);
    }
    expect(
      Math.abs(geometry.card.left - snapshots[0].geometry.card.left),
      `${label} 词卡 left`,
    ).toBeLessThanOrEqual(2);
  }
  // 会话态（无任务预览）之间词卡顶部也一致
  for (let index = 1; index < snapshots.length - 1; index += 1) {
    expect(
      Math.abs(snapshots[index + 1].geometry.card.top - snapshots[index].geometry.card.top),
      `${snapshots[index].label}/${snapshots[index + 1].label} 词卡 top`,
    ).toBeLessThanOrEqual(2);
  }
});

test("同一会话切换长短词时词卡矩形保持稳定", async ({ context, page }) => {
  await page.route("**/data/redbook.json*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      metadata: {
        title: "2027考研英语红宝书",
        total: 2,
        sectionCounts: { 必考词: 2, 基础词: 0, 超纲词: 0 },
      },
      words: [
        { id: 1, word: "go", phonetic: "/ɡoʊ/", meaning: "v. 去；进行", section: "必考词", unit: 1 },
        { id: 2, word: "counterproductive", phonetic: "/ˌkaʊntərprəˈdʌktɪv/", meaning: "adj. 适得其反的", section: "必考词", unit: 1 },
      ],
    }),
  }));
  await installStateSeed(context, createState({
    activeSession: {
      id: "word-length-session",
      kind: "search",
      title: "长短词会话",
      wordIds: [1, 2],
      index: 0,
      createdAt: "2026-07-29T07:00:00.000Z",
    },
  }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await openApp(page);

  await expect(page.getByRole("heading", { name: "go" })).toBeVisible();
  const shortWord = await studyGeometry(page);

  await page.getByRole("button", { name: "显示单词释义" }).click();
  await page.getByRole("button", { name: /认识/ }).click();
  await expect(page.getByRole("heading", { name: "counterproductive" })).toBeVisible();
  const longWord = await studyGeometry(page);

  for (const key of ["left", "top", "width", "height"]) {
    expect(Math.abs(longWord.card[key] - shortWord.card[key]), `长短词切换 词卡 ${key}`)
      .toBeLessThanOrEqual(2);
  }
  await expectNoHorizontalOverflow(page);
});

test("Study Detail 保持顶部流式长页面且舞台不参与居中", async ({ context, page }) => {
  await installStateSeed(context, createState());
  const viewports = [
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await openApp(page);
    await page.getByRole("button", { name: "显示单词释义" }).click();

    const detail = await studyGeometry(page);
    expect(detail.detailMode).toBe(true);
    expect(detail.card, "详情态不再渲染词卡").toBeNull();
    // 顶部对齐：舞台贴近 study-main-stack 顶部，不垂直居中
    expect(detail.stage.top, `${viewport.width}px 详情态顶部对齐`)
      .toBeLessThanOrEqual(detail.stack.top + 3);
    // learn-view 是唯一纵向滚动源
    expect(await page.locator(".learn-view").evaluate(
      (element) => getComputedStyle(element).overflowY,
    )).toBe("auto");
    // Sticky 评分栏
    expect(await page.locator(".rating-bar").evaluate(
      (element) => getComputedStyle(element).position,
    )).toBe("sticky");
    await expectNoHorizontalOverflow(page);

    await page.reload();
  }
});

test("极矮屏学习区完整可滚动且撤销按钮不遮挡词卡与操作", async ({ context, page }) => {
  test.setTimeout(120_000);
  await installStateSeed(context, createState());
  const shortViewports = [
    { width: 1024, height: 500 },
    { width: 390, height: 500 },
  ];

  for (const viewport of shortViewports) {
    await page.setViewportSize(viewport);
    await openApp(page);

    const label = `${viewport.width}×${viewport.height}`;
    const top = await studyGeometry(page);
    expect(top.stack.scrollHeight, `${label} 栈内可滚动`)
      .toBeGreaterThan(top.stack.clientHeight);
    expect(top.stage.top, `${label} 顶部可达`)
      .toBeGreaterThanOrEqual(top.stack.top - 1);
    expect(top.card.top, `${label} 词卡顶部可达`)
      .toBeGreaterThanOrEqual(top.stack.top - 1);
    expect(top.learnView.scrollHeight, `${label} 无嵌套双滚动`)
      .toBeLessThanOrEqual(top.learnView.clientHeight + 2);

    // 滚到底部：词卡底部完整可达（词卡高于可视区时顶部越出上方是正常滚动行为）
    await page.locator(".study-main-stack").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const bottom = await studyGeometry(page);
    expect(bottom.stack.scrollTop, `${label} 实际发生滚动`).toBeGreaterThan(0);
    expect(bottom.card.bottom, `${label} 词卡底部可达`)
      .toBeLessThanOrEqual(bottom.stack.bottom + 1);
    await expectNoHorizontalOverflow(page);

    // 回到顶部：词卡顶部重新可达
    await page.locator(".study-main-stack").evaluate((element) => {
      element.scrollTop = 0;
    });
    const restored = await studyGeometry(page);
    expect(restored.card.top, `${label} 回到顶部后词卡顶部可达`)
      .toBeGreaterThanOrEqual(restored.stack.top - 1);

    await page.reload();
  }

  // 撤销按钮：评分后出现，不遮挡词卡与评分栏
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await openApp(page);
    await page.getByRole("button", { name: "显示单词释义" }).click();
    await page.getByRole("button", { name: /认识/ }).click();
    await expect(page.locator(".undo-forever")).toBeVisible({ timeout: 10_000 });
    const overlap = await page.evaluate(() => {
      const undo = document.querySelector(".undo-forever")?.getBoundingClientRect();
      const card = document.querySelector(".word-card")?.getBoundingClientRect();
      const rating = document.querySelector(".rating-bar")?.getBoundingClientRect();
      if (!undo || !card) throw new Error("撤销按钮或词卡不存在");
      const intersects = (first, second) => first.left < second.right - 1
        && second.left < first.right - 1
        && first.top < second.bottom - 1
        && second.top < first.bottom - 1;
      return {
        card: intersects(undo, card),
        rating: rating && rating.width > 0 ? intersects(undo, rating) : false,
      };
    });
    expect(overlap.card, `${viewport.width}px 撤销按钮遮挡词卡`).toBe(false);
    expect(overlap.rating, `${viewport.width}px 撤销按钮遮挡评分栏`).toBe(false);
    await page.reload();
  }
});

test("390px 与 320px 下学习顺序控件可触达且不会重叠", async ({ context, page }) => {
  await installStateSeed(context, createState());
  const viewports = [
    { width: 390, height: 844 },
    { width: 320, height: 640 },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await openApp(page);
    const orderSwitch = await expectOrderSwitchTouchTargets(
      page,
      viewport.width === 390,
    );

    if (viewport.width === 390) {
      const [ordered, shuffled, all] = orderSwitch.buttons;
      await shuffled.click();
      await expect(shuffled).toHaveAttribute("aria-pressed", "true");
      await expect(ordered).toHaveAttribute("aria-pressed", "false");

      await ordered.click();
      await expect(ordered).toHaveAttribute("aria-pressed", "true");
      await expect(shuffled).toHaveAttribute("aria-pressed", "false");

      await all.click();
      await expect(all).toHaveAttribute("aria-pressed", "true");
      await expect(ordered).toHaveAttribute("aria-pressed", "false");
      await expect(page.locator(".learn-topbar .topbar-title"))
        .toHaveText(/全书 \d+ 学习项 · 乱序/);
    }
  }
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

    if (viewport.width === 390) {
      const detailLayout = await page.evaluate(() => {
        const contextElement = document.querySelector(".learning-context");
        const meaning = document.querySelector('[aria-label="释义与例句"]');
        if (!contextElement || !meaning) throw new Error("详情态布局节点不完整");
        const contextRect = contextElement.getBoundingClientRect();
        const meaningRect = meaning.getBoundingClientRect();
        return {
          contextHeight: contextRect.height,
          meaningTop: meaningRect.top,
          viewportHeight: window.innerHeight,
        };
      });
      expect(detailLayout.contextHeight).toBeLessThanOrEqual(110);
      expect(detailLayout.meaningTop).toBeLessThan(detailLayout.viewportHeight);
    }

    await page.reload();
  }
});

/* ---------- 轨迹页几何验收 ---------- */

function rectsOverlap(first, second) {
  return first && second
    && first.left < second.right - 1
    && second.left < first.right - 1
    && first.top < second.bottom - 1
    && second.top < first.bottom - 1;
}

function geometryDaysAgo(days, hour = 12) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

function geometryRedbookWords() {
  const words = [];
  for (let id = 1; id <= 12; id += 1) {
    words.push({
      id,
      word: `weak-${id}`,
      phonetic: "/test/",
      meaning: "v. 测试",
      section: "必考词",
      unit: 1,
    });
  }
  for (let id = 21; id <= 23; id += 1) {
    words.push({
      id,
      word: `weak-${id}`,
      phonetic: "/test/",
      meaning: "n. 测试",
      section: "基础词",
      unit: 1,
    });
  }
  return words;
}

function geometryWeakReviews() {
  const reviews = [];
  for (let wordId = 1; wordId <= 12; wordId += 1) {
    reviews.push({
      id: `geo-w${wordId}`,
      wordId,
      word: `weak-${wordId}`,
      rating: wordId % 2 === 0 ? 0 : 1,
      kind: "review",
      intervalMs: 86_400_000,
      dueAt: geometryDaysAgo(-1, 9),
      reviewedAt: geometryDaysAgo((wordId % 3) + 1, 8),
      section: "必考词",
      unit: 1,
    });
  }
  for (const wordId of [21, 22, 23]) {
    reviews.push({
      id: `geo-w${wordId}`,
      wordId,
      word: `weak-${wordId}`,
      rating: 0,
      kind: "review",
      intervalMs: 86_400_000,
      dueAt: geometryDaysAgo(-1, 9),
      reviewedAt: geometryDaysAgo((wordId % 3) + 1, 8),
      section: "基础词",
      unit: 1,
    });
  }
  return reviews;
}

function geometryLookupSeed() {
  const lookupWords = [];
  const lookupStats = {};
  const ids = [...Array.from({ length: 12 }, (_, index) => index + 1), 21, 22, 23];
  for (const wordId of ids) {
    lookupWords.push({
      id: 9_000_000_000 + wordId,
      linkedWordId: wordId,
      query: `weak-${wordId}`,
      kind: "word",
      phonetic: "/test/",
      part: "v.",
      meaning: "测试",
      note: "",
      source: "redbook",
      addedAt: geometryDaysAgo(6, 8),
    });
    lookupStats[`weak-${wordId}`] = {
      count: 3,
      firstAt: geometryDaysAgo(7, 8),
      lastAt: geometryDaysAgo(1, 8),
    };
  }
  return { lookupWords, lookupStats };
}

function geometryForecastProgress() {
  const base = (wordId, nextDueAt) => ({
    wordId,
    status: "reviewing",
    firstLearnedAt: geometryDaysAgo(7, 8),
    lastReviewedAt: geometryDaysAgo(7, 8),
    nextDueAt,
    lastRating: 2,
    reviewCount: 1,
    successCount: 1,
    lapseCount: 0,
    consecutiveSuccesses: 1,
    intervalMs: 7 * 86_400_000,
    fsrsCard: {
      due: nextDueAt,
      stability: 7,
      difficulty: 5,
      elapsedDays: 1,
      scheduledDays: 7,
      learningSteps: 0,
      reps: 1,
      lapses: 0,
      state: 2,
      lastReview: geometryDaysAgo(7, 8),
    },
  });
  return {
    101: base(101, geometryDaysAgo(-2, 9)),
    102: base(102, geometryDaysAgo(0, 23)),
    103: base(103, geometryDaysAgo(-1, 9)),
    104: base(104, geometryDaysAgo(-20, 9)),
    105: base(105, geometryDaysAgo(-29, 9)),
  };
}

async function traceGeometry(page) {
  return page.evaluate(() => {
    const rect = (element) => {
      if (!element) return null;
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
    const panel = document.querySelector(".activity-panel");
    const outer = document.querySelector(".activity-scroll");
    const heatmap = document.querySelector(".activity-heatmap-scroll");
    const forecastItems = [...document.querySelectorAll(".forecast-summary-item")]
      .map((item) => ({
        rect: rect(item),
        clipped: item.scrollWidth > item.clientWidth + 1,
        hasLabel: Boolean(item.querySelector("span")?.textContent?.trim()),
        hasValue: Boolean(item.querySelector("strong")?.textContent?.trim()),
      }));
    const weakRows = [...document.querySelectorAll(".weak-concentration-row")]
      .map((row) => {
        const countElement = row.querySelector(".weak-concentration-count");
        return {
          label: rect(row.querySelector(".weak-concentration-label")),
          track: rect(row.querySelector(".weak-concentration-track")),
          count: rect(countElement),
          sprint: rect(row.querySelector(".concentration-sprint")),
          countClipped: countElement
            ? countElement.scrollWidth > countElement.clientWidth + 1
            : true,
          countText: row.querySelector(".weak-concentration-count small")?.textContent ?? "",
        };
      });
    return {
      documentWidth: document.documentElement.clientWidth,
      documentScroll: document.documentElement.scrollWidth,
      bodyScroll: document.body.scrollWidth,
      innerWidth: window.innerWidth,
      forecastItems,
      weakRows,
      grid: rect(document.querySelector(".activity-grid")),
      summary: rect(document.querySelector(".activity-summary")),
      scroll: rect(outer),
      panel: panel && {
        clientWidth: panel.clientWidth,
        scrollWidth: panel.scrollWidth,
      },
      outer: outer && {
        clientWidth: outer.clientWidth,
        scrollWidth: outer.scrollWidth,
        overflowX: getComputedStyle(outer).overflowX,
      },
      heatmap: heatmap && {
        clientWidth: heatmap.clientWidth,
        scrollWidth: heatmap.scrollWidth,
        overflowX: getComputedStyle(heatmap).overflowX,
      },
    };
  });
}

test("轨迹页排程摘要、薄弱集中区与背诵日历九个视口不交叠且无页面级横向溢出", async ({ context, page }) => {
  test.setTimeout(120_000);
  await page.route("**/data/redbook.json*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      metadata: {
        title: "2027考研英语红宝书",
        total: 15,
        sectionCounts: { 必考词: 12, 基础词: 3, 超纲词: 0 },
      },
      words: geometryRedbookWords(),
    }),
  }));
  await installStateSeed(context, createState({
    reviews: geometryWeakReviews(),
    wordProgress: geometryForecastProgress(),
    ...geometryLookupSeed(),
  }));
  await openApp(page);
  await page
    .getByRole("complementary", { name: "主导航" })
    .getByRole("button", { name: /轨迹/ })
    .click();
  await expect(page.getByRole("heading", { name: "本周学习报告" })).toBeVisible();

  const viewports = [
    { width: 1920, height: 1080 },
    { width: 1600, height: 880 },
    { width: 1440, height: 900 },
    { width: 1180, height: 820 },
    { width: 820, height: 1180 },
    { width: 390, height: 844 },
    { width: 320, height: 640 },
    { width: 720, height: 450 },
    { width: 360, height: 225 },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    const geometry = await traceGeometry(page);

    // 页面级无横向溢出
    expect(geometry.documentScroll, `${viewport.width}px document`)
      .toBeLessThanOrEqual(geometry.documentWidth + 2);
    expect(geometry.bodyScroll, `${viewport.width}px body`)
      .toBeLessThanOrEqual(geometry.innerWidth + 2);

    // 未来排程摘要：恰好四个语义单元、互不交叠、标签与数值完整
    expect(geometry.forecastItems, `${viewport.width}px 摘要单元`).toHaveLength(4);
    for (const item of geometry.forecastItems) {
      expect(item.clipped, `${viewport.width}px 摘要裁切`).toBe(false);
      expect(item.hasLabel, `${viewport.width}px 摘要标签`).toBe(true);
      expect(item.hasValue, `${viewport.width}px 摘要数值`).toBe(true);
    }
    for (let first = 0; first < geometry.forecastItems.length; first += 1) {
      for (let second = first + 1; second < geometry.forecastItems.length; second += 1) {
        expect(
          rectsOverlap(geometry.forecastItems[first].rect, geometry.forecastItems[second].rect),
          `${viewport.width}px 摘要交叠`,
        ).toBe(false);
      }
    }
    const rowTops = new Set(geometry.forecastItems.map((item) => Math.round(item.rect.top)));
    if (viewport.width > 980) {
      expect(rowTops.size, `${viewport.width}px 四列`).toBe(1);
    } else if (viewport.width > 560) {
      expect(rowTops.size, `${viewport.width}px 两列`).toBe(2);
    } else {
      expect(rowTops.size, `${viewport.width}px 单列`).toBe(4);
    }

    // 薄弱集中区：进度条、数量说明、复习按钮互不交叠且完整可见
    expect(geometry.weakRows, `${viewport.width}px 薄弱行`).toHaveLength(2);
    for (const row of geometry.weakRows) {
      expect(row.countClipped, `${viewport.width}px 薄弱说明裁切`).toBe(false);
      expect(row.countText).toContain("贡献占比");
      expect(row.countText).toContain("分册内薄弱率");
      expect(row.sprint.width).toBeGreaterThanOrEqual(39);
      expect(row.sprint.height).toBeGreaterThanOrEqual(39);
      expect(rectsOverlap(row.count, row.track), `${viewport.width}px 说明压进度条`).toBe(false);
      expect(rectsOverlap(row.count, row.sprint), `${viewport.width}px 说明压按钮`).toBe(false);
      expect(rectsOverlap(row.track, row.sprint), `${viewport.width}px 进度条压按钮`).toBe(false);
    }
    if (viewport.width > 640) {
      const [firstRow, secondRow] = geometry.weakRows;
      expect(Math.abs(firstRow.track.left - secondRow.track.left),
        `${viewport.width}px 轨道左对齐`).toBeLessThanOrEqual(2);
      expect(Math.abs(firstRow.track.right - secondRow.track.right),
        `${viewport.width}px 轨道右对齐`).toBeLessThanOrEqual(2);
    } else {
      // 窄屏：数量说明移至进度条下方
      for (const row of geometry.weakRows) {
        expect(row.count.top, `${viewport.width}px 说明在轨道下方`)
          .toBeGreaterThanOrEqual(row.track.bottom - 1);
      }
    }

    // 背诵日历：卡片与外层容器永无横向滚动；热力图与摘要互不交叠
    expect(geometry.grid, `${viewport.width}px 热力图`).toBeTruthy();
    expect(geometry.summary, `${viewport.width}px 摘要`).toBeTruthy();
    expect(geometry.heatmap, `${viewport.width}px 热力图容器`).toBeTruthy();
    expect(geometry.panel.scrollWidth, `${viewport.width}px 卡片溢出`)
      .toBeLessThanOrEqual(geometry.panel.clientWidth + 1);
    expect(geometry.outer.scrollWidth, `${viewport.width}px 外层溢出`)
      .toBeLessThanOrEqual(geometry.outer.clientWidth + 1);
    expect(rectsOverlap(geometry.grid, geometry.summary), `${viewport.width}px 日历交叠`).toBe(false);
    if (viewport.width >= 1280) {
      // 桌面：左右排列，内容组居中平衡
      expect(geometry.summary.left, `${viewport.width}px 摘要居右`)
        .toBeGreaterThanOrEqual(geometry.grid.right + 15);
      expect(geometry.heatmap.scrollWidth, `${viewport.width}px 热力图溢出`)
        .toBeLessThanOrEqual(geometry.heatmap.clientWidth + 1);
      const leftGap = geometry.grid.left - geometry.scroll.left;
      const rightGap = geometry.scroll.right - geometry.summary.right;
      expect(Math.abs(leftGap - rightGap), `${viewport.width}px 日历居中`).toBeLessThanOrEqual(40);
    } else if (viewport.width >= 768) {
      // 平板：摘要移到热力图下方，整卡与热力图均不滚动
      expect(geometry.heatmap.scrollWidth, `${viewport.width}px 热力图溢出`)
        .toBeLessThanOrEqual(geometry.heatmap.clientWidth + 1);
      expect(geometry.summary.top, `${viewport.width}px 摘要下移`)
        .toBeGreaterThanOrEqual(geometry.grid.bottom - 1);
      expect(geometry.summary.right, `${viewport.width}px 摘要右缘`)
        .toBeLessThanOrEqual(geometry.documentWidth + 1);
    } else {
      // 移动端：摘要下移；仅专用热力图子容器允许横向滚动
      expect(geometry.heatmap.overflowX, `${viewport.width}px 热力图滚动容器`).toBe("auto");
      expect(geometry.summary.top, `${viewport.width}px 摘要下移`)
        .toBeGreaterThanOrEqual(geometry.grid.bottom - 1);
      expect(geometry.summary.right, `${viewport.width}px 摘要右缘`)
        .toBeLessThanOrEqual(geometry.documentWidth + 1);
      await expect(
        page.locator(".activity-nav").getByRole("button", { name: "查看更早日期" }),
      ).toBeVisible();
    }
  }

  // 140 / 182 / 365 天：卡片与外层容器在任何视口都不产生横向滚动；
  // 桌面热力图完整显示，移动端只有专用热力图子容器可以滚动
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const [label, expected] of [["20 周", 140], ["半年", 182], ["一年", 365]]) {
      await page.locator(".activity-range").getByRole("button", { name: label }).click();
      await expect(page.locator(".activity-cell")).toHaveCount(expected);
      const widths = await page.evaluate(() => ({
        documentScroll: document.documentElement.scrollWidth,
        documentWidth: document.documentElement.clientWidth,
        bodyScroll: document.body.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(widths.documentScroll, `${label}@${viewport.width} document`)
        .toBeLessThanOrEqual(widths.documentWidth + 2);
      expect(widths.bodyScroll, `${label}@${viewport.width} body`)
        .toBeLessThanOrEqual(widths.innerWidth + 2);
      const calendar = await traceGeometry(page);
      expect(calendar.panel.scrollWidth, `${label}@${viewport.width} 卡片溢出`)
        .toBeLessThanOrEqual(calendar.panel.clientWidth + 1);
      expect(calendar.outer.scrollWidth, `${label}@${viewport.width} 外层溢出`)
        .toBeLessThanOrEqual(calendar.outer.clientWidth + 1);
      if (viewport.width >= 768) {
        expect(calendar.heatmap.scrollWidth, `${label}@${viewport.width} 热力图溢出`)
          .toBeLessThanOrEqual(calendar.heatmap.clientWidth + 1);
      } else {
        expect(calendar.heatmap.overflowX, `${label}@${viewport.width} 热力图滚动容器`).toBe("auto");
      }
    }
  }

  // 悬停单元明细：浮层不越出视口且不造成页面级横向溢出
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator(".activity-range").getByRole("button", { name: "20 周" }).click();
  const firstRow = page.locator(".weak-concentration-row").first();
  await firstRow.hover();
  const units = firstRow.locator(".weak-concentration-units");
  await expect.poll(() => units.evaluate((element) => getComputedStyle(element).opacity))
    .toBe("1");
  const overlay = await units.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right };
  });
  const documentWidth = await page.evaluate(() => document.documentElement.clientWidth);
  expect(overlay.left).toBeGreaterThanOrEqual(-1);
  expect(overlay.right).toBeLessThanOrEqual(documentWidth + 1);
  await expectNoHorizontalOverflow(page);
});

/* ---------- 背诵日历一年范围：横向滚动彻底验收 ---------- */

function scrollProofReviews() {
  return [1, 2, 3, 4, 5, 6].map((wordId, index) => ({
    id: `scroll-${wordId}`,
    wordId,
    word: `scroll-${wordId}`,
    rating: 2,
    kind: index === 0 ? "new" : "review",
    intervalMs: 86_400_000,
    dueAt: geometryDaysAgo(-1, 9),
    reviewedAt: geometryDaysAgo(index + 1, 8),
    section: "必考词",
    unit: 1,
  }));
}

test("背诵日历一年范围在桌面与平板视口无任何横向滚动", async ({ context, page }) => {
  test.setTimeout(120_000);
  await installStateSeed(context, createState({
    reviews: scrollProofReviews(),
    wordProgress: {},
  }));
  await openApp(page);
  await page
    .getByRole("complementary", { name: "主导航" })
    .getByRole("button", { name: /轨迹/ })
    .click();
  await expect(page.getByRole("heading", { name: "本周学习报告" })).toBeVisible();
  await page.locator(".activity-range").getByRole("button", { name: "一年" }).click();
  await expect(page.locator(".activity-cell")).toHaveCount(365);

  const viewports = [
    { width: 1920, height: 1080 },
    { width: 1536, height: 864 },
    { width: 1440, height: 900 },
    { width: 1366, height: 768 },
    { width: 1280, height: 800 },
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    const geometry = await traceGeometry(page);

    // 整张卡片与日历外层容器不得产生横向滚动
    expect(geometry.heatmap, `${viewport.width}px 热力图容器`).toBeTruthy();
    expect(geometry.panel.scrollWidth, `${viewport.width}px 卡片溢出`)
      .toBeLessThanOrEqual(geometry.panel.clientWidth + 1);
    expect(geometry.outer.scrollWidth, `${viewport.width}px 外层溢出`)
      .toBeLessThanOrEqual(geometry.outer.clientWidth + 1);
    expect(geometry.outer.overflowX, `${viewport.width}px 外层滚动样式`)
      .not.toBe("auto");
    expect(geometry.heatmap.scrollWidth, `${viewport.width}px 热力图溢出`)
      .toBeLessThanOrEqual(geometry.heatmap.clientWidth + 1);
    expect(geometry.documentScroll, `${viewport.width}px document`)
      .toBeLessThanOrEqual(geometry.documentWidth + 2);
    expect(geometry.bodyScroll, `${viewport.width}px body`)
      .toBeLessThanOrEqual(geometry.innerWidth + 2);

    // 365 个日格完整保留，最后一列未被裁切
    expect(await page.locator(".activity-cell").count()).toBe(365);
    const lastCellRight = await page.locator(".activity-cell").last()
      .evaluate((element) => element.getBoundingClientRect().right);
    const heatRight = geometry.heatmap ? geometry.heatmap.clientWidth : 0;
    const heatLeft = await page.locator(".activity-heatmap-scroll")
      .evaluate((element) => element.getBoundingClientRect().left);
    expect(lastCellRight).toBeLessThanOrEqual(heatLeft + heatRight + 1);

    // 热力图与摘要不交叠；摘要完整位于布局容器内
    expect(rectsOverlap(geometry.grid, geometry.summary), `${viewport.width}px 日历交叠`).toBe(false);
    expect(geometry.summary.right, `${viewport.width}px 摘要右缘`)
      .toBeLessThanOrEqual(geometry.scroll.right + 1);
    expect(geometry.summary.left, `${viewport.width}px 摘要左缘`)
      .toBeGreaterThanOrEqual(geometry.scroll.left - 1);

    if (viewport.width >= 1280) {
      // 桌面：左右排列
      expect(geometry.summary.left, `${viewport.width}px 摘要居右`)
        .toBeGreaterThanOrEqual(geometry.grid.right + 15);
    } else {
      // 平板：摘要移到热力图下方
      expect(geometry.summary.top, `${viewport.width}px 摘要下移`)
        .toBeGreaterThanOrEqual(geometry.grid.bottom - 1);
    }
  }

  // 移动端：摘要下移；只有专用热力图子容器滚动；卡片与外层不滚动
  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await traceGeometry(page);
  expect(mobile.panel.scrollWidth).toBeLessThanOrEqual(mobile.panel.clientWidth + 1);
  expect(mobile.outer.scrollWidth).toBeLessThanOrEqual(mobile.outer.clientWidth + 1);
  expect(mobile.heatmap.overflowX).toBe("auto");
  expect(mobile.heatmap.scrollWidth).toBeGreaterThan(mobile.heatmap.clientWidth + 1);
  expect(mobile.summary.top).toBeGreaterThanOrEqual(mobile.grid.bottom - 1);
  expect(mobile.documentScroll).toBeLessThanOrEqual(mobile.documentWidth + 2);
  expect(mobile.bodyScroll).toBeLessThanOrEqual(mobile.innerWidth + 2);
});
