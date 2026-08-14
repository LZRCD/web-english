// scripts/build-sense-examples.mjs
// 释义例句离线流水线：每个词的全部义项作为共同语义上下文分块生成原创例句，
// 依次执行确定性质检、第一次语义审查、第二次独立审查、对抗式审查；
// 未通过义项仅重写该义项并完整重检；有限重写后仍失败标记 needs_review。
// 支持 --plan / --run（含 --resume）/ --check / --publish / --limit。
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { verifyInventory } from "./lib/sense-inventory.mjs";
import { loadPaperSentences } from "./lib/corpus-search.mjs";
import {
  buildContentVersion,
  cleanUnreferencedShards,
  sha256,
  shardRecords,
  stableJson,
  verifyShards,
  writeManifestAtomically,
  writeShards,
} from "./lib/dataset-shards.mjs";
import {
  createBatchRunner,
  parseProviderEnv,
  requestChat,
} from "./lib/offline-ai.mjs";
import {
  checkSentenceStructure,
  createDedupeIndex,
  nearDuplicateRatio,
  sentenceContainsWord,
} from "./lib/example-quality.mjs";
import {
  buildSenseKey,
  buildWordDatasetInputKey,
  isValidSenseExampleEntry,
} from "../lib/sense-datasets.ts";

const DATASET = "sense-examples";
const SCHEMA_VERSION = 1;
const PROMPT_VERSION = "sense-examples-prompt-v1";
const METHOD_VERSION = "sense-examples-method-v1";
const MODEL_ID = "deepseek-v4-flash";
const PROVIDER = "opencode-go";
const WORK_DIR = `.wordloop-data/${DATASET}`;
const RESULTS_DIR = `${WORK_DIR}/results`;
const STATE_PATH = `${WORK_DIR}/state.json`;
const RELEASE_DIR = `public/data/${DATASET}`;
const CORPUS_DIR = "scripts/kaoyan-corpus";
const GENERATION_BATCH_SIZE = 8;
const MAX_REWRITES = 2;
const MIN_REVIEW_CONFIDENCE = 0.7;

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = new Set();
  const values = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--limit" || arg === "--concurrency" || arg === "--only") {
      values.set(arg, Number(args[index + 1]));
      index += 1;
    } else {
      flags.add(arg);
    }
  }
  return { flags, values };
}

function parseJsonStrict(text, label) {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const parsed = JSON.parse(cleaned);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail(`${label} 顶层必须是对象`);
  }
  return parsed;
}

// ---------- 提示词 ----------

function generationPrompt(word, senses, targets, existingSentences, extra) {
  return {
    system:
      "你是严谨的考研英语词典编辑。只返回 JSON，不要 Markdown。字段必须是 examples：数组，"
      + "为 targets 中的每个义项各生成 1 句原创考研阅读风格英文例句，元素为 "
      + "{ senseIndex, sentence, translation, confidence }。senseIndex 必须是 targets 中的下标。"
      + "要求：1. 例句必须包含目标单词或其合法屈折形式，且语境唯一、清晰地指向该义项，"
      + "不能同样自然地解释成该词其他义项；2. 英语语法正确、搭配自然、语境完整，"
      + "使用考研阅读常见的正式书面语域，不堆砌冷僻词；3. 翻译准确对应英文和该义项，"
      + "不添加英文中不存在的信息；4. 禁止使用「这个词意味着……」等元语言模板；"
      + "5. 同一单词不同义项的句型、场景、主语、情节不能雷同，也不要与已有例句雷同；"
      + "6. 必须是原创，禁止复制、轻微改写或翻译真题、词典、教材例句；"
      + "7. 不包含虚构的具体学术、医学、法律、历史事实。"
      + "confidence 是 0 到 1 的语义匹配置信度。",
    user: stableJson({
      word,
      senses: senses.map((sense, index) => ({ index, text: sense })),
      targets: targets.map((index) => ({ index, text: senses[index] })),
      existingSentences,
      ...extra,
    }),
  };
}

function reviewPrompt(word, senses, examples) {
  return {
    system:
      "你是英语词典例句质检员。只返回 JSON：reviews 数组，为每个例句返回 "
      + "{ senseIndex, matches, confidence, note }。判定标准："
      + "1. 英文句子是否通过语境线索唯一指向该义项——若句子可同时自然读成该词其他义项，"
      + "判 matches=false；2. 翻译是否与句子和该义项一致，是否添加了英文中不存在的信息；"
      + "3. 句子是否与同词其他义项例句雷同（结构、用词或情节近似）。不要改写例句，"
      + "note 是不超过 40 字的中文说明。",
    user: stableJson({
      word,
      senses: senses.map((sense, index) => ({ index, text: sense })),
      examples: examples.map((example) => ({
        senseIndex: example.senseIndex,
        sentence: example.sentence,
        translation: example.translation,
      })),
    }),
  };
}

