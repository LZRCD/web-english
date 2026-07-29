import {
  lookupWordId,
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

export function buildWordTextIndex(words: Word[]): WordTextIndex {
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
