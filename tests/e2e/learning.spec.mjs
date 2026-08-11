import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  createState,
  RADIATE_ENRICHMENT,
} from "./fixtures.mjs";
import {
  installStateSeed,
  openApp,
  openSettings,
  openWordbook,
  readStoreCount,
  readStoreRecord,
  selectText,
  selectTextWithTouch,
  waitForApp,
} from "./helpers.mjs";

const E_DICTIONARY_SHARD = readFileSync(
  new URL("../../public/data/dictionary/e.json", import.meta.url),
  "utf8",
);

const ELUCIDATOR_SENTENCE =
  "A careful elucidator radiated light onto the old diagram.";

function getElucidatorSentence(page) {
  // 同一句例句可能因多个目标义项重复展示；这些用例只需选择其中一个可见实例。
  return page.getByText(ELUCIDATOR_SENTENCE, { exact: true }).first();
}

async function openElucidatorLookup(context, page) {
  await installStateSeed(context, createState({
    enrichments: RADIATE_ENRICHMENT,
  }));
  await openApp(page);
  await page.getByRole("button", { name: "显示单词释义" }).click();
  const sentence = getElucidatorSentence(page);
  await selectText(sentence, "elucidator");
  const popup = page.getByRole("dialog", { name: "划词查询：elucidator" });
  await popup.getByRole("button", { name: "翻译" }).click();
  return popup;
}

test("点击单词主体立即触发发音并显示音标", async ({ context, page }) => {
  await context.addInitScript(() => {
    globalThis.__wordloopAudioPlays = [];
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value() {
        globalThis.__wordloopAudioPlays.push(this.currentSrc || this.src || "audio");
        return Promise.resolve();
      },
    });
  });
  await installStateSeed(context, createState());
  await openApp(page);

  const wordFace = page.getByRole("button", { name: "显示单词释义" });
  await expect(wordFace.locator("p")).toHaveText(/^\/.+\/$/);
  await expect(page.getByRole("button", { name: /播放 radiate 的发音/ }))
    .toHaveAttribute("title", "2027 红宝书原声");

  await wordFace.click();

  await expect(page.getByText("请依据查看释义前的回忆状态评分", { exact: true })).toBeVisible();
  const ratingButtons = page.locator(".rating-bar button");
  await expect(ratingButtons.nth(0)).toContainText("查看前完全没想起，或回忆错误");
  await expect(ratingButtons.nth(1)).toContainText("查看前有印象，但关键内容不完整");
  await expect(ratingButtons.nth(2)).toContainText("查看前正确想起，过程略有迟疑");
  await expect(ratingButtons.nth(3)).toContainText("查看前立即、准确、轻松想起");
  await expect(page.getByRole("button", { name: /认识/ })).toBeVisible();
  await expect.poll(() => page.evaluate(
    () => globalThis.__wordloopAudioPlays.length,
  )).toBe(1);
});

test("只保留当前词与下一词两个浏览器音频源", async ({ context, page }) => {
  await context.addInitScript(() => {
    globalThis.__wordloopAudioElements = [];
    globalThis.Audio = new Proxy(globalThis.Audio, {
      construct(Target, args) {
        const audio = Reflect.construct(Target, args);
        globalThis.__wordloopAudioElements.push(audio);
        return audio;
      },
    });
  });
  await installStateSeed(context, createState());
  await openApp(page);

  const activeSources = () => page.evaluate(() =>
    globalThis.__wordloopAudioElements
      .map((audio) => audio.getAttribute("src"))
      .filter(Boolean));

  await expect.poll(activeSources).toHaveLength(2);
  const initialSources = await activeSources();
  expect(new Set(initialSources).size).toBe(2);

  await page.getByRole("button", { name: "显示单词释义" }).click();
  await page.getByRole("button", { name: /认识/ }).click();
  await expect.poll(activeSources).toHaveLength(2);
  await expect.poll(async () => new Set(await activeSources()).size).toBe(2);

  await openSettings(page);
  const diagnostics = page.locator(".performance-diagnostics");
  await expect(diagnostics).toContainText("音频预载池");
  await expect(diagnostics).toContainText("2/2 个元素");
});

