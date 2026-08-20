import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import {
  createState,
  RADIATE_ENRICHMENT,
} from "./fixtures.mjs";
import {
  installStateSeed,
  openApp,
  openSettings,
  openTraceAnalysis,
  openWordbook,
  readStoreRecord,
  selectText,
  waitForApp,
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

/** 以当前本地周一为基准生成周内时刻；weeksBefore=1 是最近完整周。 */
function localWeekTime(weeksBefore, dayOffset, hour = 8, minute = 0) {
  const date = new Date();
  const mondayOffset = date.getDay() === 0 ? 6 : date.getDay() - 1;
  date.setDate(date.getDate() - mondayOffset - weeksBefore * 7 + dayOffset);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

async function readLookupTreatmentSnapshot(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open("wordloop-local");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("state-domains", "readonly");
      const store = transaction.objectStore("state-domains");
      const reviewsRequest = store.get("reviews");
      const progressRequest = store.get("word-progress");
      const settingsRequest = store.get("settings");
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => {
        const review = reviewsRequest.result?.value?.at(-1);
        const progress = progressRequest.result?.value
          ?.find((item) => item.wordId === 1);
        const settings = settingsRequest.result?.value;
        database.close();
        resolve({
          review: review && {
            rating: review.rating,
            recallTimed: Number.isFinite(review.recallMs)
              && review.recallMs >= 0
              && review.recallMs < 60_000,
            sprintAttributed: review.sessionId?.startsWith("sprint:") ?? false,
          },
          progress: progress && {
            lastRating: progress.lastRating,
            lastReviewedAt: progress.lastReviewedAt,
          },
          lookupCount: settings?.lookupStats?.radiate?.count,
          lookupLastAt: settings?.lookupStats?.radiate?.lastAt,
          activeSession: settings?.activeSession && {
            title: settings.activeSession.title,
            wordIds: settings.activeSession.wordIds,
          },
        });
      };
    };
  }));
}

async function readStubbornTreatmentSnapshot(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open("wordloop-local");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("state-domains", "readonly");
      const store = transaction.objectStore("state-domains");
      const reviewsRequest = store.get("reviews");
      const attemptsRequest = store.get("quiz-attempts");
      const settingsRequest = store.get("settings");
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => {
        const review = reviewsRequest.result?.value?.at(-1);
        const attempt = attemptsRequest.result?.value?.at(-1);
        const settings = settingsRequest.result?.value;
        database.close();
        resolve({
          review: review && {
            rating: review.rating,
            sessionId: review.sessionId,
            recallTimed: Number.isFinite(review.recallMs)
              && review.recallMs >= 0
              && review.recallMs < 60_000,
          },
          attempt: attempt && {
            mode: attempt.mode,
            correct: attempt.correct,
            appliedToSchedule: attempt.appliedToSchedule,
          },
          activeSession: settings?.activeSession && {
            id: settings.activeSession.id,
            title: settings.activeSession.title,
            wordIds: settings.activeSession.wordIds,
          },
          activeQuiz: settings?.activeQuiz && {
            id: settings.activeQuiz.id,
            mode: settings.activeQuiz.mode,
          },
        });
      };
    };
  }));
}

async function readActiveQuizSnapshot(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open("wordloop-local");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("state-domains", "readonly");
      const settingsRequest = transaction.objectStore("state-domains").get("settings");
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => {
        const activeQuiz = settingsRequest.result?.value?.activeQuiz;
        database.close();
        resolve(activeQuiz && {
          id: activeQuiz.id,
          mode: activeQuiz.mode,
          seed: activeQuiz.seed,
          questionWordIds: activeQuiz.questionWordIds,
          index: activeQuiz.index,
          correctCount: activeQuiz.correctCount,
          answerIds: Object.keys(activeQuiz.answers ?? {}),
          complete: activeQuiz.complete,
          startedAt: activeQuiz.startedAt,
        });
      };
    };
  }));
}

async function readLatestReviewSessionIds(page, count) {
  return page.evaluate((limit) => new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open("wordloop-local");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("state-domains", "readonly");
      const reviewsRequest = transaction.objectStore("state-domains").get("reviews");
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => {
        const reviews = reviewsRequest.result?.value ?? [];
        database.close();
        resolve(reviews.slice(-limit).map((review) => review.sessionId));
      };
    };
  }), count);
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
        recallMs: 24_000,
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
        recallMs: 20_000,
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

function spellingTreatmentSeedState() {
  const examDate = new Date(Date.now() + 5 * 86_400_000)
    .toISOString().slice(0, 10);
  const learnedAt = daysAgo(4, 8, 0);
  return createState({
    examDate,
    reviews: [{
      id: "spelling-learned",
      wordId: 1,
      word: "radiate",
      rating: 2,
      kind: "new",
      intervalMs: 86_400_000,
      dueAt: daysAgo(3, 8, 0),
      reviewedAt: learnedAt,
      recallMs: 4_000,
      section: "必考词",
      unit: 1,
    }],
    quizAttempts: [
      {
        id: "spelling-wrong",
        wordId: 1,
        mode: "listening-spelling",
        correct: false,
        recallMs: 7_000,
        answeredAt: daysAgo(3, 8, 0),
        appliedToSchedule: false,
      },
      {
        id: "c2e-wrong",
        wordId: 1,
        mode: "chinese-to-english",
        correct: false,
        recallMs: 6_000,
        answeredAt: daysAgo(3, 9, 0),
        appliedToSchedule: false,
      },
      {
        id: "spelling-correct-once",
        wordId: 1,
        mode: "listening-spelling",
        correct: true,
        recallMs: 5_000,
        answeredAt: daysAgo(2, 8, 0),
        appliedToSchedule: false,
      },
    ],
    started: true,
  });
}

function chineseToEnglishTreatmentSeedState() {
  const examDate = new Date(Date.now() + 5 * 86_400_000)
    .toISOString().slice(0, 10);
  const learnedAt = daysAgo(5, 8, 0);
  return createState({
    examDate,
    reviews: [{
      id: "c2e-learned",
      wordId: 1,
      word: "radiate",
      rating: 2,
      kind: "new",
      intervalMs: 86_400_000,
      dueAt: daysAgo(4, 8, 0),
      reviewedAt: learnedAt,
      recallMs: 4_000,
      section: "必考词",
      unit: 1,
    }],
    quizAttempts: [
      {
        id: "spelling-wrong-before-c2e",
        wordId: 1,
        mode: "listening-spelling",
        correct: false,
        recallMs: 7_000,
        answeredAt: daysAgo(4, 8, 0),
        appliedToSchedule: false,
      },
      {
        id: "spelling-recovered-1",
        wordId: 1,
        mode: "listening-spelling",
        correct: true,
        recallMs: 5_000,
        answeredAt: daysAgo(3, 8, 0),
        appliedToSchedule: false,
      },
      {
        id: "spelling-recovered-2",
        wordId: 1,
        mode: "listening-spelling",
        correct: true,
        recallMs: 4_000,
        answeredAt: daysAgo(2, 8, 0),
        appliedToSchedule: false,
      },
      {
        id: "c2e-wrong",
        wordId: 1,
        mode: "chinese-to-english",
        correct: false,
        recallMs: 6_000,
        answeredAt: daysAgo(3, 9, 0),
        appliedToSchedule: false,
      },
      {
        id: "c2e-correct-once",
        wordId: 1,
        mode: "chinese-to-english",
        correct: true,
        recallMs: 5_000,
        answeredAt: daysAgo(2, 9, 0),
        appliedToSchedule: false,
      },
      {
        id: "choice-wrong-stays",
        wordId: 1,
        mode: "meaning-choice",
        correct: false,
        recallMs: 5_000,
        answeredAt: daysAgo(2, 10, 0),
        appliedToSchedule: false,
      },
    ],
    started: true,
  });
}

