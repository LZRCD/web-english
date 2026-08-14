// lib/sense-datasets.ts
// 三套私有预生成数据集的共享 schema、稳定键与校验函数。
// 生成器（node strip-types）与运行时（浏览器）共用同一实现，
// 保证 senseKey / inputKey 在任何环境字节一致。
import { splitWordSenses } from "./word-utils.ts";
import type { Word } from "./study.ts";

export const SENSE_DATASET_SCHEMA_VERSION = 1 as const;

/** FNV-1a 32 位（与 word-utils.seededScore 同族，同步、跨环境稳定）。 */
export function fnv1a32(value: string, seed = 0x811c9dc5) {
  let hash = seed | 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

/** 义项稳定键：wordId + senseIndex + 完整义项文本（当前真实输入确定）。 */
export function buildSenseKey(wordId: number, senseIndex: number, text: string) {
  return `${wordId}:${senseIndex}:${fnv1a32(text).toString(36)}`;
}

export type SenseIdentity = {
  senseIndex: number;
  text: string;
  senseKey: string;
};

/** 与展示完全一致的义项列表（splitWordSenses 扁平去重结果）。 */
export function senseIdentitiesForWord(word: Pick<Word, "meaning" | "part">, wordId: number): SenseIdentity[] {
  return splitWordSenses(word).map((text, senseIndex) => ({
    senseIndex,
    text,
    senseKey: buildSenseKey(wordId, senseIndex, text),
  }));
}

/** 词级输入身份：任何释义/拆分/版本变化都会改变。 */
export function buildWordDatasetInputKey(input: {
  dataset: string;
  schemaVersion: number;
  promptVersion: string;
  wordId: number;
  senses: string[];
}) {
  return JSON.stringify({
    dataset: input.dataset,
    schemaVersion: input.schemaVersion,
    promptVersion: input.promptVersion,
    wordId: input.wordId,
    senses: input.senses,
  });
}

// ---- 义项考频数据集 ----

export type SenseFrequencyDatasetLevel = "high" | "medium" | "low";

export type SenseFrequencyEvidence = {
  paperId: string;
  year: number;
  paperType: "old" | "english-one" | "english-two";
  section: "reading" | "new-type" | "translation";
  contextHash: string;
};

export type SenseFrequencyDatasetEntry = {
  wordId: number;
  senseIndex: number;
  senseKey: string;
  level: SenseFrequencyDatasetLevel | null;
  basis: "corpus_supported" | "model_consensus" | "needs_review";
  confidence: number | null;
  paperCount: number;
  occurrenceCount: number;
  years: number[];
  paperTypes: string[];
  evidence: SenseFrequencyEvidence[];
  methodVersion: string;
  modelId: string;
  humanReviewed: false;
  reasonCodes: string[];
  note: string;
};

// ---- 释义例句数据集 ----

export type SenseExampleDatasetEntry = {
  wordId: number;
  senseIndex: number;
  senseKey: string;
  sentence: string;
  translation: string;
  source: "ai_original";
  generationConfidence: number;
  reviewStatus: "model_passed" | "needs_review";
  reviewConfidence: number | null;
  reasonCodes: string[];
  inputKey: string;
  promptVersion: string;
  modelId: string;
  humanReviewed: false;
  generatedAt: string;
};

// ---- 词根拆解与助记数据集 ----

export type EtymologyDatasetMode =
  | "verified_morphology"
  | "surface_form"
  | "mnemonic_only"
  | "needs_review";

export type EtymologyDatasetAffix = {
  form: string;
  kind: "prefix" | "root" | "suffix" | "other";
  meaning: string;
};

export type EtymologyDatasetEntry = {
  wordId: number;
  inputKey: string;
  mode: EtymologyDatasetMode;
  breakdown: string;
  root: string | null;
  affixes: EtymologyDatasetAffix[];
  mnemonic: string;
  reasonCodes: string[];
  promptVersion: string;
  modelId: string;
  humanReviewed: false;
  generatedAt: string;
};

export function buildEtymologyDatasetInputKey(input: {
  schemaVersion: number;
  promptVersion: string;
  wordId: number;
  word: string;
  meaning: string;
  root: string;
  relation: unknown | null;
}) {
  return JSON.stringify({
    dataset: "etymology",
    schemaVersion: input.schemaVersion,
    promptVersion: input.promptVersion,
    wordId: input.wordId,
    word: input.word,
    meaning: input.meaning,
    root: input.root,
    relation: input.relation,
  });
}

export const VALID_SENSE_LEVELS = new Set(["high", "medium", "low"]);
export const VALID_BASIS = new Set(["corpus_supported", "model_consensus", "needs_review"]);
export const VALID_REVIEW_STATUS = new Set(["model_passed", "needs_review"]);
export const VALID_ETYMOLOGY_MODES = new Set([
  "verified_morphology",
  "surface_form",
  "mnemonic_only",
  "needs_review",
]);

function isNonEmptyString(value: unknown, max = Number.MAX_SAFE_INTEGER): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function isSafeCount(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

/** 校验义项考频条目字段（不验证 senseKey，由加载方对照库存校验）。 */
export function isValidSenseFrequencyEntry(value: unknown): value is SenseFrequencyDatasetEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (
    !isSafeCount(item.wordId)
    || !isSafeCount(item.senseIndex)
    || !isNonEmptyString(item.senseKey, 80)
    || !(item.level === null || VALID_SENSE_LEVELS.has(item.level as string))
    || !VALID_BASIS.has(item.basis as string)
    || !(item.confidence === null
      || (typeof item.confidence === "number" && item.confidence >= 0 && item.confidence <= 1))
    || !isSafeCount(item.paperCount)
    || !isSafeCount(item.occurrenceCount)
    || !Array.isArray(item.years) || item.years.some((year) => !isSafeCount(year))
    || !Array.isArray(item.paperTypes)
    || !Array.isArray(item.evidence)
    || item.humanReviewed !== false
    || !Array.isArray(item.reasonCodes)
    || !isNonEmptyString(item.note, 200)
  ) {
    return false;
  }
  if (item.level !== null && item.basis === "needs_review") return false;
  if (item.basis === "corpus_supported" && item.level === null) return false;
  if (item.basis === "corpus_supported" && item.evidence.length === 0) return false;
  return true;
}

export function isValidSenseExampleEntry(value: unknown): value is SenseExampleDatasetEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (
    !isSafeCount(item.wordId)
    || !isSafeCount(item.senseIndex)
    || !isNonEmptyString(item.senseKey, 80)
    || !isNonEmptyString(item.sentence, 500)
    || !isNonEmptyString(item.translation, 300)
    || item.source !== "ai_original"
    || !(typeof item.generationConfidence === "number"
      && item.generationConfidence >= 0 && item.generationConfidence <= 1)
    || !VALID_REVIEW_STATUS.has(item.reviewStatus as string)
    || !(item.reviewConfidence === null
      || (typeof item.reviewConfidence === "number"
        && item.reviewConfidence >= 0 && item.reviewConfidence <= 1))
    || !Array.isArray(item.reasonCodes)
    || !isNonEmptyString(item.inputKey, 20_000)
    || !isNonEmptyString(item.promptVersion, 80)
    || !isNonEmptyString(item.modelId, 80)
    || item.humanReviewed !== false
    || !isNonEmptyString(item.generatedAt, 80)
  ) {
    return false;
  }
  if (item.reviewStatus === "model_passed" && item.reviewConfidence === null) return false;
  return true;
}

export function isValidEtymologyDatasetEntry(value: unknown): value is EtymologyDatasetEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (
    !isSafeCount(item.wordId)
    || !isNonEmptyString(item.inputKey, 20_000)
    || !VALID_ETYMOLOGY_MODES.has(item.mode as string)
    || !isNonEmptyString(item.breakdown, 320)
    || !(item.root === null || isNonEmptyString(item.root, 120))
    || !isNonEmptyString(item.mnemonic, 500)
    || !Array.isArray(item.affixes)
    || !Array.isArray(item.reasonCodes)
    || !isNonEmptyString(item.promptVersion, 80)
    || !isNonEmptyString(item.modelId, 80)
    || item.humanReviewed !== false
    || !isNonEmptyString(item.generatedAt, 80)
  ) {
    return false;
  }
  if (item.mode === "verified_morphology" && (item.root === null || item.affixes.length === 0)) {
    return false;
  }
  return true;
}
