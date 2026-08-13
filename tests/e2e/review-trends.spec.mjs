import { expect, test } from "@playwright/test";
import { createState } from "./fixtures.mjs";
import { installStateSeed, openApp } from "./helpers.mjs";

function localWeekStart() {
  const date = new Date();
  const mondayOffset = date.getDay() === 0 ? 6 : date.getDay() - 1;
  date.setDate(date.getDate() - mondayOffset);
  date.setHours(0, 0, 0, 0);
  return date;
}

function weekTime(weeksBefore, dayOffset, hour = 8) {
  const date = localWeekStart();
  date.setDate(date.getDate() - weeksBefore * 7 + dayOffset);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

function localDueAt(dayOffset, hour = 9) {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

function dateKey(value) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function metricReview({ id, rating, reviewedAt, kind = "review", wordId }) {
  return {
    id,
    wordId,
    word: `trend-${wordId}`,
    rating,
    kind,
    intervalMs: 86_400_000,
    dueAt: localDueAt(1),
    reviewedAt,
    section: "必考词",
    unit: 1,
  };
}

function trendReviews() {
  return [
    metricReview({ id: "old-0", rating: 0, reviewedAt: weekTime(3, 1, 8), wordId: 11 }),
    metricReview({ id: "old-1", rating: 1, reviewedAt: weekTime(3, 2, 8), wordId: 12 }),
    metricReview({ id: "old-2", rating: 2, reviewedAt: weekTime(3, 3, 8), wordId: 13 }),
    metricReview({ id: "old-3", rating: 3, reviewedAt: weekTime(3, 4, 8), wordId: 14 }),
    metricReview({ id: "previous-2", rating: 2, reviewedAt: weekTime(1, 1, 8), wordId: 15 }),
    metricReview({ id: "previous-3", rating: 3, reviewedAt: weekTime(1, 2, 8), wordId: 16 }),
    metricReview({ id: "current-0", rating: 0, reviewedAt: weekTime(0, 0, 8), wordId: 17 }),
    metricReview({ id: "current-1", rating: 1, reviewedAt: weekTime(0, 1, 8), wordId: 18 }),
    metricReview({ id: "new-current", rating: 3, reviewedAt: weekTime(0, 1, 9), kind: "new", wordId: 19 }),
    metricReview({ id: "outside", rating: 0, reviewedAt: weekTime(4, 6, 8), wordId: 20 }),
    metricReview({ id: "future", rating: 0, reviewedAt: localDueAt(2), wordId: 21 }),
    metricReview({ id: "invalid", rating: 0, reviewedAt: "invalid", wordId: 22 }),
  ];
}

function progress(wordId, nextDueAt) {
  const reviewedAt = localDueAt(-7);
  return {
    wordId,
    status: "reviewing",
    firstLearnedAt: reviewedAt,
    lastReviewedAt: reviewedAt,
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
      lastReview: reviewedAt,
    },
  };
}

function forecastProgress() {
  return {
    101: progress(101, localDueAt(-2)),
    102: progress(102, localDueAt(0, 23)),
    103: progress(103, localDueAt(1)),
    104: progress(104, localDueAt(29)),
    105: progress(105, localDueAt(30)),
    106: progress(106, "invalid"),
  };
}

async function openHistory(page) {
  await openApp(page);
  await page
    .getByRole("complementary", { name: "主导航" })
    .getByRole("button", { name: /轨迹/ })
    .click();
  await expect(page.getByRole("heading", { name: "本周学习报告" })).toBeVisible();
}

async function readReviewsCount(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open("wordloop-local");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("state-domains", "readonly");
      const reviews = transaction.objectStore("state-domains").get("reviews");
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => {
        database.close();
        resolve(reviews.result?.value?.length ?? 0);
      };
    };
  }));
}

async function tabTo(page, target) {
  for (let step = 0; step < 80; step += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => document.activeElement === element)) return;
  }
  throw new Error("未能通过正常 Tab 顺序聚焦目标 summary");
}

function todayReview(id = "today-completion") {
  return metricReview({
    id,
    rating: 2,
    reviewedAt: new Date().toISOString(),
    kind: "new",
    wordId: 1,
  });
}

