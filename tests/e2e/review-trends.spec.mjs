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
  await expect(page.getByRole("heading", { name: "每周学习报告" })).toBeVisible();
}

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
    /复习保持率 — \(0\/0\)/,
    /困难率 — \(0\/0\)/,
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

  const forecast = page.getByRole("region", { name: "未来 30 天到期复习（当前排程快照）" });
  const days = forecast.locator(".forecast-day");
  const today = dateKey(localDueAt(0));
  const day30 = dateKey(localDueAt(29));
  const day31 = dateKey(localDueAt(30));

  await expect(forecast).toBeVisible();
  await expect(forecast).toContainText("继续学习和评分后排程会变化");
  await expect(forecast).toContainText("不是未来承诺");
  await expect(forecast).toContainText("逾期与今天到期均计入第 1 天");
  await expect(forecast).toContainText("共 4 词");
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

test("复习图表：320px、缩放与键盘滚动保持可访问且不撑破页面", async ({ context, page }) => {
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

  await page.setViewportSize({ width: 1280, height: 900 });
  for (const zoom of ["2", "4"]) {
    await page.evaluate((level) => {
      document.documentElement.style.zoom = level;
    }, zoom);
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
