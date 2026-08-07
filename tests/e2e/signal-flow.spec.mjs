import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import {
  createState,
} from "./fixtures.mjs";
import {
  installStateSeed,
  openApp,
  openSettings,
  openWordbook,
} from "./helpers.mjs";

// CI 干净检出无私有红宝书数据（public/data/redbook.json 被 gitignore），
// 信号联动 E2E 依赖红宝书词（radiate/objective），缺失时整文件跳过。
const PRIVATE_REDBOOK_PATH = new URL(
  "../../public/data/redbook.json",
  import.meta.url,
);
const hasPrivateData = existsSync(PRIVATE_REDBOOK_PATH);
test.skip(
  !hasPrivateData,
  "CI 干净检出无私有红宝书数据，信号联动 E2E 跳过",
);

/** 过去第 days 天（本地时刻）的 ISO 字符串 */
function daysAgo(days, hour = 8, minute = 0) {
  const date = new Date(Date.now() - days * 86_400_000);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function sprintSeedState() {
  const examDate = new Date(Date.now() + 5 * 86_400_000)
    .toISOString().slice(0, 10);
  // 评分一律用过去时间，避免未来 due 触发 ts-fsrs 负 delta 校验
  const sprintSessionId = `sprint:${daysAgo(1, 8, 0)}`;
  const plainAt = daysAgo(9, 8, 0);
  const sprintAt = daysAgo(1, 8, 7);
  return createState({
    examDate,
    // wordProgress 不手动塞（ts-fsrs 校验严格），由 reviews 自动重建
    wordProgress: {},
    // 划词查询统计：两个词都查过多次（linkedWordId 归并）
    lookupWords: [
      {
        id: 9_000_000_001,
        linkedWordId: 1,
        query: "radiate",
        kind: "word",
        phonetic: "/ˈreɪdieɪt/",
        part: "v.",
        meaning: "散发",
        note: "",
        source: "redbook",
        addedAt: "2026-08-02T08:00:00.000Z",
      },
      {
        id: 9_000_000_002,
        linkedWordId: 2,
        query: "objective",
        kind: "word",
        phonetic: "/əbˈdʒektɪv/",
        part: "n.",
        meaning: "目标",
        note: "",
        source: "redbook",
        addedAt: "2026-08-02T08:00:00.000Z",
      },
    ],
    lookupStats: {
      radiate: {
        count: 3,
        firstAt: daysAgo(10, 8, 0),
        lastAt: daysAgo(2, 8, 0),
      },
      objective: {
        count: 5,
        firstAt: daysAgo(10, 8, 0),
        lastAt: daysAgo(2, 8, 0),
      },
    },
    // 历史评分（每词 1 条普通低评分 → 重建 wordProgress 为薄弱；再 1 条冲刺评分，均为过去时间）
    reviews: [
      {
        id: "h1",
        wordId: 1,
        word: "radiate",
        rating: 0,
        kind: "new",
        intervalMs: 600_000,
        dueAt: new Date(new Date(plainAt).getTime() + 600_000).toISOString(),
        reviewedAt: plainAt,
        section: "必考词",
        unit: 1,
      },
      {
        id: "h2",
        wordId: 2,
        word: "objective",
        rating: 0,
        kind: "new",
        intervalMs: 600_000,
        dueAt: new Date(new Date(plainAt).getTime() + 720_000).toISOString(),
        reviewedAt: new Date(new Date(plainAt).getTime() + 120_000).toISOString(),
        section: "必考词",
        unit: 1,
      },
      {
        id: "r1",
        sessionId: sprintSessionId,
        wordId: 1,
        word: "radiate",
        rating: 2,
        kind: "review",
        intervalMs: 600_000,
        dueAt: new Date(new Date(sprintAt).getTime() + 600_000).toISOString(),
        reviewedAt: sprintAt,
        recallMs: 16_000,
        section: "必考词",
        unit: 1,
      },
      {
        id: "r2",
        sessionId: sprintSessionId,
        wordId: 2,
        word: "objective",
        rating: 1,
        kind: "review",
        intervalMs: 600_000,
        dueAt: new Date(new Date(sprintAt).getTime() + 720_000).toISOString(),
        reviewedAt: new Date(new Date(sprintAt).getTime() + 120_000).toISOString(),
        recallMs: 12_000,
        section: "必考词",
        unit: 1,
      },
    ],
    started: true,
  });
}

test("信号联动：轨迹页冲刺记录出现并支持再跑一次", async ({ context, page }) => {
  await installStateSeed(context, sprintSeedState());
  await openApp(page);
  // 主导航进入轨迹页
  await page
    .getByRole("complementary", { name: "主导航" })
    .getByRole("button", { name: /轨迹/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "每一次回忆都算数" }),
  ).toBeVisible();
  // 冲刺记录区出现，含 2 词一次、再跑一次按钮
  const historySection = page.locator(".sprint-history");
  await expect(historySection).toBeVisible();
  await expect(
    historySection.getByRole("heading", { name: "冲刺记录" }),
  ).toBeVisible();
  await expect(historySection).toContainText("共 1 次 · 覆盖 2 个不同单词");
  await expect(
    historySection.getByRole("button", { name: "再跑一次" }),
  ).toBeVisible();
});