test("专项测验答错写入 FSRS 薄弱词并更新每周报告", async ({ context, page }) => {
  await installStateSeed(context, createState());
  await openApp(page);

  await page.getByRole("button", { name: "显示单词释义" }).click();
  await page.getByRole("button", { name: /认识/ }).click();
  await expect.poll(async () =>
    (await readStoreRecord(page, "word-progress", 1))?.lastRating).toBe(2);

  const navigation = page.getByRole("complementary", { name: "主导航" });
  await navigation.getByRole("button", { name: /测验$/ }).click();
  await expect(page.getByRole("heading", { name: "主动写出来，才算真正会" }))
    .toBeVisible();
  await page.getByRole("button", { name: /听音拼写/ }).click();
  await page.getByLabel("你的答案").fill("incorrect");
  await page.getByRole("button", { name: "提交" }).click();
  const feedback = page.locator(".quiz-feedback");
  await expect(feedback).toContainText("已加入薄弱词");
  await expect(feedback).toContainText("解析：");
  await expect(feedback).toContainText("本题播放的发音对应单词“radiate”");
  await expect(feedback).toContainText("正确答案：radiate");
  await expect.poll(async () =>
    (await readStoreRecord(page, "word-progress", 1))?.lastRating).toBe(0);
  await expect.poll(() => readStoreCount(page, "mistakes")).toBe(1);

  await navigation.getByRole("button", { name: /轨迹$/ }).click();
  await expect(page.getByRole("heading", { name: "每周学习报告" }))
    .toBeVisible();
  await expect(page.getByText("下周预计复习", { exact: true })).toBeVisible();
  await expect(page.getByText(/设置考研日期后可获得每日新词调整建议/))
    .toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileReportViewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(mobileReportViewport.scrollWidth)
    .toBeLessThanOrEqual(mobileReportViewport.clientWidth + 1);
  await navigation.getByRole("button", { name: /测验$/ }).click();
  await expect(page.locator(".quiz-view")).toBeVisible();
  const mobileQuizViewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(mobileQuizViewport.scrollWidth)
    .toBeLessThanOrEqual(mobileQuizViewport.clientWidth + 1);
});

test("多义词严格按义项数量显示例句", async ({ context, page }) => {
  await installStateSeed(context, createState({
    enrichments: RADIATE_ENRICHMENT,
  }));
  await openApp(page);
  await page.getByRole("button", { name: "显示单词释义" }).click();

  const examples = page.locator(".sense-example");
  await expect(examples).toHaveCount(
    RADIATE_ENRICHMENT[1].targetMeanings.length,
  );
  for (const [index, meaning] of RADIATE_ENRICHMENT[1].targetMeanings.entries()) {
    await expect(examples.nth(index).locator("strong"))
      .toHaveText(`${index + 1}. ${meaning}`);
  }
});

test("评分写入后可以撤销，并把持久化进度恢复到评分前", async ({ context, page }) => {
  await installStateSeed(context, createState());
  await openApp(page);

  const wordFace = page.getByRole("button", { name: "显示单词释义" });
  const wordHeading = wordFace.locator("h1");
  const originalWord = await wordHeading.textContent();
  await wordFace.click();
  await page.getByRole("button", { name: /认识/ }).click();
  await expect.poll(() => readStoreCount(page, "reviews")).toBe(1);

  const ratingNotice = page.getByRole("status").filter({ hasText: "Z 撤销" });
  await ratingNotice.getByRole("button", { name: "撤销" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "已撤销" }),
  ).toBeVisible();
  await expect(wordHeading).toHaveText(originalWord ?? "");
  await expect(page.getByRole("button", { name: /认识/ })).toBeVisible();
  await expect.poll(() => readStoreCount(page, "reviews")).toBe(0);
  await expect.poll(() => readStoreCount(page, "word-progress")).toBe(0);

  await page.reload();
  await waitForApp(page);
  await expect(
    page
      .getByRole("button", { name: "显示单词释义" })
      .locator("h1"),
  ).toHaveText(originalWord ?? "");
  await expect.poll(() => readStoreCount(page, "reviews")).toBe(0);
});

