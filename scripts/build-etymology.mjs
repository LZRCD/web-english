// scripts/build-etymology.mjs
// 词根拆解与助记离线流水线：内容生成 → 独立事实声明检查 + 释义相关性检查
// → 构词片段完整性/relation 冲突/模板重复确定性质检 → 高风险来源降级。
// 诚实模式：verified_morphology / surface_form / mnemonic_only / needs_review，
// 允许 root=null 与 affixes=[]，禁止伪造词根。支持 --plan/--run/--check/--publish。
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { verifyInventory } from "./lib/sense-inventory.mjs";
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
  buildEtymologyDatasetInputKey,
  isValidEtymologyDatasetEntry,
} from "../lib/sense-datasets.ts";

const DATASET = "etymology";
const SCHEMA_VERSION = 1;
const PROMPT_VERSION = "etymology-prompt-v1";
const METHOD_VERSION = "etymology-method-v1";
const MODEL_ID = "deepseek-v4-flash";
const PROVIDER = "opencode-go";
const WORK_DIR = `.wordloop-data/${DATASET}`;
const RESULTS_DIR = `${WORK_DIR}/results`;
const STATE_PATH = `${WORK_DIR}/state.json`;
const RELEASE_DIR = `public/data/${DATASET}`;
const TEMPLATE_RUN_LENGTH = 12;
const TEMPLATE_MIN_OCCURRENCES = 3;

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

const AFFIX_KINDS = new Set(["prefix", "root", "suffix", "other"]);
const MODES = new Set([
  "verified_morphology",
  "surface_form",
  "mnemonic_only",
  "needs_review",
]);

function normalizeContent(parsed) {
  // mode 非法时不臆造：诚实降级为 needs_review，由 processWord 记录原因
  const modeInvalid = !MODES.has(parsed?.mode);
  const mode = modeInvalid ? "needs_review" : parsed.mode;
  const breakdown = text(parsed?.breakdown, 320);
  const root = parsed?.root === null || parsed?.root === undefined
    ? null
    : text(parsed.root, 120) || null;
  const mnemonic = text(parsed?.mnemonic, 500);
  if (!breakdown || !mnemonic) fail("内容字段缺失");
  const affixes = Array.isArray(parsed?.affixes)
    ? parsed.affixes
        .map((item) => {
          const form = text(item?.form, 40);
          const meaning = text(item?.meaning, 120);
          const kind = item?.kind;
          if (!form || !meaning || !AFFIX_KINDS.has(kind)) return null;
          return { form, kind, meaning };
        })
        .filter(Boolean)
        .slice(0, 8)
    : [];
  return { mode, breakdown, root, affixes, mnemonic, modeInvalid };
}

// ---------- 提示词 ----------

function generationPrompt(input) {
  const previousIssues = Array.isArray(input.previousIssues) && input.previousIssues.length
    ? `\n上一版内容被检查出以下问题，必须全部修正：${input.previousIssues.join("；")}。`
    : "";
  return {
    system:
      "你是谨慎的英语构词助记编辑。内容只用于记忆联想，不是权威历史词源考据。"
      + "只返回 JSON：{ mode, breakdown, root, affixes, mnemonic }。"
      + "mode 只能是：verified_morphology（存在明确、可追溯的可靠构词依据，如广为人知的"
      + "拉丁/希腊词根；此时 root 必须是可靠的构词根且 affixes 非空）、"
      + "surface_form（只分析可观察的现代词形，不声称历史词源）、"
      + "mnemonic_only（无可靠词根依据，只提供明确标注为联想的助记，root 必须为 null "
      + "且 affixes 为空数组）、needs_review（内容冲突或无法安全生成）。"
      + "breakdown 是拆解说明；mnemonic_only 时必须说明这是联想拆分而非真实词根。"
      + "root 是核心词根，可为 null；affixes 是 { form, kind, meaning } 数组，"
      + "kind 只能是 prefix/root/suffix/other，form 必须真实出现在单词词形中。"
      + "mnemonic 是记忆联想；谐音、画面和故事必须明确标注为 AI 联想。"
      + "输入中的 root 和 relation 是本地真实线索，必须遵守且不得冲突。"
      + "禁止捏造拉丁语、希腊语、法语等来源，禁止捏造年代、语音演变和学术结论，"
      + "禁止复制受版权保护的词典或教材内容。"
      + "surface_form 与 mnemonic_only 模式下不得出现任何语言来源或年代表述。"
      + previousIssues,
    user: stableJson(input),
  };
}

