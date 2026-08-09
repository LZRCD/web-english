"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SyntheticEvent,
  type SetStateAction,
} from "react";
import {
  buildWordTextIndex,
  recordLookupStat,
  rememberLookupResult,
  resolveKnownLookupResult,
  upsertLookupWord,
  type LookupResult,
  type SelectionLookupState,
  type WordTextIndex,
} from "../../lib/selection-lookup";
import {
  type LookupStats,
  type LookupWord,
  type Word,
} from "../../lib/study";
import {
  cleanSelectedText,
  formatDictionaryPhonetic,
} from "../../lib/word-utils";
import {
  fetchDictionaryRangeWithFallback,
  isDictionaryLetterRangeIndexCompatible,
  type DictionaryLetterRangeIndex,
  type DictionaryShard,
} from "../../lib/dictionary-range";
import {
  createPerformanceTrace,
  fetchJsonWithDiagnostics,
  startPerformanceTimer,
  type PerformanceOutcome,
  type PerformanceTags,
} from "../../lib/performance-diagnostics";
import {
  DATA_CONTENT_VERSION,
  DICTIONARY_RANGE_INDEX,
  versionedDataUrl,
} from "../../lib/data-version";
import { cleanupOldLookupCaches } from "../../lib/storage-diagnostics";
import {
  allowsBackgroundPrefetch,
  likelyDictionaryLetters,
} from "../../lib/background-prefetch";

type PhoneticIndex = Record<string, string>;

type CommonOptions = {
  current: Word;
  currentBase?: Word;
  currentDictionaryPhonetic?: string;
  lookupWords: LookupWord[];
  setLookupWords: Dispatch<SetStateAction<LookupWord[]>>;
  setLookupStats: Dispatch<SetStateAction<LookupStats>>;
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
  handleTextSelection(event: SyntheticEvent<HTMLElement>): Promise<void>;
  translateSelection(options?: { forceAi?: boolean }): Promise<void>;
  closeSelectionLookup(): void;
};

const LOOKUP_CACHE_KEY = `wordloop-selection-lookups-v1:${DATA_CONTENT_VERSION}`;
const DICTIONARY_BASE_PATH = "/data/dictionary";
const DICTIONARY_RANGE_DIRECTORY = `${DICTIONARY_BASE_PATH}/ranges`;
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

