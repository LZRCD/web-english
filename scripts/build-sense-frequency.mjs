// scripts/build-sense-frequency.mjs
// 义项考频离线流水线：确定性语料检索 + 两轮独立盲判 + 打乱稳定性检查
// + 分歧裁决；无语料义项走模型共识多轮推断。支持 --plan / --run（含
// --resume）/ --check / --publish / --limit。原始响应与检查点保持私有。
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  INVENTORY_PATH,
  verifyInventory,
} from "./lib/sense-inventory.mjs";
import { buildOccurrenceIndex } from "./lib/corpus-search.mjs";
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
  buildSenseKey,
  isValidSenseFrequencyEntry,
} from "../lib/sense-datasets.ts";

const DATASET = "sense-frequency";
const SCHEMA_VERSION = 1;
const PROMPT_VERSION = "sense-frequency-prompt-v1";
const METHOD_VERSION = "sense-frequency-method-v1";
const MODEL_ID = "deepseek-v4-flash";
const PROVIDER = "opencode-go";
const WORK_DIR = `.wordloop-data/${DATASET}`;
const RESULTS_DIR = `${WORK_DIR}/results`;
const OCCURRENCES_PATH = `${WORK_DIR}/occurrences.json`;
const STATE_PATH = `${WORK_DIR}/state.json`;
const RELEASE_DIR = `public/data/${DATASET}`;
const CORPUS_DIR = "scripts/kaoyan-corpus";
const CORPUS_VERSION = "46-papers-1998-2026";
// 冻结阈值：语料支持义项的等级判定（去重试卷数）
const LEVEL_THRESHOLDS = { high: 8, medium: 3 };
const MIN_CONFIDENCE = 0.6;

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