function adversarialPrompt(word, senses, examples) {
  return {
    system:
      "你是对抗式例句审查员。只返回 JSON：reviews 数组，为每个例句返回 "
      + "{ senseIndex, ambiguous, ambiguousWith, duplicate, duplicateWith, note }。"
      + "规则：1. 尝试把该例句解释成该词的其他义项，若能自然成立判 ambiguous=true，"
      + "并在 ambiguousWith 列出可成立的义项下标（整数数组）；2. 检查与其他义项例句是否"
      + "仅替换少量词、句型与情节雷同，是则 duplicate=true 并在 duplicateWith 列出下标；"
      + "3. 检查翻译是否偷偷消除了英文的歧义（英文有歧义但翻译只给一个义项）。"
      + "不要改写例句，note 是不超过 40 字的中文说明。",
    user: stableJson({
      word,
      senses: senses.map((sense, index) => ({ index, text: sense })),
      examples: examples.map((example) => ({
        senseIndex: example.senseIndex,
        sentence: example.sentence,
        translation: example.translation,
      })),
    }),
  };
}

// ---------- 模型调用 ----------

async function callJson(provider, { prompt, temperature, maxTokens }, onUsage) {
  const response = await requestChat(provider, {
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
    temperature,
    maxTokens,
    timeoutMs: 120_000,
  });
  onUsage(response.usage);
  if (!response.content) fail("模型没有返回内容");
  return parseJsonStrict(response.content, "模型 JSON");
}

function normalizeExamples(parsed, targetIndexes) {
  const list = Array.isArray(parsed.examples) ? parsed.examples : null;
  if (!list || list.length !== targetIndexes.length) {
    fail(`例句返回数量 ${list?.length} != 目标 ${targetIndexes.length}`);
  }
  return list.map((item, index) => {
    const senseIndex = item?.senseIndex ?? targetIndexes[index];
    const sentence = typeof item?.sentence === "string" ? item.sentence.trim() : "";
    const translation = typeof item?.translation === "string"
      ? item.translation.trim()
      : "";
    const confidence = Number(item?.confidence);
    if (!sentence || !translation) fail(`义项 ${senseIndex} 例句字段缺失`);
    if (!targetIndexes.includes(senseIndex)) fail(`义项 ${senseIndex} 不在目标内`);
    return {
      senseIndex,
      sentence: sentence.slice(0, 500),
      translation: translation.slice(0, 300),
      confidence: Number.isFinite(confidence)
        ? Math.max(0, Math.min(1, confidence))
        : 0,
    };
  });
}

function normalizeReviews(parsed, indexes) {
  const list = Array.isArray(parsed.reviews) ? parsed.reviews : null;
  if (!list || list.length !== indexes.length) {
    fail(`审查返回数量 ${list?.length} != ${indexes.length}`);
  }
  const bySense = new Map();
  for (const item of list) {
    const senseIndex = Number(item?.senseIndex);
    if (!indexes.includes(senseIndex)) fail(`审查包含非目标义项 ${senseIndex}`);
    const confidence = Number(item?.confidence);
    bySense.set(senseIndex, {
      matches: item?.matches === true,
      confidence: Number.isFinite(confidence)
        ? Math.max(0, Math.min(1, confidence))
        : 0,
      note: typeof item?.note === "string" ? item.note.trim().slice(0, 60) : "",
    });
  }
  return bySense;
}

function normalizeAdversarial(parsed, indexes) {
  const list = Array.isArray(parsed.reviews) ? parsed.reviews : null;
  if (!list || list.length !== indexes.length) {
    fail(`对抗审查返回数量 ${list?.length} != ${indexes.length}`);
  }
  const bySense = new Map();
  for (const item of list) {
    const senseIndex = Number(item?.senseIndex);
    if (!indexes.includes(senseIndex)) fail(`对抗审查包含非目标义项 ${senseIndex}`);
    bySense.set(senseIndex, {
      ambiguous: item?.ambiguous === true,
      ambiguousWith: Array.isArray(item?.ambiguousWith)
        ? item.ambiguousWith.filter((value) => Number.isSafeInteger(value))
        : [],
      duplicate: item?.duplicate === true,
      duplicateWith: Array.isArray(item?.duplicateWith)
        ? item.duplicateWith.filter((value) => Number.isSafeInteger(value))
        : [],
      note: typeof item?.note === "string" ? item.note.trim().slice(0, 60) : "",
    });
  }
  return bySense;
}

