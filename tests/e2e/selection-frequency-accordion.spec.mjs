import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { createState } from "./fixtures.mjs";
import {
  installStateSeed,
  openApp,
  selectText,
} from "./helpers.mjs";

const ALPHA_SENSES = [
  "名词义一",
  "名词义二",
  "名词义三",
  "名词义四",
  "动词义一",
  "动词义二",
  "动词义三",
  "动词义四",
];

const BETA_SENSES = [
  "形容义一",
  "形容义二",
  "形容义三",
  "形容义四",
  "副词义一",
  "副词义二",
  "副词义三",
  "副词义四",
];

const SYNTHETIC_REDBOOK = {
  metadata: {
    title: "合成红宝书",
    total: 2,
    sectionCounts: { 必考词: 2, 基础词: 0, 超纲词: 0 },
  },
  words: [
    {
      id: 1,
      word: "alpha",
      phonetic: "/ˈælfə/",
      meaning: "n. 名词义一;名词义二;名词义三;名词义四 v. 动词义一;动词义二;动词义三;动词义四",
      sentence: "Contexttoken appears near Alpha and beta.",
      translation: "合成词出现在 Alpha 和 beta 附近。",
      section: "必考词",
      unit: 1,
    },
    {
      id: 2,
      word: "beta",
      phonetic: "/ˈbeɪtə/",
      meaning: "adj. 形容义一;形容义二;形容义三;形容义四 adv. 副词义一;副词义二;副词义三;副词义四",
      sentence: "Beta follows alpha in this synthetic sentence.",
      translation: "Beta 在这个合成句子里跟在 alpha 后面。",
      section: "必考词",
      unit: 1,
    },
  ],
};