function factCheckPrompt(word, content) {
  return {
    system:
      "你是构词助记的事实核查员。只返回 JSON：{ ok, issues, corrected }。"
      + "核查：1. 内容是否声称历史词源、语言来源、年代或学术结论，声称是否可靠；"
      + "2. mode 是否与内容一致（verified_morphology 必须有可靠依据；surface_form 不得"
      + "声称历史来源；mnemonic_only 不得把联想写成真实词根）；"
      + "3. affixes 的 form 是否真实出现在单词词形中；4. 是否与输入的本地 root/relation "
      + "线索冲突。若发现问题，ok=false，issues 列出问题，corrected 给出修正后的完整内容"
      + "（与生成格式相同）；否则 ok=true，issues 为空数组，corrected 为 null。"
      + "常见拉丁/希腊词根（如 tele-、bio-、spect、-tion）视为可靠依据，不要过度保守。",
    user: stableJson({ word, content }),
  };
}

function relevancePrompt(word, meaning, content) {
  return {
    system:
      "你是构词助记的相关性审查员。只返回 JSON：{ relevant, note }。"
      + "判断拆解与助记是否真正关联该词的当前释义（而非其他词义或无关内容），"
      + "是否有助于记忆该词。note 是不超过 40 字的中文说明。",
    user: stableJson({ word, meaning, content }),
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

// ---------- 确定性质检 ----------

function stripAffixForm(form) {
  return String(form).trim().replace(/^[-‐‑‒–—]+|[-‐‑‒–—]+$/g, "").toLowerCase();
}

function fragmentInWord(form, word) {
  const stripped = stripAffixForm(form);
  return stripped.length > 0 && word.toLowerCase().includes(stripped);
}

function deterministicEtymologyChecks({ word, root, relation, content }) {
  void root;
  const reasons = [];
  // 1. 构词片段完整性：form 必须真实出现在单词词形中
  for (const affix of content.affixes) {
    if (!fragmentInWord(affix.form, word)) {
      reasons.push(`fragment_not_in_word:${stripAffixForm(affix.form)}`);
    }
  }
  // 2. 模式结构一致性
  if (content.mode === "verified_morphology" && (content.root === null || content.affixes.length === 0)) {
    reasons.push("invalid_verified_structure");
  }
  if (content.mode === "mnemonic_only" && (content.root !== null || content.affixes.length > 0)) {
    reasons.push("mnemonic_only_claims_root");
  }
  // 3. 与本地 relation 冲突检查：确认派生/屈折/变体关系必须出现 lemma 词形
  if (
    relation
    && (relation.confidence === "confirmed" || relation.confidence === "source-confirmed")
    && ["derived", "inflection", "variant"].includes(relation.kind)
    && typeof relation.lemma === "string"
    && relation.lemma.trim()
  ) {
    const lemma = relation.lemma.trim().toLowerCase();
    const rootHit = content.root !== null && content.root.toLowerCase().includes(lemma);
    const affixHit = content.affixes.some((affix) =>
      stripAffixForm(affix.form).includes(lemma)
      || stripAffixForm(affix.form) === lemma);
    const breakdownHit = content.breakdown.toLowerCase().includes(lemma);
    if (!rootHit && !affixHit && !breakdownHit) {
      reasons.push(`relation_conflict:${relation.lemma}`);
    }
  }
  // 4. 高风险来源声明专项：非 verified_morphology 模式下出现语言/年代来源声明
  if (content.mode !== "verified_morphology") {
    const claimPattern = /(?:拉丁|希腊|法语|古英语|日耳曼|盎格鲁|诺曼|梵语|阿拉伯语|印欧|世纪|年代|公元|中世纪|词源|演变自|来自(?:古|中))/.test(
      `${content.breakdown} ${content.root ?? ""} ${content.mnemonic}`,
    );
    if (claimPattern) reasons.push("unverified_origin_claim");
  }
  return reasons;
}

// ---------- 模板检测（跨词） ----------

function normalizeForTemplate(value) {
  // 只保留小写字母数字与中文，去除全部标点/空白/格式差异
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]/g, "");
}

