import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vocabularyFile = path.join(projectRoot, "public", "data", "redbook.json");
const analysisFile = path.join(projectRoot, "public", "data", "redbook-analysis.json");
const reportFile = path.join(projectRoot, "docs", "redbook-audit.md");

const sourceCorrections = {
  2506: {
    extractedWord: "passerby",
    word: "passersby",
    evidence: "高清正文印刷页 244（PDF 第 251 页）：passersby，复数形式",
  },
  6177: {
    extractedWord: "passerby",
    word: "passer-by",
    evidence: "高清正文印刷页 415（PDF 第 422 页）：passer-by，连字符拼写",
  },
};

const grammarRelations = new Set([68, 686, 2181, 2225, 6412]);
const lexicalizedRelations = new Set([396, 631, 1196, 3456, 3457]);
const pronounRelations = new Set([5447, 5534]);
const excludedFalseRelations = new Set([4835, 5122]);
const preferredLemmaIds = {
  247: 248,
  3456: 3454,
  3457: 3454,
  5404: 5403,
};

function normalizeWord(value) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function partOfSpeech(meaning) {
  return meaning.match(/^((?:(?:adj|adv|n|v|vi|vt|prep|conj|pron|num|aux|modal)\.\s*)+)/i)?.[1].trim()
    ?? "未标注";
}

function possibleBases(value) {
  const result = new Set();
  const word = value.toLowerCase();
  if (word.endsWith("ies") && word.length > 4) result.add(`${word.slice(0, -3)}y`);
  if (word.endsWith("ied") && word.length > 4) result.add(`${word.slice(0, -3)}y`);
  if (word.endsWith("ing") && word.length > 5) {
    const stem = word.slice(0, -3);
    result.add(stem);
    result.add(`${stem}e`);
    if (stem.length > 2 && stem.at(-1) === stem.at(-2)) result.add(stem.slice(0, -1));
  }
  if (word.endsWith("ed") && word.length > 4) {
    const stem = word.slice(0, -2);
    result.add(stem);
    result.add(word.slice(0, -1));
    if (stem.length > 2 && stem.at(-1) === stem.at(-2)) result.add(stem.slice(0, -1));
  }
  if (word.endsWith("es") && word.length > 4) {
    result.add(word.slice(0, -2));
    result.add(word.slice(0, -1));
  }
  if (word.endsWith("s") && !word.endsWith("ss") && word.length > 4) {
    result.add(word.slice(0, -1));
  }
  return [...result];
}

function broaderRelationCandidates(words, byNormalizedWord) {
  const prefixes = [
    "anti", "counter", "inter", "under", "over", "super", "trans",
    "dis", "mis", "non", "pre", "post", "sub", "un", "re",
  ];
  const suffixRules = [
    ["ness", ""],
    ["less", ""],
    ["ful", ""],
    ["ment", ""],
    ["ship", ""],
    ["hood", ""],
    ["ism", ""],
    ["ist", ""],
    ["ly", ""],
    ["er", ""],
  ];
  const candidates = new Map();

  function addCandidate(word, baseWord, rule) {
    const key = `${word.id}:${baseWord.id}`;
    const current = candidates.get(key);
    candidates.set(key, {
      wordId: word.id,
      word: word.word,
      baseId: baseWord.id,
      base: baseWord.word,
      rules: [...new Set([...(current?.rules ?? []), rule])],
      decision: "audit-only",
    });
  }

  for (const word of words) {
    const normalized = normalizeWord(word.word);
    for (const prefix of prefixes) {
      const base = normalized.startsWith(prefix) ? normalized.slice(prefix.length) : "";
      if (base.length > 2 && byNormalizedWord.has(base)) {
        addCandidate(word, byNormalizedWord.get(base), `prefix:${prefix}`);
      }
    }
    for (const [suffix, replacement] of suffixRules) {
      if (!normalized.endsWith(suffix) || normalized.length <= suffix.length + 2) continue;
      const base = `${normalized.slice(0, -suffix.length)}${replacement}`;
      if (byNormalizedWord.has(base)) {
        addCandidate(word, byNormalizedWord.get(base), `suffix:${suffix}`);
      }
    }
  }
  return [...candidates.values()].sort((first, second) => first.wordId - second.wordId);
}

