import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { createState } from "./fixtures.mjs";
import {
  blockPrivateDatasets,
  installStateSeed,
  openApp,
  readStoreRecord,
  waitForApp,
} from "./helpers.mjs";

// ---- 与 lib/sense-datasets.ts 同实现的 FNV-1a 32 位（仅测试夹具使用） ----
function fnv1a32(value, seed = 0x811c9dc5) {
  let hash = seed | 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

function senseKey(wordId, senseIndex, text) {
  return `${wordId}:${senseIndex}:${fnv1a32(text).toString(36)}`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  return JSON.stringify(value);
}

function savingSession(id) {
  return {
    id,
    kind: "search",
    title: "私有数据集验证",
    wordIds: [59],
    index: 0,
    createdAt: "2026-08-14T08:00:00.000Z",
  };
}

const SAVING_SENSES = ["存款", "节省下来的钱 (或物)"];

// 与 lib/sense-datasets.ts buildWordDatasetInputKey 同构的输入身份
const EXAMPLE_INPUT_KEY = (wordId) => stableJson({
  dataset: "sense-examples",
  schemaVersion: 1,
  promptVersion: "sense-examples-prompt-v1",
  wordId,
  senses: SAVING_SENSES,
});

// 与 lib/sense-datasets.ts buildEtymologyDatasetInputKey 同构的输入身份
// relation 键序与 redbook-analysis.json 中词条 59 完全一致
const ETYMOLOGY_INPUT_KEY = (wordId) => stableJson({
  dataset: "etymology",
  schemaVersion: 1,
  promptVersion: "etymology-prompt-v1",
  wordId,
  word: "saving",
  meaning: "n. 存款;节省下来的钱 (或物)",
  root: "",
  relation: {
    kind: "derived",
    label: "save → saving · 派生词",
    note: "红宝书以独立 n. 词条收录，关联词族但不合并掌握度。",
    lemmaId: 58,
    lemma: "save",
    canonicalId: 59,
    independent: true,
    confidence: "confirmed",
  },
});

const FREQUENCY_RECORDS = (wordId) => [
  {
    wordId,
    senseIndex: 0,
    senseKey: senseKey(wordId, 0, SAVING_SENSES[0]),
    level: "high",
    basis: "corpus_supported",
    confidence: 0.8,
    paperCount: 9,
    occurrenceCount: 11,
    years: [2012],
    paperTypes: ["english-one"],
    evidence: [{
      paperId: "2012-english-one",
      year: 2012,
      paperType: "english-one",
      section: "reading",
      contextHash: "abc123def4567890",
    }],
    methodVersion: "sense-frequency-method-v1",
    modelId: "deepseek-v4-flash",
    humanReviewed: false,
    reasonCodes: ["corpus_supported"],
    note: "本地真题语料支持",
  },
  {
    wordId,
    senseIndex: 1,
    senseKey: senseKey(wordId, 1, SAVING_SENSES[1]),
    level: "medium",
    basis: "model_consensus",
    confidence: 0.8,
    paperCount: 0,
    occurrenceCount: 0,
    years: [],
    paperTypes: [],
    evidence: [],
    methodVersion: "sense-frequency-method-v1",
    modelId: "deepseek-v4-flash",
    humanReviewed: false,
    reasonCodes: ["model_consensus"],
    note: "AI 多轮推断",
  },
];

const EXAMPLE_RECORDS = (wordId, { sense1Review = "model_passed" } = {}) => [
  {
    wordId,
    senseIndex: 0,
    senseKey: senseKey(wordId, 0, SAVING_SENSES[0]),
    sentence: "Regular saving of a small part of each paycheck builds a reliable financial buffer.",
    translation: "每月把工资的一小部分存起来，就能建立起可靠的财务缓冲。",
    source: "ai_original",
    generationConfidence: 0.85,
    reviewStatus: sense1Review,
    reviewConfidence: sense1Review === "model_passed" ? 0.9 : null,
    reasonCodes: sense1Review === "model_passed"
      ? []
      : ["needs_human_review"],
    inputKey: EXAMPLE_INPUT_KEY(wordId),
    promptVersion: "sense-examples-prompt-v1",
    modelId: "deepseek-v4-flash",
    humanReviewed: false,
    generatedAt: "2026-08-14T00:00:00.000Z",
  },
  {
    wordId,
    senseIndex: 1,
    senseKey: senseKey(wordId, 1, SAVING_SENSES[1]),
    sentence: "The careful use of energy brings a considerable saving in household costs.",
    translation: "节约使用能源能大幅节省家庭开支。",
    source: "ai_original",
    generationConfidence: 0.8,
    reviewStatus: "model_passed",
    reviewConfidence: 0.9,
    reasonCodes: [],
    inputKey: EXAMPLE_INPUT_KEY(wordId),
    promptVersion: "sense-examples-prompt-v1",
    modelId: "deepseek-v4-flash",
    humanReviewed: false,
    generatedAt: "2026-08-14T00:00:00.000Z",
  },
];

const ETYMOLOGY_RECORD = (wordId) => ({
  wordId,
  inputKey: ETYMOLOGY_INPUT_KEY(wordId),
  mode: "surface_form",
  breakdown: "sav(e) + -ing：sav- 与 save（保存、节省）同形，-ing 构成名词。",
  root: "sav",
  affixes: [
    { form: "sav", kind: "root", meaning: "保存、节省" },
    { form: "-ing", kind: "suffix", meaning: "构成名词" },
  ],
  mnemonic: "AI 联想：把省下来的钱存起来，就是 saving。",
  reasonCodes: [],
  promptVersion: "etymology-prompt-v1",
  modelId: "deepseek-v4-flash",
  humanReviewed: false,
  generatedAt: "2026-08-14T00:00:00.000Z",
});

function buildDatasetFixture({ entries }) {
  const prefix = "s";
  const schemaVersion = 1;
  const content = `${stableJson({ schemaVersion, prefix, entries })}\n`;
  const hash = sha256(content);
  const filename = `${prefix}.${hash.slice(0, 16)}.json`;
  return {
    filename,
    hash,
    bytes: Buffer.byteLength(content, "utf8"),
    body: content,
  };
}

async function routeFrequencyDataset(page, { wordId = 59 } = {}) {
  const shard = buildDatasetFixture({
    dataset: "sense-frequency",
    entries: [{ wordId, records: FREQUENCY_RECORDS(wordId) }],
  });
  const core = {
    dataset: "sense-frequency",
    schemaVersion: 1,
    promptVersion: "sense-frequency-prompt-v1",
    methodVersion: "sense-frequency-method-v1",
    modelId: "deepseek-v4-flash",
    provider: "opencode-go",
    inputDataHash: "test-input-hash",
    corpusVersion: "46-papers-1998-2026",
    generatedAt: "2026-08-14T00:00:00.000Z",
    source: "ai_offline",
    counts: {
      processedWordCount: 1,
      processedSenseCount: 2,
      labeledSenseCount: 2,
      corpusSupportedCount: 1,
      modelConsensusCount: 1,
      needsReviewCount: 0,
      levelCounts: { high: 1, medium: 1, low: 0 },
      forcedGuessCount: 0,
      truncationCount: 0,
    },
    releases: { s: shard.filename },
    shardHashes: { s: shard.hash },
    shardBytes: { s: shard.bytes },
  };
  const manifest = { ...core, contentVersion: sha256(stableJson(core)).slice(0, 16) };
  await page.route("**/data/sense-frequency/manifest.json", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: stableJson(manifest) }));
  await page.route(`**/data/sense-frequency/${shard.filename}`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: shard.body }));
  return { manifest, shard };
}

