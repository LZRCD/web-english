"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type SetStateAction,
} from "react";
import {
  allocateLookupWordId,
  buildWordTextIndex,
  lookupIdentity,
  type LookupResult,
  type SelectionLookupState,
  type WordTextIndex,
} from "../../lib/selection-lookup";
import {
  splitMeaning,
  type LookupWord,
  type Word,
} from "../../lib/study";
import {
  cleanSelectedText,
  formatDictionaryPhonetic,
} from "../../lib/word-utils";

type DictionaryEntry = [
  displayWord: string,
  phonetic: string,
  translation: string,
];
type DictionaryShard = Record<string, DictionaryEntry>;
type PhoneticIndex = Record<string, string>;

type CommonOptions = {
  current: Word;
  currentBase?: Word;
  currentDictionaryPhonetic?: string;
  lookupWords: LookupWord[];
  setLookupWords: Dispatch<SetStateAction<LookupWord[]>>;
  setDictionaryPhonetics: Dispatch<
    SetStateAction<Record<number, string>>
  >;
};

type WordSource =
  | {
      wordByText: WordTextIndex;
      redbookWords?: never;
    }
  | {
      wordByText?: never;
      redbookWords: Word[];
    };

export type UseSelectionLookupOptions = CommonOptions & WordSource;

export type UseSelectionLookupResult = {
  selectionLookup?: SelectionLookupState;
  handleTextSelection(event: ReactMouseEvent<HTMLElement>): Promise<void>;
  translateSelection(options?: { forceAi?: boolean }): Promise<void>;
  closeSelectionLookup(): void;
};

const LOOKUP_CACHE_KEY = "wordloop-selection-lookups-v1";
const DICTIONARY_BASE_PATH = "/data/dictionary";
const PHONETIC_INDEX_PATH = "/data/phonetic-index.json";

function readLookupCache() {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(LOOKUP_CACHE_KEY) ?? "{}",
    ) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, LookupResult>;
  } catch {
    return {};
  }
}