function createTemplateIndex(entries = []) {
  const runToWords = new Map();
  for (const entry of entries) {
    const normalized = normalizeForTemplate(entry.mnemonic);
    const runs = new Set();
    for (let start = 0; start + TEMPLATE_RUN_LENGTH <= normalized.length; start += 1) {
      runs.add(normalized.slice(start, start + TEMPLATE_RUN_LENGTH));
    }
    for (const run of runs) {
      const list = runToWords.get(run) ?? [];
      list.push(entry.wordId);
      runToWords.set(run, list);
    }
  }
  const check = (wordId, mnemonic) => {
    const normalized = normalizeForTemplate(mnemonic);
    const hits = new Set();
    for (let start = 0; start + TEMPLATE_RUN_LENGTH <= normalized.length; start += 1) {
      const run = normalized.slice(start, start + TEMPLATE_RUN_LENGTH);
      for (const other of runToWords.get(run) ?? []) {
        if (other !== wordId) hits.add(other);
      }
      if (hits.size >= TEMPLATE_MIN_OCCURRENCES - 1) break;
    }
    return [...hits];
  };
  const add = (wordId, mnemonic) => {
    const normalized = normalizeForTemplate(mnemonic);
    const runs = new Set();
    for (let start = 0; start + TEMPLATE_RUN_LENGTH <= normalized.length; start += 1) {
      runs.add(normalized.slice(start, start + TEMPLATE_RUN_LENGTH));
    }
    for (const run of runs) {
      const list = runToWords.get(run) ?? [];
      if (!list.includes(wordId)) {
        list.push(wordId);
        runToWords.set(run, list);
      }
    }
  };
  return { check, add };
}

// ---------- 单词语义处理 ----------

async function generateContent(provider, input, usage) {
  const parsed = await callJson(provider, {
    prompt: generationPrompt(input),
    temperature: 0.4,
    maxTokens: 1400,
  }, usage);
  return normalizeContent(parsed);
}

