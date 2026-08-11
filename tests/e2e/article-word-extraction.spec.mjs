import { expect, test } from "@playwright/test";
import { createState } from "./fixtures.mjs";
import {
  installStateSeed,
  openApp,
  openWordbook,
  readStoreCount,
  readStoreRecord,
} from "./helpers.mjs";

const EXISTING_LOOKUP_ID = 9_000_123;
const ARTICLE_TEXT = [
  "Radiate",
  "objective",
  "contextualized",
  "elucidator",
  "ELUCIDATOR",
  "aardvark",
  "zzzzwordloopmissing",
].join(" ");

function masteredProgress(wordId) {
  const reviewedAt = "2026-08-01T08:00:00.000Z";
  const dueAt = "2026-09-01T08:00:00.000Z";
  return {
    wordId,
    status: "mastered",
    firstLearnedAt: reviewedAt,
    lastReviewedAt: reviewedAt,
    nextDueAt: dueAt,
    lastRating: 3,
    reviewCount: 5,
    successCount: 5,
    lapseCount: 0,
    consecutiveSuccesses: 5,
    intervalMs: 31 * 86_400_000,
    fsrsCard: {
      due: dueAt,
      stability: 31,
      difficulty: 3,
      elapsedDays: 1,
      scheduledDays: 31,
      learningSteps: 0,
      reps: 5,
      lapses: 0,
      state: 2,
      lastReview: reviewedAt,
    },
  };
}

function existingLookupWord() {
  return {
    id: EXISTING_LOOKUP_ID,
    query: "contextualized",
    kind: "word",
    phonetic: "",
    phoneticSource: "dictionary",
    part: "本地词典",
    meaning: "使语境化",
    note: "既有划词",
    source: "dictionary",
    addedAt: "2026-08-01T08:00:00.000Z",
  };
}

function seededArticleState() {
  return createState({
    lookupWords: [existingLookupWord()],
    lookupStats: {
      contextualized: {
        count: 2,
        firstAt: "2026-08-01T08:00:00.000Z",
        lastAt: "2026-08-02T08:00:00.000Z",
      },
    },
    wordProgress: { 5: masteredProgress(5) },
  });
}

async function openExtractor(page) {
  await openWordbook(page);
  await page.getByRole("button", { name: "文章提词" }).click();
  await expect(
    page.getByRole("region", { name: "文章提词" }),
  ).toBeVisible();
}

async function analyze(page, text) {
  await page.getByRole("textbox", { name: "英文文章" }).fill(text);
  await page.getByRole("button", { name: "分析文章" }).click();
  await expect(page.getByRole("status").filter({ hasText: "分析完成" }))
    .toBeVisible();
}

async function learningStateSnapshot(page) {
  const settings = await readStoreRecord(page, "settings", "current");
  return {
    lookupWords: settings?.lookupWords,
    lookupStats: settings?.lookupStats,
    activeSession: settings?.activeSession,
    reviews: await readStoreCount(page, "reviews"),
    wordProgress: await readStoreCount(page, "word-progress"),
    mistakes: await readStoreCount(page, "mistakes"),
  };
}

async function revealAndRate(page) {
  await page.getByRole("button", { name: "显示单词释义" }).click();
  await page.getByRole("button", { name: /认识/ }).click();
}