function activeQuizSnapshotSeedState() {
  const examDate = new Date(Date.now() + 5 * 86_400_000)
    .toISOString().slice(0, 10);
  const learnedAt = daysAgo(5, 8, 0);
  return createState({
    examDate,
    enrichments: RADIATE_ENRICHMENT,
    lookupWords: [{
      id: 9_000_000_001,
      linkedWordId: 1,
      query: "radiate",
      kind: "word",
      phonetic: "/ˈreɪdieɪt/",
      part: "v.",
      meaning: "散发",
      note: "",
      source: "redbook",
      addedAt: daysAgo(10, 8, 0),
    }],
    lookupStats: {
      radiate: {
        count: 3,
        firstAt: daysAgo(10, 8, 0),
        lastAt: daysAgo(2, 7, 0),
      },
    },
    reviews: [
      { wordId: 1, word: "radiate" },
      { wordId: 5, word: "objective" },
    ].map((item, index) => ({
      id: `snapshot-learned-${item.wordId}`,
      ...item,
      rating: 2,
      kind: "new",
      intervalMs: 86_400_000,
      dueAt: daysAgo(4, 8, index),
      reviewedAt: new Date(new Date(learnedAt).getTime() + index * 60_000).toISOString(),
      recallMs: 4_000,
      section: "必考词",
      unit: 1,
    })),
    quizAttempts: [1, 5].flatMap((wordId, index) => [
      {
        id: `snapshot-c2e-wrong-${wordId}`,
        wordId,
        mode: "chinese-to-english",
        correct: false,
        recallMs: 7_000,
        answeredAt: daysAgo(3, 8, index),
        appliedToSchedule: false,
      },
      {
        id: `snapshot-c2e-correct-${wordId}`,
        wordId,
        mode: "chinese-to-english",
        correct: true,
        recallMs: 5_000,
        answeredAt: daysAgo(2, 8, index),
        appliedToSchedule: false,
      },
    ]),
    started: true,
  });
}

function meaningChoiceTreatmentSeedState() {
  const examDate = new Date(Date.now() + 5 * 86_400_000)
    .toISOString().slice(0, 10);
  const learnedAt = daysAgo(5, 8, 0);
  const learnedWords = ["radiate", "radiant", "radical", "object"];
  return createState({
    examDate,
    reviews: learnedWords.map((word, index) => ({
      id: `choice-learned-${index + 1}`,
      wordId: index + 1,
      word,
      rating: 2,
      kind: "new",
      intervalMs: 86_400_000,
      dueAt: daysAgo(4, 8, index),
      reviewedAt: new Date(new Date(learnedAt).getTime() + index * 60_000).toISOString(),
      recallMs: 4_000,
      section: "必考词",
      unit: 1,
    })),
    quizAttempts: [
      {
        id: "choice-wrong",
        wordId: 1,
        mode: "meaning-choice",
        correct: false,
        recallMs: 7_000,
        answeredAt: daysAgo(3, 8, 0),
        appliedToSchedule: false,
      },
      {
        id: "choice-correct-once",
        wordId: 1,
        mode: "meaning-choice",
        correct: true,
        recallMs: 5_000,
        answeredAt: daysAgo(2, 8, 0),
        appliedToSchedule: false,
      },
    ],
    stubbornWords: {
      1: {
        wordId: 1,
        active: true,
        reason: "again-3",
        triggeredAt: daysAgo(3, 7, 0),
        lastChangedAt: daysAgo(3, 7, 0),
        triggerCount: 1,
      },
    },
    started: true,
  });
}

function lookupRecallTreatmentSeedState() {
  const examDate = new Date(Date.now() + 5 * 86_400_000)
    .toISOString().slice(0, 10);
  return createState({
    examDate,
    enrichments: RADIATE_ENRICHMENT,
    lookupWords: [{
      id: 9_000_000_001,
      linkedWordId: 1,
      query: "radiate",
      kind: "word",
      phonetic: "/ˈreɪdieɪt/",
      part: "v.",
      meaning: "散发",
      note: "",
      source: "redbook",
      addedAt: daysAgo(10, 8, 0),
    }],
    lookupStats: {
      radiate: {
        count: 3,
        firstAt: daysAgo(10, 8, 0),
        lastAt: daysAgo(2, 8, 0),
      },
    },
    reviews: [{
      id: "lookup-learned",
      wordId: 1,
      word: "radiate",
      rating: 2,
      kind: "new",
      intervalMs: 86_400_000,
      dueAt: daysAgo(4, 8, 0),
      reviewedAt: daysAgo(5, 8, 0),
      recallMs: 4_000,
      section: "必考词",
      unit: 1,
    }],
    started: true,
  });
}

function stubbornTreatmentSeedState() {
  const examDate = new Date(Date.now() + 5 * 86_400_000)
    .toISOString().slice(0, 10);
  return createState({
    examDate,
    reviews: [6, 5, 4].map((days, index) => ({
      id: `stubborn-low-${index + 1}`,
      wordId: 1,
      word: "radiate",
      rating: 0,
      kind: index === 0 ? "new" : "review",
      intervalMs: 600_000,
      dueAt: new Date(new Date(daysAgo(days, 8, 0)).getTime() + 600_000).toISOString(),
      reviewedAt: daysAgo(days, 8, 0),
      recallMs: 8_000,
      section: "必考词",
      unit: 1,
    })),
    started: true,
  });
}

function insightReview(id, days, rating, wordId) {
  const reviewedAt = daysAgo(days, 8, wordId);
  return {
    id,
    wordId,
    word: wordId === 1 ? "radiate" : "objective",
    rating,
    kind: id.startsWith("new") ? "new" : "review",
    sessionId: id.startsWith("sprint") ? `sprint:${id}` : undefined,
    intervalMs: 600_000,
    dueAt: new Date(new Date(reviewedAt).getTime() + 600_000).toISOString(),
    reviewedAt,
    recallMs: 4_000,
    section: "必考词",
    unit: 1,
  };
}