async function processWord({ word, provider, usage, templateIndex }) {
  const input = {
    word: word.word,
    meaning: word.meaning,
    root: word.root ?? "",
    relation: word.relation,
  };
  let content = await generateContent(provider, input, usage);

  // 独立事实声明检查 + 释义相关性检查（并行）
  const [factParsed, relevanceParsed] = await Promise.all([
    callJson(provider, {
      prompt: factCheckPrompt(word.word, content),
      temperature: 0,
      maxTokens: 1400,
    }, usage),
    callJson(provider, {
      prompt: relevancePrompt(word.word, word.meaning, content),
      temperature: 0,
      maxTokens: 600,
    }, usage),
  ]);
  const reasons = [];
  if (content.modeInvalid) reasons.push("invalid_mode_from_model");
  if (factParsed?.ok !== true && factParsed?.corrected) {
    reasons.push("fact_check_corrected");
    content = normalizeContent(factParsed.corrected);
  } else if (factParsed?.ok !== true) {
    reasons.push(...(Array.isArray(factParsed?.issues)
      ? factParsed.issues.map((issue) => `fact_issue:${String(issue).slice(0, 40)}`)
      : ["fact_check_failed"]));
  }
  if (relevanceParsed?.relevant === false) {
    reasons.push("not_relevant_to_meaning");
  }

  // 确定性质检
  reasons.push(...deterministicEtymologyChecks({
    word: word.word,
    meaning: word.meaning,
    root: word.root ?? "",
    relation: word.relation,
    content,
  }));

  // 跨词模板检测
  const templateHits = templateIndex.check(word.wordId, content.mnemonic);
  if (templateHits.length >= TEMPLATE_MIN_OCCURRENCES - 1) {
    reasons.push(`template_similarity:${templateHits.slice(0, 3).join(",")}`);
  }

  // 一次受限重生成：结构性问题带原因反馈重试
  const structural = reasons.some((reason) =>
    reason.startsWith("fragment_not_in_word")
    || reason === "invalid_verified_structure"
    || reason === "mnemonic_only_claims_root"
    || reason === "unverified_origin_claim"
    || reason === "invalid_mode_from_model"
    || reason === "not_relevant_to_meaning");
  if (structural) {
    const retryInput = {
      ...input,
      previousIssues: [...new Set(reasons)],
    };
    const retried = await generateContent(provider, retryInput, usage);
    const retryReasons = deterministicEtymologyChecks({
      word: word.word,
      meaning: word.meaning,
      root: word.root ?? "",
      relation: word.relation,
      content: retried,
    });
    if (retryReasons.length === 0) {
      content = retried;
      reasons.length = 0;
      reasons.push("regenerated_after_structural_issues");
    } else {
      reasons.push(...retryReasons);
      // 保留第一条更合法的候选？两者都未通过结构检查时保留原始内容并标记待复核
    }
  }

  const mode = reasons.length
    && reasons.some((reason) =>
      reason.startsWith("fragment_not_in_word")
      || reason.startsWith("relation_conflict")
      || reason === "not_relevant_to_meaning"
      || reason.startsWith("template_similarity")
      || reason.startsWith("fact_issue")
      || reason === "fact_check_failed"
      || reason === "invalid_mode_from_model"
      || reason === "unverified_origin_claim")
    ? "needs_review"
    : content.mode;

  templateIndex.add(word.wordId, content.mnemonic);

  return {
    wordId: word.wordId,
    inputKey: buildEtymologyDatasetInputKey({
      schemaVersion: SCHEMA_VERSION,
      promptVersion: PROMPT_VERSION,
      wordId: word.wordId,
      word: word.word,
      meaning: word.meaning,
      root: word.root ?? "",
      relation: word.relation ?? null,
    }),
    mode,
    breakdown: content.breakdown,
    root: content.root,
    affixes: content.affixes,
    mnemonic: content.mnemonic,
    reasonCodes: [...new Set(reasons)].slice(0, 8),
    promptVersion: PROMPT_VERSION,
    modelId: MODEL_ID,
    humanReviewed: false,
    generatedAt: new Date().toISOString(),
  };
}

// ---------- 校验与发布 ----------