test("低评分强化会关闭 AI 教练并在答错后给出完整对照", async ({ context, page }) => {
  await installStateSeed(context, createState());
  await openApp(page);

  const wordFace = page.getByRole("button", { name: "显示单词释义" });
  const wordHeading = wordFace.locator("h1");
  const radiateAudio = page.getByRole("button", { name: /播放 radiate 的发音/ });
  await expect(wordHeading).toHaveText("radiate");
  await wordFace.click();

  await page.getByRole("button", { name: "打开 AI 记忆教练" }).click();
  const coach = page.getByRole("complementary", { name: "AI 记忆教练" });
  await expect(coach).toBeVisible();
  await expect(coach).toContainText("radiate");

  await page.getByRole("button", { name: /忘记/ }).click();
  await expect(coach).toBeHidden();
  const disabledCoachEntry = page.getByRole("button", {
    name: "强化拼写进行中，暂不能打开 AI 记忆教练",
  });
  await expect(disabledCoachEntry).toBeDisabled();
  await expect(disabledCoachEntry).toHaveAttribute(
    "title",
    "请先完成强化拼写或暂时跳过，再使用 AI 记忆教练",
  );

  const reinforcement = page.locator(".reinforcement-panel");
  await expect(reinforcement).toBeVisible();
  await reinforcement.getByRole("textbox", { name: "输入完整单词" })
    .fill("radio");
  await reinforcement.getByRole("button", { name: "完成强化" }).click();

  const feedback = reinforcement.locator("#reinforcement-feedback");
  await expect(feedback).toContainText("你刚输入的是「radio」");
  await expect(feedback).toContainText("正确拼写是「radiate」");
  await expect(feedback).toContainText("请对照后重试");
  await expect(feedback).toContainText("暂时跳过");
  await expect(radiateAudio).toBeVisible();
  await expect.poll(() => readStoreCount(page, "reviews")).toBe(0);
  await expect.poll(async () => readStoreRecord(page, "word-progress", 1))
    .toBeNull();

  await reinforcement.getByRole("textbox", { name: "输入完整单词" })
    .fill("radiate");
  await reinforcement.getByRole("button", { name: "完成强化" }).click();
  await expect(reinforcement).toHaveCount(0);
  await expect.poll(() => readStoreCount(page, "reviews")).toBe(1);
  await expect.poll(async () =>
    (await readStoreRecord(page, "word-progress", 1))?.lastRating).toBe(0);
  await expect(radiateAudio).toHaveCount(0);
});

test("刷新页面后仍可撤销最近评分", async ({ context, page }) => {
  await installStateSeed(context, createState());
  await openApp(page);

  const wordFace = page.getByRole("button", { name: "显示单词释义" });
  const originalWord = await wordFace.locator("h1").textContent();
  await wordFace.click();
  await page.getByRole("button", { name: /认识/ }).click();
  await expect.poll(async () => {
    const settings = await readStoreRecord(page, "settings", "current");
    return settings?.ratingUndoStack?.length ?? 0;
  }).toBe(1);

  await page.reload();
  await waitForApp(page);
  await page.getByRole("button", { name: /撤销上一步/ }).click();

  await expect(
    page.getByRole("status").filter({ hasText: "已撤销" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "显示单词释义" }).locator("h1"),
  ).toHaveText(originalWord ?? "");
  await expect.poll(() => readStoreCount(page, "reviews")).toBe(0);
  await expect.poll(async () => {
    const settings = await readStoreRecord(page, "settings", "current");
    return settings?.ratingUndoStack?.length ?? 0;
  }).toBe(0);
});