function relationCopy(item, lemma) {
  const part = partOfSpeech(item.meaning);
  if (item.id === 68) {
    return {
      kind: "grammar",
      label: "provide → provided · 独立连词用法",
      note: "红宝书明确标为 conj.，同义词为 if；不是普通过去式。",
    };
  }
  if (item.id === 5404) {
    return {
      kind: "contrast",
      label: "易混词 · sometime / sometimes",
      note: "sometimes 表示“有时”，与 sometime“某时”分开记忆。",
    };
  }
  if (grammarRelations.has(item.id)) {
    return {
      kind: "grammar",
      label: `${lemma.word} → ${item.word} · 独立语法用法`,
      note: `红宝书作为独立 ${part} 词条收录，单独安排复习。`,
    };
  }
  if (lexicalizedRelations.has(item.id)) {
    return {
      kind: "lexicalized",
      label: `${item.word} · 词义已固化`,
      note: `与 ${lemma.word} 保留词形关联，但已有独立含义和复习进度。`,
    };
  }
  if (pronounRelations.has(item.id)) {
    return {
      kind: "pronoun",
      label: `${lemma.word} → ${item.word} · 独立代词形式`,
      note: "词性和句法功能独立，保留为单独学习项。",
    };
  }
  return {
    kind: "derived",
    label: `${lemma.word} → ${item.word} · 派生词`,
    note: `红宝书以独立 ${part} 词条收录，关联词族但不合并掌握度。`,
  };
}

const data = JSON.parse(readFileSync(vocabularyFile, "utf8"));
if (!Array.isArray(data.words) || data.words.length !== 6550) {
  throw new Error(`词库数量异常：${data.words?.length ?? 0}，预期 6550`);
}

const originalWords = new Map(data.words.map((word) => [word.id, word.word]));
const words = data.words.map((word) => {
  const correction = sourceCorrections[word.id];
  return correction ? { ...word, word: correction.word } : word;
});
const byLowerWord = new Map(words.map((word) => [word.word.toLowerCase(), word]));
const byNormalizedWord = new Map(words.map((word) => [normalizeWord(word.word), word]));
const byId = new Map(words.map((word) => [word.id, word]));
const entries = {};
let morphologicalCandidates = 0;

for (const item of words) {
  const bases = possibleBases(item.word)
    .map((base) => byLowerWord.get(base))
    .filter(Boolean);
  if (!bases.length) continue;
  morphologicalCandidates += 1;
  if (excludedFalseRelations.has(item.id)) continue;
  const preferredLemma = byId.get(preferredLemmaIds[item.id]);
  const lemma = preferredLemma ?? bases[0];
  const copy = relationCopy(item, lemma);
  entries[item.id] = {
    relation: {
      ...copy,
      lemmaId: lemma.id,
      lemma: lemma.word,
      canonicalId: item.id,
      independent: true,
      confidence: "confirmed",
    },
  };
}

entries[2506] = {
  correctedWord: "passersby",
  relation: {
    kind: "inflection",
    label: "passerby → passersby · 特殊复数",
    note: "复数加在核心词 passer 上；同组展示连字符变体 passer-by。",
    lemma: "passerby",
    canonicalId: 2506,
    independent: true,
    confidence: "source-confirmed",
  },
  evidence: sourceCorrections[2506].evidence,
};
entries[6177] = {
  correctedWord: "passer-by",
  relation: {
    kind: "variant",
    label: "passer-by · 连字符变体",
    note: "与 passerby / passersby 共用学习项，不重复进入每日新词。",
    lemmaId: 2506,
    lemma: "passerby",
    canonicalId: 2506,
    independent: false,
    confidence: "source-confirmed",
  },
  evidence: sourceCorrections[6177].evidence,
};

const normalizedGroups = new Map();
for (const word of words) {
  const key = normalizeWord(word.word);
  normalizedGroups.set(key, [...(normalizedGroups.get(key) ?? []), word]);
}
const homographs = [...normalizedGroups.values()]
  .filter((group) => group.length > 1)
  .map((group) => ({
    normalized: normalizeWord(group[0].word),
    entries: group.map((word) => ({
      id: word.id,
      word: word.word,
      meaning: word.meaning,
    })),
  }))
  .filter((group) => !group.entries.some((entry) => [2506, 6177].includes(entry.id)));