function fnv1a32(value, seed = 0x811c9dc5) {
  let hash = seed | 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function buildFrequencyFixture(highSenseIndexes = { a: 4, b: 4 }) {
  const words = [
    { prefix: "a", wordId: 1, senses: ALPHA_SENSES },
    { prefix: "b", wordId: 2, senses: BETA_SENSES },
  ];
  const shards = Object.fromEntries(words.map(({ prefix, wordId, senses }) => {
    const records = senses.map((meaning, senseIndex) => ({
      wordId,
      senseIndex,
      senseKey: `${wordId}:${senseIndex}:${fnv1a32(meaning).toString(36)}`,
      level: senseIndex === highSenseIndexes[prefix] ? "high" : "low",
      basis: "model_consensus",
      confidence: 0.8,
      paperCount: 0,
      occurrenceCount: 0,
      years: [],
      paperTypes: [],
      evidence: [],
      methodVersion: "sense-frequency-method-v1",
      modelId: "synthetic-test-model",
      humanReviewed: false,
      reasonCodes: ["model_consensus"],
      note: "受控合成测试数据",
    }));
    const body = `${JSON.stringify({
      schemaVersion: 1,
      prefix,
      entries: [{ wordId, records }],
    })}\n`;
    const hash = sha256(body);
    return [prefix, {
      body,
      hash,
      filename: `${prefix}.${hash.slice(0, 16)}.json`,
    }];
  }));
  const core = {
    dataset: "sense-frequency",
    schemaVersion: 1,
    promptVersion: "sense-frequency-prompt-v1",
    methodVersion: "sense-frequency-method-v1",
    modelId: "synthetic-test-model",
    provider: "synthetic",
    inputDataHash: "synthetic-input-hash",
    corpusVersion: "synthetic-corpus-v1",
    generatedAt: "2026-08-21T00:00:00.000Z",
    source: "ai_offline",
    counts: {
      processedWordCount: words.length,
      processedSenseCount: ALPHA_SENSES.length + BETA_SENSES.length,
    },
    releases: Object.fromEntries(
      Object.entries(shards).map(([prefix, shard]) => [prefix, shard.filename]),
    ),
    shardHashes: Object.fromEntries(
      Object.entries(shards).map(([prefix, shard]) => [prefix, shard.hash]),
    ),
    shardBytes: Object.fromEntries(
      Object.entries(shards).map(([prefix, shard]) => [
        prefix,
        Buffer.byteLength(shard.body, "utf8"),
      ]),
    ),
  };
  return {
    shards,
    manifestBody: JSON.stringify({
      ...core,
      contentVersion: sha256(JSON.stringify(core)).slice(0, 16),
    }),
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function installSyntheticNetwork(page, {
  failFrequency = false,
  gatedPrefixes = ["a"],
  highSenseIndexes,
  lookupResponse,
} = {}) {
  const fixture = buildFrequencyFixture(highSenseIndexes);
  const gates = Object.fromEntries(["a", "b"].map((prefix) => [prefix, {
    delivered: deferred(),
    release: deferred(),
    requested: deferred(),
  }]));
  const frequencyFailed = deferred();

  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      !["127.0.0.1", "localhost"].includes(url.hostname)
    ) {
      await route.abort();
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      if (url.pathname === "/api/lookup" && lookupResponse) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(lookupResponse),
        });
      } else {
        await route.abort();
      }
      return;
    }
    if (url.pathname === "/data/redbook.json") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(SYNTHETIC_REDBOOK),
      });
      return;
    }
    if (url.pathname === "/data/redbook-analysis.json") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          metadata: { auditedEntries: 6550, learningItemCount: 2 },
          entries: { 1: {}, 2: {} },
        }),
      });
      return;
    }
    if (url.pathname === "/data/sense-frequency/manifest.json") {
      if (failFrequency) {
        await route.abort();
        frequencyFailed.resolve();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: fixture.manifestBody,
      });
      return;
    }
    for (const [prefix, shard] of Object.entries(fixture.shards)) {
      if (url.pathname === `/data/sense-frequency/${shard.filename}`) {
        gates[prefix].requested.resolve();
        if (gatedPrefixes.includes(prefix)) await gates[prefix].release.promise;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: shard.body,
        });
        gates[prefix].delivered.resolve();
        return;
      }
    }
    if (lookupResponse && url.pathname.startsWith("/data/dictionary/")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{}",
      });
      return;
    }
    if (
      url.pathname.startsWith("/data/sense-examples/")
      || url.pathname.startsWith("/data/etymology/")
    ) {
      await route.abort();
      return;
    }
    await route.continue();
  });

  return {
    releaseShard: (prefix = "a") => gates[prefix].release.resolve(),
    waitForDelivered: (prefix = "a") => gates[prefix].delivered.promise,
    waitForFrequencyFailure: () => frequencyFailed.promise,
    waitForShard: (prefix = "a") => gates[prefix].requested.promise,
  };
}

function accordionButtons(popup) {
  return {
    noun: popup.getByRole("button", { name: /^n\./ }),
    verb: popup.getByRole("button", { name: /^v\./ }),
  };
}

async function openAlphaPopup(context, page) {
  await installStateSeed(context, createState());
  await openApp(page);
  await page.getByRole("button", { name: "显示单词释义" }).click();
  const sentence = page.getByText(
    "Contexttoken appears near Alpha and beta.",
    { exact: true },
  );
  await selectText(sentence, "Alpha");
  return {
    popup: page.getByRole("dialog", { name: "划词查询：Alpha" }),
    sentence,
  };
}

