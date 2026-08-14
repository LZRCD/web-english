// scripts/lib/example-quality.mjs
// 释义例句的确定性质检：词形命中、结构合法性、长度、模板检测、
// 同词义项串义近似检测与全库/真题近似重复检测。冻结为方法版本的一部分。
import { tokenMatchesWord } from "./corpus-search.mjs";

export const MIN_SENTENCE_TOKENS = 8;
export const MAX_SENTENCE_TOKENS = 40;
export const MAX_SENTENCE_LENGTH = 500;
export const MAX_TRANSLATION_LENGTH = 300;
export const NEAR_DUP_NGRAM = 5;
export const NEAR_DUP_OVERLAP = 0.6;

const ENGLISH_TOKEN = /[A-Za-z]+(?:['’\-‐‑‒–—][A-Za-z]+)*/g;

export function sentenceTokens(sentence) {
  return sentence.match(ENGLISH_TOKEN) ?? [];
}

export function normalizeForCompare(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 检查英文句是否包含目标词或其合法屈折形式（真词形匹配，非子串）。 */
export function sentenceContainsWord(sentence, word) {
  const normalized = String(word).trim().toLowerCase();
  if (!normalized || !/^[a-z]+(?:['-][a-z]+)*$/.test(normalized)) {
    // 短语词条：空白/连字符归一后的表面匹配
    const pattern = normalized
      .replace(/[-‐‑‒–—]/g, "[-‐‑‒–—]")
      .replace(/\s+/g, "\\s+")
      .replace(/['’]/g, "['’]");
    const regex = new RegExp(`(?<![a-z0-9'’\\-])${pattern}(?![a-z0-9'’\\-])`, "i");
    return regex.test(sentence);
  }
  return sentenceTokens(sentence).some((token) =>
    tokenMatchesWord(token, normalized));
}

export function checkSentenceStructure(sentence, translation) {
  const reasons = [];
  if (typeof sentence !== "string" || !sentence.trim()) {
    reasons.push("empty_sentence");
    return reasons;
  }
  if (typeof translation !== "string" || !translation.trim()) {
    reasons.push("empty_translation");
  }
  if (translation === sentence) reasons.push("translation_equals_sentence");
  const tokens = sentenceTokens(sentence);
  if (tokens.length < MIN_SENTENCE_TOKENS) reasons.push("too_few_tokens");
  if (tokens.length > MAX_SENTENCE_TOKENS) reasons.push("too_many_tokens");
  if (sentence.length > MAX_SENTENCE_LENGTH) reasons.push("sentence_too_long");
  if (translation.length > MAX_TRANSLATION_LENGTH) reasons.push("translation_too_long");
  if (!/[.!?]["'”’)\]}]*$/.test(sentence)) reasons.push("missing_terminal_punctuation");
  if (/\〔[^〕]*\〕|_{2,}|＿{2,}|\.{4,}|```|~~~/.test(sentence)) {
    reasons.push("placeholder_or_markup");
  }
  if (/<\/?[A-Za-z][^>]*>/.test(sentence)) reasons.push("html");
  if (/\[\s*[A-H]\s*\]|TODO|TBD|PLACEHOLDER|\[图片/i.test(sentence)) {
    reasons.push("template_marker");
  }
  const firstLetter = sentence.match(/[A-Za-z]/)?.[0];
  if (firstLetter && firstLetter !== firstLetter.toUpperCase()) {
    reasons.push("not_capitalized");
  }
  // 元语言模板
  if (/^the\s+word\b|\bthe\s+word\s+[\w'-]+\s+means\b|\bmeans\s+that\b|\bmeans\s*[“"']|\bis\s+defined\s+as\b|\bthis\s+word\b/i.test(sentence)) {
    reasons.push("meta_language_template");
  }
  return reasons;
}

export function ngrams(tokens, size) {
  const grams = [];
  for (let index = 0; index + size <= tokens.length; index += 1) {
    grams.push(tokens.slice(index, index + size).join(" "));
  }
  return grams;
}

/** 与参考句的近似重复检测：返回 { nearDuplicate, overlap }。 */
export function nearDuplicateRatio(candidate, reference) {
  const candidateTokens = normalizeForCompare(candidate).split(" ");
  const referenceTokens = normalizeForCompare(reference).split(" ");
  if (
    candidateTokens.length < NEAR_DUP_NGRAM
    || referenceTokens.length < NEAR_DUP_NGRAM
  ) {
    return { nearDuplicate: false, overlap: 0 };
  }
  const candidateGrams = new Set(ngrams(candidateTokens, NEAR_DUP_NGRAM));
  const referenceGrams = new Set(ngrams(referenceTokens, NEAR_DUP_NGRAM));
  if (!candidateGrams.size || !referenceGrams.size) {
    return { nearDuplicate: false, overlap: 0 };
  }
  let shared = 0;
  for (const gram of candidateGrams) {
    if (referenceGrams.has(gram)) shared += 1;
  }
  const union = candidateGrams.size + referenceGrams.size - shared;
  const overlap = shared / union;
  return { nearDuplicate: overlap >= NEAR_DUP_OVERLAP, overlap };
}

/**
 * 全库参考句倒排索引：把大量参考句按 5-gram 索引，供增量查重。
 */
export function createDedupeIndex(references = []) {
  const gramToRefs = new Map();
  const normalizedRefs = [];
  for (const reference of references) {
    const normalized = normalizeForCompare(reference);
    if (!normalized) continue;
    const tokens = normalized.split(" ");
    if (tokens.length < NEAR_DUP_NGRAM) continue;
    const grams = new Set(ngrams(tokens, NEAR_DUP_NGRAM));
    const refIndex = normalizedRefs.length;
    normalizedRefs.push({ normalized, tokens, grams });
    for (const gram of grams) {
      const list = gramToRefs.get(gram) ?? [];
      list.push(refIndex);
      gramToRefs.set(gram, list);
    }
  }
  const findNearDuplicate = (candidate) => {
    const normalized = normalizeForCompare(candidate);
    const tokens = normalized.split(" ");
    if (tokens.length < NEAR_DUP_NGRAM) return { nearDuplicate: false, overlap: 0 };
    const grams = ngrams(tokens, NEAR_DUP_NGRAM);
    const candidates = new Set();
    for (const gram of grams) {
      for (const refIndex of gramToRefs.get(gram) ?? []) candidates.add(refIndex);
    }
    let worst = { nearDuplicate: false, overlap: 0 };
    for (const refIndex of candidates) {
      const reference = normalizedRefs[refIndex];
      let shared = 0;
      for (const gram of grams) {
        if (reference.grams.has(gram)) shared += 1;
      }
      const union = grams.length + reference.grams.size - shared;
      const overlap = shared / union;
      if (overlap > worst.overlap) worst = { nearDuplicate: overlap >= NEAR_DUP_OVERLAP, overlap };
      if (worst.nearDuplicate) break;
    }
    return worst;
  };
  const add = (reference) => {
    const normalized = normalizeForCompare(reference);
    if (!normalized) return;
    const tokens = normalized.split(" ");
    if (tokens.length < NEAR_DUP_NGRAM) return;
    const grams = new Set(ngrams(tokens, NEAR_DUP_NGRAM));
    const refIndex = normalizedRefs.length;
    normalizedRefs.push({ normalized, tokens, grams });
    for (const gram of grams) {
      const list = gramToRefs.get(gram) ?? [];
      list.push(refIndex);
      gramToRefs.set(gram, list);
    }
  };
  return { findNearDuplicate, add, size: () => normalizedRefs.length };
}