test("信号联动：近七天当场达标与 True Retention 保持各自口径", async ({ browser, baseURL }) => {
  const scenarios = [
    {
      reviews: [insightReview("previous-only", 8, 3, 1)],
      value: "暂无样本",
      comparison: "当前窗无样本",
      retention: "暂无样本",
    },
    {
      reviews: [
        insightReview("previous-success", 8, 3, 1),
        insightReview("sprint-current-failure", 1, 0, 1),
      ],
      value: "0%",
      comparison: "较上窗 -100 个百分点",
      retention: "0% (0/1)",
    },
    {
      reviews: [
        insightReview("new-previous-success", 8, 3, 1),
        insightReview("previous-failure", 8, 0, 2),
        insightReview("current-success", 1, 2, 1),
        insightReview("current-failure", 1, 1, 2),
      ],
      value: "50%",
      comparison: "较上窗持平",
      retention: "100% (2/2)",
    },
  ];

  for (const scenario of scenarios) {
    const scenarioContext = await browser.newContext({ baseURL });
    try {
      await installStateSeed(
        scenarioContext,
        createState({ reviews: scenario.reviews, wordProgress: {} }),
      );
      const scenarioPage = await scenarioContext.newPage();
      await openApp(scenarioPage);
      await scenarioPage
        .getByRole("complementary", { name: "主导航" })
        .getByRole("button", { name: /轨迹/ })
        .click();

      const card = scenarioPage.locator(".insight-card").filter({
        hasText: "当场达标占比",
      });
      const retentionCard = scenarioPage.locator(".insight-card").filter({
        hasText: "真实复习保持率",
      });
      const metrics = scenarioPage.locator('details[aria-label="近 7 日详细指标"]');
      await metrics.locator(":scope > summary").click();
      await expect(scenarioPage.getByText("近 7 天截至目前", { exact: true })).toBeVisible();
      await expect(card.getByText("rating≥2 / 全部评分事件；不代表长期记住", { exact: true })).toBeVisible();
      await expect(card.getByText(scenario.value, { exact: true })).toBeVisible();
      await expect(card.getByText(scenario.comparison, { exact: true })).toBeVisible();
      await expect(retentionCard.getByText(scenario.retention, { exact: true })).toBeVisible();
      await expect(retentionCard).toContainText("仅复习：忘记失败，其余评分成功");
    } finally {
      await scenarioContext.close();
    }
  }
});

test("信号联动：拼写薄弱从冲刺入口直达听音拼写并归因结果", async ({ context, page }) => {
  await installStateSeed(context, spellingTreatmentSeedState());
  await openApp(page);
  await page
    .getByRole("complementary", { name: "主导航" })
    .getByRole("button", { name: /轨迹/ })
    .click();
  await openTraceAnalysis(page);

  await page.getByRole("button", { name: /开始考前薄弱冲刺（1 词）/ }).click();
  await expect(page.getByText("听音拼写", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "重新播放本题发音" })).toBeVisible();

  await page.getByRole("textbox", { name: "你的答案" }).fill("radiate");
  await page.getByRole("button", { name: "提交" }).click();
  await expect(page.locator(".quiz-feedback")).toContainText("回答正确");

  await expect.poll(async () => page.evaluate(() => new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open("wordloop-local");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("state-domains", "readonly");
      const store = transaction.objectStore("state-domains");
      const attemptsRequest = store.get("quiz-attempts");
      const reviewsRequest = store.get("reviews");
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => {
        const attempt = attemptsRequest.result?.value?.at(-1);
        const review = reviewsRequest.result?.value?.at(-1);
        database.close();
        resolve({
          mode: attempt?.mode,
          correct: attempt?.correct,
          recallTimed: Number.isFinite(attempt?.recallMs)
            && attempt.recallMs >= 0
            && attempt.recallMs < 60_000,
          sprintAttributed: review?.sessionId?.startsWith("sprint:") ?? false,
        });
      };
    };
  }))).toEqual({
    mode: "listening-spelling",
    correct: true,
    recallTimed: true,
    sprintAttributed: true,
  });

  await page.getByRole("button", { name: "查看结果" }).click();
  await page.getByRole("button", { name: "再来一组" }).click();
  await page.getByRole("textbox", { name: "你的答案" }).fill("wrong");
  await page.getByRole("button", { name: "提交" }).click();
  await expect(page.locator(".quiz-feedback")).toContainText("已加入薄弱词");

  await page.getByRole("button", { name: "查看结果" }).click();
  await page
    .getByRole("complementary", { name: "主导航" })
    .getByRole("button", { name: /轨迹/ })
    .click();
  await openTraceAnalysis(page);
  await page.getByRole("button", { name: /开始考前薄弱冲刺（1 词）/ }).click();
  await expect(page.getByText("听音拼写", { exact: true })).toBeVisible();
});

test("信号联动：拼写恢复后中译英接管冲刺并完成同维回流", async ({ context, page }) => {
  await installStateSeed(context, chineseToEnglishTreatmentSeedState());
  await openApp(page);
  await page
    .getByRole("complementary", { name: "主导航" })
    .getByRole("button", { name: /轨迹/ })
    .click();
  await openTraceAnalysis(page);

  await page.getByRole("button", { name: /开始考前薄弱冲刺（1 词）/ }).click();
  await expect(page.getByText("中译英", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /散发/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "重新播放本题发音" })).toHaveCount(0);

  await page.getByRole("textbox", { name: "你的答案" }).fill("radiate");
  await page.getByRole("button", { name: "提交" }).click();
  await expect(page.locator(".quiz-feedback")).toContainText("回答正确");

  await expect.poll(async () => page.evaluate(() => new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open("wordloop-local");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("state-domains", "readonly");
      const store = transaction.objectStore("state-domains");
      const attemptsRequest = store.get("quiz-attempts");
      const reviewsRequest = store.get("reviews");
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => {
        const attempt = attemptsRequest.result?.value?.at(-1);
        const review = reviewsRequest.result?.value?.at(-1);
        database.close();
        resolve({
          mode: attempt?.mode,
          correct: attempt?.correct,
          sprintAttributed: review?.sessionId?.startsWith("sprint:") ?? false,
        });
      };
    };
  }))).toEqual({
    mode: "chinese-to-english",
    correct: true,
    sprintAttributed: true,
  });

  await page.getByRole("button", { name: "查看结果" }).click();
  await page.getByRole("button", { name: "再来一组" }).click();
  await page.getByRole("textbox", { name: "你的答案" }).fill("wrong");
  await page.getByRole("button", { name: "提交" }).click();
  await expect(page.locator(".quiz-feedback")).toContainText("已加入薄弱词");
  await expect.poll(async () => page.evaluate(() => new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open("wordloop-local");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("state-domains", "readonly");
      const store = transaction.objectStore("state-domains");
      const attemptsRequest = store.get("quiz-attempts");
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => {
        const attempt = attemptsRequest.result?.value?.at(-1);
        database.close();
        resolve({ mode: attempt?.mode, correct: attempt?.correct });
      };
    };
  }))).toEqual({ mode: "chinese-to-english", correct: false });

  await page.getByRole("button", { name: "查看结果" }).click();
  await page
    .getByRole("complementary", { name: "主导航" })
    .getByRole("button", { name: /轨迹/ })
    .click();
  await openTraceAnalysis(page);
  await page.getByRole("button", { name: /开始考前薄弱冲刺（1 词）/ }).click();
  await expect(page.getByText("中译英", { exact: true })).toBeVisible();
});