async function routeExamplesDataset(page, { wordId = 59, sense1Review } = {}) {
  const shard = buildDatasetFixture({
    dataset: "sense-examples",
    entries: [{ wordId, records: EXAMPLE_RECORDS(wordId, { sense1Review }) }],
  });
  const core = {
    dataset: "sense-examples",
    schemaVersion: 1,
    promptVersion: "sense-examples-prompt-v1",
    methodVersion: "sense-examples-method-v1",
    modelId: "deepseek-v4-flash",
    provider: "opencode-go",
    inputDataHash: "test-input-hash",
    generatedAt: "2026-08-14T00:00:00.000Z",
    source: "ai_offline",
    counts: {
      processedSenseCount: 2,
      acceptedExampleCount: 2,
      needsReviewCount: 0,
      exactDuplicateCount: 0,
      nearDuplicateCount: 0,
    },
    releases: { s: shard.filename },
    shardHashes: { s: shard.hash },
    shardBytes: { s: shard.bytes },
  };
  const manifest = { ...core, contentVersion: sha256(stableJson(core)).slice(0, 16) };
  await page.route("**/data/sense-examples/manifest.json", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: stableJson(manifest) }));
  await page.route(`**/data/sense-examples/${shard.filename}`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: shard.body }));
  return { manifest, shard };
}