function validateAllRecords(inventory, recordsByWordId) {
  const report = {
    expectedWords: inventory.counts.primaryWords,
    processedWordCount: Object.keys(recordsByWordId).length,
    missingWords: 0,
    duplicateWordIds: 0,
    invalidRecords: 0,
    mismatchedInputKeys: 0,
    modeCounts: {
      verified_morphology: 0,
      surface_form: 0,
      mnemonic_only: 0,
      needs_review: 0,
    },
    forcedRootCount: 0,
    unverifiedMorphologyCount: 0,
    pseudoHumanReviewed: 0,
    templateFlaggedCount: 0,
  };
  const templateIndex = createTemplateIndex();
  for (const word of inventory.words) {
    const record = recordsByWordId[word.wordId];
    if (!record) {
      report.missingWords += 1;
      continue;
    }
    if (!isValidEtymologyDatasetEntry(record)) {
      report.invalidRecords += 1;
      continue;
    }
    const expectedKey = buildEtymologyDatasetInputKey({
      schemaVersion: SCHEMA_VERSION,
      promptVersion: PROMPT_VERSION,
      wordId: word.wordId,
      word: word.word,
      meaning: word.meaning,
      root: word.root ?? "",
      relation: word.relation ?? null,
    });
    if (record.inputKey !== expectedKey) {
      report.mismatchedInputKeys += 1;
      continue;
    }
    if (record.humanReviewed !== false) report.pseudoHumanReviewed += 1;
    report.modeCounts[record.mode] += 1;
    if (record.mode === "verified_morphology") {
      // 不接受无依据的年代断言（世纪/公元）；语言来源表述需事实核查轮已把关
      if (/世纪|年代|公元/.test(`${record.breakdown} ${record.mnemonic}`)) {
        report.unverifiedMorphologyCount += 1;
      }
    }
    const hits = templateIndex.check(word.wordId, record.mnemonic);
    if (hits.length >= TEMPLATE_MIN_OCCURRENCES - 1) {
      report.templateFlaggedCount += 1;
    }
    templateIndex.add(word.wordId, record.mnemonic);
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
  for (const key of [
    "missingWords", "duplicateWordIds", "invalidRecords", "mismatchedInputKeys",
    "forcedRootCount", "pseudoHumanReviewed",
  ]) {
    if (report[key] !== 0) problems.push(`${key} = ${report[key]}`);
  }
  if (problems.length) return { ok: false, problems, report };

  const wordById = new Map(inventory.words.map((word) => [word.wordId, word]));
  const wordEntries = inventory.words
    .filter((word) => recordsByWordId[word.wordId])
    .map((word) => ({ wordId: word.wordId, record: recordsByWordId[word.wordId] }));
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
      processedWordCount: report.processedWordCount,
      modeCounts: report.modeCounts,
      templateFlaggedCount: report.templateFlaggedCount,
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
      recordsByWordId[entry.wordId] = entry.record;
    }
  }
  const report = validateAllRecords(inventory, recordsByWordId);
  const problems = [];
  if (report.processedWordCount !== report.expectedWords) {
    problems.push(`词处理数 ${report.processedWordCount} != ${report.expectedWords}`);
  }
  for (const key of [
    "missingWords", "duplicateWordIds", "invalidRecords", "mismatchedInputKeys",
    "forcedRootCount", "pseudoHumanReviewed",
  ]) {
    if (report[key] !== 0) problems.push(`${key} = ${report[key]}`);
  }
  return { ok: problems.length === 0, problems, report, manifest };
}

// ---------- 主流程 ----------

const isDirectRun = process.argv[1]
  && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;