test("信号联动：维度化 Quiz、主动回忆、刷新、历史与 generic 复跑纵向贯通", async ({ context, page }) => {
  await installStateSeed(context, activeQuizSnapshotSeedState());
  await openApp(page);
  await page
    .getByRole("complementary", { name: "主导航" })
    .getByRole("button", { name: /轨迹/ })
    .click();
  await openTraceAnalysis(page);

  await page.getByRole("button", { name: /开始考前薄弱冲刺（2 词）/ }).click();
  await expect(page.getByText("中译英", { exact: true })).toBeVisible();
  await expect.poll(async () => (await readActiveQuizSnapshot(page))?.questionWordIds?.length)
    .toBe(2);
  const started = await readActiveQuizSnapshot(page);
  expect(started).toMatchObject({
    mode: "chinese-to-english",
    index: 0,
    correctCount: 0,
    answerIds: [],
    complete: false,
  });
  expect(started.id).toMatch(/^sprint:treatment:chinese-to-english:/);
  const answers = { 1: "radiate", 5: "objective" };
  const [firstWordId, secondWordId] = started.questionWordIds;

  await page.getByRole("textbox", { name: "你的答案" }).fill(answers[firstWordId]);
  await page.getByRole("button", { name: "提交" }).click();
  await expect(page.locator(".quiz-feedback")).toContainText("回答正确");
  await page.getByRole("button", { name: "下一题 →" }).click();
  await expect.poll(async () => {
    const snapshot = await readActiveQuizSnapshot(page);
    return {
      questionWordIds: snapshot?.questionWordIds,
      index: snapshot?.index,
      correctCount: snapshot?.correctCount,
      answerCount: snapshot?.answerIds?.length,
    };
  }).toEqual({
    questionWordIds: started.questionWordIds,
    index: 1,
    correctCount: 1,
    answerCount: 1,
  });

  await page.reload();
  await waitForApp(page);
  await page
    .getByRole("complementary", { name: "主导航" })
    .getByRole("button", { name: /测验/ })
    .click();
  await expect(page.locator(".quiz-session-head")).toContainText("2 / 2");
  await expect(page.locator(".quiz-session-head")).toContainText("答对 1");
  await expect(page.locator(".quiz-question-card h1"))
    .toContainText(secondWordId === 1 ? "散发" : "目标");
  const restored = await readActiveQuizSnapshot(page);
  expect(restored).toMatchObject({
    id: started.id,
    mode: started.mode,
    seed: started.seed,
    questionWordIds: started.questionWordIds,
    index: 1,
    correctCount: 1,
    complete: false,
  });
  expect(restored.startedAt).toBe(started.startedAt);

  await page.getByRole("textbox", { name: "你的答案" }).fill(answers[secondWordId]);
  await page.getByRole("button", { name: "提交" }).click();
  await expect(page.locator(".quiz-feedback")).toContainText("回答正确");
  await page.getByRole("button", { name: "查看结果" }).click();
  await expect(page.locator(".quiz-complete-score")).toHaveText("100%");
  await expect.poll(async () => (await readActiveQuizSnapshot(page))?.complete).toBe(true);
  await expect.poll(() => readLatestReviewSessionIds(page, 2))
    .toEqual([started.id, started.id]);

  // Quiz 成功 review 会让此前的 lookup 信号降级；用真实再次划词制造复发。
  await page.getByRole("button", { name: "词环首页" }).click();
  await page.getByRole("button", { name: "显示单词释义" }).click();
  await selectText(
    page.getByText("Stars radiate energy into space.", { exact: true }),
    "radiate",
  );
  const popup = page.getByRole("dialog", { name: "划词查询：radiate" });
  await expect(popup).toContainText("已加入划词集");
  await popup.getByRole("button", { name: "关闭划词查询" }).click();

  await page
    .getByRole("complementary", { name: "主导航" })
    .getByRole("button", { name: /轨迹/ })
    .click();
  await openTraceAnalysis(page);
  await page.getByRole("button", { name: /开始考前薄弱冲刺（1 词）/ }).click();
  await expect(page.getByText(/考前薄弱冲刺 · 词义主动回忆/).first()).toBeVisible();
  await expect.poll(async () => {
    const settings = await readStoreRecord(page, "settings", "current");
    return settings?.activeSession;
  }).toMatchObject({
    id: expect.stringMatching(/^sprint:treatment:lookup-recall:/),
    wordIds: [1],
  });
  const lookupSession = (await readStoreRecord(page, "settings", "current")).activeSession;

  await page.reload();
  await waitForApp(page);
  await expect(page.getByText(/考前薄弱冲刺 · 词义主动回忆/).first()).toBeVisible();
  await page.getByRole("button", { name: "显示单词释义" }).click();
  await page.getByRole("button", { name: /认识/ }).click();
  await expect.poll(async () => (await readLatestReviewSessionIds(page, 1))[0])
    .toBe(lookupSession.id);

  await page.getByRole("button", { name: "返回轨迹页" }).click();
  await openTraceAnalysis(page);
  const history = page.locator(".sprint-history");
  await expect(history).toContainText("共 2 次 · 覆盖 2 个不同单词");
  await history.locator(".sprint-history-row").first()
    .getByRole("button", { name: "再跑一次" }).click();
  await expect.poll(async () => {
    const settings = await readStoreRecord(page, "settings", "current");
    return {
      id: settings?.activeSession?.id,
      wordIds: settings?.activeSession?.wordIds,
    };
  }).toEqual({
    id: expect.stringMatching(/^sprint:treatment:generic-sprint:/),
    wordIds: [1],
  });
});

