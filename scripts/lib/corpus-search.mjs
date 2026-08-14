// scripts/lib/corpus-search.mjs
// 义项考频流水线的确定性语料检索：复用 build-kaoyan-examples.mjs 的句子级
// 解析（reading/new-type/translation 三段），按 lemma/词形匹配目标词，
// 产出带私有指针（paperId/年份/卷型/小节/上下文哈希）的上下文出现索引。
// 不保存真题原文到任何 tracked 文件；上下文仅进入私有工作目录。
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  extractPaperSentences,
  normalizeLf,
  validateCorpusInput,
} from "../build-kaoyan-examples.mjs";
import { sha256 } from "./dataset-shards.mjs";

export const MAX_CONTEXTS_PER_WORD = 12;

const ENGLISH_TOKEN = /[A-Za-z]+(?:['’\-‐‑‒–—][A-Za-z]+)*/g;

/** 考研常见不规则动词（与 lib/sentence-index.ts 冻结一致）。 */
const LEMMA_OVERRIDES = {
  went: "go", gone: "go", bought: "buy", thought: "think", took: "take",
  taken: "take", saw: "see", seen: "see", made: "make", came: "come",
  gave: "give", given: "give", found: "find", knew: "know", known: "know",
  spoke: "speak", spoken: "speak", wrote: "write", written: "write",
  drove: "drive", driven: "drive", ran: "run", ate: "eat", eaten: "eat",
  felt: "feel", lost: "lose", built: "build",
};

/** 简单词形还原候选（与 lib/sentence-index.ts 同规则）。 */
export function inflections(token) {
  const candidates = [token];
  const override = LEMMA_OVERRIDES[token];
  if (override) candidates.push(override);
  if (token.endsWith("'s")) candidates.push(token.slice(0, -2));
  if (token.endsWith("ies")) candidates.push(token.slice(0, -3) + "y");
  if (token.endsWith("ied")) candidates.push(token.slice(0, -3) + "y");
  if (token.endsWith("es")) candidates.push(token.slice(0, -2));
  if (token.endsWith("ing")) {
    candidates.push(token.slice(0, -3));
    candidates.push(token.slice(0, -3) + "e");
  }
  if (token.endsWith("ed")) {
    candidates.push(token.slice(0, -2));
    candidates.push(token.slice(0, -1));
  }
  if (token.endsWith("s")) candidates.push(token.slice(0, -1));
  return candidates;
}

/** 目标词的正向屈折展开（原词 → 常见规则/不规则形态）。 */
export function forwardForms(word) {
  const normalized = String(word).trim().toLowerCase();
  const forms = new Set([normalized]);
  if (/^[a-z]+$/.test(normalized)) {
    forms.add(`${normalized}s`);
    if (normalized.endsWith("e")) {
      forms.add(`${normalized}d`);
      forms.add(`${normalized.slice(0, -1)}ing`);
    } else {
      forms.add(`${normalized}ed`);
      forms.add(`${normalized}ing`);
    }
    if (/[sxz]$/.test(normalized) || /(?:ch|sh|o)$/.test(normalized)) {
      forms.add(`${normalized}es`);
    }
    if (/[^aeiou]y$/.test(normalized)) {
      forms.add(`${normalized.slice(0, -1)}ies`);
      forms.add(`${normalized.slice(0, -1)}ied`);
    }
    for (const [inflected, base] of Object.entries(LEMMA_OVERRIDES)) {
      if (base === normalized) forms.add(inflected);
    }
  }
  return [...forms];
}

/** 语料 token 是否命中目标词（正向展开 + 反向还原双向匹配）。 */
export function tokenMatchesWord(token, word) {
  const lower = token.toLowerCase();
  if (lower === word) return true;
  return inflections(lower).includes(word) || forwardForms(word).includes(lower);
}

export function paperIdentity(paperId) {
  const old = /^(199[8-9]|200[0-9])$/.exec(paperId);
  if (old) return { year: Number(old[1]), paperType: "old" };
  const current = /^(20(?:1[0-9]|2[0-6]))-english-(one|two)$/.exec(paperId);
  if (!current) return undefined;
  return {
    year: Number(current[1]),
    paperType: `english-${current[2]}`,
  };
}

/** 加载全部试卷的 reading/new-type/translation 句子（确定性，46 套）。 */
export async function loadPaperSentences(corpusDir) {
  const manifest = JSON.parse(
    await readFile(path.join(corpusDir, "manifest.json"), "utf8"),
  );
  if (manifest.source !== "https://english-exam.lazynote.cn/kaoyan/") {
    throw new Error("语料 manifest source 与登记来源不符");
  }
  const papers = [];
  for (const paper of manifest.papers) {
    const identity = paperIdentity(paper.id);
    if (!identity) throw new Error(`试卷 id 身份无效：${paper.id}`);
    const body = normalizeLf(
      await readFile(path.join(corpusDir, "papers", `${paper.id}.md`), "utf8"),
    );
    const sentences = extractPaperSentences(body);
    papers.push({
      paperId: paper.id,
      ...identity,
      sentences: sentences.map((item) => ({
        section: item.section,
        sentence: item.sentence,
      })),
    });
  }
  return papers;
}

function sentenceTokens(sentence) {
  return sentence.match(ENGLISH_TOKEN) ?? [];
}

/** 目标词的匹配词形集合：正向屈折展开 + 不规则形态回推。 */
export function matchForms(word) {
  const normalized = String(word).trim().toLowerCase();
  const forms = new Set(forwardForms(normalized));
  for (const [inflected, base] of Object.entries(LEMMA_OVERRIDES)) {
    if (base === normalized) forms.add(inflected);
  }
  return forms;
}

function countTokenOccurrences(sentence, token) {
  const pattern = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(?<![A-Za-z0-9'’\\-])${pattern}(?![A-Za-z0-9'’\\-])`, "gi");
  return (sentence.match(regex) ?? []).length;
}

/**
 * 构建全库词形出现索引（私有）：wordId → 上下文列表。
 * 使用词形倒排索引避免全量嵌套扫描；每词最多保留 MAX_CONTEXTS_PER_WORD
 * 个上下文（显式安全上限），totalOccurrences 记录完整数量。
 */
export async function buildOccurrenceIndex({ corpusDir, inventory, outPath }) {
  await validateCorpusInput(corpusDir);
  const papers = await loadPaperSentences(corpusDir);

  const inverted = new Map();
  for (const paper of papers) {
    for (const item of paper.sentences) {
      const seen = new Set();
      for (const token of sentenceTokens(item.sentence)) {
        const lower = token.toLowerCase();
        if (seen.has(lower)) continue;
        seen.add(lower);
        const list = inverted.get(lower) ?? [];
        list.push({ paper, item });
        inverted.set(lower, list);
      }
    }
  }

  const index = {
    inputDataHash: inventory.inputDataHash,
    corpusVersion: "46-papers-1998-2026",
    paperCount: papers.length,
    byWordId: {},
    totals: { wordsWithOccurrences: 0, totalOccurrences: 0 },
  };
  let totalOccurrences = 0;
  for (const word of inventory.words) {
    const forms = matchForms(word.word);
    if (!forms.size) continue;
    const hits = new Map();
    let count = 0;
    for (const form of forms) {
      for (const { paper, item } of inverted.get(form) ?? []) {
        count += countTokenOccurrences(item.sentence, form);
        const key = `${paper.paperId}\u0000${item.section}\u0000${item.sentence}`;
        const hit = hits.get(key);
        if (hit) hit.matchedForms.add(form);
        else hits.set(key, { paper, item, matchedForms: new Set([form]) });
      }
    }
    if (count > 0) {
      const contexts = [...hits.values()].slice(0, MAX_CONTEXTS_PER_WORD).map((hit) => ({
        paperId: hit.paper.paperId,
        year: hit.paper.year,
        paperType: hit.paper.paperType,
        section: hit.item.section,
        contextHash: sha256(
          `${hit.paper.paperId}\u0000${hit.item.section}\u0000${hit.item.sentence}`,
        ).slice(0, 16),
        matchedForms: [...hit.matchedForms],
        context: hit.item.sentence,
      }));
      index.byWordId[word.wordId] = {
        wordId: word.wordId,
        word: word.word,
        totalOccurrences: count,
        contexts,
      };
      index.totals.wordsWithOccurrences += 1;
      totalOccurrences += count;
    }
  }
  index.totals.totalOccurrences = totalOccurrences;
  if (outPath) {
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(index)}\n`, "utf8");
  }
  return index;
}
