import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { createState } from "./fixtures.mjs";
import {
  installStateSeed,
  openApp,
  openWordbook,
  waitForApp,
} from "./helpers.mjs";

// CI 干净检出无私有红宝书数据（public/data/redbook.json 被 gitignore），
// leech 联动 E2E 依赖红宝书词（radiate，wordId 1），缺失时整文件跳过。
const PRIVATE_REDBOOK_PATH = new URL(
  "../../public/data/redbook.json",
  import.meta.url,
);
const hasPrivateData = existsSync(PRIVATE_REDBOOK_PATH);
test.skip(
  !hasPrivateData,
  "CI 干净检出无私有红宝书数据，leech 联动 E2E 跳过",
);

/** 过去第 days 天（本地时刻）的 ISO 字符串 */
function daysAgo(days, hour = 8, minute = 0) {
  const date = new Date(Date.now() - days * 86_400_000);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function lapseReview(id, rating, reviewedAt) {
  return {
    id,
    wordId: 1,
    word: "radiate",
    rating,
    kind: "review",
    intervalMs: 600_000,
    dueAt: new Date(new Date(reviewedAt).getTime() + 600_000).toISOString(),
    reviewedAt,
    section: "必考词",
    unit: 1,
  };
}

/** 指定数量的 rating=0 事件（按时间升序），其后可选连续成功事件 */
function leechReviews(lapseCount, successCount = 0) {
  const reviews = Array.from({ length: lapseCount }, (_, index) =>
    lapseReview(`leech-lapse-${index + 1}`, 0, daysAgo(20 - index, 8, 0)));
  for (let index = 0; index < successCount; index += 1) {
    reviews.push(lapseReview(
      `leech-ok-${index + 1}`,
      [2, 2, 3][index] ?? 3,
      daysAgo(19 - lapseCount - index, 9, 0),
    ));
  }
  return reviews;
}

/** 跨档追加的 lapse 事件：独立 id、晚于种子事件的时间 */
function extraLapseReviews(count) {
  return Array.from({ length: count }, (_, index) =>
    lapseReview(`leech-extra-${index + 1}`, 0, daysAgo(11 - index, 8, 0)));
}

function leechSeedState(lapseCount, successCount = 0, withFavorite = false) {
  return createState({
    reviews: leechReviews(lapseCount, successCount),
    wordProgress: {},
    ...(withFavorite
      ? { favorites: [{ wordId: 1, addedAt: daysAgo(21, 8, 0) }] }
      : {}),
  });
}

/** 直接向 state-domains 追加 reviews（模拟复习事件增长），刷新后由应用重建派生 */
async function appendReviews(page, extraReviews) {
  await page.evaluate((newReviews) => new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open("wordloop-local");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("state-domains", "readwrite");
      const store = transaction.objectStore("state-domains");
      const reviewsRequest = store.get("reviews");
      const settingsRequest = store.get("settings");
      transaction.onerror = () => {
        database.close();
        reject(transaction.error);
      };
      transaction.oncomplete = () => {
        database.close();
        resolve(true);
      };
      reviewsRequest.onsuccess = () => {
        const existing = reviewsRequest.result?.value ?? [];
        store.put({ key: "reviews", value: [...existing, ...newReviews] });
      };
      settingsRequest.onsuccess = () => {
        const settingsRecord = settingsRequest.result;
        store.put({
          key: "settings",
          revision: (settingsRecord?.revision ?? 0) + 1,
          value: settingsRecord?.value ?? {},
        });
      };
    };
  }), extraReviews);
  await page.reload();
  await waitForApp(page);
}

/** 读取 settings 分域的 leechMuted；保存是异步的，先轮询到预期值再继续 */
async function readLeechMuted(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open("wordloop-local");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("state-domains", "readonly");
      const storeRequest = transaction.objectStore("state-domains").get("settings");
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => {
        database.close();
        resolve(storeRequest.result?.value?.leechMuted ?? null);
      };
    };
  }));
}

async function waitForLeechMuted(page, expected) {
  await expect.poll(async () => JSON.stringify(await readLeechMuted(page)))
    .toBe(JSON.stringify(expected));
}

async function readLearningDomainSnapshot(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open("wordloop-local");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("state-domains", "readonly");
      const store = transaction.objectStore("state-domains");
      const keys = ["reviews", "word-progress", "quiz-attempts", "fsrs-cards"];
      const requests = keys.map((key) => store.get(key));
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => {
        const snapshot = {};
        keys.forEach((key, index) => {
          snapshot[key] = requests[index].result?.value ?? null;
        });
        database.close();
        resolve(snapshot);
      };
    };
  }));
}

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

