// scripts/lib/sense-inventory.mjs
// 三套私有数据流水线共享的确定性义项库存。
// 从当前真实 redbook.json + redbook-analysis.json 派生；senseKey 由当前真实
// splitWordSenses / splitMeaning 逻辑确定性生成，任何释义、词性或拆分变化都会失效。
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { splitMeaning } from "../../lib/study.ts";
import { splitSenseItems, splitWordSenses } from "../../lib/word-utils.ts";
import { buildSenseKey } from "../../lib/sense-datasets.ts";

export const WORK_ROOT = ".wordloop-data";
export const INVENTORY_PATH = `${WORK_ROOT}/inventory.json`;
export const CANONICAL_ALIASES = { 6177: 2506 };
export const SOURCE_TOTAL = 6550;
export const EXPECTED = {
  sourceEntries: 6550,
  primaryWords: 6549,
  senseTotal: 25340,
};

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** 稳定序列化：任何环境都字节一致（LF、无尾随空格、键顺序确定）。 */
export function stableJson(value) {
  return JSON.stringify(value);
}

/** 义项稳定键（与 lib/sense-datasets.ts 同实现）。 */
export { buildSenseKey };

/**
 * 按词性分段拆分义项，按 splitWordSenses 同规则跨词性去重（首个出现保留）。
 * 返回 [{ part, text }]，与运行时 splitWordSenses 扁平结果一一对应。
 */
export function senseItemsWithPart(word) {
  const parsed = splitMeaning(word.meaning);
  const segments = word.part
    ? [{ part: word.part, meaning: parsed.meaning }]
    : parsed.senses;
  const flattened = [];
  for (const segment of segments) {
    for (const text of splitSenseItems(segment.meaning)) {
      flattened.push({ part: segment.part, text });
    }
  }
  const seen = new Set();
  return flattened.filter((item) => {
    if (seen.has(item.text)) return false;
    seen.add(item.text);
    return true;
  });
}

export async function loadRedbookWords(redbookPath = "public/data/redbook.json") {
  const buffer = await readFile(redbookPath);
  const parsed = JSON.parse(buffer.toString("utf8"));
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.words)) {
    throw new Error("redbook.json 结构无效：缺少 words 数组");
  }
  return { words: parsed.words, bytes: buffer, hash: sha256(buffer) };
}

export async function loadAnalysis(analysisPath = "public/data/redbook-analysis.json") {
  const buffer = await readFile(analysisPath);
  const parsed = JSON.parse(buffer.toString("utf8"));
  return { parsed, bytes: buffer, hash: sha256(buffer) };
}

/**
 * 构建库存：主学习词 + 全部义项 + 稳定 senseKey + 输入身份哈希。
 * 返回 { words, senses, counts, inputDataHash, splitterHash }。
 */