function writeLookupCache(cache: Record<string, LookupResult>) {
  try {
    localStorage.setItem(LOOKUP_CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

/** 由红宝书词条构建划词结果；phonetic 可来自词典音标索引 */
function redbookLookupResult(
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

export function useSelectionLookup(
  options: UseSelectionLookupOptions,
): UseSelectionLookupResult {
  const {
    current,
    currentBase,
    currentDictionaryPhonetic = "",
    lookupWords,
    setLookupWords,
    setDictionaryPhonetics,
  } = options;
  const suppliedWordByText = options.wordByText;
  const redbookWords = options.redbookWords;
  const wordByText = useMemo(
    () => suppliedWordByText ?? buildWordTextIndex(redbookWords ?? []),
    [redbookWords, suppliedWordByText],
  );
  const [selectionLookup, setSelectionLookup] =
    useState<SelectionLookupState>();
  const lookupAbortRef = useRef<AbortController | null>(null);
  const lookupCacheRef = useRef<Record<string, LookupResult>>({});
  const dictionaryShardCacheRef =
    useRef<Record<string, DictionaryShard>>({});
  const phoneticIndexRef = useRef<PhoneticIndex>({});
  const [phoneticIndexReady, setPhoneticIndexReady] = useState(false);

  const closeSelectionLookup = useCallback(() => {
    lookupAbortRef.current?.abort();
    setSelectionLookup(undefined);
  }, []);

  const saveLookupWord = useCallback((result: LookupResult) => {
    setLookupWords((items) => {
      const identity = lookupIdentity(result);
      const existing = items.find(
        (item) => lookupIdentity(item) === identity,
      );
      return [
        {
          ...result,
          id: existing?.id ?? allocateLookupWordId(result.query, items),
          addedAt: existing?.addedAt ?? new Date().toISOString(),
        },
        ...items.filter((item) => lookupIdentity(item) !== identity),
      ];
    });
  }, [setLookupWords]);

  const findInLocalDictionary = useCallback(
    async (query: string): Promise<LookupResult | null> => {
      if (!/^[A-Za-z][A-Za-z '-]*$/.test(query)) return null;
      const shardName = query[0].toLowerCase();
      let shard = dictionaryShardCacheRef.current[shardName];
      if (!shard) {
        const response = await fetch(
          `${DICTIONARY_BASE_PATH}/${shardName}.json`,
        );
        if (!response.ok) return null;
        shard = await response.json() as DictionaryShard;
        dictionaryShardCacheRef.current[shardName] = shard;
      }
      const entry = shard[query.toLowerCase()];
      if (!entry) return null;
      return {
        query: entry[0],
        kind: entry[0].includes(" ") ? "phrase" : "word",
        phonetic: formatDictionaryPhonetic(entry[1]),
        phoneticSource: "dictionary",
        part: "本地词典",
        meaning: entry[2]
          .replace(/\\n/g, "；")
          .replace(/\s*;\s*/g, "；"),
        note: "ECDICT 离线释义",
        source: "dictionary",
      };
    },
    [],
  );

  /** 词典音标索引（秒级）优先，分片兜底 */
  const lookupLocalPhonetic = useCallback(
    async (query: string): Promise<string> => {
      const normalized = query.trim().toLowerCase();
      const indexed = phoneticIndexRef.current[normalized];
      if (indexed) return indexed;
      const result = await findInLocalDictionary(query).catch(() => null);
      return result?.phonetic ?? "";
    },
    [findInLocalDictionary],
  );

  /** 同步解析已知词：红宝书词 / 已存划词 / 已缓存结果。命中返回结果，否则 null。 */
  const resolveKnownLocal = useCallback((
    query: string,
    context: string,
  ): { result: LookupResult; cached: boolean } | null => {
    const normalizedQuery = query.toLowerCase();
    const localWord = wordByText.exact.get(query.trim())
      ?? wordByText.folded.get(normalizedQuery)?.[0];
    if (localWord) {
      const phonetic = localWord.phonetic
        || phoneticIndexRef.current[normalizedQuery]
        || "";
      if (localWord.id !== undefined && phonetic) {
        setDictionaryPhonetics((items) => ({
          ...items,
          [localWord.id!]: phonetic,
        }));
      }
      return {
        result: redbookLookupResult(localWord, phonetic),
        cached: false,
      };
    }

    const savedLookup = lookupWords.find(
      (item) => item.query.toLowerCase() === normalizedQuery,
    );
    if (savedLookup) {
      const phonetic = savedLookup.source === "ai"
        ? phoneticIndexRef.current[normalizedQuery] || savedLookup.phonetic
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

    const cacheKey = JSON.stringify([normalizedQuery, context.toLowerCase()]);
    const cached = lookupCacheRef.current[cacheKey];
    if (cached) {
      return { result: cached, cached: true };
    }
    return null;
  }, [
    lookupWords,
    setDictionaryPhonetics,
    wordByText,
  ]);

  const handleTextSelection = useCallback(async (
    event: ReactMouseEvent<HTMLElement>,
  ) => {
    const target = event.target as HTMLElement;
    if (target.closest("button, input, textarea, select, a")) return;
    const selection = window.getSelection();
    if (
      !selection
      || selection.isCollapsed
      || selection.rangeCount === 0
    ) {
      return;
    }
    const range = selection.getRangeAt(0);
    if (!event.currentTarget.contains(range.commonAncestorContainer)) return;

    const query = cleanSelectedText(selection.toString());
    if (!query || !/[A-Za-z]/.test(query)) return;
    const rangeBox = range.getBoundingClientRect();
    if (!rangeBox.width && !rangeBox.height) return;
    const popupWidth = Math.min(360, window.innerWidth - 24);
    const x = Math.min(
      window.innerWidth - popupWidth / 2 - 12,
      Math.max(
        popupWidth / 2 + 12,
        rangeBox.left + rangeBox.width / 2,
      ),
    );
    const popupHeight = 220;
    const y = rangeBox.bottom + 12 + popupHeight <= window.innerHeight
      ? rangeBox.bottom + 12
      : Math.max(12, rangeBox.top - popupHeight - 12);
    const commonNode = range.commonAncestorContainer;
    const commonElement = commonNode.nodeType === Node.ELEMENT_NODE
      ? commonNode as Element
      : commonNode.parentElement;
    const contextElement = commonElement?.closest(
      ".meaning-row, .context-block, .collocation-block, .word-face",
    );
    const context = (
      contextElement?.textContent
      ?? current.sentence
      ?? current.meaning
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);

    lookupAbortRef.current?.abort();
    const resolved = resolveKnownLocal(query, context);
    if (resolved) {
      saveLookupWord(resolved.result);
      setSelectionLookup({
        query,
        context,
        x,
        y,
        status: "ready",
        result: resolved.result,
        cached: resolved.cached,
      });
      // 红宝书词索引未命中音标时，后台用词典分片补全
      if (
        resolved.result.source === "redbook"
        && !resolved.result.phonetic
      ) {
        findInLocalDictionary(query)
          .then((dictionaryResult) => {
            if (!dictionaryResult?.phonetic) return;
            setSelectionLookup((state) =>
              state
              && state.query === query
              && state.result?.source === "redbook"
              && !state.result.phonetic
                ? {
                    ...state,
                    result: {
                      ...state.result,
                      phonetic: dictionaryResult.phonetic,
                      phoneticSource: "dictionary",
                    },
                  }
                : state);
          })
          .catch(() => {});
      }
      return;
    }
    setSelectionLookup({ query, context, x, y, status: "idle" });
  }, [
    current.meaning,
    current.sentence,
    findInLocalDictionary,
    resolveKnownLocal,
    saveLookupWord,
  ]);

  const translateSelection = useCallback(async (
    translateOptions: { forceAi?: boolean } = {},
  ) => {
    if (!selectionLookup || selectionLookup.status === "loading") return;
    const { query, context, x, y } = selectionLookup;
    const normalizedQuery = query.toLowerCase();

    if (!translateOptions.forceAi) {
      const known = resolveKnownLocal(query, context);
      if (known) {
        saveLookupWord(known.result);
        setSelectionLookup({
          query,
          context,
          x,
          y,
          status: "ready",
          result: known.result,
          cached: known.cached,
        });
        // 已知结果仍缺音标时（非红宝书词典词），后台用词典分片补全
        if (!known.result.phonetic) {
          lookupLocalPhonetic(query)
            .then((phonetic) => {
              if (!phonetic) return;
              setSelectionLookup((state) =>
                state
                && state.query === query
                && !state.result?.phonetic
                  ? {
                      ...state,
                      result: {
                        ...state.result!,
                        phonetic,
                        phoneticSource: "dictionary",
                      },
                    }
                  : state);
            })
            .catch(() => {});
        }
        return;
      }
    }

    const controller = new AbortController();
    lookupAbortRef.current = controller;
    setSelectionLookup({ query, context, x, y, status: "loading" });
    try {
      if (!translateOptions.forceAi) {
        const dictionaryResult = await findInLocalDictionary(query);
        if (dictionaryResult) {
          saveLookupWord(dictionaryResult);
          setSelectionLookup({
            query,
            context,
            x,
            y,
            status: "ready",
            result: dictionaryResult,
          });
          return;
        }
      }
      const response = await fetch("/api/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: query, context }),
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(30000),
        ]),
      });
      const data = await response.json() as LookupResult & {
        error?: string;
      };
      if (!response.ok || data.source !== "ai") {
        throw new Error(data.error ?? "划词查询失败");
      }
      const dictionaryPhonetic = await lookupLocalPhonetic(query);
      const trustedResult: LookupResult = {
        ...data,
        phonetic: selectionLookup.result?.phonetic || dictionaryPhonetic,
        phoneticSource:
          selectionLookup.result?.phoneticSource
          || (dictionaryPhonetic ? "dictionary" : undefined),
      };
      const entries = Object.entries({
        ...lookupCacheRef.current,
        [JSON.stringify([normalizedQuery, context.toLowerCase()])]: trustedResult,
      }).slice(-120);
      lookupCacheRef.current = Object.fromEntries(entries);
      writeLookupCache(lookupCacheRef.current);
      saveLookupWord(trustedResult);
      setSelectionLookup({
        query,
        context,
        x,
        y,
        status: "ready",
        result: trustedResult,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      setSelectionLookup({
        query,
        context,
        x,
        y,
        status: "error",
        error: error instanceof Error
          ? error.message
          : "划词查询失败",
      });
    }
  }, [
    findInLocalDictionary,
    lookupLocalPhonetic,
    resolveKnownLocal,
    saveLookupWord,
    selectionLookup,
    setSelectionLookup,
  ]);

  useEffect(() => {
    lookupCacheRef.current = readLookupCache();
  }, []);

  // 预加载红宝书词音标索引，秒级填充学习卡与划词结果
  useEffect(() => {
    let active = true;
    fetch(PHONETIC_INDEX_PATH)
      .then((response) => {
        if (!response.ok) throw new Error("phonetic index missing");
        return response.json() as Promise<PhoneticIndex>;
      })
      .then((index) => {
        if (active) {
          phoneticIndexRef.current = index;
          setPhoneticIndexReady(true);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (
      currentBase?.id === undefined
      || !currentBase.word
      || currentBase.phonetic
      || currentDictionaryPhonetic
    ) {
      return;
    }
    let active = true;
    lookupLocalPhonetic(currentBase.word)
      .then((phonetic) => {
        if (active && phonetic) {
          setDictionaryPhonetics((items) => ({
            ...items,
            [currentBase.id!]: phonetic,
          }));
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [
    currentBase?.id,
    currentBase?.phonetic,
    currentBase?.word,
    currentDictionaryPhonetic,
    lookupLocalPhonetic,
    phoneticIndexReady,
    setDictionaryPhonetics,
  ]);

  useEffect(() => {
    if (!selectionLookup) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Element
        && target.closest(".selection-lookup")
      ) {
        return;
      }
      closeSelectionLookup();
    };
    document.addEventListener(
      "pointerdown",
      closeOnOutsidePointer,
      true,
    );
    return () => document.removeEventListener(
      "pointerdown",
      closeOnOutsidePointer,
      true,
    );
  }, [closeSelectionLookup, selectionLookup]);

  useEffect(() => () => {
    lookupAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    queueMicrotask(closeSelectionLookup);
  }, [closeSelectionLookup, current.id]);

  return {
    selectionLookup,
    handleTextSelection,
    translateSelection,
    closeSelectionLookup,
  };
}