test("信号联动：拼写与中译英恢复后辨析接管冲刺并完成同维回流", async ({ context, page }) => {
  await installStateSeed(context, meaningChoiceTreatmentSeedState());
  await openApp(page);
  await page
    .getByRole("complementary", { name: "主导航" })
    .getByRole("button", { name: /轨迹/ })
    .click();
  await openTraceAnalysis(page);

  await page.getByRole("button", { name: /开始考前薄弱冲刺（1 词）/ }).click();
  await expect(page.getByText("熟词僻义", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /radiate.*忽略的义项/ })).toBeVisible();
  await expect(page.locator(".quiz-option")).toHaveCount(4);

  const answer = "呈辐射状发散 (或伸展)";
  await page.getByRole("button", { name: new RegExp(answer.replace(/[()]/g, "\\$&")) }).click();
  await expect(page.locator(".quiz-feedback")).toContainText("回答正确");

  await expect.poll(async () => page.evaluate(() => new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open("wordloop-local");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("state-domains", "readonly");
      const store = transaction.objectStore("state-domains");
      const attemptsRequest = store.get("quiz-attempts");
      const reviewsRequest = store.get("reviews");
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => {
        const attempt = attemptsRequest.result?.value?.at(-1);
        const review = reviewsRequest.result?.value?.at(-1);
        database.close();
        resolve({
          mode: attempt?.mode,
          correct: attempt?.correct,
          optionsStoredAsAttempt: attempt?.wordId === 1,
          sprintAttributed: review?.sessionId?.startsWith("sprint:") ?? false,
        });
      };
    };
  }))).toEqual({
    mode: "meaning-choice",
    correct: true,
    optionsStoredAsAttempt: true,
    sprintAttributed: true,
  });

  await page.getByRole("button", { name: "查看结果" }).click();
  await page.getByRole("button", { name: "再来一组" }).click();
  await expect(page.getByRole("heading", { name: /radiate.*忽略的义项/ })).toBeVisible();
  await page.locator(".quiz-option").filter({ hasNotText: answer }).first().click();
  await expect(page.locator(".quiz-feedback")).toContainText("已加入薄弱词");
  await expect.poll(async () => page.evaluate(() => new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open("wordloop-local");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("state-domains", "readonly");
      const store = transaction.objectStore("state-domains");
      const attemptsRequest = store.get("quiz-attempts");
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => {
        const attempt = attemptsRequest.result?.value?.at(-1);
        database.close();
        resolve({ wordId: attempt?.wordId, mode: attempt?.mode, correct: attempt?.correct });
      };
    };
  }))).toEqual({ wordId: 1, mode: "meaning-choice", correct: false });

  await page
    .getByRole("complementary", { name: "主导航" })
    .getByRole("button", { name: /轨迹/ })
    .click();
  await openTraceAnalysis(page);
  await expect(page.locator(".sprint-history")).toContainText("覆盖 1 个不同单词");
  await page.getByRole("button", { name: /开始考前薄弱冲刺（1 词）/ }).click();
  await expect(page.getByText("熟词僻义", { exact: true })).toBeVisible();
});

test("信号联动：查词薄弱进入主动回忆，真实评分淡出并在再次查词后复发", async ({ context, page }) => {
  const seededState = lookupRecallTreatmentSeedState();
  const initialLookupLastAt = seededState.lookupStats.radiate.lastAt;
  await installStateSeed(context, seededState);
  await openApp(page);
  await page
    .getByRole("complementary", { name: "主导航" })
    .getByRole("button", { name: /轨迹/ })
    .click();
  await openTraceAnalysis(page);

  await page.getByRole("button", { name: /开始考前薄弱冲刺（1 词）/ }).click();
  await expect(page.getByText(/考前薄弱冲刺 · 词义主动回忆/).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "radiate" })).toBeVisible();
  await expect(page.locator(".meaning-panel")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /认识/ })).toBeHidden();

  await expect.poll(async () => (await readLookupTreatmentSnapshot(page)).activeSession)
    .toEqual({ title: "考前薄弱冲刺 · 词义主动回忆", wordIds: [1] });
  await page.reload();
  await waitForApp(page);
  await expect(page.getByText(/考前薄弱冲刺 · 词义主动回忆/).first()).toBeVisible();
  await expect(page.locator(".meaning-panel")).toHaveCount(0);

  await page.getByRole("button", { name: "显示单词释义" }).click();
  await expect(page.locator(".meaning-panel")).toContainText("散发");
  await page.getByRole("button", { name: /认识/ }).click();

  await expect.poll(async () => readLookupTreatmentSnapshot(page)).toMatchObject({
    review: { rating: 2, recallTimed: true, sprintAttributed: true },
    progress: { lastRating: 2 },
    lookupCount: 3,
    lookupLastAt: initialLookupLastAt,
  });
  await page.getByRole("button", { name: "返回轨迹页" }).click();
  await openTraceAnalysis(page);
  await expect(page.getByRole("button", { name: /开始考前薄弱冲刺/ })).toHaveCount(0);

  await page.getByRole("button", { name: "词环首页" }).click();
  await page.getByRole("button", { name: "显示单词释义" }).click();
  await selectText(
    page.getByText("Stars radiate energy into space.", { exact: true }),
    "radiate",
  );
  const popup = page.getByRole("dialog", { name: "划词查询：radiate" });
  await expect(popup).toContainText("已加入划词集");
  await expect.poll(async () => (await readLookupTreatmentSnapshot(page)).lookupCount).toBe(4);
  await expect.poll(async () => (await readLookupTreatmentSnapshot(page)).lookupLastAt)
    .not.toBe(initialLookupLastAt);
  await popup.getByRole("button", { name: "关闭划词查询" }).click();

  await page.reload();
  await waitForApp(page);
  await page
    .getByRole("complementary", { name: "主导航" })
    .getByRole("button", { name: /轨迹/ })
    .click();
  await openTraceAnalysis(page);
  await page.getByRole("button", { name: /开始考前薄弱冲刺（1 词）/ }).click();
  await expect(page.getByText(/考前薄弱冲刺 · 词义主动回忆/).first()).toBeVisible();
});