export async function buildInventory({ root } = {}) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const projectRoot = root ?? repoRoot;
  const { words, hash: redbookHash } = await loadRedbookWords(
    path.join(projectRoot, "public", "data", "redbook.json"),
  );
  const { parsed: analysis, hash: analysisHash } = await loadAnalysis(
    path.join(projectRoot, "public", "data", "redbook-analysis.json"),
  );
  const [wordUtilsBytes, studyBytes] = await Promise.all([
    readFile(path.join(projectRoot, "lib", "word-utils.ts")),
    readFile(path.join(projectRoot, "lib", "study.ts")),
  ]);
  const splitterHash = sha256(Buffer.concat([wordUtilsBytes, studyBytes]));

  const primaryWords = [];
  const seenWordIds = new Set();
  const counts = {
    sourceEntries: words.length,
    primaryWords: 0,
    senseTotal: 0,
    monoSense: 0,
    polySense: 0,
    polySenseTotal: 0,
    over8: 0,
    maxSenses: 0,
    zeroSense: 0,
  };
  const wordIdToInventoryIndex = new Map();
  for (const word of words) {
    const wordId = Number(word.id);
    if (!Number.isSafeInteger(wordId) || seenWordIds.has(wordId)) {
      throw new Error(`词库存在重复或非法 id：${word.id}`);
    }
    seenWordIds.add(wordId);
    if (wordId in CANONICAL_ALIASES) continue; // alias 词条不产生主学习义项库存
    const items = senseItemsWithPart(word);
    // 库存义项文本必须与运行时 splitWordSenses 扁平结果逐字一致
    const runtimeSenses = splitWordSenses(word);
    if (JSON.stringify(items.map((item) => item.text)) !== JSON.stringify(runtimeSenses)) {
      throw new Error(`词 ${word.id} 库存义项与 splitWordSenses 不一致`);
    }
    if (!items.length) counts.zeroSense += 1;
    const relationRaw = analysis.entries?.[String(wordId)]?.relation;
    const senses = items.map((item, senseIndex) => ({
      senseIndex,
      part: item.part,
      text: item.text,
      senseKey: buildSenseKey(wordId, senseIndex, item.text),
    }));
    const entry = {
      wordId,
      word: String(word.word ?? "").trim(),
      part: typeof word.part === "string" ? word.part : undefined,
      meaning: String(word.meaning ?? "").trim(),
      section: word.section,
      unit: word.unit,
      root: typeof word.root === "string" ? word.root : undefined,
      relation: relationRaw
        ? {
            kind: relationRaw.kind,
            label: relationRaw.label,
            note: relationRaw.note,
            lemmaId: relationRaw.lemmaId,
            lemma: relationRaw.lemma,
            canonicalId: relationRaw.canonicalId,
            independent: relationRaw.independent === true,
            confidence: relationRaw.confidence,
          }
        : null,
      senses,
    };
    wordIdToInventoryIndex.set(wordId, primaryWords.length);
    primaryWords.push(entry);
    counts.primaryWords += 1;
    counts.senseTotal += senses.length;
    if (senses.length === 1) counts.monoSense += 1;
    else {
      counts.polySense += 1;
      counts.polySenseTotal += senses.length;
      if (senses.length > 8) counts.over8 += 1;
      if (senses.length > counts.maxSenses) counts.maxSenses = senses.length;
    }
  }
  if (counts.primaryWords !== EXPECTED.primaryWords) {
    throw new Error(
      `主学习词数量异常：${counts.primaryWords} != ${EXPECTED.primaryWords}`,
    );
  }
  if (counts.senseTotal !== EXPECTED.senseTotal) {
    throw new Error(`义项总数异常：${counts.senseTotal} != ${EXPECTED.senseTotal}`);
  }
  const senseKeys = new Set();
  for (const word of primaryWords) {
    for (const sense of word.senses) {
      if (senseKeys.has(sense.senseKey)) throw new Error(`senseKey 冲突：${sense.senseKey}`);
      senseKeys.add(sense.senseKey);
    }
  }
  const inputDataHash = sha256(
    `${redbookHash}\u0000${analysisHash}\u0000${splitterHash}`,
  );
  return {
    words: primaryWords,
    counts,
    inputDataHash,
    redbookHash,
    analysisHash,
    splitterHash,
    wordIdToInventoryIndex,
  };
}

/** 校验库存文件与当前真实输入一致（供 --check 与运行时校验使用）。 */
export async function verifyInventory(inventoryPath = INVENTORY_PATH, { root } = {}) {
  const current = await buildInventory({ root });
  const storedBuffer = await readFile(inventoryPath);
  const stored = JSON.parse(storedBuffer.toString("utf8"));
  if (stored.inputDataHash !== current.inputDataHash) {
    return { valid: false, reason: "输入数据哈希不一致（红宝书/词族/拆分器已变化）" };
  }
  if (stored.words?.length !== current.counts.primaryWords) {
    return { valid: false, reason: "库存词数不一致" };
  }
  for (let index = 0; index < current.words.length; index += 1) {
    const expected = current.words[index];
    const actual = stored.words?.[index];
    if (
      !actual
      || actual.wordId !== expected.wordId
      || actual.senses?.length !== expected.senses.length
    ) {
      return { valid: false, reason: `库存第 ${index} 词不一致` };
    }
    for (let senseIndex = 0; senseIndex < expected.senses.length; senseIndex += 1) {
      if (actual.senses[senseIndex].senseKey !== expected.senses[senseIndex].senseKey) {
        return { valid: false, reason: `词 ${expected.wordId} 义项 ${senseIndex} senseKey 不一致` };
      }
    }
  }
  return { valid: true, reason: "库存与当前输入一致", current };
}

/** 可序列化的轻量库存（数据集运行时校验用；不含整套中文释义）。 */
export function compactInventory(inventory) {
  return {
    schemaVersion: 1,
    inputDataHash: inventory.inputDataHash,
    redbookHash: inventory.redbookHash,
    analysisHash: inventory.analysisHash,
    splitterHash: inventory.splitterHash,
    counts: inventory.counts,
    words: inventory.words.map((word) => ({
      wordId: word.wordId,
      word: word.word,
      senseKeys: word.senses.map((sense) => sense.senseKey),
    })),
  };
}