async function revealWordCard(page) {
  await expect(
    page.getByRole("button", { name: "显示单词释义" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "显示单词释义" }).click();
}

test("leech：累计 8 次遗忘后词卡出现 leech 8 标签，跨档更新为 leech 12", async ({ context, page }) => {
  await installStateSeed(context, leechSeedState(8));
  await openApp(page);
  await revealWordCard(page);
  await expect(page.locator(".weak-signal-tag", { hasText: "leech 8" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "不再提醒：leech 8" }),
  ).toBeVisible();

  // 累计到 12 次：文案更新为 leech 12，不再出现 leech 8
  await appendReviews(page, extraLapseReviews(4));
  await revealWordCard(page);
  await expect(page.locator(".weak-signal-tag", { hasText: "leech 12" })).toBeVisible();
  await expect(page.locator(".weak-signal-tag", { hasText: "leech 8" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "不再提醒：leech 12" }),
  ).toBeVisible();
});

test("leech：连续 3 次成功自动解除，刷新后仍消失且累计 lapses 保留", async ({ context, page }) => {
  await installStateSeed(context, leechSeedState(8, 3));
  await openApp(page);
  await revealWordCard(page);
  await expect(page.locator(".weak-signal-tag", { hasText: "leech 8" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /不再提醒：leech/ }),
  ).toHaveCount(0);
  // 刷新后派生结果一致（标签不重新点亮）
  await page.reload();
  await waitForApp(page);
  await revealWordCard(page);
  await expect(page.locator(".weak-signal-tag", { hasText: "leech 8" })).toHaveCount(0);
});

test("leech：不再提醒即时隐藏、词本同步隐藏、刷新保持、跨档自动复活", async ({ context, page }) => {
  await installStateSeed(context, leechSeedState(8, 0, true));
  await openApp(page);
  await revealWordCard(page);
  await expect(page.locator(".weak-signal-tag", { hasText: "leech 8" })).toBeVisible();
  await page.getByRole("button", { name: "不再提醒：leech 8" }).click();
  // 词卡即时隐藏，无空白占位
  await expect(page.locator(".weak-signal-tag", { hasText: "leech 8" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /不再提醒：leech/ }),
  ).toHaveCount(0);
  await waitForLeechMuted(page, [{ wordId: 1, tier: 8 }]);
  // 词本我的词本同步隐藏
  await openWordbook(page);
  await expect(page.getByRole("tab", { name: /我的词本/ })).toBeVisible();
  const favoriteCard = page.locator(".saved-word-card", { hasText: "radiate" });
  await expect(favoriteCard).toBeVisible();
  await expect(favoriteCard.locator(".weak-signal-tag", { hasText: "leech 8" }))
    .toHaveCount(0);
  await expect(favoriteCard.getByRole("button", { name: /不再提醒：leech/ }))
    .toHaveCount(0);
  // 刷新后静默保持（持久化生效）
  await page.reload();
  await waitForApp(page);
  await openWordbook(page);
  await expect(
    page.locator(".saved-word-card", { hasText: "radiate" })
      .locator(".weak-signal-tag", { hasText: "leech 8" }),
  ).toHaveCount(0);
  // 跨档后自动解除静默并显示新档位文案（词本同步复活）
  await appendReviews(page, extraLapseReviews(4));
  await openWordbook(page);
  const revivedCard = page.locator(".saved-word-card", { hasText: "radiate" });
  await expect(revivedCard.locator(".weak-signal-tag", { hasText: "leech 12" }))
    .toBeVisible();
  await expect(revivedCard.getByRole("button", { name: "不再提醒：leech 12" }))
    .toBeVisible();
});

test("leech：静默只写 leechMuted，学习数据零写入且词本仍为 4 个 tab", async ({ context, page }) => {
  const externalRequests = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/")) externalRequests.push(request.url());
  });
  await installStateSeed(context, leechSeedState(8, 0, true));
  await openApp(page);
  await revealWordCard(page);
  await expect(page.locator(".weak-signal-tag", { hasText: "leech 8" })).toBeVisible();

  const before = await readLearningDomainSnapshot(page);
  await page.getByRole("button", { name: "不再提醒：leech 8" }).click();
  await expect(page.locator(".weak-signal-tag", { hasText: "leech 8" })).toHaveCount(0);
  await waitForLeechMuted(page, [{ wordId: 1, tier: 8 }]);
  const after = await readLearningDomainSnapshot(page);
  expect(after).toEqual(before);

  // 静默集合写入 settings 分域（仅 wordId 与档位）
  const settings = await readLeechMuted(page);
  expect(settings).toEqual([{ wordId: 1, tier: 8 }]);

  // 词本仍为 4 个 tab，无第五个
  await openWordbook(page);
  await expect(page.getByRole("tablist", { name: "词本分类" })).toBeVisible();
  expect(await page.getByRole("tab").count()).toBe(4);

  // 全程无 API route 调用
  expect(externalRequests).toEqual([]);
});

test("leech：不再提醒按钮键盘可访问、320px 无横向溢出、200%/400% 缩放可操作", async ({ context, page }) => {
  await installStateSeed(context, leechSeedState(8, 0, true));
  await page.setViewportSize({ width: 320, height: 720 });
  await openApp(page);
  await revealWordCard(page);
  await expect(page.locator(".weak-signal-tag", { hasText: "leech 8" })).toBeVisible();
  const muteButton = page.getByRole("button", { name: "不再提醒：leech 8" });
  await muteButton.focus();
  await expect(muteButton).toBeFocused();
  await expectNoHorizontalOverflow(page);
  await openWordbook(page);
  await expect(
    page.locator(".saved-word-card", { hasText: "radiate" })
      .getByRole("button", { name: "不再提醒：leech 8" }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // 200% / 400% 缩放下标签与按钮仍可操作
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "1";
  });
  for (const zoom of ["2", "4"]) {
    await page.evaluate((level) => {
      document.documentElement.style.zoom = level;
    }, zoom);
    await expect(page.locator(".weak-signal-tag", { hasText: "leech 8" })).toBeVisible();
    await expect(muteButton).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
  await page.evaluate(() => {
    document.documentElement.style.zoom = "1";
  });
});