function text(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

// ---------- 提示词 ----------

export function contextJudgmentPrompt(word, senses, contexts) {  return {
    system:
      "你是考研英语义项标注员。只返回 JSON，不要 Markdown。字段必须是 assignments：数组，"
      + "为每个输入 context 各返回一个元素 { contextId, senseIndex, confidence }。"
      + "contextId 必须与输入一致；senseIndex 是义项在输入 senses 数组中的下标（从 0 开始），"
      + "无法可靠判断时用 null；confidence 是 0 到 1 的置信度。"
      + "只能依据上下文语义判断该处词形属于哪个义项，不得臆测、不得输出解释、不得引用外部材料。",
    user: stableJson({
      word,
      senses: senses.map((sense, index) => ({ index, text: sense })),
      contexts: contexts.map((context, index) => ({
        id: `C${index}`,
        matchedForms: context.matchedForms,
        text: context.context,
      })),
    }),
  };
}

function shuffledSenseOrder(senses, seed) {
  const order = senses.map((_, index) => index);
  // 确定性洗牌：与 fnv 无关，仅按种子旋转，保证可复现
  for (let index = order.length - 1; index > 0; index -= 1) {
    const other = (seed + index * 2654435761) % (index + 1);
    [order[index], order[other]] = [order[other], order[index]];
  }
  return order;
}

function stabilityPrompt(word, senses, contexts, seed) {
  const order = shuffledSenseOrder(senses, seed);
  return {
    system:
      "你是考研英语义项标注员。只返回 JSON，不要 Markdown。字段必须是 assignments：数组，"
      + "为每个输入 context 各返回一个元素 { contextId, senseIndex, confidence }。"
      + "senseIndex 必须填义项的「原始下标 originalIndex」，输入中已给出每个义项的原下标；"
      + "无法可靠判断时用 null。只依据上下文语义判断，不得臆测、不得输出解释。",
    user: stableJson({
      word,
      senses: order.map((originalIndex) => ({
        originalIndex,
        text: senses[originalIndex],
      })),
      contexts: contexts.map((context, index) => ({
        id: `C${index}`,
        matchedForms: context.matchedForms,
        text: context.context,
      })),
    }),
  };
}

function levelPrompt(word, senses) {
  return {
    system:
      "你是考研英语词义考频评估员。只返回 JSON，不要 Markdown。字段必须是 levels：数组，"
      + "为输入 senses 中的每个义项各返回一个元素 { senseIndex, level, confidence, note }。"
      + "senseIndex 是义项在输入数组中的下标；level 只能是 high（考研英语高频常考）、"
      + "medium（中频）、low（低频）之一；confidence 是 0 到 1；note 是不超过 20 字的中文说明。"
      + "你的结论只是基于训练知识的 AI 推断，不是官方考频，不得宣称官方统计或绝对概率，"
      + "不得说某义项「必考」。",
    user: stableJson({
      word,
      senses: senses.map((sense, index) => ({ index, text: sense })),
    }),
  };
}

function adjudicationPrompt(word, senses, contexts, judgments) {
  return {
    system:
      "你是考研英语义项标注裁决员。只返回 JSON，不要 Markdown。字段必须是 assignments：数组，"
      + "为每个 context 返回 { contextId, senseIndex, confidence }。"
      + "senseIndex 是义项下标（0 起）或 null（多轮意见分歧且无法裁决时）。"
      + "下面给出多轮标注员的分歧意见，请仅依据上下文语义做最终裁决，不得输出解释。",
    user: stableJson({
      word,
      senses: senses.map((sense, index) => ({ index, text: sense })),
      contexts,
      judgments,
    }),
  };
}

// ---------- 模型调用辅助 ----------

async function callJson(provider, { prompt, temperature, maxTokens }, onUsage) {
  const response = await requestChat(provider, {
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
    temperature,
    maxTokens,
    timeoutMs: 90_000,
  });
  onUsage(response.usage);
  if (!response.content) fail("模型没有返回内容");
  return parseJsonStrict(response.content, "模型 JSON");
}

function normalizeAssignments(parsed, contextCount) {
  const list = Array.isArray(parsed.assignments) ? parsed.assignments : null;
  if (!list || list.length !== contextCount) fail("裁决返回数量与上下文不一致");
  return list.map((item, index) => {
    const senseIndex = item?.senseIndex;
    const confidence = Number(item?.confidence);
    if (
      (senseIndex !== null && !Number.isSafeInteger(senseIndex))
      || (senseIndex !== null && senseIndex < 0)
      || !Number.isFinite(confidence)
    ) {
      fail(`上下文 ${index} 标注格式无效`);
    }
    return {
      contextId: `C${index}`,
      senseIndex: senseIndex === null ? null : senseIndex,
      confidence: Math.max(0, Math.min(1, confidence)),
    };
  });
}

// ---------- 单词语义处理 ----------

function levelFromPapers(paperCount) {
  if (paperCount >= LEVEL_THRESHOLDS.high) return "high";
  if (paperCount >= LEVEL_THRESHOLDS.medium) return "medium";
  return "low";
}

function monoConfidence(paperCount) {
  if (paperCount >= LEVEL_THRESHOLDS.high) return 0.85;
  if (paperCount >= LEVEL_THRESHOLDS.medium) return 0.6;
  return 0.4;
}

function evidenceFor(contexts) {
  return contexts.map((context) => ({
    paperId: context.paperId,
    year: context.year,
    paperType: context.paperType,
    section: context.section,
    contextHash: context.contextHash,
  }));
}

function summarizeAssignments(assignmentsByContext, occurrences) {
  // assignmentsByContext: Map<contextIndex, senseIndex|null>
  const perSense = new Map();
  let skipped = 0;
  for (let index = 0; index < occurrences.contexts.length; index += 1) {
    const senseIndex = assignmentsByContext.get(index);
    if (senseIndex === null || senseIndex === undefined) {
      skipped += 1;
      continue;
    }
    const context = occurrences.contexts[index];
    const bucket = perSense.get(senseIndex) ?? [];
    bucket.push(context);
    perSense.set(senseIndex, bucket);
  }
  return { perSense, skipped };
}

function corpusLevelRecords(word, senses, perSense) {
  const records = [];
  for (let senseIndex = 0; senseIndex < senses.length; senseIndex += 1) {
    const contexts = perSense.get(senseIndex) ?? [];
    if (!contexts.length) continue;
    const papers = new Set(contexts.map((context) => context.paperId));
    const years = [...new Set(contexts.map((context) => context.year))].sort();
    const paperTypes = [...new Set(contexts.map((context) => context.paperType))].sort();
    records.push({
      wordId: word.wordId,
      senseIndex,
      senseKey: buildSenseKey(word.wordId, senseIndex, senses[senseIndex]),
      level: levelFromPapers(papers.size),
      basis: "corpus_supported",
      confidence: Number((contexts.length / (contexts.length + 1)).toFixed(2)),
      paperCount: papers.size,
      occurrenceCount: contexts.length,
      years,
      paperTypes,
      evidence: evidenceFor(contexts),
      methodVersion: METHOD_VERSION,
      modelId: MODEL_ID,
      humanReviewed: false,
      reasonCodes: ["corpus_supported"],
      note: `本地 46 套真题语料去重后 ${papers.size} 套试卷出现该义项`,
    });
  }
  return records;
}

function finalizeLevelJudgments(word, senses, roundA, roundB, roundC) {
  const records = [];
  for (let senseIndex = 0; senseIndex < senses.length; senseIndex += 1) {
    const a = roundA.find((item) => item.senseIndex === senseIndex);
    const b = roundB.find((item) => item.senseIndex === senseIndex);
    const c = roundC?.find((item) => item.senseIndex === senseIndex);
    const levels = [a?.level, b?.level, c?.level].filter(Boolean);
    const confidences = [a?.confidence, b?.confidence, c?.confidence]
      .filter((value) => Number.isFinite(value));
    const unanimous = levels.length === 3
      && levels[0] === levels[1]
      && levels[1] === levels[2];
    const majorityOfThree = levels.length === 3
      && (levels[0] === levels[1] || levels[0] === levels[2])
      ? levels[0]
      : levels.length === 3 && levels[1] === levels[2]
        ? levels[1]
        : null;
    const level = levels.length === 2
      ? (levels[0] === levels[1] ? levels[0] : null)
      : unanimous
        ? levels[0]
        : majorityOfThree;
    const avgConfidence = confidences.length
      ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
      : null;
    const stable = level !== null
      && (avgConfidence === null || avgConfidence >= MIN_CONFIDENCE);
    if (level && stable) {
      records.push({
        wordId: word.wordId,
        senseIndex,
        senseKey: buildSenseKey(word.wordId, senseIndex, senses[senseIndex]),
        level,
        basis: "model_consensus",
        confidence: Number(avgConfidence.toFixed(2)),
        paperCount: 0,
        occurrenceCount: 0,
        years: [],
        paperTypes: [],
        evidence: [],
        methodVersion: METHOD_VERSION,
        modelId: MODEL_ID,
        humanReviewed: false,
        reasonCodes: ["model_consensus", "corpus_absent_or_unassigned"],
        note: "AI 多轮推断考频；本地 46 套语料未检索到该义项的直接证据",
      });
    } else {
      records.push({
        wordId: word.wordId,
        senseIndex,
        senseKey: buildSenseKey(word.wordId, senseIndex, senses[senseIndex]),
        level: null,
        basis: "needs_review",
        confidence: avgConfidence === null
          ? null
          : Number(avgConfidence.toFixed(2)),
        paperCount: 0,
        occurrenceCount: 0,
        years: [],
        paperTypes: [],
        evidence: [],
        methodVersion: METHOD_VERSION,
        modelId: MODEL_ID,
        humanReviewed: false,
        reasonCodes: ["unstable_judgments"],
        note: "多轮判断不一致或置信度不足，待人工复核",
      });
    }
  }
  return records;
}

async function judgeLevels(provider, word, senses, usage) {
  const prompt = levelPrompt(word.word, senses);
  const [roundA, roundB] = await Promise.all([
    callJson(provider, { prompt, temperature: 0.2, maxTokens: 1400 }, usage),
    callJson(provider, { prompt, temperature: 0.4, maxTokens: 1400 }, usage),
  ]);
  const normalize = (parsed) => {
    const list = Array.isArray(parsed.levels) ? parsed.levels : null;
    if (!list || list.length !== senses.length) fail("考频轮次返回数量与义项不一致");
    return list.map((item, index) => {
      const level = ["high", "medium", "low"].includes(item?.level)
        ? item.level
        : null;
      const confidence = Number(item?.confidence);
      return {
        senseIndex: Number.isSafeInteger(item?.senseIndex) ? item.senseIndex : index,
        level,
        confidence: Number.isFinite(confidence)
          ? Math.max(0, Math.min(1, confidence))
          : 0,
        note: text(item?.note, 40),
      };
    });
  };
  const normalizedA = normalize(roundA);
  const normalizedB = normalize(roundB);
  let normalizedC = null;
  let needStability = false;
  for (let index = 0; index < senses.length; index += 1) {
    if (normalizedA[index]?.level !== normalizedB[index]?.level) {
      needStability = true;
      break;
    }
  }
  if (needStability) {
    const stability = levelPrompt(word.word, senses);
    const roundC = await callJson(
      provider,
      { prompt: stability, temperature: 0.3, maxTokens: 1400 },
      usage,
    );
    normalizedC = normalize(roundC);
  }
  return { roundA: normalizedA, roundB: normalizedB, roundC: normalizedC };
}

async function processWord({ word, senses, occurrences, provider, usage }) {
  const records = [];
  if (senses.length === 1) {
    if (occurrences && occurrences.totalOccurrences > 0) {
      const papers = new Set(occurrences.contexts.map((context) => context.paperId));
      records.push({
        wordId: word.wordId,
        senseIndex: 0,
        senseKey: buildSenseKey(word.wordId, 0, senses[0]),
        level: levelFromPapers(papers.size),
        basis: "corpus_supported",
        confidence: monoConfidence(papers.size),
        paperCount: papers.size,
        occurrenceCount: occurrences.totalOccurrences,
        years: [...new Set(occurrences.contexts.map((context) => context.year))].sort(),
        paperTypes: [...new Set(occurrences.contexts.map((context) => context.paperType))].sort(),
        evidence: evidenceFor(occurrences.contexts),
        methodVersion: METHOD_VERSION,
        modelId: MODEL_ID,
        humanReviewed: false,
        reasonCodes: ["corpus_supported", "monosense"],
        note: "单义词：按本地真题语料词形出现频次定级",
      });
    } else {
      const { roundA, roundB, roundC } = await judgeLevels(provider, word, senses, usage);
      records.push(...finalizeLevelJudgments(word, senses, roundA, roundB, roundC));
    }
    return records;
  }

  if (occurrences && occurrences.totalOccurrences > 0) {
    // 两轮独立盲判（并行）+ 打乱义项顺序稳定性检查
    const base = contextJudgmentPrompt(word.word, senses, occurrences.contexts);
    const [roundA, roundB] = await Promise.all([
      callJson(provider, { prompt: base, temperature: 0.2, maxTokens: 1600 }, usage),
      callJson(provider, { prompt: base, temperature: 0.4, maxTokens: 1600 }, usage),
    ]);
    const judgmentsA = normalizeAssignments(roundA, occurrences.contexts.length);
    const judgmentsB = normalizeAssignments(roundB, occurrences.contexts.length);
    const stabilityMessage = stabilityPrompt(
      word.word,
      senses,
      occurrences.contexts,
      word.wordId,
    );
    const roundC = await callJson(
      provider,
      { prompt: stabilityMessage, temperature: 0.3, maxTokens: 1600 },
      usage,
    );
    const judgmentsC = normalizeAssignments(roundC, occurrences.contexts.length);

    const assignmentsByContext = new Map();
    const disputed = [];
    for (let index = 0; index < occurrences.contexts.length; index += 1) {
      const a = judgmentsA[index].senseIndex;
      const b = judgmentsB[index].senseIndex;
      const c = judgmentsC[index].senseIndex;
      let winner = null;
      if (a !== null && b !== null && c !== null) {
        if (a === b || a === c) winner = a;
        else if (b === c) winner = b;
        else disputed.push(index);
      } else if (a !== null && b !== null && a === b) winner = a;
      else if (a !== null && c !== null && a === c) winner = a;
      else if (b !== null && c !== null && b === c) winner = b;
      else if (a === null && b === null && c === null) winner = null;
      else disputed.push(index);
      assignmentsByContext.set(index, winner);
    }

    if (disputed.length) {
      const disputeContexts = disputed.map((index) => ({
        id: `C${index}`,
        text: occurrences.contexts[index].context,
        matchedForms: occurrences.contexts[index].matchedForms,
        rounds: [
          { round: "A", senseIndex: judgmentsA[index].senseIndex },
          { round: "B", senseIndex: judgmentsB[index].senseIndex },
          { round: "C", senseIndex: judgmentsC[index].senseIndex },
        ],
      }));
      const message = adjudicationPrompt(word.word, senses, disputeContexts, null);
      const roundD = await callJson(
        provider,
        { prompt: message, temperature: 0.2, maxTokens: 1200 },
        usage,
      );
      const list = Array.isArray(roundD.assignments) ? roundD.assignments : null;
      if (!list || list.length !== disputeContexts.length) fail("裁决返回数量不一致");
      list.forEach((item, itemIndex) => {
        const senseIndex = item?.senseIndex;
        const index = disputed[itemIndex];
        if (Number.isSafeInteger(senseIndex) && senseIndex >= 0 && senseIndex < senses.length) {
          assignmentsByContext.set(index, senseIndex);
        }
        // 仍为 null 则保持未分配（不臆造）
      });
    }

    const { perSense, skipped } = summarizeAssignments(assignmentsByContext, occurrences);
    if (skipped > 0) {
      // 上下文歧义只影响证据完整性，不阻塞：记录在 note 中
    }
    records.push(...corpusLevelRecords(word, senses, perSense));
    const unassigned = [];
    for (let senseIndex = 0; senseIndex < senses.length; senseIndex += 1) {
      if (!perSense.has(senseIndex)) unassigned.push(senseIndex);
    }
    if (unassigned.length) {
      const unassignedSenses = unassigned.map((senseIndex) => senses[senseIndex]);
      const { roundA: la, roundB: lb, roundC: lc } = await judgeLevels(
        provider,
        word,
        unassignedSenses,
        usage,
      );
      const levelRecords = finalizeLevelJudgments(word, unassignedSenses, la, lb, lc);
      for (const record of levelRecords) {
        const globalIndex = unassigned[record.senseIndex];
        record.senseIndex = globalIndex;
        record.senseKey = buildSenseKey(word.wordId, globalIndex, senses[globalIndex]);
        records.push(record);
      }
    }
    return records;
  }

  // 语料中完全未出现：全部义项走模型共识多轮推断
  const { roundA, roundB, roundC } = await judgeLevels(provider, word, senses, usage);
  records.push(...finalizeLevelJudgments(word, senses, roundA, roundB, roundC));
  return records;
}

// ---------- 校验与发布 ----------

function validateAllRecords(inventory, recordsByWordId) {
  const report = {
    expectedWords: inventory.counts.primaryWords,
    expectedSenses: inventory.counts.senseTotal,
    processedWordCount: Object.keys(recordsByWordId).length,
    processedSenseCount: 0,
    missingWords: 0,
    duplicateSenses: 0,
    mismatchedSenseKeys: 0,
    invalidRecords: 0,
    labeledSenseCount: 0,
    corpusSupportedCount: 0,
    modelConsensusCount: 0,
    needsReviewCount: 0,
    levelCounts: { high: 0, medium: 0, low: 0 },
    monoWordRecords: 0,
    over8WordRecords: 0,
    forcedGuessCount: 0,
    truncationCount: 0,
  };
  for (const word of inventory.words) {
    const records = recordsByWordId[word.wordId];
    if (!records || records.length !== word.senses.length) {
      report.missingWords += 1;
      continue;
    }
    report.processedSenseCount += records.length;
    if (word.senses.length === 1) report.monoWordRecords += records.length;
    if (word.senses.length > 8) report.over8WordRecords += records.length;
    const seen = new Set();
    for (const record of records) {
      if (seen.has(record.senseIndex)) {
        report.duplicateSenses += 1;
        continue;
      }
      seen.add(record.senseIndex);
      if (!isValidSenseFrequencyEntry(record)) {
        report.invalidRecords += 1;
        continue;
      }
      const expectedKey = buildSenseKey(
        word.wordId,
        record.senseIndex,
        word.senses[record.senseIndex].text,
      );
      if (record.senseKey !== expectedKey) {
        report.mismatchedSenseKeys += 1;
        continue;
      }
      if (record.level !== null) {
        report.labeledSenseCount += 1;
        report.levelCounts[record.level] += 1;
      }
      if (record.basis === "corpus_supported") report.corpusSupportedCount += 1;
      if (record.basis === "model_consensus") report.modelConsensusCount += 1;
      if (record.basis === "needs_review") report.needsReviewCount += 1;
      if (record.level !== null && record.basis === "needs_review") {
        report.forcedGuessCount += 1;
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
  if (report.processedWordCount !== report.expectedWords) {
    problems.push(`词处理数 ${report.processedWordCount} != ${report.expectedWords}`);
  }
  if (report.processedSenseCount !== report.expectedSenses) {
    problems.push(`义项处理数 ${report.processedSenseCount} != ${report.expectedSenses}`);
  }
  for (const key of [
    "missingWords", "duplicateSenses", "mismatchedSenseKeys", "invalidRecords",
    "forcedGuessCount", "truncationCount",
  ]) {
    if (report[key] !== 0) problems.push(`${key} = ${report[key]}`);
  }
  if (problems.length) {
    return { ok: false, problems, report };
  }

  const byWordId = new Map();
  const wordById = new Map(inventory.words.map((word) => [word.wordId, word]));
  for (const word of inventory.words) {
    byWordId.set(word.wordId, {
      wordId: word.wordId,
      records: recordsByWordId[word.wordId],
    });
  }
  const wordEntries = [...byWordId.values()];
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
    corpusVersion: CORPUS_VERSION,
    generatedAt: await releaseTimestamp(),
    source: "ai_offline",
    counts: {
      processedWordCount: report.processedWordCount,
      processedSenseCount: report.processedSenseCount,
      labeledSenseCount: report.labeledSenseCount,
      corpusSupportedCount: report.corpusSupportedCount,
      modelConsensusCount: report.modelConsensusCount,
      needsReviewCount: report.needsReviewCount,
      levelCounts: report.levelCounts,
      forcedGuessCount: 0,
      truncationCount: 0,
    },
    releases: Object.fromEntries(shards.map((shard) => [shard.prefix, shard.filename])),
    shardHashes: Object.fromEntries(shards.map((shard) => [shard.prefix, shard.hash])),
    shardBytes: Object.fromEntries(shards.map((shard) => [shard.prefix, shard.bytes])),
  };
  const manifest = {
    ...core,
    contentVersion: buildContentVersion(core),
  };
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
  const prefixes = Object.keys(core.releases).sort();
  const shards = [];
  for (const prefix of prefixes) {
    const filename = core.releases[prefix];
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
    shards.push(parsed);
  }
  const recordsByWordId = {};
  for (const shard of shards) {
    if (shard.schemaVersion !== SCHEMA_VERSION) {
      return { ok: false, problems: [`shard ${shard.prefix} schemaVersion 不一致`], report: null };
    }
    for (const entry of shard.entries ?? []) {
      if (recordsByWordId[entry.wordId]) {
        return { ok: false, problems: [`wordId ${entry.wordId} 在多个 shard 出现`], report: null };
      }
      recordsByWordId[entry.wordId] = entry.records;
    }
  }
  const report = validateAllRecords(inventory, recordsByWordId);
  const problems = [];
  if (report.processedWordCount !== report.expectedWords) {
    problems.push(`词处理数 ${report.processedWordCount} != ${report.expectedWords}`);
  }
  if (report.processedSenseCount !== report.expectedSenses) {
    problems.push(`义项处理数 ${report.processedSenseCount} != ${report.expectedSenses}`);
  }
  for (const key of [
    "missingWords", "duplicateSenses", "mismatchedSenseKeys", "invalidRecords",
    "forcedGuessCount", "truncationCount",
  ]) {
    if (report[key] !== 0) problems.push(`${key} = ${report[key]}`);
  }
  return { ok: problems.length === 0, problems, report, manifest };
}

// ---------- 主流程 ----------

async function loadWordData() {
  const inventoryCheck = await verifyInventory(INVENTORY_PATH);
  if (!inventoryCheck.valid) fail(`库存校验失败：${inventoryCheck.reason}`);
  const inventory = inventoryCheck.current;
  let occurrences;
  try {
    occurrences = JSON.parse(await readFile(OCCURRENCES_PATH, "utf8"));
  } catch {
    occurrences = await buildOccurrenceIndex({
      corpusDir: CORPUS_DIR,
      inventory,
      outPath: OCCURRENCES_PATH,
    });
  }
  return { inventory, occurrences };
}

async function main() {
  const { flags, values } = parseArgs(process.argv);
  const { inventory, occurrences } = await loadWordData();

  if (flags.has("--plan")) {
    const wordsWithCorpus = Object.keys(occurrences.byWordId).length;
    const wordsWithoutCorpus = inventory.counts.primaryWords - wordsWithCorpus;
    const estimate = Math.round(
      wordsWithCorpus * 4.2 + wordsWithoutCorpus * 3.2 + inventory.counts.monoSense * 0.8,
    );
    console.log(JSON.stringify({
      plan: DATASET,
      model: MODEL_ID,
      provider: PROVIDER,
      methodVersion: METHOD_VERSION,
      promptVersion: PROMPT_VERSION,
      inputDataHash: inventory.inputDataHash,
      counts: inventory.counts,
      corpusWords: wordsWithCorpus,
      corpusAbsentWords: wordsWithoutCorpus,
      estimatedModelCalls: estimate,
      thresholds: LEVEL_THRESHOLDS,
      minConfidence: MIN_CONFIDENCE,
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
      const key = String(word.wordId);
      try {
        const record = JSON.parse(await readFile(path.join(RESULTS_DIR, `${key}.json`), "utf8"));
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

  // --run（默认；--limit 用于试点）
  const provider = parseProviderEnv(await readFile(".env.local", "utf8"));
  if (!provider.apiKey) fail("缺少模型凭证（.env.local 中未配置 API key）");
  await mkdir(RESULTS_DIR, { recursive: true });
  const limit = values.get("--limit");
  const concurrency = values.get("--concurrency") ?? 10;
  const only = values.get("--only");
  const usageTotals = { promptTokens: 0, completionTokens: 0 };
  const usage = (value) => {
    usageTotals.promptTokens += value?.promptTokens ?? 0;
    usageTotals.completionTokens += value?.completionTokens ?? 0;
  };

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
        const occurrencesForWord = occurrences.byWordId[word.wordId];
        const localUsage = { promptTokens: 0, completionTokens: 0, calls: 0 };
        const local = (value) => {
          localUsage.promptTokens += value?.promptTokens ?? 0;
          localUsage.completionTokens += value?.completionTokens ?? 0;
          localUsage.calls += 1;
        };
        const records = await processWord({
          word,
          senses,
          occurrences: occurrencesForWord,
          provider,
          usage: local,
        });
        usage(localUsage);
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
}

// 仅直接执行时运行（被 import 时不触发全量任务）
const isDirectRun = process.argv[1]
  && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;
if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