test("设置页显示并可清空评分撤销历史", async ({ context, page }) => {
  await installStateSeed(context, createState());
  await openApp(page);
  await page.getByRole("button", { name: "显示单词释义" }).click();
  await page.getByRole("button", { name: /认识/ }).click();
  await openSettings(page);
  await expect(page.getByText("当前可撤销 1 步，运行中最多保留 30 步"))
    .toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "清空撤销历史" }).click();
  await expect(page.getByText("当前可撤销 0 步，运行中最多保留 30 步"))
    .toBeVisible();
  await expect.poll(async () => {
    const settings = await readStoreRecord(page, "settings", "current");
    return settings?.ratingUndoStack?.length ?? 0;
  }).toBe(0);
});

test("划选例句中的英文可查义、加入划词集并持久化", async ({ context, page }) => {
  await installStateSeed(context, createState({
    enrichments: RADIATE_ENRICHMENT,
  }));
  await openApp(page);

  await page.getByRole("button", { name: "显示单词释义" }).click();
  await selectText(
    page.getByText("Stars radiate energy into space.", { exact: true }),
    "radiate",
  );
  const popup = page.getByRole("dialog", { name: "划词查询：radiate" });
  await expect(popup).toBeVisible();
  // 红宝书内词直接显示查询结果，不再询问是否翻译
  await expect(popup).toContainText("已加入划词集");

  await expect.poll(async () => {
    const settings = await readStoreRecord(page, "settings", "current");
    return settings?.lookupWords?.length ?? 0;
  }).toBe(1);
  await openWordbook(page);
  await page.getByRole("tab", { name: /划词集/ }).click();
  await expect(
    page.getByRole("tabpanel").getByRole("heading", { name: "radiate" }),
  ).toBeVisible();

  await page.reload();
  await waitForApp(page);
  await openWordbook(page);
  await page.getByRole("tab", { name: /划词集/ }).click();
  await expect(
    page.getByRole("tabpanel").getByRole("heading", { name: "radiate" }),
  ).toBeVisible();
});

