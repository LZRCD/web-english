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
    setSelectionLookup({ query, context, x, y, status: "idle" });
  }, [current.meaning, current.sentence]);

  const translateSelection = useCallback(async (
    translateOptions: { forceAi?: boolean } = {},
  ) => {
    if (!selectionLookup || selectionLookup.status === "loading") return;
    const { query, context, x, y } = selectionLookup;
    const normalizedQuery = query.toLowerCase();
    const localWord = wordByText.exact.get(query.trim())
      ?? wordByText.folded.get(normalizedQuery)?.[0];
    if (localWord && !translateOptions.forceAi) {
      const parsed = splitMeaning(localWord.meaning);
      const dictionaryResult = localWord.phonetic
        ? null
        : await findInLocalDictionary(query).catch(() => null);
      const phonetic =
        localWord.phonetic || dictionaryResult?.phonetic || "";
      if (localWord.id !== undefined && phonetic) {
        setDictionaryPhonetics((items) => ({
          ...items,
          [localWord.id!]: phonetic,
        }));
      }
      const result: LookupResult = {
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
      saveLookupWord(result);
      setSelectionLookup({
        query,
        context,
        x,
        y,
        status: "ready",
        result,
      });
      return;
    }

    const savedLookup = lookupWords.find(
      (item) => item.query.toLowerCase() === normalizedQuery,
    );
    if (savedLookup && !translateOptions.forceAi) {
      const dictionaryResult = savedLookup.source === "ai"
        ? await findInLocalDictionary(query).catch(() => null)
        : null;
      const result: LookupResult = {
        query: savedLookup.query,
        kind: savedLookup.kind,
        phonetic: savedLookup.source === "ai"
          ? dictionaryResult?.phonetic ?? ""
          : savedLookup.phonetic,
        phoneticSource: savedLookup.source === "ai"
          ? dictionaryResult?.phoneticSource
          : savedLookup.phoneticSource,
        part: savedLookup.part,
        meaning: savedLookup.meaning,
        note: savedLookup.note,
        source: savedLookup.source,
      };
      setSelectionLookup({
        query,
        context,
        x,
        y,
        status: "ready",
        result,
        cached: true,
      });
      return;
    }

    const cacheKey = JSON.stringify([
      normalizedQuery,
      context.toLowerCase(),
    ]);
    const cached = lookupCacheRef.current[cacheKey];
    if (
      cached
      && (!translateOptions.forceAi || cached.source === "ai")
    ) {
      const trustedCached = cached.source === "ai"
        ? {
            ...cached,
            phonetic: selectionLookup.result?.phonetic || (
              cached.phoneticSource ? cached.phonetic : ""
            ),
            phoneticSource:
              selectionLookup.result?.phoneticSource
              ?? cached.phoneticSource,
          }
        : cached;
      saveLookupWord(trustedCached);
      setSelectionLookup({
        query,
        context,
        x,
        y,
        status: "ready",
        result: trustedCached,
        cached: true,
      });
      return;
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
      const trustedResult: LookupResult = {
        ...data,
        phonetic: selectionLookup.result?.phonetic || "",
        phoneticSource: selectionLookup.result?.phoneticSource,
      };
      const entries = Object.entries({
        ...lookupCacheRef.current,
        [cacheKey]: trustedResult,
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
    lookupWords,
    saveLookupWord,
    selectionLookup,
    setDictionaryPhonetics,
    wordByText,
  ]);

  useEffect(() => {
    lookupCacheRef.current = readLookupCache();
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
    findInLocalDictionary(currentBase.word)
      .then((result) => {
        if (active && result?.phonetic) {
          setDictionaryPhonetics((items) => ({
            ...items,
            [currentBase.id!]: result.phonetic,
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
    findInLocalDictionary,
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
