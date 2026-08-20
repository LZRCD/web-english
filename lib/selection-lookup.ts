import {
  lookupWordId,
  splitMeaning,
  type LookupStats,
  type LookupWord,
  type Word,
} from "./study.ts";
import {
  splitSenseItems,
} from "./word-utils.ts";

/** 单个词性分组：part 为词性标签（如 "n."），senses 为该词性下的展示义项。 */
export type WordSenseGroup = { part: string; senses: string[] };

/** 词性标签串（与 study.ts splitMeaning 的 partPattern 保持一致）。 */
const PART_TAG_LIST =
  "vlink|modal|usage|prep|conj|pron|suff|pref|adj|adv|det|int|num|aux|ord|vi|vt|n|v";
const PART_TAGS_ONLY = new RegExp(
  `^(?:(?:${PART_TAG_LIST})\\.\\s*)+$`,
  "i",
);

/**
 * 按词性分组拆分的展示义项（划词弹窗用）：
 * - meaning 自带完整词性分段（红宝书等规范释义）且 part 为词性标签或缺失时，
 *   按词性分组，组内按逗号/分号拆分；跨词性重复文本只保留首个词性分组
 *   （与 splitWordSenses 的首个出现保留口径一致，避免义项重复展示）。
 * - 其它情况（ECDICT/AI 纯中文释义、part 为"本地词典/短语"等非词性标签）：
 *   整体作为一段，沿用传入的 part 标签。
 */
export function splitWordSensesByPart(
  word: Pick<Word, "meaning" | "part">,
): WordSenseGroup[] {
  const parsed = splitMeaning(word.meaning);
  const part = (word.part ?? "").trim();
  if (
    parsed.part === "红宝书"
    || (part && !PART_TAGS_ONLY.test(part))
  ) {
    // 回退为整体一段：保留原始释义文本（ECDICT/AI 等不带词性分段或非词性标签）
    return [{ part, senses: [word.meaning.trim()] }];
  }
  const groups = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const sense of parsed.senses) {
    for (const text of splitSenseItems(sense.meaning)) {
      if (seen.has(text)) continue;
      seen.add(text);
      const items = groups.get(sense.part) ?? [];
      items.push(text);
      groups.set(sense.part, items);
    }
  }
  return [...groups].map(([groupPart, senses]) => ({
    part: groupPart,
    senses,
  }));
}

export type LookupResult = Omit<LookupWord, "id" | "addedAt"> & {
  /** 红宝书词目按词性分组的释义；无词性分段或旧缓存缺失时弹窗回退为整体一段。 */
  sensesByPart?: WordSenseGroup[];
  /**
   * 可信来源（如 AI 依据 context 推断）给出的「当前语境词性」，渐进增强：
   * 存在且命中词性分组时，弹窗默认展开该词性；缺失时回退为高频/首词性展开，
   * 绝不伪造语境词性。
   */
  contextPart?: string;
};

type StableLookupResult = Omit<LookupWord, "id" | "addedAt">;

/** 持久化边界：只构造既有 LookupWord 字段，不保存弹窗展示投影。 */
function toStableLookupResult(result: LookupResult): StableLookupResult {
  return {
    ...(result.linkedWordId === undefined
      ? {}
      : { linkedWordId: result.linkedWordId }),
    query: result.query,
    kind: result.kind,
    phonetic: result.phonetic,
    ...(result.phoneticSource === undefined
      ? {}
      : { phoneticSource: result.phoneticSource }),
    part: result.part,
    meaning: result.meaning,
    note: result.note,
    source: result.source,
  };
}

export type SelectionLookupState = {
  query: string;
  context: string;
  x: number;
  y: number;
  /** 选中词在视口中的几何信息：弹窗按实际渲染尺寸动态重新定位（下方优先、空间不足翻转）。 */
  anchor: { centerX: number; top: number; bottom: number };
  status: "idle" | "loading" | "ready" | "error";
  result?: LookupResult;
  cached?: boolean;
  error?: string;
};

export type WordTextIndex = {
  exact: Map<string, Word>;
  folded: Map<string, Word[]>;
};

type PhoneticIndex = Record<string, string>;

export type KnownLookupResolution = {
  result: LookupResult;
  cached: boolean;
  linkedPhonetic?: { wordId: number; phonetic: string };
};

export function buildWordTextIndex(words: readonly Word[]): WordTextIndex {
  const exact = new Map<string, Word>();
  const folded = new Map<string, Word[]>();
  for (const word of words) {
    const text = word.word.trim();
    if (!exact.has(text)) exact.set(text, word);
    const key = text.toLowerCase();
    folded.set(key, [...(folded.get(key) ?? []), word]);
  }
  return { exact, folded };
}

/** 由红宝书词条构建划词结果；phonetic 可来自词典音标索引 */
export function buildRedbookLookupResult(
  localWord: Word,
  phonetic: string,
): LookupResult {
  const parsed = splitMeaning(localWord.meaning);
  // 词性分段完整时才携带分组（如 "n. 状况 vt. 陈述 adj. 国家的"），
  // 无分段（如纯中文释义）不生成该字段，弹窗回退为整体一段。
  const sensesByPart = parsed.part !== "红宝书"
    ? splitWordSensesByPart({
        meaning: localWord.meaning,
        part: localWord.part ?? "",
      })
    : undefined;
  return {
    linkedWordId: localWord.id,
    query: localWord.word,
    kind: localWord.word.includes(" ") ? "phrase" : "word",
    phonetic,
    phoneticSource: localWord.phonetic
      ? "redbook"
      : phonetic
        ? "dictionary"
        : undefined,
    part: localWord.part ?? parsed.part,
    meaning: parsed.meaning,
    ...(sensesByPart ? { sensesByPart } : {}),
    note: `${localWord.section ?? "红宝书"}${
      localWord.unit ? ` · Unit ${localWord.unit}` : ""
    }`,
    source: "redbook",
  };
}