// ---------- 确定性质检与合并 ----------

function deterministicChecks(word, senses, candidates, dedupe) {
  void senses;
  const problems = new Map();
  for (const candidate of candidates) {
    const reasons = [];
    if (!sentenceContainsWord(candidate.sentence, word)) {
      reasons.push("missing_target_word");
    }
    reasons.push(...checkSentenceStructure(candidate.sentence, candidate.translation));
    // 全库/真题近似重复
    const globalDup = dedupe.findNearDuplicate(candidate.sentence);
    if (globalDup.nearDuplicate) reasons.push("near_duplicate_reference");
    // 同词其他义项近似重复
    for (const other of candidates) {
      if (other.senseIndex === candidate.senseIndex) continue;
      const ratio = nearDuplicateRatio(candidate.sentence, other.sentence);
      if (ratio.nearDuplicate) {
        reasons.push(`sibling_near_dup:${other.senseIndex}`);
      }
    }
    if (reasons.length) problems.set(candidate.senseIndex, reasons);
  }
  return problems;
}

// ---------- 单词语义处理 ----------

async function reviewCandidates(provider, word, senses, indexes, candidatesBySense, usage) {
  const examples = indexes
    .map((index) => candidatesBySense.get(index))
    .filter(Boolean)
    .map((candidate) => ({
      senseIndex: candidate.senseIndex,
      sentence: candidate.sentence,
      translation: candidate.translation,
    }));
  const reviewMessage = reviewPrompt(word, senses, examples);
  const [roundA, roundB, adversarialParsed] = await Promise.all([
    callJson(provider, { prompt: reviewMessage, temperature: 0, maxTokens: 1600 }, usage),
    callJson(provider, { prompt: reviewMessage, temperature: 0, maxTokens: 1600 }, usage),
    callJson(provider, {
      prompt: adversarialPrompt(word, senses, examples),
      temperature: 0,
      maxTokens: 1200,
    }, usage),
  ]);
  return {
    reviewsA: normalizeReviews(roundA, indexes),
    reviewsB: normalizeReviews(roundB, indexes),
    adversarial: normalizeAdversarial(adversarialParsed, indexes),
  };
}

async function generateCandidates(provider, word, senses, targetIndexes, existingSentences, extra, usage) {
  const prompt = generationPrompt(word, senses, targetIndexes, existingSentences, extra);
  const parsed = await callJson(
    provider,
    { prompt, temperature: 0.7, maxTokens: 2800 },
    usage,
  );
  return normalizeExamples(parsed, targetIndexes);
}