test("文章提词预览保持零写入并按来源状态筛选", async ({ context, page }) => {
  await installStateSeed(context, seededArticleState());
  await openApp(page);
  await openExtractor(page);
  const before = await learningStateSnapshot(page);

  await analyze(page, ARTICLE_TEXT);

  const candidateList = page.getByRole("list", { name: "文章候选词" });
  await expect(candidateList).toContainText("radiate");
  await expect(candidateList).toContainText("contextualized");
  await expect(candidateList).toContainText("elucidator");
  await expect(candidateList).toContainText("aardvark");
  await expect(candidateList).not.toContainText("objective");
  await expect(page.getByText("匹配候选 5", { exact: true })).toBeVisible();
  await expect(page.getByText("未学习 4", { exact: true })).toBeVisible();
  await expect(page.getByText("项目内已掌握 1", { exact: true })).toBeVisible();
  await expect(page.getByText("ECDICT 未命中 1", { exact: true })).toBeVisible();
  await expect(page.getByText("查询失败 0", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "开始文章学习（4 词）" }))
    .toBeVisible();

  const order = await candidateList.getByRole("listitem")
    .evaluateAll((items) => items.map((item) => item.getAttribute("data-token")));
  expect(order).toEqual(["radiate", "contextualized", "elucidator", "aardvark"]);

  await page.getByRole("checkbox", { name: /显示项目内已掌握/ }).check();
  await expect(candidateList).toContainText("objective");
  await expect(page.getByRole("checkbox", { name: "选择 objective" }))
    .not.toBeChecked();
  await page.getByRole("combobox", { name: "按学习状态筛选" })
    .selectOption("mastered");
  await expect(candidateList.getByRole("listitem")).toHaveCount(1);
  await expect(candidateList.getByRole("listitem").first())
    .toHaveAttribute("data-token", "objective");
  await page.getByRole("combobox", { name: "按学习状态筛选" })
    .selectOption("all");
  await expect(page.getByRole("checkbox", { name: "选择 radiate" }))
    .toBeChecked();

  expect(await learningStateSnapshot(page)).toEqual(before);
});