test("信号联动：顽固词按真实 review 跨主动回忆、听音拼写与中译英推进", async ({ context, page }) => {
  await installStateSeed(context, stubbornTreatmentSeedState());
  await openApp(page);
  await openWordbook(page);
  await page.getByRole("tab", { name: /顽固词/ }).click();
  await page.getByRole("button", { name: "开始顽固词专项" }).click();

  await expect(page.getByText(/顽固词多模式强化 · 词义主动回忆/).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "radiate" })).toBeVisible();
  await expect(page.locator(".meaning-panel")).toHaveCount(0);
  await expect.poll(async () => (await readStubbornTreatmentSnapshot(page)).activeSession)
    .toMatchObject({
      title: "顽固词多模式强化 · 词义主动回忆",
      wordIds: [1],
    });
  await expect.poll(async () => (await readStubbornTreatmentSnapshot(page)).activeSession?.id)
    .toMatch(/^sprint:stubborn:lookup-recall:/);

  await page.reload();
  await waitForApp(page);
  await expect(page.getByText(/顽固词多模式强化 · 词义主动回忆/).first()).toBeVisible();
  await expect(page.locator(".meaning-panel")).toHaveCount(0);
  await page.getByRole("button", { name: "显示单词释义" }).click();
  await page.getByRole("button", { name: /认识/ }).click();
  await expect.poll(async () => (await readStubbornTreatmentSnapshot(page)).review)
    .toMatchObject({ rating: 2, recallTimed: true });
  await expect.poll(async () => (await readStubbornTreatmentSnapshot(page)).review?.sessionId)
    .toMatch(/^sprint:stubborn:lookup-recall:/);

  await page.getByRole("button", { name: "返回词本" }).click();
  await page.getByRole("button", { name: "开始顽固词专项" }).click();
  await expect(page.getByText("听音拼写", { exact: true })).toBeVisible();
  await expect.poll(async () => (await readStubbornTreatmentSnapshot(page)).activeQuiz)
    .toMatchObject({ mode: "listening-spelling" });
  await expect.poll(async () => (await readStubbornTreatmentSnapshot(page)).activeQuiz?.id)
    .toMatch(/^sprint:stubborn:listening-spelling:/);

  await page.reload();
  await waitForApp(page);
  await page
    .getByRole("complementary", { name: "主导航" })
    .getByRole("button", { name: /测验/ })
    .click();
  await expect(page.getByText("听音拼写", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "你的答案" }).fill("radiate");
  await page.getByRole("button", { name: "提交" }).click();
  await expect(page.locator(".quiz-feedback")).toContainText("回答正确");
  await expect.poll(async () => (await readStubbornTreatmentSnapshot(page)).attempt)
    .toEqual({ mode: "listening-spelling", correct: true, appliedToSchedule: true });
  await expect.poll(async () => (await readStubbornTreatmentSnapshot(page)).review?.sessionId)
    .toMatch(/^sprint:stubborn:listening-spelling:/);

  await page
    .getByRole("complementary", { name: "主导航" })
    .getByRole("button", { name: /轨迹/ })
    .click();
  await openTraceAnalysis(page);
  await expect(page.locator(".sprint-history")).toContainText("覆盖 1 个不同单词");
  await page.getByRole("button", { name: /开始考前薄弱冲刺（1 词）/ }).click();
  await expect(page.getByText("中译英", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /散发/ })).toBeVisible();
  await expect.poll(async () => (await readStubbornTreatmentSnapshot(page)).activeQuiz?.id)
    .toMatch(/^sprint:stubborn:chinese-to-english:/);
});

test("信号联动：轨迹页冲刺记录出现并支持再跑一次", async ({ context, page }) => {
  await installStateSeed(context, sprintSeedState());
  await openApp(page);
  // 主导航进入轨迹页
  await page
    .getByRole("complementary", { name: "主导航" })
    .getByRole("button", { name: /轨迹/ })
    .click();
  await openTraceAnalysis(page);
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
  await expect(historySection).toContainText("当场达标 50%");
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
    .getByRole("spinbutton", { name: /反复查词/ });
  await lookupWeakInput.fill("10");
  await expect(preview).toContainText("薄弱候选 0 词");
  await expect(preview).toContainText("插队 1 词");
  await expect(preview).toContainText("冲刺 2 词");
  // 把「插队复习」阈值调到 10：插队清零
  const lookupPriorityInput = page
    .getByRole("spinbutton", { name: /插队复习/ });
  await lookupPriorityInput.fill("10");
  await expect(preview).toContainText("插队 0 词");
});