async function waitForTwoFrames(page) {
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

test("异步高频到达前未操作时，默认展开从首词性更新为高频词性", async ({
  context,
  page,
}) => {
  const network = await installSyntheticNetwork(page);
  const { popup } = await openAlphaPopup(context, page);
  const { noun, verb } = accordionButtons(popup);
  await network.waitForShard();
  await expect(noun).toHaveAttribute("aria-expanded", "true");
  await expect(verb).toHaveAttribute("aria-expanded", "false");

  network.releaseShard();
  await expect(verb).toHaveAttribute("aria-expanded", "true");
  await expect(noun).toHaveAttribute("aria-expanded", "false");
});

test("异步到达前手动切换后锁定本查询展开状态", async ({ context, page }) => {
  const network = await installSyntheticNetwork(page);
  const { popup } = await openAlphaPopup(context, page);
  const { noun, verb } = accordionButtons(popup);
  await network.waitForShard();
  await expect(noun).toHaveAttribute("aria-expanded", "true");
  await verb.click();
  await expect(verb).toHaveAttribute("aria-expanded", "true");

  network.releaseShard();
  await expect(popup.getByText("★ 高频常考", { exact: true })).toBeVisible();
  await expect(noun).toHaveAttribute("aria-expanded", "true");
  await expect(verb).toHaveAttribute("aria-expanded", "true");
});

test("可信 contextPart 始终优先于异步高频词性", async ({ context, page }) => {
  const network = await installSyntheticNetwork(page, {
    highSenseIndexes: { a: 0, b: 4 },
    lookupResponse: {
      linkedWordId: 1,
      query: "Contexttoken",
      kind: "word",
      phonetic: "",
      part: "v.",
      contextPart: "v.",
      meaning: SYNTHETIC_REDBOOK.words[0].meaning,
      note: "合成语境词性",
      source: "ai",
    },
  });
  await installStateSeed(context, createState());
  await openApp(page);
  await page.getByRole("button", { name: "显示单词释义" }).click();
  await selectText(
    page.getByText("Contexttoken appears near Alpha and beta.", { exact: true }),
    "Contexttoken",
  );
  const popup = page.getByRole("dialog", { name: "划词查询：Contexttoken" });
  await popup.getByRole("button", { name: "翻译" }).click();
  const { noun, verb } = accordionButtons(popup);
  await network.waitForShard();
  await expect(verb).toHaveAttribute("aria-expanded", "true");
  await expect(noun).toHaveAttribute("aria-expanded", "false");

  network.releaseShard();
  await network.waitForDelivered();
  await waitForTwoFrames(page);
  await expect(verb).toHaveAttribute("aria-expanded", "true");
  await expect(noun).toHaveAttribute("aria-expanded", "false");
  await noun.click();
  await expect(popup.getByText("★ 高频常考", { exact: true })).toBeVisible();
});

test("快速 A→B 且 A 旧 shard 晚返回时，B 的异步默认和用户状态不受影响", async ({
  context,
  page,
}) => {
  const network = await installSyntheticNetwork(page, {
    gatedPrefixes: ["a", "b"],
  });
  const { popup: alphaPopup, sentence } = await openAlphaPopup(context, page);
  await network.waitForShard("a");
  await expect(alphaPopup).toBeVisible();
  await alphaPopup.getByRole("button", { name: /^v\./ }).click();

  await selectText(sentence, "beta");
  const betaPopup = page.getByRole("dialog", { name: "划词查询：beta" });
  const adjective = betaPopup.getByRole("button", { name: /^adj\./ });
  const adverb = betaPopup.getByRole("button", { name: /^adv\./ });
  await network.waitForShard("b");
  await expect(adjective).toHaveAttribute("aria-expanded", "true");
  network.releaseShard("b");
  await expect(adverb).toHaveAttribute("aria-expanded", "true");
  await expect(adjective).toHaveAttribute("aria-expanded", "false");

  await adjective.click();
  await expect(adjective).toHaveAttribute("aria-expanded", "true");
  network.releaseShard("a");
  await network.waitForDelivered("a");
  await waitForTwoFrames(page);
  await expect(alphaPopup).toHaveCount(0);
  await expect(adjective).toHaveAttribute("aria-expanded", "true");
  await expect(adverb).toHaveAttribute("aria-expanded", "true");
});

test("本地考频加载失败时保持首词性默认且不抖动", async ({ context, page }) => {
  const network = await installSyntheticNetwork(page, { failFrequency: true });
  const { popup } = await openAlphaPopup(context, page);
  const { noun, verb } = accordionButtons(popup);
  await network.waitForFrequencyFailure();
  await expect(noun).toHaveAttribute("aria-expanded", "true");
  await expect(verb).toHaveAttribute("aria-expanded", "false");
  await waitForTwoFrames(page);
  await expect(noun).toHaveAttribute("aria-expanded", "true");
  await expect(verb).toHaveAttribute("aria-expanded", "false");
  await expect(popup.locator(".sense-frequency-highlight")).toHaveCount(0);
});
