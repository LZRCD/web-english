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

test("桌面与 16:10 非全屏下自由学习主卡紧跟任务预览", async ({ context, page }) => {
  await installStateSeed(context, createState());
  const viewports = [
    { width: 1920, height: 1080, minGap: 28, maxGap: 56, maxCardTop: 367 },
    { width: 1600, height: 880, minGap: 24, maxGap: 34, maxCardTop: 300 },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await openApp(page);

    const geometry = await page.evaluate(() => {
      const task = document.querySelector(".today-task-strip")?.getBoundingClientRect();
      const metadata = document.querySelector(".card-metadata")?.getBoundingClientRect();
      const card = document.querySelector(".word-card")?.getBoundingClientRect();
      const hint = document.querySelector(".word-face span")?.getBoundingClientRect();
      if (!task || !metadata || !card || !hint) {
        throw new Error("自由学习布局节点不完整");
      }
      return {
        taskBottom: task.bottom,
        metadataTop: metadata.top,
        cardTop: card.top,
        hintBottom: hint.bottom,
        viewportHeight: window.innerHeight,
      };
    });

    const taskGap = geometry.metadataTop - geometry.taskBottom;
    expect(taskGap).toBeGreaterThanOrEqual(viewport.minGap);
    expect(taskGap).toBeLessThanOrEqual(viewport.maxGap);
    expect(geometry.cardTop).toBeLessThanOrEqual(viewport.maxCardTop);
    expect(geometry.hintBottom).toBeLessThan(geometry.viewportHeight);
    await expectNoHorizontalOverflow(page);
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
