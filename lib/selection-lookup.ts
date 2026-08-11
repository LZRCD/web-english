import {
  lookupWordId,
  splitMeaning,
  type LookupStats,
  type LookupWord,
  type Word,
} from "./study.ts";

export type LookupResult = Omit<LookupWord, "id" | "addedAt">;

export type SelectionLookupState = {
  query: string;
  context: string;
  x: number;
  y: number;
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
  return cached ? { result: cached, cached: true } : null;
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
  return [
    {
      ...result,
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
  return Object.fromEntries(Object.entries({
    ...cache,
    [lookupCacheKey(query, context)]: result,
  }).slice(-120));
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