async function processWord({ word, senses, provider, usage, dedupe, redbookSentences }) {
  const candidatesBySense = new Map();
  const generationBatchSize = GENERATION_BATCH_SIZE;
  const batches = [];
  for (let start = 0; start < senses.length; start += generationBatchSize) {
    batches.push(
      senses.map((_, index) => index).slice(start, start + generationBatchSize),
    );
  }
  const existingSentences = redbookSentences.get(word.wordId) ?? [];
  for (const batch of batches) {
    const generated = await generateCandidates(
      provider,
      word.word,
      senses,
      batch,
      existingSentences,
      {},
      usage,
    );
    for (const candidate of generated) candidatesBySense.set(candidate.senseIndex, candidate);
  }

  const finalRecords = new Map();
  let pending = [...candidatesBySense.keys()];

  for (let round = 0; round <= MAX_REWRITES && pending.length; round += 1) {
    // 确定性质检（仅检查待定义项）
    const pendingCandidates = pending
      .map((index) => candidatesBySense.get(index))
      .filter(Boolean);
    const detProblems = deterministicChecks(word.word, senses, pendingCandidates, dedupe);

    // 通过确定性质检的进入语义审查
    const reviewable = pending.filter((index) => !detProblems.has(index));
    let reviews = { reviewsA: new Map(), reviewsB: new Map(), adversarial: new Map() };
    if (reviewable.length) {
      reviews = await reviewCandidates(
        provider,
        word.word,
        senses,
        reviewable,
        candidatesBySense,
        usage,
      );
    }

    const nextPending = [];
    for (const index of pending) {
      const candidate = candidatesBySense.get(index);
      const reasons = [...(detProblems.get(index) ?? [])];
      const reviewA = reviews.reviewsA.get(index);
      const reviewB = reviews.reviewsB.get(index);
      const adversarial = reviews.adversarial.get(index);
      if (reviewA && reviewB && adversarial) {
        if (!reviewA.matches) reasons.push("review1_mismatch");
        if (!reviewB.matches) reasons.push("review2_mismatch");
        if (adversarial.ambiguous) {
          reasons.push(`adversarial_ambiguous:${adversarial.ambiguousWith.join(",")}`);
        }
        if (adversarial.duplicate) {
          reasons.push(`adversarial_duplicate:${adversarial.duplicateWith.join(",")}`);
        }
      }
      const confidences = [reviewA?.confidence, reviewB?.confidence]
        .filter((value) => Number.isFinite(value));
      const reviewConfidence = confidences.length
        ? Math.min(...confidences)
        : null;
      const passed = reasons.length === 0
        && reviewA?.matches === true
        && reviewB?.matches === true
        && adversarial?.ambiguous === false
        && adversarial?.duplicate === false
        && reviewConfidence !== null
        && reviewConfidence >= MIN_REVIEW_CONFIDENCE;
      if (passed) {
        dedupe.add(candidate.sentence);
        finalRecords.set(index, {
          wordId: word.wordId,
          senseIndex: index,
          senseKey: buildSenseKey(word.wordId, index, senses[index]),
          sentence: candidate.sentence,
          translation: candidate.translation,
          source: "ai_original",
          generationConfidence: candidate.confidence,
          reviewStatus: "model_passed",
          reviewConfidence: Number(reviewConfidence.toFixed(2)),
          reasonCodes: [],
          inputKey: buildWordDatasetInputKey({
            dataset: DATASET,
            schemaVersion: SCHEMA_VERSION,
            promptVersion: PROMPT_VERSION,
            wordId: word.wordId,
            senses,
          }),
          promptVersion: PROMPT_VERSION,
          modelId: MODEL_ID,
          humanReviewed: false,
          generatedAt: new Date().toISOString(),
        });
      } else {
        nextPending.push(index);
        if (round >= MAX_REWRITES) {
          finalRecords.set(index, {
            wordId: word.wordId,
            senseIndex: index,
            senseKey: buildSenseKey(word.wordId, index, senses[index]),
            sentence: candidate.sentence,
            translation: candidate.translation,
            source: "ai_original",
            generationConfidence: candidate.confidence,
            reviewStatus: "needs_review",
            reviewConfidence: reviewConfidence === null
              ? null
              : Number(reviewConfidence.toFixed(2)),
            reasonCodes: reasons.slice(0, 8),
            inputKey: buildWordDatasetInputKey({
              dataset: DATASET,
              schemaVersion: SCHEMA_VERSION,
              promptVersion: PROMPT_VERSION,
              wordId: word.wordId,
              senses,
            }),
            promptVersion: PROMPT_VERSION,
            modelId: MODEL_ID,
            humanReviewed: false,
            generatedAt: new Date().toISOString(),
          });
        }
      }
    }
    pending = nextPending;
    if (pending.length && round < MAX_REWRITES) {
      // 仅重写失败义项：提供同词已通过例句与失败原因，避免重复
      const acceptedExamples = [...finalRecords.values()].map((record) => ({
        senseIndex: record.senseIndex,
        sentence: record.sentence,
      }));
      const failedReasons = Object.fromEntries(
        pending.map((index) => [index, (detProblems.get(index) ?? []).slice(0, 4)]),
      );
      const rewritten = await generateCandidates(
        provider,
        word.word,
        senses,
        pending,
        existingSentences,
        { acceptedExamples, failedReasons },
        usage,
      );
      for (const candidate of rewritten) {
        if (pending.includes(candidate.senseIndex)) {
          candidatesBySense.set(candidate.senseIndex, candidate);
        }
      }
    }
  }

  return senses.map((_, index) => finalRecords.get(index))
    .filter(Boolean);
}

// ---------- 校验与发布 ----------

