export const DAILY_SENTENCE_SCHEMA_VERSION = 1 as const;
export const DAILY_SENTENCE_PROMPT_VERSION = "daily-sentence-v1" as const;

export type DailySentenceInput = {
  localDate: string;
};

export type DailySentenceClause = {
  text: string;
  type:
    | "main"
    | "relative"
    | "noun"
    | "adverbial"
    | "appositive"
    | "coordinate"
    | "other";
  function: string;
};

export type DailySentenceModifier = {
  text: string;
  target: string;
  relation: string;
};

export type DailySentenceContent = {
  sentence: string;
  backbone: string;
  clauses: DailySentenceClause[];
  modifiers: DailySentenceModifier[];
  translation: string;
};

export type DailySentenceCacheEntry = {
  schemaVersion: typeof DAILY_SENTENCE_SCHEMA_VERSION;
  promptVersion: typeof DAILY_SENTENCE_PROMPT_VERSION;
  inputKey: string;
  localDate: string;
  content: DailySentenceContent;
  generatedAt: string;
  source: "ai";
};

const CLAUSE_TYPES = new Set<DailySentenceClause["type"]>([
  "main",
  "relative",
  "noun",
  "adverbial",
  "appositive",
  "coordinate",
  "other",
]);

function normalizedText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : "";
}

function englishWordCount(value: string) {
  return value.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)?.length ?? 0;
}

export function isDailySentenceLocalDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(year, month - 1, day);
  return date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day;
}

export function buildDailySentenceInputKey(input: DailySentenceInput) {
  return JSON.stringify({
    schemaVersion: DAILY_SENTENCE_SCHEMA_VERSION,
    promptVersion: DAILY_SENTENCE_PROMPT_VERSION,
    localDate: input.localDate,
  });
}

function normalizeClause(
  value: unknown,
  sentence: string,
): DailySentenceClause | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const text = normalizedText(item.text, 600);
  const clauseFunction = normalizedText(item.function, 300);
  if (
    !text
    || !sentence.includes(text)
    || typeof item.type !== "string"
    || !CLAUSE_TYPES.has(item.type as DailySentenceClause["type"])
    || !clauseFunction
  ) return null;
  return {
    text,
    type: item.type as DailySentenceClause["type"],
    function: clauseFunction,
  };
}

function normalizeModifier(
  value: unknown,
  sentence: string,
): DailySentenceModifier | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const text = normalizedText(item.text, 300);
  const target = normalizedText(item.target, 300);
  const relation = normalizedText(item.relation, 300);
  if (!text || !sentence.includes(text) || !target || !relation) return null;
  return { text, target, relation };
}

export function normalizeDailySentenceContent(
  value: unknown,
  input: DailySentenceInput,
): DailySentenceContent | null {
  if (
    !isDailySentenceLocalDate(input.localDate)
    || !value
    || typeof value !== "object"
    || Array.isArray(value)
  ) return null;
  const item = value as Record<string, unknown>;
  const sentence = normalizedText(item.sentence, 1_200);
  const backbone = normalizedText(item.backbone, 500);
  const translation = normalizedText(item.translation, 1_200);
  const wordCount = englishWordCount(sentence);
  if (
    !sentence
    || wordCount < 30
    || wordCount > 70
    || !/[.!?]$/.test(sentence)
    || /```/.test(sentence)
    || /<[^>]+>/.test(sentence)
    || /\b(?:todo|placeholder|lorem ipsum)\b/i.test(sentence)
    || !backbone
    || !translation
    || !Array.isArray(item.clauses)
    || item.clauses.length < 2
    || item.clauses.length > 8
    || !Array.isArray(item.modifiers)
    || item.modifiers.length < 1
    || item.modifiers.length > 12
  ) return null;

  const clauses = item.clauses.map((clause) => normalizeClause(clause, sentence));
  if (
    clauses.some((clause) => clause === null)
    || !clauses.some((clause) => clause?.type === "main")
    || !clauses.some((clause) => clause?.type !== "main")
  ) return null;
  const modifiers = item.modifiers.map((modifier) =>
    normalizeModifier(modifier, sentence));
  if (modifiers.some((modifier) => modifier === null)) return null;

  return {
    sentence,
    backbone,
    clauses: clauses as DailySentenceClause[],
    modifiers: modifiers as DailySentenceModifier[],
    translation,
  };
}

export function buildDailySentenceCacheEntry(
  input: DailySentenceInput,
  content: DailySentenceContent,
  generatedAt: Date,
): DailySentenceCacheEntry {
  return {
    schemaVersion: DAILY_SENTENCE_SCHEMA_VERSION,
    promptVersion: DAILY_SENTENCE_PROMPT_VERSION,
    inputKey: buildDailySentenceInputKey(input),
    localDate: input.localDate,
    content,
    generatedAt: generatedAt.toISOString(),
    source: "ai",
  };
}

export function normalizeDailySentenceCacheEntry(
  value: unknown,
): DailySentenceCacheEntry | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  if (
    item.schemaVersion !== DAILY_SENTENCE_SCHEMA_VERSION
    || item.promptVersion !== DAILY_SENTENCE_PROMPT_VERSION
    || !isDailySentenceLocalDate(item.localDate)
    || item.inputKey !== buildDailySentenceInputKey({ localDate: item.localDate })
    || item.source !== "ai"
    || typeof item.generatedAt !== "string"
    || !Number.isFinite(new Date(item.generatedAt).getTime())
  ) return undefined;
  const input = { localDate: item.localDate };
  const content = normalizeDailySentenceContent(item.content, input);
  if (!content) return undefined;
  return {
    schemaVersion: DAILY_SENTENCE_SCHEMA_VERSION,
    promptVersion: DAILY_SENTENCE_PROMPT_VERSION,
    inputKey: buildDailySentenceInputKey(input),
    localDate: input.localDate,
    content,
    generatedAt: new Date(item.generatedAt).toISOString(),
    source: "ai",
  };
}

export function isCurrentDailySentenceCache(
  entry: DailySentenceCacheEntry | undefined,
  input: DailySentenceInput,
) {
  const normalized = normalizeDailySentenceCacheEntry(entry);
  return Boolean(
    normalized
    && normalized.localDate === input.localDate
    && normalized.inputKey === buildDailySentenceInputKey(input),
  );
}