function lookupCacheKey(query: string, context: string) {
  return JSON.stringify([query.toLowerCase(), context.toLowerCase()]);
}

/** 按既有优先级解析红宝书、已保存划词和 query/context 缓存。 */
export function resolveKnownLookupResult(input: {
  query: string;
  context: string;
  wordByText: WordTextIndex;
  lookupWords: readonly LookupWord[];
  lookupCache: Readonly<Record<string, LookupResult>>;
  phoneticIndex: Readonly<PhoneticIndex>;
}): KnownLookupResolution | null {
  const normalizedQuery = input.query.toLowerCase();
  const localWord = input.wordByText.exact.get(input.query.trim())
    ?? input.wordByText.folded.get(normalizedQuery)?.[0];
  if (localWord) {
    const phonetic = localWord.phonetic
      || input.phoneticIndex[normalizedQuery]
      || "";
    return {
      result: buildRedbookLookupResult(localWord, phonetic),
      cached: false,
      ...(localWord.id !== undefined && phonetic
        ? { linkedPhonetic: { wordId: localWord.id, phonetic } }
        : {}),
    };
  }

  const savedLookup = input.lookupWords.find(
    (item) => item.query.toLowerCase() === normalizedQuery,
  );
  if (savedLookup) {
    const phonetic = savedLookup.source === "ai"
      ? input.phoneticIndex[normalizedQuery] || savedLookup.phonetic
      : savedLookup.phonetic;
    return {
      result: {
        ...(savedLookup.linkedWordId === undefined
          ? {}
          : { linkedWordId: savedLookup.linkedWordId }),
        query: savedLookup.query,
        kind: savedLookup.kind,
        phonetic,
        phoneticSource: savedLookup.source === "ai"
          ? (phonetic ? "dictionary" : undefined)
          : savedLookup.phoneticSource,
        part: savedLookup.part,
        meaning: savedLookup.meaning,
        note: savedLookup.note,
        source: savedLookup.source,
      },
      cached: true,
    };
  }

  const cached = input.lookupCache[lookupCacheKey(input.query, input.context)];
  if (!cached) return null;
  const stableCached = toStableLookupResult(cached);
  const cachedPart = stableCached.part.trim();
  const contextPart = stableCached.source === "ai"
      && PART_TAGS_ONLY.test(cachedPart)
    ? cachedPart
    : undefined;
  return {
    result: {
      ...stableCached,
      ...(contextPart ? { contextPart } : {}),
    },
    cached: true,
  };
}

export function lookupIdentity(
  word: Pick<LookupWord, "linkedWordId" | "query">,
) {
  return word.linkedWordId === undefined
    ? `lookup:${word.query.trim().toLowerCase()}`
    : `redbook:${word.linkedWordId}`;
}

export function learningWordId(word: LookupWord) {
  return word.linkedWordId ?? word.id;
}

export function allocateLookupWordId(query: string, words: LookupWord[]) {
  const normalizedQuery = query.trim().toLowerCase();
  let candidate = lookupWordId(query);
  while (
    words.some((word) =>
      word.linkedWordId === undefined
      && word.id === candidate
      && word.query.trim().toLowerCase() !== normalizedQuery)
  ) {
    candidate += 1;
  }
  return candidate;
}

/** 保存划词结果的纯投影：按 identity 去重并保留既有 id/addedAt。 */
export function upsertLookupWord(
  words: readonly LookupWord[],
  result: LookupResult,
  addedAt?: string,
): LookupWord[] {
  const identity = lookupIdentity(result);
  const existing = words.find((word) => lookupIdentity(word) === identity);
  const stableResult = toStableLookupResult(result);
  return [
    {
      ...stableResult,
      id: existing?.id ?? allocateLookupWordId(result.query, [...words]),
      addedAt: existing?.addedAt ?? addedAt ?? new Date().toISOString(),
    },
    ...words.filter((word) => lookupIdentity(word) !== identity),
  ];
}

/** 记录一次划词查询；空 query 保持原对象引用。 */
export function recordLookupStat(
  stats: LookupStats,
  query: string,
  now = new Date().toISOString(),
): LookupStats {
  const key = query.trim().toLowerCase();
  if (!key) return stats;
  const previous = stats[key];
  return {
    ...stats,
    [key]: {
      count: (previous?.count ?? 0) + 1,
      firstAt: previous?.firstAt ?? now,
      lastAt: now,
    },
  };
}

/** 按既有对象插入顺序保留缓存尾部 120 项。 */
export function rememberLookupResult(
  cache: Readonly<Record<string, LookupResult>>,
  query: string,
  context: string,
  result: LookupResult,
): Record<string, LookupResult> {
  return Object.fromEntries(
    Object.entries({
      ...cache,
      [lookupCacheKey(query, context)]: result,
    })
      .slice(-120)
      .map(([key, cached]) => [key, toStableLookupResult(cached)]),
  );
}

export function toLookupStudyWord(word: LookupWord): Word {
  return {
    id: learningWordId(word),
    word: word.query,
    phonetic: word.phonetic,
    part: word.part,
    meaning: `${word.part.replace(/\.+$/, "")}. ${word.meaning}`,
    sentence: word.note,
    section: "划词集",
    unit: "自选",
  };
}