test("高频考义在学习卡与划词弹窗一致高亮", async ({ browser, context, page }) => {
  const senseFrequency = {
    1: [
      { meaning: "散发", level: "high" },
      { meaning: "流露", level: "medium" },
    ],
  };
  await installStateSeed(context, createState({
    enrichments: RADIATE_ENRICHMENT,
    familiarMeanings: { 1: ["散发"] },
    senseFrequency,
  }));
  await openApp(page);
  await page.getByRole("button", { name: "显示单词释义" }).click();

  const highCardSense = page.locator(".meaning-sense")
    .filter({ hasText: "散发" }).first();
  const mediumCardSense = page.locator(".meaning-sense")
    .filter({ hasText: "流露" }).first();
  await expect(highCardSense).toHaveClass(/\bsense-frequency-highlight\b/);
  await expect(highCardSense).toHaveClass(/\bfamiliar\b/);
  await expect(highCardSense.getByText("★ 高频常考", { exact: true })).toBeVisible();
  await expect(mediumCardSense).not.toHaveClass(/\bsense-frequency-highlight\b/);

  const highCardStyle = await highCardSense.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      borderTopWidth: style.borderTopWidth,
      fontWeight: Number(style.fontWeight),
    };
  });
  expect(highCardStyle.backgroundColor).toBe("rgb(255, 245, 239)");
  expect(highCardStyle.borderTopWidth).toBe("1px");
  expect(highCardStyle.fontWeight).toBeGreaterThanOrEqual(700);

  const radiateSentence = page.getByText(
    "Stars radiate energy into space.",
    { exact: true },
  );
  await selectText(radiateSentence, "radiate");
  let popup = page.getByRole("dialog", { name: "划词查询：radiate" });
  await expect(popup).toContainText("红宝书");
  await expect(popup).toContainText("已加入划词集");
  const highPopupSense = popup.locator(".selection-lookup-sense")
    .filter({ hasText: "散发" });
  const mediumPopupSense = popup.locator(".selection-lookup-sense")
    .filter({ hasText: "流露" });
  await expect(highPopupSense).toHaveClass(/\bsense-frequency-highlight\b/);
  await expect(highPopupSense.getByText("★ 高频常考", { exact: true })).toBeVisible();
  await expect(mediumPopupSense).not.toHaveClass(/\bsense-frequency-highlight\b/);
  await expect(popup.locator(".sense-frequency-highlight")).toHaveCount(1);

  const highPopupStyle = await highPopupSense.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      borderTopWidth: style.borderTopWidth,
      fontWeight: Number(style.fontWeight),
    };
  });
  expect(highPopupStyle).toEqual(highCardStyle);

  await popup.getByRole("button", { name: "关闭划词查询" }).click();
  await expect(popup).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 700 });
  await radiateSentence.scrollIntoViewIfNeeded();
  await selectText(radiateSentence, "radiate");
  popup = page.getByRole("dialog", { name: "划词查询：radiate" });
  await expect(popup.locator(".sense-frequency-highlight")).toHaveCount(1);
  const mobileViewport = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(mobileViewport.scrollWidth).toBeLessThanOrEqual(mobileViewport.innerWidth);

  const noFrequencyContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });
  try {
    await installStateSeed(noFrequencyContext, createState({
      enrichments: RADIATE_ENRICHMENT,
    }));
    const noFrequencyPage = await noFrequencyContext.newPage();
    await openApp(noFrequencyPage);
    await noFrequencyPage.getByRole("button", { name: "显示单词释义" }).click();
    await expect(noFrequencyPage.locator(".sense-frequency-highlight")).toHaveCount(0);
    const sentenceWithoutFrequency = noFrequencyPage.getByText(
      "Stars radiate energy into space.",
      { exact: true },
    );
    await selectText(sentenceWithoutFrequency, "radiate");
    const popupWithoutFrequency = noFrequencyPage.getByRole("dialog", {
      name: "划词查询：radiate",
    });
    await expect(popupWithoutFrequency).toContainText("已加入划词集");
    await expect(popupWithoutFrequency.locator(".sense-frequency-highlight"))
      .toHaveCount(0);
  } finally {
    await noFrequencyContext.close();
  }
});

test("词典 Range 请求返回 206，查询过的词再次划选时直显结果和音标", async ({ context, page }) => {
  await installStateSeed(context, createState({
    enrichments: RADIATE_ENRICHMENT,
  }));
  await openApp(page);
  await page.getByRole("button", { name: "显示单词释义" }).click();

  const sentence = getElucidatorSentence(page);
  await selectText(sentence, "elucidator");
  let popup = page.getByRole("dialog", { name: "划词查询：elucidator" });
  await expect(popup.getByRole("button", { name: "翻译" })).toBeVisible();

  const rangeResponsePromise = page.waitForResponse((response) => {
    const request = response.request();
    return /\/data\/dictionary\/[a-z](?:\.[a-f0-9]{16})?\.json(?:\?.*)?$/.test(response.url())
      && Boolean(request.headers().range);
  });
  await popup.getByRole("button", { name: "翻译" }).click();
  const rangeResponse = await rangeResponsePromise;
  expect(rangeResponse.status()).toBe(206);
  await expect(popup).toContainText("ECDICT · 本地");
  await expect(popup).toContainText("已加入划词集");

  await popup.getByRole("button", { name: "关闭划词查询" }).click();
  await selectText(sentence, "elucidator");
  popup = page.getByRole("dialog", { name: "划词查询：elucidator" });
  await expect(popup).toContainText("已加入划词集");
  await expect(popup.locator(".selection-lookup-query small"))
    .toHaveText(/^\/.+\/$/);
  await expect(popup.getByRole("button", { name: "翻译" })).toHaveCount(0);
});

test("服务器忽略 Range 返回 200 时直接使用完整词典分片", async ({ context, page }) => {
  await page.route("**/data/dictionary/e*.json*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: E_DICTIONARY_SHARD,
    });
  });

  const popup = await openElucidatorLookup(context, page);
  await expect(popup).toContainText("ECDICT · 本地");
  await expect(popup).toContainText("已加入划词集");
});