const learningItemCount = new Set(
  words.map((word) => word.id === 6177 ? 2506 : word.id),
).size;
const broaderCandidates = broaderRelationCandidates(words, byNormalizedWord);

const analysis = {
  metadata: {
    version: 1,
    sourceTitle: data.metadata.title,
    auditedEntries: words.length,
    learningItemCount,
    confirmedRelations: Object.keys(entries).length,
    morphologicalCandidates,
    broaderRelationCandidates: broaderCandidates.length,
    sourceCorrections: Object.keys(sourceCorrections).length,
    unresolvedConfirmedSourceConflicts: 0,
    sourceComparisonScope: "全量扫描 6550 个词条；对规则候选、同形词及资料冲突项逐项复核",
    sourcePriority: [
      "高清正文",
      "正序英文词表",
      "正序中文词表",
      "自动词形分析",
    ],
  },
  entries,
  audit: {
    sourceCorrections: Object.entries(sourceCorrections).map(([id, correction]) => ({
      id: Number(id),
      extractedWord: correction.extractedWord ?? originalWords.get(Number(id)),
      correctedWord: correction.word,
      evidence: correction.evidence,
    })),
    homographs,
    excludedFalseRelations: [
      { id: 4835, word: "pants", reason: "与动词 pant 仅为表面拼写相似，不建立词族关系" },
      { id: 5122, word: "evening", reason: "与 even 仅为表面拼写相似，不建立词族关系" },
    ],
    broaderCandidates,
  },
};

data.words = words;
data.metadata = {
  ...data.metadata,
  auditVersion: analysis.metadata.version,
  learningItemCount,
};

mkdirSync(path.dirname(analysisFile), { recursive: true });
mkdirSync(path.dirname(reportFile), { recursive: true });
writeFileSync(vocabularyFile, `${JSON.stringify(data, null, 2)}\n`, "utf8");
writeFileSync(analysisFile, `${JSON.stringify(analysis, null, 2)}\n`, "utf8");

const correctionRows = analysis.audit.sourceCorrections
  .map((item) => `| ${item.id} | ${item.extractedWord} | ${item.correctedWord} | ${item.evidence} |`)
  .join("\n");
const homographRows = homographs
  .map((group) => `| ${group.normalized} | ${group.entries.map((item) => `${item.id}: ${item.word}`).join("；")} | 保留独立词义 |`)
  .join("\n");

writeFileSync(reportFile, `# 红宝书 6550 词全量审计

## 结论

- 已扫描原书词条：${words.length}
- 实际独立学习项：${learningItemCount}
- 已确认词形/词族关系：${analysis.metadata.confirmedRelations}
- 规则变形候选：${morphologicalCandidates}
- 更广泛派生候选：${broaderCandidates.length}（逐条保存在分析 JSON，仅用于审计，不自动影响学习进度）
- 高清正文确认的资料修正：${analysis.metadata.sourceCorrections}
- 已确认冲突中未解决项：${analysis.metadata.unresolvedConfirmedSourceConflicts}

审计范围：${analysis.metadata.sourceComparisonScope}。

## 来源优先级

高清正文 > 正序英文词表 > 正序中文词表 > 自动词形分析。

## 高清正文修正

| 编号 | 配套词表 | 高清正文 | 依据 |
|---:|---|---|---|
${correctionRows}

## 同形词

| 归一化拼写 | 原书词条 | 处理 |
|---|---|---|
${homographRows || "| - | 未发现 | - |"}

## 防误判

- pants 不与 pant 建立词族关系。
- evening 不与 even 建立词族关系。
- 自动后缀和前缀规则只负责发现候选，不负责合并学习项。
- provided、means、goods 等具有独立词性或固定含义的词保留独立进度。
`, "utf8");

console.log(`已审计 ${words.length} 个原书词条`);
console.log(`已生成 ${learningItemCount} 个独立学习项`);
console.log(`已确认 ${analysis.metadata.confirmedRelations} 条词形/词族关系`);
console.log(`审计报告：${reportFile}`);