test("信号联动：设置页阈值预览随阈值变化", async ({ context, page }) => {
  await installStateSeed(context, sprintSeedState());
  await openApp(page);
  await openSettings(page);
  // 默认阈值（薄弱候选 ≥2 / 插队 ≥3）：薄弱候选 2、冲刺 2；
  // 词 1 冲刺已答对且查询不再增长 → 自动降级出插队队列，故插队 1（词 2）
  const preview = page.locator(".weak-thresholds-preview");
  await expect(preview).toContainText("薄弱候选 2 词");
  await expect(preview).toContainText("插队 1 词");
  await expect(preview).toContainText("冲刺 2 词");
  // 把「反复查词」阈值调到 10：薄弱候选清零；插队（独立阈值）与冲刺（lapse 命中）不变
  const lookupWeakInput = page
    .locator(".weak-thresholds-settings")
    .getByRole("spinbutton", { name: /反复查词/ });
  await lookupWeakInput.fill("10");
  await expect(preview).toContainText("薄弱候选 0 词");
  await expect(preview).toContainText("插队 1 词");
  await expect(preview).toContainText("冲刺 2 词");
  // 把「插队复习」阈值调到 10：插队清零
  const lookupPriorityInput = page
    .locator(".weak-thresholds-settings")
    .getByRole("spinbutton", { name: /插队复习/ });
  await lookupPriorityInput.fill("10");
  await expect(preview).toContainText("插队 0 词");
});

test("信号联动：词本划词集展示薄弱候选与一键学习入口", async ({ context, page }) => {
  await installStateSeed(context, sprintSeedState());
  await openApp(page);
  await openWordbook(page);
  await page.getByRole("tab", { name: /划词集/ }).click();
  // 两个词都标薄弱候选（查过 2 次+）
  await expect(page.getByText("薄弱候选").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: /学习全部薄弱候选（2）/ }),
  ).toBeVisible();
  // 「只看薄弱候选」过滤后仍显示 2 条
  await page.getByRole("checkbox", { name: /只看薄弱候选/ }).check();
  await expect(
    page.getByRole("button", { name: /学习全部薄弱候选（2）/ }),
  ).toBeVisible();
});