function validateAllRecords(inventory, recordsByWordId) {
  const report = {
    expectedWords: inventory.counts.primaryWords,
    expectedSenses: inventory.counts.senseTotal,
    processedSenseCount: 0,
    acceptedExampleCount: 0,
    needsReviewCount: 0,
    missingWords: 0,
    duplicateSenses: 0,
    mismatchedSenseKeys: 0,
    invalidRecords: 0,
    missingTargetWord: 0,
    exactDuplicateCount: 0,
    nearDuplicateCount: 0,
    pseudoHumanReviewed: 0,
    monoAccepted: 0,
    monoNeedsReview: 0,
    over8Accepted: 0,
    over8NeedsReview: 0,
  };
  const normalizedSet = new Set();
  const dedupe = createDedupeIndex();
  for (const word of inventory.words) {
    const records = recordsByWordId[word.wordId];
    if (!records || records.length !== word.senses.length) {
      report.missingWords += 1;
      continue;
    }
    report.processedSenseCount += records.length;
    const seen = new Set();
    for (const record of records) {
      if (seen.has(record.senseIndex)) {
        report.duplicateSenses += 1;
        continue;
      }
      seen.add(record.senseIndex);
      if (!isValidSenseExampleEntry(record)) {
        report.invalidRecords += 1;
        continue;
      }
      if (record.humanReviewed !== false) report.pseudoHumanReviewed += 1;
      const expectedKey = buildSenseKey(
        word.wordId,
        record.senseIndex,
        word.senses[record.senseIndex].text,
      );
      if (record.senseKey !== expectedKey) {
        report.mismatchedSenseKeys += 1;
        continue;
      }
      const normalized = record.sentence
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[^a-z0-9']+/g, " ")
        .trim();
      if (normalizedSet.has(normalized)) {
        report.exactDuplicateCount += 1;
      }
      normalizedSet.add(normalized);
      const near = dedupe.findNearDuplicate(record.sentence);
      if (near.nearDuplicate) report.nearDuplicateCount += 1;
      dedupe.add(record.sentence);
      if (!sentenceContainsWord(record.sentence, word.word)) {
        report.missingTargetWord += 1;
      }
      if (record.reviewStatus === "model_passed") {
        report.acceptedExampleCount += 1;
        if (word.senses.length === 1) report.monoAccepted += 1;
        if (word.senses.length > 8) report.over8Accepted += 1;
      } else {
        report.needsReviewCount += 1;
        if (word.senses.length === 1) report.monoNeedsReview += 1;
        if (word.senses.length > 8) report.over8NeedsReview += 1;
      }
    }
  }
  return report;
}

function shardPrefix(word) {
  const first = String(word).trim().toLowerCase()[0] ?? "";
  return /[a-z]/.test(first) ? first : "0";
}

async function releaseTimestamp() {
  try {
    const state = JSON.parse(await readFile(STATE_PATH, "utf8"));
    const startedAt = state?.stats?.startedAt;
    if (typeof startedAt === "string" && startedAt) return startedAt;
  } catch {
    // 无检查点
  }
  return new Date().toISOString();
}

async function buildRelease({ inventory, recordsByWordId }) {
  const report = validateAllRecords(inventory, recordsByWordId);
  const problems = [];
  if (report.processedSenseCount !== report.expectedSenses) {
    problems.push(`义项处理数 ${report.processedSenseCount} != ${report.expectedSenses}`);
  }
  for (const key of [
    "missingWords", "duplicateSenses", "mismatchedSenseKeys", "invalidRecords",
    "pseudoHumanReviewed",
  ]) {
    if (report[key] !== 0) problems.push(`${key} = ${report[key]}`);
  }
  if (report.acceptedExampleCount + report.needsReviewCount !== report.processedSenseCount) {
    problems.push("通过 + 待复核 != 处理数");
  }
  // 通过例句不得缺失目标词形
  for (const word of inventory.words) {
    for (const record of recordsByWordId[word.wordId] ?? []) {
      if (
        record.reviewStatus === "model_passed"
        && !sentenceContainsWord(record.sentence, word.word)
      ) {
        problems.push(`wordId ${word.wordId} 义项 ${record.senseIndex} 通过但缺失目标词形`);
      }
    }
  }
  if (problems.length) return { ok: false, problems, report };

  const wordById = new Map(inventory.words.map((word) => [word.wordId, word]));
  const wordEntries = inventory.words
    .filter((word) => recordsByWordId[word.wordId])
    .map((word) => ({
      wordId: word.wordId,
      records: recordsByWordId[word.wordId],
    }));
  const { shards } = shardRecords(
    wordEntries,
    (entry) => shardPrefix(wordById.get(entry.wordId)?.word ?? ""),
    { schemaVersion: SCHEMA_VERSION },
  );
  await writeShards(RELEASE_DIR, shards);
  const shardProblems = await verifyShards(RELEASE_DIR, shards);
  if (shardProblems.length) return { ok: false, problems: shardProblems, report };

  const core = {
    dataset: DATASET,
    schemaVersion: SCHEMA_VERSION,
    promptVersion: PROMPT_VERSION,
    methodVersion: METHOD_VERSION,
    modelId: MODEL_ID,
    provider: PROVIDER,
    inputDataHash: inventory.inputDataHash,
    generatedAt: await releaseTimestamp(),
    source: "ai_offline",
    counts: {
      processedSenseCount: report.processedSenseCount,
      acceptedExampleCount: report.acceptedExampleCount,
      needsReviewCount: report.needsReviewCount,
      exactDuplicateCount: report.exactDuplicateCount,
      nearDuplicateCount: report.nearDuplicateCount,
    },
    releases: Object.fromEntries(shards.map((shard) => [shard.prefix, shard.filename])),
    shardHashes: Object.fromEntries(shards.map((shard) => [shard.prefix, shard.hash])),
    shardBytes: Object.fromEntries(shards.map((shard) => [shard.prefix, shard.bytes])),
  };
  const manifest = { ...core, contentVersion: buildContentVersion(core) };
  await writeManifestAtomically(RELEASE_DIR, manifest);
  await cleanUnreferencedShards(RELEASE_DIR, manifest);
  return { ok: true, problems: [], report, manifest };
}

async function checkRelease({ inventory }) {
  let manifest;
  try {
    manifest = JSON.parse(
      await readFile(path.join(RELEASE_DIR, "manifest.json"), "utf8"),
    );
  } catch {
    return { ok: false, problems: ["manifest 缺失"], report: null };
  }
  const { contentVersion, ...core } = manifest;
  if (contentVersion !== buildContentVersion(core)) {
    return { ok: false, problems: ["contentVersion 不一致"], report: null };
  }
  if (
    core.dataset !== DATASET
    || core.schemaVersion !== SCHEMA_VERSION
    || core.promptVersion !== PROMPT_VERSION
    || core.methodVersion !== METHOD_VERSION
    || core.inputDataHash !== inventory.inputDataHash
  ) {
    return { ok: false, problems: ["manifest 身份字段与当前输入/方法不一致"], report: null };
  }
  const recordsByWordId = {};
  for (const [prefix, filename] of Object.entries(core.releases)) {
    const buffer = await readFile(path.join(RELEASE_DIR, filename)).catch(() => null);
    if (!buffer) return { ok: false, problems: [`shard ${prefix} 文件缺失`], report: null };
    if (buffer.byteLength !== core.shardBytes[prefix]) {
      return { ok: false, problems: [`shard ${prefix} 字节数不一致`], report: null };
    }
    if (sha256(buffer) !== core.shardHashes[prefix]) {
      return { ok: false, problems: [`shard ${prefix} SHA-256 不一致`], report: null };
    }
    let parsed;
    try {
      parsed = JSON.parse(buffer.toString("utf8"));
    } catch {
      return { ok: false, problems: [`shard ${prefix} JSON 无效`], report: null };
    }
    if (parsed.schemaVersion !== SCHEMA_VERSION) {
      return { ok: false, problems: [`shard ${prefix} schemaVersion 不一致`], report: null };
    }
    for (const entry of parsed.entries ?? []) {
      if (recordsByWordId[entry.wordId]) {
        return { ok: false, problems: [`wordId ${entry.wordId} 在多个 shard 出现`], report: null };
      }
      recordsByWordId[entry.wordId] = entry.records;
    }
  }
  const report = validateAllRecords(inventory, recordsByWordId);
  const problems = [];
  if (report.processedSenseCount !== report.expectedSenses) {
    problems.push(`义项处理数 ${report.processedSenseCount} != ${report.expectedSenses}`);
  }
  for (const key of [
    "missingWords", "duplicateSenses", "mismatchedSenseKeys", "invalidRecords",
    "pseudoHumanReviewed",
  ]) {
    if (report[key] !== 0) problems.push(`${key} = ${report[key]}`);
  }
  return { ok: problems.length === 0, problems, report, manifest };
}

// ---------- 主流程 ----------

async function loadReferences() {
  const papers = await loadPaperSentences(CORPUS_DIR);
  const corpusSentences = papers.flatMap((paper) =>
    paper.sentences.map((item) => item.sentence));
  const redbookRaw = JSON.parse(await readFile("public/data/redbook.json", "utf8"));
  const redbookSentences = new Map();
  for (const word of redbookRaw.words) {
    const sentence = typeof word.sentence === "string" ? word.sentence.trim() : "";
    if (sentence) {
      const list = redbookSentences.get(Number(word.id)) ?? [];
      list.push(sentence);
      redbookSentences.set(Number(word.id), list);
    }
  }
  const dedupe = createDedupeIndex([...corpusSentences, ...redbookSentences.values()].flat());
  return { corpusSentences, redbookSentences, dedupe };
}

// 仅直接执行时运行（被 import 时不触发全量任务）
const isDirectRun = process.argv[1]
  && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;

if (isDirectRun) {
  const { flags, values } = parseArgs(process.argv);
  (async () => {
    const inventoryResult = await verifyInventory(".wordloop-data/inventory.json");
    if (!inventoryResult.valid) fail(`库存校验失败：${inventoryResult.reason}`);
    const inventory = inventoryResult.current;

    if (flags.has("--plan")) {
      const estimate = Math.round(
        inventory.counts.primaryWords * 4.6
        + inventory.counts.senseTotal * 0.15 * 2,
      );
      console.log(JSON.stringify({
        plan: DATASET,
        model: MODEL_ID,
        provider: PROVIDER,
        methodVersion: METHOD_VERSION,
        promptVersion: PROMPT_VERSION,
        inputDataHash: inventory.inputDataHash,
        counts: inventory.counts,
        generationBatchSize: GENERATION_BATCH_SIZE,
        maxRewrites: MAX_REWRITES,
        minReviewConfidence: MIN_REVIEW_CONFIDENCE,
        estimatedModelCalls: estimate,
      }, null, 2));
      return;
    }

    if (flags.has("--check")) {
      const result = await checkRelease({ inventory });
      console.log(JSON.stringify({
        check: DATASET,
        ok: result.ok,
        problems: result.problems,
        report: result.report,
        contentVersion: result.manifest?.contentVersion,
      }, null, 2));
      process.exit(result.ok ? 0 : 1);
    }

    if (flags.has("--publish")) {
      const recordsByWordId = {};
      for (const word of inventory.words) {
        try {
          const record = JSON.parse(
            await readFile(path.join(RESULTS_DIR, `${word.wordId}.json`), "utf8"),
          );
          recordsByWordId[word.wordId] = record.records;
        } catch {
          // 缺失词由 validateAllRecords 报告
        }
      }
      const result = await buildRelease({ inventory, recordsByWordId });
      console.log(JSON.stringify({
        publish: DATASET,
        ok: result.ok,
        problems: result.problems,
        report: result.report,
        contentVersion: result.manifest?.contentVersion,
      }, null, 2));
      process.exit(result.ok ? 0 : 1);
    }

    // --fix-duplicates：找出全库近重复记录（含配对双方），重置后以全库为查重参考重写
    if (flags.has("--fix-duplicates")) {
      const { rm } = await import("node:fs/promises");
      const provider = parseProviderEnv(await readFile(".env.local", "utf8"));
      if (!provider.apiKey) fail("缺少模型凭证（.env.local 中未配置 API key）");
      const { redbookSentences, dedupe } = await loadReferences();
      const allRecords = [];
      for (const word of inventory.words) {
        try {
          const record = JSON.parse(
            await readFile(path.join(RESULTS_DIR, `${word.wordId}.json`), "utf8"),
          );
          for (const entry of record.records ?? []) allRecords.push(entry);
        } catch {
          // 未完成
        }
      }
      const scanIndex = createDedupeIndex();
      const involved = new Set();
      for (const entry of allRecords) {
        const hit = scanIndex.findNearDuplicate(entry.sentence);
        if (hit.nearDuplicate) {
          involved.add(entry.wordId);
          // 配对方也一并重写：以句子文本定位（近似重复伙伴）
          for (const other of allRecords) {
            if (other.wordId === entry.wordId) continue;
            if (nearDuplicateRatio(entry.sentence, other.sentence).nearDuplicate) {
              involved.add(other.wordId);
            }
          }
        }
        scanIndex.add(entry.sentence);
      }
      const resetIds = [...involved].map(String);
      console.log(`[${DATASET}] 近重复涉及词：${resetIds.length}`);
      if (!resetIds.length) return;

      // 以除重写词之外的全部记录作为查重参考
      for (const entry of allRecords) {
        if (!involved.has(entry.wordId) && entry.reviewStatus === "model_passed") {
          dedupe.add(entry.sentence);
        }
      }
      const runner = createBatchRunner({
        name: DATASET,
        statePath: STATE_PATH,
        resultPathFor: (key) => path.join(RESULTS_DIR, `${key}.json`),
        maxConcurrent: values.get("--concurrency") ?? 6,
      });
      await runner.load();
      for (const key of resetIds) {
        await rm(path.join(RESULTS_DIR, `${key}.json`), { force: true });
      }
      await runner.resetKeys(resetIds);
      const involvedSet = new Set([...involved].map(Number));
      const items = inventory.words
        .filter((word) => involvedSet.has(word.wordId))
        .map((word) => ({
          key: String(word.wordId),
          run: async () => {
            const senses = word.senses.map((sense) => sense.text);
            const localUsage = { promptTokens: 0, completionTokens: 0, calls: 0 };
            const local = (value) => {
              localUsage.promptTokens += value?.promptTokens ?? 0;
              localUsage.completionTokens += value?.completionTokens ?? 0;
              localUsage.calls += 1;
            };
            const records = await processWord({
              word,
              senses,
              provider,
              usage: local,
              dedupe,
              redbookSentences,
            });
            return {
              usage: localUsage,
              calls: localUsage.calls,
              result: {
                wordId: word.wordId,
                inputDataHash: inventory.inputDataHash,
                methodVersion: METHOD_VERSION,
                modelId: MODEL_ID,
                records,
              },
            };
          },
        }));
      const outcome = await runner.runAll(items);
      console.log(JSON.stringify({
        run: `${DATASET}:fix-duplicates`,
        involvedWords: resetIds.length,
        finished: outcome.stats.finished,
        failedItems: outcome.failed.size,
        modelCalls: outcome.stats.calls,
      }, null, 2));
      return;
    }

    const provider = parseProviderEnv(await readFile(".env.local", "utf8"));
    if (!provider.apiKey) fail("缺少模型凭证（.env.local 中未配置 API key）");
    await mkdir(RESULTS_DIR, { recursive: true });
    const limit = values.get("--limit");
    const concurrency = values.get("--concurrency") ?? 10;
    const only = values.get("--only");
    const { redbookSentences, dedupe } = await loadReferences();
    // resume 时把已完成词的结果句加入查重索引
    for (const word of inventory.words) {
      try {
        const record = JSON.parse(
          await readFile(path.join(RESULTS_DIR, `${word.wordId}.json`), "utf8"),
        );
        for (const entry of record.records ?? []) {
          if (entry.reviewStatus === "model_passed") dedupe.add(entry.sentence);
        }
      } catch {
        // 未完成
      }
    }

    const runner = createBatchRunner({
      name: DATASET,
      statePath: STATE_PATH,
      resultPathFor: (key) => path.join(RESULTS_DIR, `${key}.json`),
      maxConcurrent: concurrency,
    });
    const items = inventory.words
      .filter((word) => (only === undefined || word.wordId === only))
      .slice(0, limit === undefined ? undefined : Math.max(0, limit))
      .map((word) => ({
        key: String(word.wordId),
        run: async () => {
          const senses = word.senses.map((sense) => sense.text);
          const localUsage = { promptTokens: 0, completionTokens: 0, calls: 0 };
          const local = (value) => {
            localUsage.promptTokens += value?.promptTokens ?? 0;
            localUsage.completionTokens += value?.completionTokens ?? 0;
            localUsage.calls += 1;
          };
          const records = await processWord({
            word,
            senses,
            provider,
            usage: local,
            dedupe,
            redbookSentences,
          });
          return {
            usage: localUsage,
            calls: localUsage.calls,
            result: {
              wordId: word.wordId,
              inputDataHash: inventory.inputDataHash,
              methodVersion: METHOD_VERSION,
              modelId: MODEL_ID,
              records,
            },
          };
        },
      }));
    const outcome = await runner.runAll(items);
    console.log(JSON.stringify({
      run: DATASET,
      finished: outcome.stats.finished,
      completedItems: outcome.stats.completedItems,
      totalItems: outcome.stats.totalItems,
      failedItems: outcome.failed.size,
      modelCalls: outcome.stats.calls,
      promptTokens: outcome.stats.promptTokens,
      completionTokens: outcome.stats.completionTokens,
    }, null, 2));
  })().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