test("信号联动：薄弱阈值与猜错累计经分域写盘和完整刷新保持", async ({ context, page }) => {
  await installStateSeed(context, {
    ...lookupRecallTreatmentSeedState(),
    weakThresholds: {
      lookupWeak: 7,
      lookupPriority: 8,
      slowRecallMs: 22_000,
    },
    guessMistakes: { 1: 3 },
    senseFrequency: {
      1: [{ meaning: "散发", level: "high", note: "核心义" }],
    },
    hideChineseMeaning: true,
    guessContextFirst: true,
  });
  await openApp(page);

  const readSettings = async () => {
    const settings = await readStoreRecord(page, "settings", "current");
    return {
      weakThresholds: settings?.weakThresholds,
      guessMistakes: settings?.guessMistakes,
      senseFrequency: settings?.senseFrequency,
      hideChineseMeaning: settings?.hideChineseMeaning,
      guessContextFirst: settings?.guessContextFirst,
    };
  };
  await expect.poll(readSettings).toEqual({
    weakThresholds: {
      lookupWeak: 7,
      lookupPriority: 8,
      slowRecallMs: 22_000,
      leechLapses: 8,
    },
    guessMistakes: { 1: 3 },
    senseFrequency: {
      1: [{ meaning: "散发", level: "high", note: "核心义" }],
    },
    hideChineseMeaning: true,
    guessContextFirst: true,
  });

  await page.reload();
  await waitForApp(page);
  await openSettings(page);
  await expect(page.getByRole("spinbutton", { name: /反复查词/ })).toHaveValue("7");
  await expect(page.getByRole("spinbutton", { name: /插队复习/ })).toHaveValue("8");
  await expect(page.getByRole("spinbutton", { name: /回忆偏慢/ })).toHaveValue("22");

  await page.getByRole("spinbutton", { name: /反复查词/ }).fill("6");
  await expect.poll(readSettings).toEqual({
    weakThresholds: {
      lookupWeak: 6,
      lookupPriority: 8,
      slowRecallMs: 22_000,
      leechLapses: 8,
    },
    guessMistakes: { 1: 3 },
    senseFrequency: {
      1: [{ meaning: "散发", level: "high", note: "核心义" }],
    },
    hideChineseMeaning: true,
    guessContextFirst: true,
  });

  await page.reload();
  await waitForApp(page);
  await openSettings(page);
  await expect(
    page.getByRole("spinbutton", { name: /反复查词/ }),
  ).toHaveValue("6");
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
  await openTraceAnalysis(page);
  const sprintStart = page.getByRole("button", {
    name: /开始考前薄弱冲刺（2 词）/,
  });
  await expect(sprintStart).toBeVisible();
  const weeklyEffectiveness = page.locator('[aria-label="本周冲刺观察"]');
  await expect(weeklyEffectiveness).toContainText("当场达标词数");
  await expect(weeklyEffectiveness).toContainText("配对词回忆变化");
  await expect(weeklyEffectiveness).toContainText("较此前快 8.0s");
  await expect(weeklyEffectiveness).toContainText("配对词 2");
  const effectivenessSeries = page.locator('[aria-label="冲刺观察 4 周"]');
  await expect(effectivenessSeries).toContainText("当场达标词数");
  await expect(effectivenessSeries).toContainText("当场达标 1 词");
  await expect(effectivenessSeries).toContainText("较此前快 8.0s · 配对 2 词");
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
  await expect(
    page.getByLabel("本次冲刺小结").getByText("当场达标", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("配对词冲刺均值", { exact: true })).toBeVisible();
  const pairedRecall = page.locator('[aria-label="同词配对回忆变化"]');
  await expect(pairedRecall).toContainText("2 个配对词");
  await expect(pairedRecall).toContainText("最近非冲刺");
  await expect(pairedRecall).toContainText("本次冲刺");
  await expect(pairedRecall).toContainText("观察到本次较此前快");
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
  await openTraceAnalysis(page);
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
  // 点必考词分册「复习 →」按钮，进入限定范围冲刺会话
  const sectionSprint = concentration.getByRole("button", {
    name: "复习 →",
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

/** 当前仍薄弱追踪 seed：上周（8 天前）冲刺当场达标 2 词，两词当前仍薄弱 */
function relapseSeedState() {
  const state = sprintSeedState();
  const lastWeekSessionId = `sprint:${daysAgo(8, 8, 0)}`;
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
  // 本周再各追加 1 条低评分（rating 1）：lastRating 回到 ≤1，词书 isWeakProgress 判薄弱；
  // 同时不落入上周窗口（不复影响复发解决集），lookup 信号保持复发判定
  const recentAt = daysAgo(2, 9, 0);
  state.reviews.push(
    {
      id: "w1-relapse",
      wordId: 1,
      word: "radiate",
      rating: 1,
      kind: "review",
      intervalMs: 600_000,
      dueAt: new Date(new Date(recentAt).getTime() + 600_000).toISOString(),
      reviewedAt: recentAt,
      section: "必考词",
      unit: 1,
    },
    {
      id: "w2-relapse",
      wordId: 2,
      word: "objective",
      rating: 1,
      kind: "review",
      intervalMs: 600_000,
      dueAt: new Date(new Date(recentAt).getTime() + 720_000).toISOString(),
      reviewedAt: new Date(new Date(recentAt).getTime() + 120_000).toISOString(),
      section: "必考词",
      unit: 1,
    },
  );
  return state;
}

test("信号联动：词书薄弱分布与冲刺后当前仍薄弱追踪", async ({ context, page }) => {
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
  // 轨迹页：追踪栏显示上周当场达标与当前仍薄弱词数，并披露证据边界
  await page
    .getByRole("complementary", { name: "主导航" })
    .getByRole("button", { name: /轨迹/ })
    .click();
  await openTraceAnalysis(page);
  await expect(
    page.getByRole("heading", { name: "每一次回忆都算数" }),
  ).toBeVisible();
  const relapse = page.locator('[aria-label="冲刺后当前仍薄弱追踪"]');
  await expect(relapse).toBeVisible();
  await expect(relapse).toContainText("上周当场达标 2 词");
  await expect(relapse).toContainText("当前仍薄弱 2 词");
  await expect(relapse).toContainText("当前仍薄弱率 100%");
  await expect(relapse).toContainText("未区分从未恢复与恢复后再次薄弱");
  const relapseSeries = page.locator('[aria-label="冲刺后当前仍薄弱率 4 周回溯"]');
  await expect(relapseSeries).toBeVisible();
  await expect(relapseSeries).toContainText("按最近一次达标处置周分组");
  await expect(relapseSeries).toContainText("未区分从未恢复与恢复后再次薄弱");
});

test("信号联动：当前仍薄弱词一键再冲刺与词书薄弱单元", async ({ context, page }) => {
  await installStateSeed(context, relapseSeedState());
  await openApp(page);
  // 轨迹页：追踪栏出现「再冲刺当前仍薄弱词（2）」按钮
  await page
    .getByRole("complementary", { name: "主导航" })
    .getByRole("button", { name: /轨迹/ })
    .click();
  await openTraceAnalysis(page);
  await expect(
    page.getByRole("heading", { name: "每一次回忆都算数" }),
  ).toBeVisible();
  const relapse = page.locator('[aria-label="冲刺后当前仍薄弱追踪"]');
  await expect(relapse).toBeVisible();
  const resprintRelapse = relapse.getByRole("button", {
    name: /再冲刺当前仍薄弱词（2）/,
  });
  await expect(resprintRelapse).toBeVisible();
  await resprintRelapse.click();
  // 学习卡：当前仍薄弱词再次处置会话 + 信号原因
  await expect(
    page.getByRole("button", { name: "显示单词释义" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "显示单词释义" }).click();
  await expect(page.getByText("本词因以下信号进入冲刺")).toBeVisible();
  // 逐词评分推进完成
  for (let index = 0; index < 2; index += 1) {
    if (index > 0) {
      await page.getByRole("button", { name: "显示单词释义" }).click();
    }
    await page.getByRole("button", { name: /认识/ }).click();
  }
  await expect(
    page.getByRole("heading", { name: "本次冲刺小结" }),
  ).toBeVisible();
  // 词书页：必考词卡片薄弱文案 + 薄弱单元小字
  await page
    .getByRole("complementary", { name: "主导航" })
    .getByRole("button", { name: /词书/ })
    .click();
  const requiredCard = page
    .getByRole("button", { name: /必考词/ })
    .filter({ has: page.getByRole("heading", { name: "必考词" }) });
  await expect(requiredCard).toContainText("薄弱");
  await expect(requiredCard.locator(".book-weak-units")).toBeVisible();
  await expect(requiredCard.locator(".book-weak-units")).toContainText("薄弱集中");
});

test("信号联动：学习卡非冲刺态薄弱提示与一键补漏", async ({ context, page }) => {
  await installStateSeed(context, sprintSeedState());
  await openApp(page);
  // 学习页（非冲刺态）：radiate 是当前词（必考词 Unit 1 首词）
  await expect(
    page.getByRole("button", { name: "显示单词释义" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "显示单词释义" }).click();
  // 非冲刺态也显示薄弱信号（日常文案）+ 一键补漏按钮
  await expect(page.getByText("本词存在薄弱信号：")).toBeVisible();
  await expect(page.locator(".weak-signal-tags")).not.toBeEmpty();
  const addToday = page.getByRole("button", { name: "开始一词补漏" });
  await expect(addToday).toBeVisible();
  await addToday.click();
  // 进入今日任务会话（补漏），词卡仍显示薄弱信号
  await expect(
    page.getByRole("button", { name: "显示单词释义" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "显示单词释义" }).click();
  await expect(page.getByText("本词存在薄弱信号：")).toBeVisible();
  // 会话名应为「今日任务 · 补漏」
  await expect(page.getByText(/今日任务 · 补漏/).first()).toBeVisible();
});

function sprintRetentionSeedState() {
  const review = ({
    id,
    wordId,
    rating,
    reviewedAt,
    sessionId,
    recallMs,
  }) => ({
    id,
    wordId,
    word: `word-${wordId}`,
    rating,
    kind: "review",
    intervalMs: 600_000,
    dueAt: new Date(new Date(reviewedAt).getTime() + 600_000).toISOString(),
    reviewedAt,
    ...(sessionId ? { sessionId } : {}),
    ...(recallMs === undefined ? {} : { recallMs }),
    section: "必考词",
    unit: 1,
  });
  const anchorAt = localWeekTime(1, 1, 8, 0);
  const currentWeekSprintAt = localWeekTime(0, 0, 0, 1);
  return createState({
    reviews: [
      review({ id: "retained-anchor", wordId: 1, rating: 2, reviewedAt: anchorAt, sessionId: "sprint:retention", recallMs: 10_000 }),
      review({ id: "retained-follow", wordId: 1, rating: 2, reviewedAt: localWeekTime(1, 2, 8, 0), sessionId: "quiz:meaning-choice", recallMs: 6_000 }),
      review({ id: "failed-anchor", wordId: 2, rating: 3, reviewedAt: anchorAt, sessionId: "sprint:retention", recallMs: 8_000 }),
      review({ id: "failed-follow", wordId: 2, rating: 1, reviewedAt: localWeekTime(1, 3, 8, 0) }),
      review({ id: "unobserved-anchor", wordId: 3, rating: 2, reviewedAt: anchorAt, sessionId: "sprint:retention", recallMs: 7_000 }),
      review({ id: "truncated-anchor", wordId: 4, rating: 2, reviewedAt: anchorAt, sessionId: "sprint:retention", recallMs: 9_000 }),
      review({ id: "truncated-next-sprint", wordId: 4, rating: 2, reviewedAt: currentWeekSprintAt, sessionId: "sprint:next", recallMs: 7_000 }),
      review({ id: "truncated-too-late", wordId: 4, rating: 3, reviewedAt: localWeekTime(0, 0, 1, 0), recallMs: 5_000 }),
      review({ id: "null-anchor", wordId: 5, rating: 2, reviewedAt: localWeekTime(4, 1, 8, 0), sessionId: "sprint:null", recallMs: 4_000 }),
    ],
    quizAttempts: [{
      id: "attempt-must-not-follow",
      wordId: 3,
      mode: "meaning-choice",
      correct: true,
      recallMs: 3_000,
      answeredAt: localWeekTime(1, 2, 9, 0),
      appliedToSchedule: false,
    }],
    wordProgress: {},
  });
}

test("信号联动：冲刺后首次正常复习保持披露覆盖、截断与配对测时", async ({ context, page }) => {
  await installStateSeed(context, sprintRetentionSeedState());
  await openApp(page);
  await page
    .getByRole("complementary", { name: "主导航" })
    .getByRole("button", { name: /轨迹/ })
    .click();
  await openTraceAnalysis(page);
  await expect(
    page.getByRole("heading", { name: "每一次回忆都算数" }),
  ).toBeVisible();

  const retention = page.locator('[aria-label="冲刺后首次正常复习保持 4 周"]');
  await expect(retention).toBeVisible();
  await expect(retention).toContainText("未观察不计为失败");
  await expect(retention).toContainText("覆盖 50% · 保持 50%");
  await expect(retention).toContainText("cohort 4 · 已观察 2 · 保持 1");
  await expect(retention).toContainText("未观察 2 · 截断 1 · 平均间隔 1.5天");
  await expect(retention).toContainText("配对测时 1 词");
  await expect(retention).toContainText("冲刺 10.0s → 随访 6.0s");
  await expect(retention).toContainText("随访较冲刺快 4.0s");
  await expect(retention).toContainText("覆盖 0% · 保持 —");
  await expect(retention).toContainText("cohort 1 · 已观察 0 · 保持 0");
  await expect(retention).toContainText("未观察 1 · 截断 0 · 平均间隔 —");
  await expect(retention).toContainText("配对测时 0 词 · 无配对样本");
});

function dimensionObservationSeedState() {
  const review = ({ id, wordId, rating, reviewedAt, sessionId, recallMs }) => ({
    id,
    wordId,
    word: `word-${wordId}`,
    rating,
    kind: "review",
    intervalMs: 600_000,
    dueAt: new Date(new Date(reviewedAt).getTime() + 600_000).toISOString(),
    reviewedAt,
    ...(sessionId ? { sessionId } : {}),
    ...(recallMs === undefined ? {} : { recallMs }),
    section: "必考词",
    unit: 1,
  });
  const anchorAt = localWeekTime(1, 1, 8, 0);
  const followAt = localWeekTime(1, 2, 8, 0);
  return createState({
    reviews: [
      review({ id: "dimension-known-anchor", wordId: 1, rating: 2, reviewedAt: anchorAt, sessionId: `sprint:treatment:meaning-choice:${anchorAt}`, recallMs: 8_000 }),
      review({ id: "dimension-known-follow", wordId: 1, rating: 2, reviewedAt: followAt, sessionId: "quiz:meaning-choice", recallMs: 4_000 }),
      review({ id: "dimension-unknown-anchor", wordId: 2, rating: 2, reviewedAt: anchorAt, sessionId: `sprint:${anchorAt}`, recallMs: 7_000 }),
      review({ id: "dimension-unknown-follow", wordId: 2, rating: 1, reviewedAt: followAt, recallMs: 5_000 }),
      review({ id: "dimension-generic-anchor", wordId: 3, rating: 2, reviewedAt: anchorAt, sessionId: `sprint:treatment:generic-sprint:${anchorAt}` }),
      review({ id: "dimension-stubborn-anchor", wordId: 4, rating: 2, reviewedAt: anchorAt, sessionId: `sprint:stubborn:lookup-recall:${anchorAt}`, recallMs: 6_000 }),
      review({ id: "dimension-stubborn-follow", wordId: 4, rating: 2, reviewedAt: followAt, sessionId: "quiz:meaning-choice", recallMs: 6_000 }),
    ],
    wordProgress: {},
  });
}

test("信号联动：分维度观察固定并列 known、unknown、generic 与顽固样本", async ({ context, page }) => {
  await installStateSeed(context, dimensionObservationSeedState());
  await openApp(page);
  await page
    .getByRole("complementary", { name: "主导航" })
    .getByRole("button", { name: /轨迹/ })
    .click();
  await openTraceAnalysis(page);
  const report = page.locator('[aria-label="分维度观察报告（最近 4 个完整周）"]');
  await expect(report).toBeVisible();
  await report.locator("summary").click();

  await expect(report).toContainText("不代表模式效果、因果、最佳/最差或推荐依据");
  await expect(report).toContainText("同词可跨维重复，不可跨维合计");
  await expect(report).toContainText("当前弱点也未必由该处置维度产生");
  await expect(report.locator('[data-dimension="meaning-choice"]')).toContainText("保持：1/1（100%）");
  await expect(report.locator('[data-dimension="unknown"]')).toContainText("保持：0/1（0%）");
  await expect(report.locator('[data-dimension="generic-sprint"]')).toContainText("通用冲刺");
  await expect(report.locator('[data-dimension="unknown"]')).toContainText("未知历史");
  await expect(report.locator('[data-dimension="stubborn"]')).toContainText("词义主动回忆 1");
  await expect(report.locator('[data-dimension="slow-recall"]')).toHaveCount(0);
  await expect(report).toContainText("其余 5 个维度暂无活动样本");
  await expect(report.locator("article")).toHaveCount(4);
  expect(await report.locator("article").evaluateAll((items) =>
    items.map((item) => item.getAttribute("data-dimension")))).toEqual([
    "meaning-choice",
    "stubborn",
    "generic-sprint",
    "unknown",
  ]);
});