function recentReview(index) {
  const reviewedAt = new Date(Date.now() - (7 - index) * 60_000).toISOString();
  return {
    id: `recent-${index}`,
    wordId: 200 + index,
    word: `recent-word-${index}`,
    rating: index % 4,
    kind: index % 2 === 0 ? "new" : "review",
    intervalMs: 86_400_000,
    dueAt: localDueAt(index + 1),
    reviewedAt,
    section: "必考词",
    unit: 1,
  };
}

test("轨迹信息架构使用真实 DOM 顺序且两个详细区默认独立关闭", async ({ context, page }) => {
  await installStateSeed(context, createState({
    reviews: [],
    wordProgress: forecastProgress(),
  }));
  await openHistory(page);

  const order = await page.evaluate(() => {
    const selectors = [
      'section[aria-labelledby="current-status-title"]',
      'section[aria-labelledby="weekly-report-title"]',
      '[aria-labelledby="review-forecast-title"]',
      '.weak-concentration',
      'section[aria-labelledby="activity-title"]',
      '.history-panel',
      'details[aria-label="近 7 日详细指标"]',
      'details[aria-label="详细学习分析"]',
    ];
    const nodes = selectors.map((selector) => document.querySelector(selector));
    if (nodes.some((node) => !node)) throw new Error("轨迹页信息架构节点不完整");
    return nodes.slice(0, -1).map((node, index) =>
      Boolean(node.compareDocumentPosition(nodes[index + 1])
        & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  expect(order).toEqual([true, true, true, true, true, true, true]);

  const metrics = page.locator('details[aria-label="近 7 日详细指标"]');
  const analysis = page.locator('details[aria-label="详细学习分析"]');
  const metricsSummary = metrics.locator(":scope > summary");
  const analysisSummary = analysis.locator(":scope > summary");
  await expect(metrics).not.toHaveAttribute("open", "");
  await expect(analysis).not.toHaveAttribute("open", "");

  await metricsSummary.click();
  await expect.poll(() => metrics.evaluate((element) => element.open)).toBe(true);
  await expect.poll(() => analysis.evaluate((element) => element.open)).toBe(false);
  await metricsSummary.click();
  await expect.poll(() => metrics.evaluate((element) => element.open)).toBe(false);

  await analysisSummary.click();
  await expect.poll(() => analysis.evaluate((element) => element.open)).toBe(true);
  await expect.poll(() => metrics.evaluate((element) => element.open)).toBe(false);
  await analysisSummary.click();
  await expect.poll(() => analysis.evaluate((element) => element.open)).toBe(false);
});

test("两个轨迹详细区可通过 Tab、Enter 与 Space 独立开合", async ({ context, page }) => {
  await installStateSeed(context, createState({
    reviews: [],
    wordProgress: forecastProgress(),
  }));
  await openHistory(page);

  const metrics = page.locator('details[aria-label="近 7 日详细指标"]');
  const analysis = page.locator('details[aria-label="详细学习分析"]');
  const metricsSummary = metrics.locator(":scope > summary");
  const analysisSummary = analysis.locator(":scope > summary");
  await metricsSummary.scrollIntoViewIfNeeded();
  await tabTo(page, metricsSummary);
  await expect(metricsSummary).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => metrics.evaluate((element) => element.open)).toBe(true);
  await expect.poll(() => analysis.evaluate((element) => element.open)).toBe(false);
  await page.keyboard.press("Space");
  await expect.poll(() => metrics.evaluate((element) => element.open)).toBe(false);

  await analysisSummary.scrollIntoViewIfNeeded();
  await tabTo(page, analysisSummary);
  await expect(analysisSummary).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => analysis.evaluate((element) => element.open)).toBe(true);
  await expect.poll(() => metrics.evaluate((element) => element.open)).toBe(false);
  await page.keyboard.press("Space");
  await expect.poll(() => analysis.evaluate((element) => element.open)).toBe(false);
});

test("轨迹主行动三态均离开轨迹并进入真实学习状态", async ({ browser, baseURL }) => {
  const scenarios = [
    {
      name: "有已到期词",
      state: createState({
        reviews: [],
        wordProgress: { 1: progress(1, localDueAt(-1)) },
      }),
      summary: "当前有 1 个已到期词，优先完成今日复习。",
      label: "开始今日任务",
      sessionTitle: /今日任务 · 0\/1/,
    },
    {
      name: "无到期词但今天已有评分",
      state: createState({
        reviews: [todayReview()],
        wordProgress: { 1: progress(1, localDueAt(1)) },
      }),
      summary: "当前暂无已到期词，今天已完成 1 次学习评分。",
      label: "继续学习",
    },
    {
      name: "无到期词且今天无评分",
      state: createState({
        reviews: [],
        wordProgress: { 1: progress(1, localDueAt(1)) },
      }),
      summary: "当前暂无已到期词，可以从新词或薄弱项开始。",
      label: "开始学习",
    },
  ];

  for (const scenario of scenarios) {
    const scenarioContext = await browser.newContext({ baseURL });
    try {
      await installStateSeed(scenarioContext, scenario.state);
      const scenarioPage = await scenarioContext.newPage();
      await scenarioPage.route("**/data/redbook.json*", (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          metadata: {
            title: "2027考研英语红宝书",
            total: 1,
            sectionCounts: { 必考词: 1, 基础词: 0, 超纲词: 0 },
          },
          words: [{
            id: 1,
            word: "radiate",
            phonetic: "/ˈreɪdieɪt/",
            meaning: "v. 辐射；散发",
            section: "必考词",
            unit: 1,
          }],
        }),
      }));
      await openHistory(scenarioPage);
      const action = scenarioPage.locator(".trace-primary-action");
      await expect(action.getByText(scenario.summary, { exact: true })).toBeVisible();
      await action.getByRole("button", { name: scenario.label, exact: true }).click();
      await expect(scenarioPage.locator(".learn-view"), scenario.name).toBeVisible();
      await expect(scenarioPage.getByRole("heading", { name: "每一次回忆都算数" }))
        .toHaveCount(0);
      await expect(scenarioPage.getByRole("button", { name: "显示单词释义" }))
        .toBeEnabled();
      if (scenario.sessionTitle) {
        await expect(scenarioPage.locator(".learn-topbar .topbar-title"))
          .toHaveText(scenario.sessionTitle);
      } else {
        await expect(scenarioPage.locator(".learn-topbar .topbar-title"))
          .not.toContainText("今日任务");
      }
    } finally {
      await scenarioContext.close();
    }
  }
});