test("Range 片段损坏时浏览器回退完整词典分片", async ({ context, page }) => {
  await page.route("**/data/dictionary/e*.json*", async (route) => {
    const requestedRange = route.request().headers().range;
    if (requestedRange) {
      const match = requestedRange.match(/bytes=(\d+)-(\d+)/);
      const requestedBytes = Number(match?.[2]) - Number(match?.[1]) + 1;
      await route.fulfill({
        status: 206,
        contentType: "application/json",
        headers: {
          "Content-Range": `bytes ${match?.[1] ?? 0}-${match?.[2] ?? 0}/${Buffer.byteLength(E_DICTIONARY_SHARD)}`,
        },
        body: '"elucidator":['.padEnd(requestedBytes, " "),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: E_DICTIONARY_SHARD,
    });
  });

  const popup = await openElucidatorLookup(context, page);
  await expect(popup).toContainText("ECDICT · 本地");
  await expect(popup).toContainText("已加入划词集");
});

test("Range 网络中断时浏览器回退完整词典分片", async ({ context, page }) => {
  let interrupted = false;
  await page.route("**/data/dictionary/e*.json*", async (route) => {
    if (route.request().headers().range && !interrupted) {
      interrupted = true;
      await route.abort("connectionreset");
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: E_DICTIONARY_SHARD,
    });
  });

  const popup = await openElucidatorLookup(context, page);
  await expect(popup).toContainText("ECDICT · 本地");
  await expect(popup).toContainText("已加入划词集");
});

test("触屏划词可打开弹窗，Escape 关闭后恢复原焦点", async ({ context, page }) => {
  await installStateSeed(context, createState({
    enrichments: RADIATE_ENRICHMENT,
  }));
  await openApp(page);
  const wordFace = page.getByRole("button", { name: "显示单词释义" });
  await wordFace.click();
  await wordFace.focus();
  const sentence = page.getByText("Stars radiate energy into space.", {
    exact: true,
  });
  await selectTextWithTouch(sentence, "radiate");

  const popup = page.getByRole("dialog", { name: "划词查询：radiate" });
  await expect(popup).toHaveAttribute("aria-modal", "true");
  await expect(popup.getByRole("button", { name: "关闭划词查询" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(popup).toHaveCount(0);
  await expect(wordFace).toBeFocused();
});

test("浏览器阻止录音播放时分类为 autoplay-blocked 并回退 TTS", async ({ context, page }) => {
  await context.addInitScript(() => {
    globalThis.__wordloopTtsCalls = [];
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value() {
        return Promise.reject(new DOMException("blocked", "NotAllowedError"));
      },
    });
    const originalSpeak = globalThis.speechSynthesis.speak.bind(
      globalThis.speechSynthesis,
    );
    globalThis.__wordloopOriginalSpeak = originalSpeak;
    globalThis.speechSynthesis.speak = (utterance) => {
      globalThis.__wordloopTtsCalls.push(utterance.text);
      queueMicrotask(() => utterance.onstart?.(new Event("start")));
    };
  });
  await installStateSeed(context, createState());
  await openApp(page);
  const sound = page.getByRole("button", { name: /播放 radiate 的发音/ });
  await expect(sound).toHaveAttribute("title", "2027 红宝书原声");
  await sound.click();

  await expect.poll(() => page.evaluate(
    () => globalThis.__wordloopTtsCalls.length,
  )).toBe(1);
  await expect.poll(() => page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem("wordloop-performance-v1") ?? "{}");
    return store.samples?.some((sample) =>
      sample.metric === "audio.play.invoke"
      && sample.tags?.fallbackReason === "autoplay-blocked");
  })).toBe(true);
});