export function useSelectionLookup(
  options: UseSelectionLookupOptions,
): UseSelectionLookupResult {
  const {
    current,
    currentBase,
    currentDictionaryPhonetic = "",
    lookupWords,
    setLookupWords,
    setLookupStats,
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
  const lookupAttemptsRef = useRef(new Set<string>());
  const lookupCacheRef = useRef<Record<string, LookupResult>>({});
  const dictionaryShardCacheRef =
    useRef<Record<string, DictionaryShard>>({});
  const dictionaryPrefixCacheRef =
    useRef<Record<string, DictionaryShard>>({});
  const dictionaryPrefixPromiseRef =
    useRef<Record<string, Promise<DictionaryShard>>>({});
  const dictionaryLetterRangeIndexPromiseRef =
    useRef<Record<string, Promise<DictionaryLetterRangeIndex>>>({});
  const phoneticIndexRef = useRef<PhoneticIndex>({});
  const [phoneticIndexReady, setPhoneticIndexReady] = useState(false);

  const loadDictionaryLetterIndex = useCallback((
    letter: string,
    tags: PerformanceTags = {},
  ) => {
    const rangeIndex = DICTIONARY_RANGE_INDEX;
    const rangeIndexFile = rangeIndex.rangeIndexFiles[letter];
    if (!rangeIndexFile) {
      return Promise.reject(new Error("dictionary letter range index is missing"));
    }
    const cached = dictionaryLetterRangeIndexPromiseRef.current[letter];
    if (cached) return cached;
    const request = fetchJsonWithDiagnostics<DictionaryLetterRangeIndex>(
      versionedDataUrl(
        `${DICTIONARY_RANGE_DIRECTORY}/${rangeIndexFile}.json`,
      ),
      "dictionary.range_letter_index",
      undefined,
      { ...tags, letter },
    )
      .then((result) => {
        if (!isDictionaryLetterRangeIndexCompatible(result.data, letter)) {
          throw new Error("dictionary letter range index is invalid");
        }
        return result.data;
      })
      .catch((error) => {
        delete dictionaryLetterRangeIndexPromiseRef.current[letter];
        throw error;
      });
    dictionaryLetterRangeIndexPromiseRef.current[letter] = request;
    return request;
  }, []);

  /** 记录一次划词查询：累计次数并更新最近查询时间 */
  const recordLookup = useCallback((query: string) => {
    const key = query.trim().toLowerCase();
    if (!key) return;
    const now = new Date().toISOString();
    setLookupStats((items) => recordLookupStat(items, query, now));
  }, [setLookupStats]);

  const closeSelectionLookup = useCallback(() => {
    lookupAbortRef.current?.abort();
    setSelectionLookup(undefined);
  }, []);

  const saveLookupWord = useCallback((result: LookupResult) => {
    setLookupWords((items) => upsertLookupWord(items, result));
  }, [setLookupWords]);

  const loadDictionaryPrefix = useCallback(async (
    key: string,
    tags: PerformanceTags = {},
  ) => {
    const rangeIndex = DICTIONARY_RANGE_INDEX;
    const letter = key[0];
    const letterIndex = await loadDictionaryLetterIndex(letter, tags);
    const prefix = key.slice(0, Math.min(rangeIndex.prefixLength, key.length));
    const cached = dictionaryPrefixCacheRef.current[prefix];
    if (cached) return cached;
    const pending = dictionaryPrefixPromiseRef.current[prefix];
    if (pending) return pending;

    const request = (async () => {
      const combined: DictionaryShard = {};
      const ranges = letterIndex.ranges[prefix] ?? [];
      if (!ranges.length) throw new Error("dictionary range not indexed");
      for (const [file, start, end] of ranges) {
        const fullShard = dictionaryShardCacheRef.current[file];
        if (fullShard) return fullShard;
        const releaseFile = rangeIndex.releaseFiles[file] ?? file;
        const result = await fetchDictionaryRangeWithFallback({
          url: versionedDataUrl(`${DICTIONARY_BASE_PATH}/${releaseFile}.json`),
          start,
          end,
          tags: { ...tags, rangeCount: ranges.length },
        });
        if (result.mode !== "partial-206") {
          dictionaryShardCacheRef.current[file] = result.shard;
          return result.shard;
        }
        Object.assign(combined, result.shard);
      }
      dictionaryPrefixCacheRef.current[prefix] = combined;
      return combined;
    })();
    dictionaryPrefixPromiseRef.current[prefix] = request;
    try {
      return await request;
    } finally {
      delete dictionaryPrefixPromiseRef.current[prefix];
    }
  }, [loadDictionaryLetterIndex]);

  const findInLocalDictionary = useCallback(
    async (
      query: string,
      tags: PerformanceTags = {},
    ): Promise<LookupResult | null> => {
      if (!/^[A-Za-z][A-Za-z '-]*$/.test(query)) return null;
      const key = query.toLowerCase();
      let shard: DictionaryShard;
      try {
        shard = await loadDictionaryPrefix(key, tags);
      } catch (rangeError) {
        const shardName = key[0];
        shard = dictionaryShardCacheRef.current[shardName];
        if (!shard) {
          const fallbackReason = rangeError instanceof SyntaxError
            ? "fragment-corrupt"
            : rangeError instanceof TypeError
              ? "network-error"
              : "range-unavailable";
          try {
            const result = await fetchJsonWithDiagnostics<DictionaryShard>(
              versionedDataUrl(`${DICTIONARY_BASE_PATH}/${shardName}.json`),
              "dictionary.full_shard_fallback",
              undefined,
              { ...tags, fallbackReason },
            );
            shard = result.data;
          } catch {
            return null;
          }
          dictionaryShardCacheRef.current[shardName] = shard;
        }
      }
      const entry = shard[key];
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
    [loadDictionaryPrefix],
  );

  /** 词典音标索引（秒级）优先，分片兜底 */
  const lookupLocalPhonetic = useCallback(
    async (
      query: string,
      tags: PerformanceTags = {},
    ): Promise<string> => {
      const normalized = query.trim().toLowerCase();
      const indexed = phoneticIndexRef.current[normalized];
      if (indexed) return indexed;
      const result = await findInLocalDictionary(query, tags).catch(() => null);
      return result?.phonetic ?? "";
    },
    [findInLocalDictionary],
  );

  /** 同步解析已知词：红宝书词 / 已存划词 / 已缓存结果。命中返回结果，否则 null。 */
  const resolveKnownLocal = useCallback((
    query: string,
    context: string,
  ): { result: LookupResult; cached: boolean } | null => {
    const resolved = resolveKnownLookupResult({
      query,
      context,
      wordByText,
      lookupWords,
      lookupCache: lookupCacheRef.current,
      phoneticIndex: phoneticIndexRef.current,
    });
    if (resolved?.linkedPhonetic) {
      const { wordId, phonetic } = resolved.linkedPhonetic;
      setDictionaryPhonetics((items) => ({
        ...items,
        [wordId]: phonetic,
      }));
    }
    return resolved;
  }, [
    lookupWords,
    setDictionaryPhonetics,
    wordByText,
  ]);

  const handleTextSelection = useCallback(async (
    event: SyntheticEvent<HTMLElement>,
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
      const normalizedQuery = query.toLowerCase();
      const lookupMode = lookupAttemptsRef.current.has(normalizedQuery)
        ? "repeat"
        : "first";
      const traceId = createPerformanceTrace("lookup");
      lookupAttemptsRef.current.add(normalizedQuery);
      const lookupTimer = startPerformanceTimer("lookup.total", {
        traceId,
        lookupMode,
      });
      saveLookupWord(resolved.result);
      recordLookup(query);
      setSelectionLookup({
        query,
        context,
        x,
        y,
        status: "ready",
        result: resolved.result,
        cached: resolved.cached,
      });
      window.requestAnimationFrame(() => lookupTimer.end({
        source: resolved.result.source,
        cacheHit: resolved.cached,
      }));
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
    recordLookup,
  ]);

  const translateSelection = useCallback(async (
    translateOptions: { forceAi?: boolean } = {},
  ) => {
    if (!selectionLookup || selectionLookup.status === "loading") return;
    const { query, context, x, y } = selectionLookup;
    const normalizedQuery = query.toLowerCase();
    const lookupMode = lookupAttemptsRef.current.has(normalizedQuery)
      ? "repeat"
      : "first";
    const traceId = createPerformanceTrace("lookup");
    lookupAttemptsRef.current.add(normalizedQuery);
    const lookupTimer = startPerformanceTimer("lookup.total", {
      traceId,
      lookupMode,
      forceAi: Boolean(translateOptions.forceAi),
    });
    const finishLookup = (
      tags: PerformanceTags,
      outcome: PerformanceOutcome = "ok",
    ) => {
      window.requestAnimationFrame(() => lookupTimer.end(tags, outcome));
    };

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
        finishLookup({
          source: known.result.source,
          cacheHit: known.cached,
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
        const dictionaryResult = await findInLocalDictionary(query, { traceId });
        if (controller.signal.aborted || lookupAbortRef.current !== controller) {
          finishLookup({}, "aborted");
          return;
        }
        if (dictionaryResult) {
          saveLookupWord(dictionaryResult);
          recordLookup(query);
          setSelectionLookup({
            query,
            context,
            x,
            y,
            status: "ready",
            result: dictionaryResult,
          });
          finishLookup({ source: "dictionary", cacheHit: false });
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
      const dictionaryPhonetic = await lookupLocalPhonetic(query, { traceId });
      if (controller.signal.aborted || lookupAbortRef.current !== controller) {
        finishLookup({}, "aborted");
        return;
      }
      const trustedResult: LookupResult = {
        ...data,
        phonetic: selectionLookup.result?.phonetic || dictionaryPhonetic,
        phoneticSource:
          selectionLookup.result?.phoneticSource
          || (dictionaryPhonetic ? "dictionary" : undefined),
      };
      lookupCacheRef.current = rememberLookupResult(
        lookupCacheRef.current,
        query,
        context,
        trustedResult,
      );
      writeLookupCache(lookupCacheRef.current);
      saveLookupWord(trustedResult);
      recordLookup(query);
      setSelectionLookup({
        query,
        context,
        x,
        y,
        status: "ready",
        result: trustedResult,
      });
      finishLookup({ source: "ai", cacheHit: false });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        finishLookup({}, "aborted");
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
      finishLookup({}, "error");
    }
  }, [
    findInLocalDictionary,
    lookupLocalPhonetic,
    resolveKnownLocal,
    saveLookupWord,
    recordLookup,
    selectionLookup,
    setSelectionLookup,
  ]);

  useEffect(() => {
    cleanupOldLookupCaches(LOOKUP_CACHE_KEY);
    lookupCacheRef.current = readLookupCache();
  }, []);

  // 预加载红宝书词音标索引，秒级填充学习卡与划词结果
  useEffect(() => {
    let active = true;
    fetchJsonWithDiagnostics<PhoneticIndex>(
      versionedDataUrl(PHONETIC_INDEX_PATH),
      "phonetic.index",
    )
      .then(({ data: index }) => {
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

  // 首屏稳定后预取当前卡片最可能涉及的字母索引，省去高延迟网络的一次串行往返。
  useEffect(() => {
    const letters = likelyDictionaryLetters([
      current.word,
      current.sentence,
      current.collocation,
      current.meaning,
    ]);
    if (!letters.length) return;
    let cancelled = false;
    let idleId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      if (cancelled) return;
      const connection = (
        navigator as Navigator & {
          connection?: { saveData?: boolean; effectiveType?: string };
        }
      ).connection;
      if (!allowsBackgroundPrefetch({
        online: navigator.onLine,
        visibilityState: document.visibilityState,
        connection,
      })) return;
      const queue = [...letters];
      const worker = async () => {
        while (!cancelled) {
          const letter = queue.shift();
          if (!letter) return;
          await loadDictionaryLetterIndex(letter, {
            prefetch: true,
            prefetchBudgetLetters: letters.length,
          }).catch(() => undefined);
        }
      };
      void Promise.all([worker(), worker()]);
    };
    const idleWindow = window as Window & {
      requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions,
      ) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (idleWindow.requestIdleCallback) {
      idleId = idleWindow.requestIdleCallback(run, { timeout: 2_000 });
    } else {
      timeoutId = globalThis.setTimeout(run, 750);
    }
    return () => {
      cancelled = true;
      if (idleId !== undefined) idleWindow.cancelIdleCallback?.(idleId);
      if (timeoutId !== undefined) globalThis.clearTimeout(timeoutId);
    };
  }, [
    current.collocation,
    current.meaning,
    current.sentence,
    current.word,
    loadDictionaryLetterIndex,
  ]);

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