test("最近学习只渲染最新 5 条且不截断 IndexedDB 原始 reviews", async ({ context, page }) => {
  const reviews = Array.from({ length: 8 }, (_, index) => recentReview(index));
  await installStateSeed(context, createState({ reviews, wordProgress: {} }));
  await openApp(page);
  await expect.poll(() => readReviewsCount(page)).toBe(8);
  await page
    .getByRole("complementary", { name: "主导航" })
    .getByRole("button", { name: /轨迹/ })
    .click();

  const panel = page.locator(".history-panel");
  const rows = panel.locator(".history-row");
  await expect(rows).toHaveCount(5);
  await expect.poll(() => rows.evaluateAll((elements) =>
    elements.map((element) => element.dataset.reviewId))).toEqual([
    "recent-7",
    "recent-6",
    "recent-5",
    "recent-4",
    "recent-3",
  ]);
  await expect(rows.first().getByText("recent-word-7", { exact: true })).toBeVisible();
  await expect(panel.getByText("recent-word-0", { exact: true })).toHaveCount(0);
  await expect(panel.getByText("recent-word-1", { exact: true })).toHaveCount(0);
  for (let index = 0; index < 5; index += 1) {
    await expect(rows.nth(index).locator("strong")).not.toBeEmpty();
    await expect(rows.nth(index).locator(".rating-dot")).toContainText(/新学|复习/);
    await expect(rows.nth(index).locator(".rating-dot")).toContainText(/忘记|模糊|认识|熟练/);
    await expect(rows.nth(index).locator(":scope > span").last()).not.toBeEmpty();
  }
  await expect.poll(() => readReviewsCount(page)).toBe(8);
});