if (isDirectRun) {
  const { flags, values } = parseArgs(process.argv);
  (async () => {
    const inventoryResult = await verifyInventory(".wordloop-data/inventory.json");
    if (!inventoryResult.valid) fail(`库存校验失败：${inventoryResult.reason}`);
    const inventory = inventoryResult.current;

    if (flags.has("--plan")) {
      console.log(JSON.stringify({
        plan: DATASET,
        model: MODEL_ID,
        provider: PROVIDER,
        methodVersion: METHOD_VERSION,
        promptVersion: PROMPT_VERSION,
        inputDataHash: inventory.inputDataHash,
        counts: inventory.counts,
        templateRunLength: TEMPLATE_RUN_LENGTH,
        templateMinOccurrences: TEMPLATE_MIN_OCCURRENCES,
        estimatedModelCalls: Math.round(inventory.counts.primaryWords * 3.3),
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
          recordsByWordId[word.wordId] = record.record ?? record;
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

    // --retry-flagged：重置带未解决结构性问题（非 needs_review）的记录并重跑
    if (flags.has("--retry-flagged")) {
      const { rm } = await import("node:fs/promises");
      const provider = parseProviderEnv(await readFile(".env.local", "utf8"));
      if (!provider.apiKey) fail("缺少模型凭证（.env.local 中未配置 API key）");
      const templateIndex = createTemplateIndex();
      for (const word of inventory.words) {
        try {
          const record = JSON.parse(
            await readFile(path.join(RESULTS_DIR, `${word.wordId}.json`), "utf8"),
          );
          const entry = record.record ?? record;
          if (entry?.mnemonic) templateIndex.add(word.wordId, entry.mnemonic);
        } catch {
          // 未完成
        }
      }
      const runner = createBatchRunner({
        name: DATASET,
        statePath: STATE_PATH,
        resultPathFor: (key) => path.join(RESULTS_DIR, `${key}.json`),
        maxConcurrent: values.get("--concurrency") ?? 8,
      });
      await runner.load();
      const RETRYABLE = /^(fragment_not_in_word|unverified_origin_claim|template_similarity|fact_issue|invalid_mode_from_model|not_relevant_to_meaning|invalid_verified_structure|mnemonic_only_claims_root)/;
      const flaggedIds = [];
      for (const word of inventory.words) {
        try {
          const record = JSON.parse(
            await readFile(path.join(RESULTS_DIR, `${word.wordId}.json`), "utf8"),
          );
          const entry = record.record ?? record;
          const reasons = entry?.reasonCodes ?? [];
          const retryableIssues = reasons.filter((reason) => RETRYABLE.test(reason));
          const flagged = entry
            && retryableIssues.length > 0
            && (entry.mode !== "needs_review" || retryableIssues.length === reasons.length);
          if (flagged) flaggedIds.push(String(word.wordId));
        } catch {
          // 缺失结果交由主跑处理
        }
      }
      console.log(`[${DATASET}] 需重跑标记词：${flaggedIds.length}`);
      for (const key of flaggedIds) {
        await rm(path.join(RESULTS_DIR, `${key}.json`), { force: true });
      }
      await runner.resetKeys(flaggedIds);
      const flaggedSet = new Set(flaggedIds.map(Number));
      const items = inventory.words
        .filter((word) => flaggedSet.has(word.wordId))
        .map((word) => ({
          key: String(word.wordId),
          run: async () => {
            const localUsage = { promptTokens: 0, completionTokens: 0, calls: 0 };
            const local = (value) => {
              localUsage.promptTokens += value?.promptTokens ?? 0;
              localUsage.completionTokens += value?.completionTokens ?? 0;
              localUsage.calls += 1;
            };
            const record = await processWord({
              word,
              provider,
              usage: local,
              templateIndex,
            });
            return {
              usage: localUsage,
              calls: localUsage.calls,
              result: {
                wordId: word.wordId,
                inputDataHash: inventory.inputDataHash,
                methodVersion: METHOD_VERSION,
                modelId: MODEL_ID,
                record,
              },
            };
          },
        }));
      const outcome = await runner.runAll(items);
      console.log(JSON.stringify({
        run: `${DATASET}:retry-flagged`,
        flaggedCount: flaggedIds.length,
        finished: outcome.stats.finished,
        failedItems: outcome.failed.size,
        modelCalls: outcome.stats.calls,
        promptTokens: outcome.stats.promptTokens,
        completionTokens: outcome.stats.completionTokens,
      }, null, 2));
      return;
    }

    const provider = parseProviderEnv(await readFile(".env.local", "utf8"));
    if (!provider.apiKey) fail("缺少模型凭证（.env.local 中未配置 API key）");
    await mkdir(RESULTS_DIR, { recursive: true });
    const limit = values.get("--limit");
    const concurrency = values.get("--concurrency") ?? 10;
    const only = values.get("--only");
    const templateIndex = createTemplateIndex();
    for (const word of inventory.words) {
      try {
        const record = JSON.parse(
          await readFile(path.join(RESULTS_DIR, `${word.wordId}.json`), "utf8"),
        );
        const entry = record.record ?? record;
        if (entry?.mnemonic) templateIndex.add(word.wordId, entry.mnemonic);
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
    const targetIds = only === undefined
      ? undefined
      : [String(only)];
    const items = inventory.words
      .filter((word) => (targetIds === undefined || targetIds.includes(String(word.wordId))))
      .slice(0, limit === undefined ? undefined : Math.max(0, limit))
      .map((word) => ({
        key: String(word.wordId),
        run: async () => {
          const localUsage = { promptTokens: 0, completionTokens: 0, calls: 0 };
          const local = (value) => {
            localUsage.promptTokens += value?.promptTokens ?? 0;
            localUsage.completionTokens += value?.completionTokens ?? 0;
            localUsage.calls += 1;
          };
          const record = await processWord({
            word,
            provider,
            usage: local,
            templateIndex,
          });
          return {
            usage: localUsage,
            calls: localUsage.calls,
            result: {
              wordId: word.wordId,
              inputDataHash: inventory.inputDataHash,
              methodVersion: METHOD_VERSION,
              modelId: MODEL_ID,
              record,
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