test("反馈不符例句后只二审并重写目标义项", async ({ context, page }) => {
  const aiEnrichment = structuredClone(RADIATE_ENRICHMENT);
  aiEnrichment[1].source = "ai";
  aiEnrichment[1].verified = false;
  aiEnrichment[1].senseExamples[0].confidence = 0.8;
  await page.route("**/api/enrich/review", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      matches: false,
      confidence: 0.96,
      note: "义项不匹配",
    }),
  }));
  await page.route("**/api/enrich", async (route) => {
    if (route.request().url().endsWith("/review")) return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        sentence: "The warm lamp radiated a soft glow.",
        translation: "温暖的灯散发出柔和的光。",
        senseExamples: [{
          meaning: "散发",
          sentence: "The warm lamp radiated a soft glow.",
          translation: "温暖的灯散发出柔和的光。",
          confidence: 0.95,
        }],
        targetMeanings: ["散发"],
        collocations: ["radiate a glow"],
        source: "ai",
        verified: false,
      }),
    });
  });
  await installStateSeed(context, createState({ enrichments: aiEnrichment }));
  await openApp(page);
  await page.getByRole("button", { name: "显示单词释义" }).click();
  const firstExample = page.locator(".sense-example").first();
  await firstExample.getByRole("button", { name: "例句与义项不符" }).click();
  await expect(firstExample).toContainText("二审未通过：义项不匹配");
  await firstExample.getByRole("button", { name: "只重写此条" }).click();
  await expect(firstExample).toContainText("The warm lamp radiated a soft glow.");
  await expect(page.locator(".sense-example")).toHaveCount(4);
  await expect.poll(async () => {
    const stored = await readStoreRecord(page, "enrichments", 1);
    return stored?.senseExamples?.[0]?.sentence;
  }).toBe("The warm lamp radiated a soft glow.");
});

test("快速 A→B 划词时旧请求晚返回也不会覆盖新弹窗", async ({ context, page }) => {
  await page.route("**/api/lookup", async (route) => {
    const body = route.request().postDataJSON();
    if (body.text === "careful elucidator") {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        query: body.text,
        kind: "phrase",
        phonetic: "",
        part: "短语",
        meaning: body.text === "old diagram" ? "旧图表" : "细致的阐释者",
        note: "测试语境",
        source: "ai",
      }),
    }).catch(() => undefined);
  });
  await installStateSeed(context, createState({ enrichments: RADIATE_ENRICHMENT }));
  await openApp(page);
  await page.getByRole("button", { name: "显示单词释义" }).click();
  const sentence = getElucidatorSentence(page);

  await selectText(sentence, "careful elucidator");
  await page.getByRole("dialog", { name: "划词查询：careful elucidator" })
    .getByRole("button", { name: "翻译" }).click();
  await selectText(sentence, "old diagram");
  const latestPopup = page.getByRole("dialog", { name: "划词查询：old diagram" });
  await latestPopup.getByRole("button", { name: "翻译" }).click();
  await expect(latestPopup).toContainText("旧图表");
  await page.waitForTimeout(650);
  await expect(latestPopup).toContainText("旧图表");
  await expect(page.getByRole("dialog", {
    name: "划词查询：careful elucidator",
  })).toHaveCount(0);
});

test("关闭划词弹窗后旧请求返回不会重新打开或写入结果", async ({ context, page }) => {
  await page.route("**/api/lookup", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        query: "careful elucidator",
        kind: "phrase",
        phonetic: "",
        part: "短语",
        meaning: "细致的阐释者",
        note: "测试语境",
        source: "ai",
      }),
    }).catch(() => undefined);
  });
  await installStateSeed(context, createState({ enrichments: RADIATE_ENRICHMENT }));
  await openApp(page);
  await page.getByRole("button", { name: "显示单词释义" }).click();
  const sentence = getElucidatorSentence(page);
  await selectText(sentence, "careful elucidator");
  const popup = page.getByRole("dialog", {
    name: "划词查询：careful elucidator",
  });
  await popup.getByRole("button", { name: "翻译" }).click();
  await popup.getByRole("button", { name: "关闭划词查询" }).click();
  await expect(popup).toHaveCount(0);
  await page.waitForTimeout(550);
  await expect(popup).toHaveCount(0);
});