test("复习趋势：4 周保持率与困难率共用周报口径并保留空样本", async ({ context, page }) => {
  await installStateSeed(context, createState({
    reviews: trendReviews(),
    wordProgress: {},
  }));
  await openHistory(page);

  const trend = page.getByRole("region", { name: "复习保持率/困难率趋势" });
  const weeks = trend.locator(".review-metric-week");
  await expect(trend).toBeVisible();
  await expect(weeks).toHaveCount(4);
  await expect(weeks.nth(1).locator(".review-metric-value")).toHaveText([
    /复习保持率 暂无样本/,
    /困难率 暂无样本/,
  ]);
  await expect(weeks.nth(3)).toContainText("本周");
  await expect(weeks.nth(3)).toContainText("复习保持率 50% (1/2)");
  await expect(weeks.nth(3)).toContainText("困难率 100% (2/2)");
  await expect(weeks.nth(3)).toHaveAttribute("aria-label", /保持 1\/2.*困难 2\/2/);

  const summary = page.locator(".review-metric-summary");
  await expect(summary).toContainText("本周复习保持率");
  await expect(summary).toContainText("50% (1/2)");
  await expect(summary).toContainText("本周困难率");
  await expect(summary).toContainText("100% (2/2)");
  await expect(page.locator("body")).not.toContainText("遗忘曲线");
  await expect(page.locator("body")).not.toContainText("Again+Hard 遗忘率");
});

test("复习压力：30 天当前排程快照保留首日与第 30/31 天边界", async ({ context, page }) => {
  await installStateSeed(context, createState({
    reviews: [],
    wordProgress: forecastProgress(),
  }));
  await openHistory(page);

  const forecast = page.getByRole("region", { name: "未来排程" });
  const days = forecast.locator(".forecast-day");
  const today = dateKey(localDueAt(0));
  const day30 = dateKey(localDueAt(29));
  const day31 = dateKey(localDueAt(30));

  await expect(forecast).toBeVisible();
  await expect(forecast).toContainText("继续学习和评分后排程会变化");
  await expect(forecast).toContainText("不是未来承诺");
  await expect(forecast).toContainText("逾期与今天内到期均计入第一个自然日桶");
  await expect(forecast).toContainText("未来 30 天 4 词");
  await expect(days).toHaveCount(30);
  await expect(forecast.locator(`[data-date="${today}"]`)).toHaveAttribute(
    "aria-label",
    /含逾期与今天到期.*2 词/,
  );
  await expect(forecast.locator(`[data-date="${day30}"]`)).toHaveAttribute(
    "aria-label",
    /1 词/,
  );
  await expect(forecast.locator(`[data-date="${day31}"]`)).toHaveCount(0);
});

test("复习图表：320px 与小高度等效视口下可访问且不撑破页面", async ({ context, page }) => {
  await installStateSeed(context, createState({
    reviews: [],
    wordProgress: forecastProgress(),
  }));
  await page.setViewportSize({ width: 320, height: 720 });
  await openHistory(page);

  const scroll = page.getByRole("region", { name: "未来 30 天到期复习图表，可横向滚动" });
  const trend = page.getByRole("region", { name: "复习保持率/困难率趋势" });
  const widths = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
    body: document.body.scrollWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport + 2);
  expect(widths.body).toBeLessThanOrEqual(widths.viewport + 2);
  await expect.poll(() => scroll.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await scroll.focus();
  await expect(scroll).toBeFocused();
  await scroll.press("ArrowRight");
  await expect.poll(() => scroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await expect(trend.getByText("复习保持率", { exact: false }).first()).toBeVisible();
  await expect(trend.getByText("困难率", { exact: false }).first()).toBeVisible();

  for (const viewport of [{ width: 720, height: 450 }, { width: 360, height: 225 }]) {
    await page.setViewportSize(viewport);
    const trendTitle = page.getByRole("heading", { name: "复习保持率/困难率趋势" });
    const disclosure = page.getByText("按当前 nextDueAt 计算", { exact: false });
    const summary = page.locator(".review-metric-summary");
    await trendTitle.evaluate((element) => element.scrollIntoView({ block: "center", inline: "center" }));
    await expect(trendTitle).toBeVisible();
    await summary.evaluate((element) => element.scrollIntoView({ block: "center", inline: "center" }));
    await expect(summary).toBeVisible();
    await disclosure.evaluate((element) => element.scrollIntoView({ block: "center", inline: "center" }));
    await expect(disclosure).toBeVisible();
  }
});
