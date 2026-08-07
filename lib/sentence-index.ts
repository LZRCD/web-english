import type { WordEnrichment } from "./learning.ts";
import type { LookupStats, LookupWord, Word } from "./study.ts";

/** 一条可复用的已见例句：句子、翻译与来源词 */
export type ReusedSentence = {
  sentence: string;
  translation?: string;
  /** 例句来源词（生成/原句所属的词） */
  sourceWord: string;
  sourceId?: number;
};

/** 例句反向索引：小写词形 → 包含它的已见例句列表 */
export type SentenceIndex = Map<string, ReusedSentence[]>;

const STOP_WORDS = new Set([
  "a", "an", "the", "of", "to", "in", "on", "at", "for", "with",
  "and", "or", "but", "by", "from", "as", "is", "are", "was", "were",
  "be", "been", "being", "it", "its", "this", "that", "these", "those",
  "i", "you", "he", "she", "we", "they", "my", "your", "his", "her",
  "our", "their", "me", "him", "us", "them", "not", "no", "so", "do",
  "does", "did", "have", "has", "had", "can", "could", "will", "would",
  "shall", "should", "may", "might", "must", "there", "here", "when",
  "where", "which", "who", "whom", "whose", "what", "how", "why",
  "if", "then", "than", "too", "very", "just", "more", "most", "also",
  "only", "about", "into", "over", "after", "before", "between", "during",
  "without", "through", "against", "upon", "within", "among", "out",
  "up", "down", "off", "away", "back", "one", "two", "all", "some",
  "any", "each", "every", "both", "few", "many", "much", "such",
  "other", "another", "own", "same", "new", "first", "last", "next",
  "well", "good", "thing", "things", "people", "time", "way", "year",
  "day", "life", "world", "work", "make", "take", "get", "go", "come",
  "see", "know", "think", "want", "like", "use", "find", "give", "tell",
  "say", "said", "part", "place", "point", "number", "lot", "little",
  "big", "great", "important", "need", "show", "help", "keep", "start",
  "turn", "seem", "look", "mean", "put", "call", "ask", "try", "left",
  "right", "long", "high", "low", "also", "even",
]);

/** 简单词形还原候选：原词 → 常见变形 */
function inflections(token: string) {
  const candidates = [token];
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

/**
 * 从已见例句（AI 内容补充的释义例句）构建反向索引。
 * key 为小写词形；命中词库的词才会收录，排除例句来源词自身。
 */
export function buildSentenceIndex({
  redbookWords,
  enrichments,
}: {
  redbookWords: Word[];
  enrichments: Record<number, WordEnrichment>;
}): SentenceIndex {
  const index: SentenceIndex = new Map();
  const exact = new Map<string, Word>();
  for (const word of redbookWords) {
    const text = word.word.trim();
    if (text && !exact.has(text)) exact.set(text, word);
  }
  const addSentence = (
    sentence: string,
    translation: string | undefined,
    sourceWord: string,
    sourceId: number | undefined,
  ) => {
    const tokens = sentence.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
    const seen = new Set<string>();
    const seenKeys = new Set<string>();
    for (const token of tokens) {
      const lower = token.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      if (lower === sourceWord.toLowerCase()) continue;
      if (STOP_WORDS.has(lower)) continue;
      // 词形双向展开：token 及其变形候选凡命中词库均作为 key 收录，
      // 让「原形 ↔ 变形」互相可查；每条例句最多收录 2 个 key 控制膨胀
      const keys = [...new Set(
        inflections(lower).filter((candidate) => exact.has(candidate)),
      )].slice(0, 2);
      if (!keys.length) continue;
      const entry: ReusedSentence = {
        sentence,
        ...(translation ? { translation } : {}),
        sourceWord,
        ...(sourceId !== undefined ? { sourceId } : {}),
      };
      for (const key of keys) {
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        const list = index.get(key);
        if (list) list.push(entry);
        else index.set(key, [entry]);
      }
    }
  };

  for (const word of redbookWords) {
    if (word.sentence) {
      addSentence(word.sentence, word.translation, word.word, word.id);
    }
  }
  // wordId → 实际单词，例句来源显示真实词形
  const wordById = new Map<number, Word>();
  for (const word of redbookWords) {
    if (word.id !== undefined) wordById.set(word.id, word);
  }
  for (const [wordId, enrichment] of Object.entries(enrichments)) {
    const id = Number(wordId);
    const sourceWord = wordById.get(id)?.word ?? "词 " + id;
    for (const example of enrichment.senseExamples ?? []) {
      // 语义二审确认不符的例句不进入反向索引，避免劣质例句传播复用
      if (example.review?.status === "failed") continue;
      addSentence(example.sentence, example.translation, sourceWord, id);
    }
  }
  return index;
}

/** 例句来源词的划词查询次数（linkedWordId 命中来源 id 时归并） */
function sourceLookupCount(
  sourceId: number | undefined,
  lookupStats?: LookupStats,
  lookupWords?: LookupWord[],
) {
  if (sourceId === undefined || !lookupStats || !lookupWords) return 0;
  let best = 0;
  for (const word of lookupWords) {
    if (word.linkedWordId !== sourceId) continue;
    const count = lookupStats[word.query.trim().toLowerCase()]?.count ?? 0;
    if (count > best) best = count;
  }
  return best;
}

/** 查询某词在已见例句中的复用列表（含简单变形匹配，来源词查得多的例句优先） */
export function reusedSentencesFor(
  index: SentenceIndex,
  word: string,
  options?: {
    lookupStats?: LookupStats;
    lookupWords?: LookupWord[];
  },
): ReusedSentence[] {
  const lower = word.trim().toLowerCase();
  if (!lower) return [];
  const seen = new Map<string, ReusedSentence>();
  for (const candidate of inflections(lower)) {
    for (const entry of index.get(candidate) ?? []) {
      const key = (entry.sourceId ?? entry.sourceWord) + ":" + entry.sentence;
      if (!seen.has(key)) seen.set(key, entry);
    }
  }
  const countByEntry = new Map<ReusedSentence, number>();
  for (const entry of seen.values()) {
    countByEntry.set(
      entry,
      sourceLookupCount(entry.sourceId, options?.lookupStats, options?.lookupWords),
    );
  }
  return [...seen.values()]
    .sort((first, second) =>
      (countByEntry.get(second) ?? 0) - (countByEntry.get(first) ?? 0))
    .slice(0, 6);
}