async function routeEtymologyDataset(page, { wordId = 59 } = {}) {
  const shard = buildDatasetFixture({
    dataset: "etymology",
    entries: [{ wordId, record: ETYMOLOGY_RECORD(wordId) }],
  });
  const core = {
    dataset: "etymology",
    schemaVersion: 1,
    promptVersion: "etymology-prompt-v1",
    methodVersion: "etymology-method-v1",
    modelId: "deepseek-v4-flash",
    provider: "opencode-go",
    inputDataHash: "test-input-hash",
    generatedAt: "2026-08-14T00:00:00.000Z",
    source: "ai_offline",
    counts: {
      processedWordCount: 1,
      modeCounts: { verified_morphology: 0, surface_form: 1, mnemonic_only: 0, needs_review: 0 },
      templateFlaggedCount: 0,
    },
    releases: { s: shard.filename },
    shardHashes: { s: shard.hash },
    shardBytes: { s: shard.bytes },
  };
  const manifest = { ...core, contentVersion: sha256(stableJson(core)).slice(0, 16) };
  await page.route("**/data/etymology/manifest.json", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: stableJson(manifest) }));
  await page.route(`**/data/etymology/${shard.filename}`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: shard.body }));
  return { manifest, shard };
}

async function revealWord(page) {
  await page.getByRole("button", { name: "显示单词释义" }).click();
  await expect(page.getByRole("heading", { name: "AI 词根拆解与助记" }).or(
    page.getByRole("button", { name: /生成 AI 词根拆解与助记/ }),
  )).toBeVisible();
}

test("三套预生成数据同时存在：直接命中、不调用生成 API、刷新仍命中、UI 如实标注", async ({ context, page }) => {
  let apiCalls = 0;
  for (const endpoint of ["**/api/sense-frequency", "**/api/enrich", "**/api/etymology"]) {
    await page.route(endpoint, (route) => {
      apiCalls += 1;
      return route.fulfill({ status: 503, body: "{}" });
    });
  }
  await routeFrequencyDataset(page);
  await routeExamplesDataset(page);
  await routeEtymologyDataset(page);
  await installStateSeed(context, createState({
    activeSession: savingSession("datasets-all"),
  }));
  await openApp(page);
  await revealWord(page);
  expect(apiCalls).toBe(0);

  // 义项考频：数据集标签直接展示，不出现“生成义项考频提示”按钮
  await expect(page.getByText("★ 高频常考").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /生成义项考频提示/ })).toHaveCount(0);
  // 释义例句：AI 原创 · 模型二审 · 未人工核验
  await expect(page.getByText("Regular saving of a small part of each paycheck builds a reliable financial buffer.", { exact: true }))
    .toBeVisible();
  await expect(page.getByText("AI 原创 · 模型二审 · 未人工核验").first()).toBeVisible();
  // 词根助记：基础数据命中，标注现代词形拆解与未人工核验，保留免责声明
  await expect(page.getByRole("heading", { name: "AI 词根拆解与助记" })).toBeVisible();
  await expect(page.getByText("现代词形拆解 · 未人工核验", { exact: true })).toBeVisible();
  await expect(page.getByText("AI 助记仅用于记忆联想，不是权威词源考据。", { exact: true })).toBeVisible();

  // 刷新后仍然命中，且不触发生成 API
  await page.reload();
  await waitForApp(page);
  await revealWord(page);
  await expect(page.getByText("★ 高频常考").first()).toBeVisible();
  expect(apiCalls).toBe(0);
});

