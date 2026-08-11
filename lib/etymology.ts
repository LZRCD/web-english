import type { WordRelation } from "./study.ts";

export const ETYMOLOGY_SCHEMA_VERSION = 1 as const;
export const ETYMOLOGY_PROMPT_VERSION = "etymology-v1" as const;

export type EtymologyAffix = {
  form: string;
  kind: "prefix" | "root" | "suffix" | "other";
  meaning: string;
};

export type EtymologyContent = {
  breakdown: string;
  root: string;
  affixes: EtymologyAffix[];
  mnemonic: string;
};

export type EtymologyInput = {
  wordId: number;
  word: string;
  meaning: string;
  root?: string;
  relation?: Pick<
    WordRelation,
    "kind" | "label" | "note" | "lemma" | "independent" | "confidence"
  >;
};

export type EtymologyCacheEntry = {
  schemaVersion: typeof ETYMOLOGY_SCHEMA_VERSION;
  promptVersion: typeof ETYMOLOGY_PROMPT_VERSION;
  inputKey: string;
  content: EtymologyContent;
  generatedAt: string;
  source: "ai";
};

type EtymologyWord = {
  id?: number;
  word: string;
  meaning: string;
  root?: string;
  relation?: EtymologyInput["relation"];
};

const AFFIX_KINDS = new Set<EtymologyAffix["kind"]>([
  "prefix",
  "root",
  "suffix",
  "other",
]);

function text(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

/** 从当前真实词条提取缓存与请求共用的输入身份。 */
export function etymologyInputForWord(
  word: EtymologyWord,
): EtymologyInput | undefined {
  if (!Number.isSafeInteger(word.id)) return undefined;
  const relation = word.relation;
  return {
    wordId: word.id!,
    word: word.word,
    meaning: word.meaning,
    root: word.root,
    relation: relation ? {
      kind: relation.kind,
      label: relation.label,
      note: relation.note,
      lemma: relation.lemma,
      independent: relation.independent,
      confidence: relation.confidence,
    } : undefined,
  };
}

export function normalizeEtymologyContent(
  value: unknown,
): EtymologyContent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const breakdown = text(item.breakdown, 320);
  const root = text(item.root, 120);
  const mnemonic = text(item.mnemonic, 500);
  if (!breakdown || !root || !mnemonic) return null;

  const affixes = Array.isArray(item.affixes)
    ? item.affixes
        .map((raw) => {
          if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
          const affix = raw as Record<string, unknown>;
          const form = text(affix.form, 40);
          const meaning = text(affix.meaning, 120);
          const kind = affix.kind;
          if (
            !form
            || !meaning
            || typeof kind !== "string"
            || !AFFIX_KINDS.has(kind as EtymologyAffix["kind"])
          ) {
            return null;
          }
          return { form, kind: kind as EtymologyAffix["kind"], meaning };
        })
        .filter((affix): affix is EtymologyAffix => affix !== null)
        .slice(0, 8)
    : [];

  return { breakdown, root, affixes, mnemonic };
}

/** 使用固定属性顺序序列化真实输入；不依赖时间、随机数或哈希。 */
export function buildEtymologyInputKey(input: EtymologyInput) {
  const relation = input.relation;
  return JSON.stringify({
    schemaVersion: ETYMOLOGY_SCHEMA_VERSION,
    promptVersion: ETYMOLOGY_PROMPT_VERSION,
    wordId: Number.isSafeInteger(input.wordId) ? input.wordId : null,
    word: text(input.word, Number.MAX_SAFE_INTEGER),
    meaning: text(input.meaning, Number.MAX_SAFE_INTEGER),
    root: text(input.root, Number.MAX_SAFE_INTEGER),
    relation: relation ? {
      kind: relation.kind,
      label: text(relation.label, Number.MAX_SAFE_INTEGER),
      note: text(relation.note, Number.MAX_SAFE_INTEGER),
      lemma: text(relation.lemma, Number.MAX_SAFE_INTEGER),
      independent: relation.independent,
      confidence: relation.confidence,
    } : null,
  });
}

export function buildEtymologyCacheEntry(
  input: EtymologyInput,
  content: EtymologyContent,
  generatedAt: Date,
): EtymologyCacheEntry {
  return {
    schemaVersion: ETYMOLOGY_SCHEMA_VERSION,
    promptVersion: ETYMOLOGY_PROMPT_VERSION,
    inputKey: buildEtymologyInputKey(input),
    content,
    generatedAt: generatedAt.toISOString(),
    source: "ai",
  };
}

export function normalizeEtymologyCacheEntry(
  value: unknown,
): EtymologyCacheEntry | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  const inputKey = typeof item.inputKey === "string" ? item.inputKey : "";
  const generatedAt = typeof item.generatedAt === "string"
    ? new Date(item.generatedAt)
    : new Date(Number.NaN);
  const content = normalizeEtymologyContent(item.content);
  if (
    item.schemaVersion !== ETYMOLOGY_SCHEMA_VERSION
    || item.promptVersion !== ETYMOLOGY_PROMPT_VERSION
    || item.source !== "ai"
    || !inputKey
    || inputKey.trim() !== inputKey
    || Number.isNaN(generatedAt.getTime())
    || !content
  ) {
    return undefined;
  }
  return {
    schemaVersion: ETYMOLOGY_SCHEMA_VERSION,
    promptVersion: ETYMOLOGY_PROMPT_VERSION,
    inputKey,
    content,
    generatedAt: generatedAt.toISOString(),
    source: "ai",
  };
}

export function isCurrentEtymologyCache(
  entry: EtymologyCacheEntry | undefined,
  input: EtymologyInput,
) {
  return entry?.schemaVersion === ETYMOLOGY_SCHEMA_VERSION
    && entry.promptVersion === ETYMOLOGY_PROMPT_VERSION
    && entry.source === "ai"
    && entry.inputKey === buildEtymologyInputKey(input);
}