test("确认选择后原子创建真实 article 会话并刷新恢复到词本", async ({ context, page }) => {
  await installStateSeed(context, seededArticleState());
  await openApp(page);
  await openExtractor(page);
  await analyze(page, ARTICLE_TEXT);

  await page.getByRole("checkbox", { name: "选择 aardvark" }).uncheck();
  await page.getByRole("button", { name: "开始文章学习（3 词）" }).click();

  await expect(page.getByText("文章提词 · 0/3", { exact: true })).toBeVisible();
  await expect(page.getByText("文章提词", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("这个词来自你粘贴并确认的英文文章。", {
    exact: true,
  })).toBeVisible();

  const created = await expect.poll(async () => {
    const settings = await readStoreRecord(page, "settings", "current");
    return {
      lookupWords: settings?.lookupWords,
      lookupStats: settings?.lookupStats,
      activeSession: settings?.activeSession,
    };
  }).toMatchObject({
    lookupStats: seededArticleState().lookupStats,
    activeSession: {
      kind: "article",
      title: "文章提词",
      index: 0,
    },
  });
  void created;

  const settings = await readStoreRecord(page, "settings", "current");
  const storedWords = settings.lookupWords;
  expect(storedWords.map((item) => item.query).sort()).toEqual([
    "contextualized",
    "elucidator",
  ]);
  expect(storedWords.some((item) => item.query === "aardvark")).toBe(false);
  const elucidatorId = storedWords.find((item) => item.query === "elucidator").id;
  expect(settings.activeSession.wordIds).toEqual([1, EXISTING_LOOKUP_ID, elucidatorId]);
  expect(new Set(settings.activeSession.wordIds).size).toBe(3);

  await revealAndRate(page);
  const beforeReload = await expect.poll(async () =>
    (await readStoreRecord(page, "settings", "current"))?.activeSession,
  ).toMatchObject({ kind: "article", index: 1 });
  void beforeReload;
  const persistedBeforeReload = (
    await readStoreRecord(page, "settings", "current")
  ).activeSession;

  await page.reload();
  await openApp(page);
  const restored = await readStoreRecord(page, "settings", "current");
  expect(restored.activeSession).toEqual(persistedBeforeReload);
  await expect(page.getByText("文章提词 · 1/3", { exact: true })).toBeVisible();

  await revealAndRate(page);
  await revealAndRate(page);
  await expect(
    page.getByRole("heading", { name: "这一轮记忆已闭合" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回词本" }).click();
  await expect(page.getByRole("tablist", { name: "词本分类" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /错词记录/ }))
    .toHaveAttribute("aria-selected", "false");
});

test("文章提词边界、失败、截断与响应式键盘路径可用", async ({ context, page }) => {
  const dictionaryRequests = [];
  page.on("request", (request) => {
    if (request.url().includes("/data/dictionary/")) {
      dictionaryRequests.push(request.url());
    }
  });
  await page.route("**/data/dictionary/**", async (route) => {
    const url = new URL(route.request().url());
    if (/\/data\/dictionary\/(?:ranges\/)?q(?:\.|\/)/.test(url.pathname)) {
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  await installStateSeed(context, createState());
  await page.setViewportSize({ width: 320, height: 720 });
  await openApp(page);
  await openExtractor(page);

  const textarea = page.getByRole("textbox", { name: "英文文章" });
  const analyzeButton = page.getByRole("button", { name: "分析文章" });
  await expect(analyzeButton).toBeDisabled();
  await expect(page.getByText("最多输入 20,000 个字符", { exact: true }))
    .toBeVisible();

  await analyze(page, "zzzzwordloopmissing");
  await expect(page.getByText("ECDICT 未命中 1", { exact: true })).toBeVisible();
  await expect(page.getByText("没有找到可学习的候选词", { exact: true }))
    .toBeVisible();
  await expect(page.getByRole("button", { name: "开始文章学习（0 词）" }))
    .toBeDisabled();
  expect((await readStoreRecord(page, "settings", "current"))?.activeSession)
    .toBeUndefined();

  await analyze(page, "elucidator quokka zzzzwordloopmissing");
  await expect(page.getByText("ECDICT 未命中 1", { exact: true })).toBeVisible();
  await expect(page.getByText("查询失败 1", { exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "文章候选词" }))
    .toContainText("elucidator");
  await page.getByRole("button", { name: "清空选择" }).click();
  await page.getByRole("button", { name: "开始文章学习（0 词）" }).click();
  await expect(page.getByText("请至少选择一个候选词", { exact: true }))
    .toBeVisible();
  expect((await readStoreRecord(page, "settings", "current"))?.activeSession)
    .toBeUndefined();

  const cappedWords = Array.from({ length: 201 }, (_, index) => {
    const first = String.fromCharCode(97 + Math.floor(index / 26));
    const second = String.fromCharCode(97 + index % 26);
    return `missing${first}${second}`;
  });
  await analyze(page, cappedWords.join(" "));
  await expect(page.getByText("未分析 1", { exact: true })).toBeVisible();

  const overflow = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(overflow.body).toBeLessThanOrEqual(overflow.viewport + 2);

  await page.setViewportSize({ width: 1280, height: 900 });
  await textarea.fill("radiate");
  await textarea.focus();
  await textarea.press("Tab");
  await expect(analyzeButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "分析完成" }))
    .toBeVisible();
  const candidateCheckbox = page.getByRole("checkbox", { name: "选择 radiate" });
  await candidateCheckbox.focus();
  await page.keyboard.press("Space");
  await expect(candidateCheckbox).not.toBeChecked();

  for (const zoom of ["2", "4"]) {
    await page.evaluate((level) => {
      document.documentElement.style.zoom = level;
    }, zoom);
    await expect(textarea).toBeVisible();
    await expect(analyzeButton).toBeVisible();
    await page.evaluate(() => {
      document.documentElement.style.zoom = "1";
    });
  }

  const requestedLetters = new Set(dictionaryRequests.flatMap((url) => {
    const match = new URL(url).pathname.match(
      /\/data\/dictionary\/(?:ranges\/)?([a-z])(?:\.|\/)/,
    );
    return match ? [match[1]] : [];
  }));
  expect(requestedLetters.size).toBeLessThan(26);
});