test("信号联动：完整冲刺交互（入口→词卡原因→完成小结→再冲刺）", async ({ context, page }) => {
  await installStateSeed(context, sprintSeedState());
  await openApp(page);
  // 进入轨迹页，冲刺期/临考期（examDate 5 天后）+ 冲刺词数 2 → 显示冲刺入口
  await page
    .getByRole("complementary", { name: "主导航" })
    .getByRole("button", { name: /轨迹/ })
    .click();
  const sprintStart = page.getByRole("button", {
    name: /开始考前薄弱冲刺（2 词）/,
  });
  await expect(sprintStart).toBeVisible();
  await sprintStart.click();

  // 学习卡：冲刺会话中释义面板显示薄弱原因
  await expect(
    page.getByRole("button", { name: "显示单词释义" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "显示单词释义" }).click();
  await expect(page.getByText("本词因以下信号进入冲刺")).toBeVisible();
  await expect(page.locator(".weak-signal-tags")).not.toBeEmpty();

  // 逐词评分（认识）推进会话到完成
  for (let index = 0; index < 2; index += 1) {
    await page.getByRole("button", { name: /认识/ }).click();
    if (index === 0) {
      // 下一个词仍处于冲刺会话
      await expect(page.getByRole("button", { name: "显示单词释义" })).toBeEnabled();
      await page.getByRole("button", { name: "显示单词释义" }).click();
      await expect(page.getByText("本词因以下信号进入冲刺")).toBeVisible();
    }
  }

  // 完成页：本次冲刺小结 + 再冲刺仍需关注
  await expect(
    page.getByRole("heading", { name: "本次冲刺小结" }),
  ).toBeVisible();
  await expect(page.getByText("已解决")).toBeVisible();
  const resprintButton = page.getByRole("button", {
    name: /再冲刺仍需关注（\d+）/,
  });
  await expect(resprintButton).toBeVisible();
  await resprintButton.click();
  // 新冲刺会话建立：回到学习卡，仍显示冲刺薄弱原因
  await expect(
    page.getByRole("button", { name: "显示单词释义" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "显示单词释义" }).click();
  await expect(page.getByText("本词因以下信号进入冲刺")).toBeVisible();
});

test("信号联动：集中区按分册冲刺与薄弱候选导出入口", async ({ context, page }) => {
  await installStateSeed(context, sprintSeedState());
  await openApp(page);
  await page
    .getByRole("complementary", { name: "主导航" })
    .getByRole("button", { name: /轨迹/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "每一次回忆都算数" }),
  ).toBeVisible();
  // 轨迹页冲刺区导出按钮存在（不做下载断言）
  await expect(
    page.locator(".sprint-actions").getByRole("button", { name: "导出 CSV" }),
  ).toBeVisible();
  // 薄弱集中区出现：必考词 2 词（radiate/objective 均查过 2 次+）
  const concentration = page.locator('[aria-label="薄弱集中区"]');
  await expect(concentration).toBeVisible();
  await expect(concentration).toContainText("必考词");
  // 点必考词分册「冲刺」按钮，进入限定范围冲刺会话
  const sectionSprint = concentration.getByRole("button", {
    name: "冲刺",
    exact: true,
  }).first();
  await expect(sectionSprint).toBeEnabled();
  await sectionSprint.click();
  // 学习卡：冲刺会话中释义面板显示薄弱原因
  await expect(
    page.getByRole("button", { name: "显示单词释义" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "显示单词释义" }).click();
  await expect(page.getByText("本词因以下信号进入冲刺")).toBeVisible();
  await expect(page.locator(".weak-signal-tags")).not.toBeEmpty();
  // 逐词评分推进完成（第二张卡需先展开释义，rating 栏才可见）
  for (let index = 0; index < 2; index += 1) {
    if (index > 0) {
      await page.getByRole("button", { name: "显示单词释义" }).click();
    }
    await page.getByRole("button", { name: /认识/ }).click();
  }
  await expect(
    page.getByRole("heading", { name: "本次冲刺小结" }),
  ).toBeVisible();
  // 词本划词集：薄弱候选导出按钮存在
  await page
    .getByRole("complementary", { name: "主导航" })
    .getByRole("button", { name: /词本$/ })
    .click();
  await page.getByRole("tab", { name: /划词集/ }).click();
  await expect(
    page.getByRole("button", { name: "导出 CSV" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /学习全部薄弱候选（2）/ }),
  ).toBeVisible();
});

/** 复发追踪 seed：上周（8 天前，必落上周窗口）冲刺解决 2 词，两词当前仍薄弱（查过 2+ 次） */
function relapseSeedState() {
  const state = sprintSeedState();
  const lastWeekSessionId = `sprint:${daysAgo(8, 8, 0)}`;
  const lastWeekAt = daysAgo(8, 8, 5);
  const solvedAt = daysAgo(8, 8, 7);
  // 把本周冲刺评分改为上周，且两词均 rating≥2（解决）；保留普通低评分（薄弱画像）
  state.reviews = state.reviews.map((review) => {
    if (review.id === "r1") {
      return {
        ...review,
        sessionId: lastWeekSessionId,
        reviewedAt: solvedAt,
        dueAt: new Date(new Date(solvedAt).getTime() + 600_000).toISOString(),
        rating: 2,
      };
    }
    if (review.id === "r2") {
      return {
        ...review,
        sessionId: lastWeekSessionId,
        reviewedAt: new Date(new Date(solvedAt).getTime() + 120_000).toISOString(),
        dueAt: new Date(new Date(solvedAt).getTime() + 720_000).toISOString(),
        rating: 2,
      };
    }
    return review;
  });
  return state;
}

test("信号联动：词书薄弱分布与冲刺复发追踪", async ({ context, page }) => {
  await installStateSeed(context, relapseSeedState());
  await openApp(page);
  // 词书页：必考词卡片显示薄弱文案
  await page
    .getByRole("complementary", { name: "主导航" })
    .getByRole("button", { name: /词书/ })
    .click();
  const requiredCard = page
    .getByRole("button", { name: /必考词/ })
    .filter({ has: page.getByRole("heading", { name: "必考词" }) });
  await expect(requiredCard).toBeVisible();
  await expect(requiredCard).toContainText("薄弱");
  // 轨迹页：复发追踪栏显示上周解决与复发词数
  await page
    .getByRole("complementary", { name: "主导航" })
    .getByRole("button", { name: /轨迹/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "每一次回忆都算数" }),
  ).toBeVisible();
  const relapse = page.locator('[aria-label="冲刺复发追踪"]');
  await expect(relapse).toBeVisible();
  await expect(relapse).toContainText("上周解决 2 词");
  await expect(relapse).toContainText("复发 2 词");
  await expect(relapse).toContainText("复发率 100%");
});