test("任一套数据集缺失：只回退该套按钮，其余数据集仍命中", async ({ context, page }) => {
  // 屏蔽本机真实义项考频数据，模拟该套缺失
  await blockPrivateDatasets(page, { datasets: ["sense-frequency"] });
  await routeExamplesDataset(page);
  await routeEtymologyDataset(page);
  await installStateSeed(context, createState({
    activeSession: savingSession("datasets-missing-frequency"),
  }));
  await openApp(page);
  await revealWord(page);

  // 释义例句与词根助记命中
  await expect(page.getByText("AI 原创 · 模型二审 · 未人工核验").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "AI 词根拆解与助记" })).toBeVisible();
  // 义项考频缺失 → 原有生成按钮出现
  await expect(page.getByRole("button", { name: /生成义项考频提示/ })).toBeVisible();
});

test("shard 损坏：不显示错误内容，安全降级为生成入口", async ({ context, page }) => {
  const { shard } = await routeExamplesDataset(page);
  // 把 shard 响应替换为损坏字节：哈希校验失败 → 数据不可用
  await page.unroute(`**/data/sense-examples/${shard.filename}`);
  await page.route(`**/data/sense-examples/${shard.filename}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{\"schemaVersion\":1,\"prefix\":\"s\",\"entries\":[]} corrupted",
    }));
  await routeEtymologyDataset(page);
  await installStateSeed(context, createState({
    activeSession: savingSession("datasets-corrupt-shard"),
  }));
  await openApp(page);
  await revealWord(page);

  // 损坏例句数据不显示，也不显示错误内容
  await expect(page.getByText("Regular saving of a small part of each paycheck builds a reliable financial buffer.", { exact: true }))
    .toHaveCount(0);
  // 词根助记仍正常（其他数据集不受影响）
  await expect(page.getByRole("heading", { name: "AI 词根拆解与助记" })).toBeVisible();
});

test("个人缓存优先：有效个人例句压过基础例句，其余基础例句保留且个人缓存不被覆盖", async ({ context, page }) => {
  await routeExamplesDataset(page);
  await installStateSeed(context, createState({
    activeSession: savingSession("datasets-personal-priority"),
    enrichments: {
      59: {
        source: "ai",
        senseExamples: [{
          meaning: "存款",
          sentence: "My personal sentence about saving money every month.",
          translation: "我个人写的关于每月存钱的句子。",
          confidence: 0.9,
          review: { status: "passed", confidence: 0.95, reviewedAt: "2026-08-14T00:00:00.000Z" },
        }],
      },
    },
  }));
  await openApp(page);
  await revealWord(page);

  // 义项 0 显示个人例句，义项 1 显示基础例句
  await expect(page.getByText("My personal sentence about saving money every month.", { exact: true }))
    .toBeVisible();
  await expect(page.getByText("The careful use of energy brings a considerable saving in household costs.", { exact: true }))
    .toBeVisible();
  // 个人缓存不被基础数据覆盖
  const stored = await readStoreRecord(page, "enrichments", 59);
  expect(stored?.senseExamples?.[0]?.sentence)
    .toBe("My personal sentence about saving money every month.");
});

test("待人工复核的基础例句不进入强化语境", async ({ context, page }) => {
  await routeExamplesDataset(page, { sense1Review: "needs_review" });
  await installStateSeed(context, createState({
    activeSession: savingSession("datasets-needs-review"),
  }));
  await openApp(page);
  await revealWord(page);

  // 待复核例句如实标注后显示
  await expect(page.getByText("AI 原创 · 待人工复核 · 未人工核验").first()).toBeVisible();
  // 评分“忘记”进入强化：填空句必须来自复核通过的例句
  await page.getByRole("button", { name: /忘记/ }).click();
  const reinforcement = page.getByRole("form", { name: /强化/ }).or(
    page.locator(".reinforcement-panel"),
  );
  await expect(reinforcement).toBeVisible();
  await expect(reinforcement).not.toContainText("Regular saving of a small part");
  await expect(reinforcement).toContainText("＿＿＿＿");
});
