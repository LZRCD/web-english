import type { ReviewEvent } from "./learning.ts";
import type { QuizQuestion } from "./quiz.ts";
import type { Word } from "./study.ts";
import { localDateKey } from "./date-utils.ts";
import { clozeSentence } from "./word-utils.ts";

export const DAILY_CLOZE_SCHEMA_VERSION = 1 as const;
export const DAILY_CLOZE_PROMPT_VERSION = "daily-cloze-v1" as const;
export const MAX_DAILY_CLOZE_TARGETS = 10;
const MAX_PASSAGE_LENGTH = 2_000;
const MAX_OPTION_LENGTH = 80;
const MAX_EXPLANATION_LENGTH = 400;
const CLOZE_PLACEHOLDER = "＿＿＿＿";

export type DailyClozeTarget = {
  wordId: number;
  word: string;
  meaning: string;
};

export type DailyClozeInput = {
  localDate: string;
  targets: DailyClozeTarget[];
};

export type DailyClozeQuestion = {
  wordId: number;
  options: string[];
  explanation: string;
};

export type DailyClozeContent = {
  passage: string;
  questions: DailyClozeQuestion[];
};

export type DailyClozeCacheEntry = {
  schemaVersion: typeof DAILY_CLOZE_SCHEMA_VERSION;
  promptVersion: typeof DAILY_CLOZE_PROMPT_VERSION;
  inputKey: string;
  localDate: string;
  targetWordIds: number[];
  content: DailyClozeContent;
  generatedAt: string;
  source: "ai";
};

function validWordId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function isDailyClozeLocalDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day;
}

function validTarget(value: unknown): value is DailyClozeTarget {
  if (!value || typeof value !== "object") return false;
  const target = value as Partial<DailyClozeTarget>;
  return validWordId(target.wordId)
    && typeof target.word === "string"
    && Boolean(target.word.trim())
    && typeof target.meaning === "string"
    && Boolean(target.meaning.trim());
}

export function selectDailyNewWordTargets(
  reviews: readonly ReviewEvent[],
  words: readonly Word[],
  now: Date,
): DailyClozeTarget[] {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return [];
  const today = localDateKey(now);
  const wordById = new Map<number, Word>();
  for (const word of words) {
    if (!validWordId(word.id) || !word.word.trim() || !word.meaning.trim()) continue;
    if (!wordById.has(word.id)) wordById.set(word.id, word);
  }

  const seen = new Set<number>();
  return reviews
    .map((review, index) => ({
      review,
      index,
      reviewedAtMs: new Date(review.reviewedAt).getTime(),
    }))
    .filter(({ review, reviewedAtMs }) =>
      review.kind === "new"
      && validWordId(review.wordId)
      && Number.isFinite(reviewedAtMs)
      && reviewedAtMs <= nowMs
      && localDateKey(new Date(reviewedAtMs)) === today
      && wordById.has(review.wordId))
    .sort((first, second) =>
      first.reviewedAtMs - second.reviewedAtMs
      || first.review.id.localeCompare(second.review.id)
      || first.index - second.index)
    .flatMap(({ review }) => {
      const wordId = review.wordId!;
      if (seen.has(wordId)) return [];
      seen.add(wordId);
      const word = wordById.get(wordId)!;
      return [{
        wordId,
        word: word.word.trim(),
        meaning: word.meaning.trim(),
      }];
    })
    .slice(0, MAX_DAILY_CLOZE_TARGETS);
}

export function buildDailyClozeInputKey(input: DailyClozeInput) {
  return JSON.stringify({
    schemaVersion: DAILY_CLOZE_SCHEMA_VERSION,
    promptVersion: DAILY_CLOZE_PROMPT_VERSION,
    localDate: input.localDate,
    targets: input.targets.map(({ wordId, word, meaning }) => ({
      wordId,
      word,
      meaning,
    })),
  });
}

function englishWordCount(value: string) {
  return value.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)?.length ?? 0;
}

function normalizeOptions(value: unknown) {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const options = value.map((option) =>
    typeof option === "string" ? option.trim().slice(0, MAX_OPTION_LENGTH) : "");
  if (options.some((option) => !option)) return null;
  const unique = new Set(options.map((option) => option.normalize("NFKC").toLowerCase()));
  return unique.size === 4 ? options : null;
}

function normalizePassage(value: unknown) {
  if (typeof value !== "string") return null;
  const passage = value.trim();
  const wordCount = englishWordCount(passage);
  if (
    !passage
    || passage.length > MAX_PASSAGE_LENGTH
    || wordCount < 80
    || wordCount > 120
    || passage.includes(CLOZE_PLACEHOLDER)
    || /_{4,}/.test(passage)
    || /```/.test(passage)
  ) return null;
  return passage;
}

function normalizeQuestion(
  value: unknown,
  expectedWordId: number,
): DailyClozeQuestion | null {
  if (!value || typeof value !== "object") return null;
  const question = value as Partial<DailyClozeQuestion>;
  if (question.wordId !== expectedWordId) return null;
  const options = normalizeOptions(question.options);
  const explanation = typeof question.explanation === "string"
    ? question.explanation.trim().slice(0, MAX_EXPLANATION_LENGTH)
    : "";
  return options && explanation
    ? { wordId: expectedWordId, options, explanation }
    : null;
}

export function normalizeDailyClozeContent(
  value: unknown,
  input: DailyClozeInput,
): DailyClozeContent | null {
  if (
    !isDailyClozeLocalDate(input.localDate)
    || input.targets.length < 1
    || input.targets.length > MAX_DAILY_CLOZE_TARGETS
    || input.targets.some((target) => !validTarget(target))
    || new Set(input.targets.map(({ wordId }) => wordId)).size !== input.targets.length
    || !value
    || typeof value !== "object"
  ) return null;
  const content = value as Partial<DailyClozeContent>;
  const passage = normalizePassage(content.passage);
  if (!passage || !Array.isArray(content.questions)) return null;
  if (content.questions.length !== input.targets.length) return null;

  const questions: DailyClozeQuestion[] = [];
  for (let index = 0; index < input.targets.length; index += 1) {
    const target = input.targets[index];
    const question = normalizeQuestion(content.questions[index], target.wordId);
    if (!question || !question.options.includes(target.word)) return null;
    const clozed = clozeSentence(passage, target.word);
    if (!clozed || clozed.split(CLOZE_PLACEHOLDER).length - 1 !== 1) return null;
    questions.push(question);
  }
  return { passage, questions };
}

export function buildDailyClozeCacheEntry(
  input: DailyClozeInput,
  content: DailyClozeContent,
  generatedAt: Date,
): DailyClozeCacheEntry {
  return {
    schemaVersion: DAILY_CLOZE_SCHEMA_VERSION,
    promptVersion: DAILY_CLOZE_PROMPT_VERSION,
    inputKey: buildDailyClozeInputKey(input),
    localDate: input.localDate,
    targetWordIds: input.targets.map(({ wordId }) => wordId),
    content,
    generatedAt: generatedAt.toISOString(),
    source: "ai",
  };
}

export function normalizeDailyClozeCacheEntry(
  value: unknown,
): DailyClozeCacheEntry | undefined {
  if (!value || typeof value !== "object") return undefined;
  const entry = value as Partial<DailyClozeCacheEntry>;
  if (
    entry.schemaVersion !== DAILY_CLOZE_SCHEMA_VERSION
    || entry.promptVersion !== DAILY_CLOZE_PROMPT_VERSION
    || typeof entry.inputKey !== "string"
    || !entry.inputKey
    || !isDailyClozeLocalDate(entry.localDate)
    || entry.source !== "ai"
    || typeof entry.generatedAt !== "string"
    || !Number.isFinite(new Date(entry.generatedAt).getTime())
    || !Array.isArray(entry.targetWordIds)
    || entry.targetWordIds.length < 1
    || entry.targetWordIds.length > MAX_DAILY_CLOZE_TARGETS
    || entry.targetWordIds.some((wordId) => !validWordId(wordId))
    || new Set(entry.targetWordIds).size !== entry.targetWordIds.length
    || !entry.content
    || typeof entry.content !== "object"
  ) return undefined;
  const passage = normalizePassage(entry.content.passage);
  if (!passage || !Array.isArray(entry.content.questions)) return undefined;
  if (entry.content.questions.length !== entry.targetWordIds.length) return undefined;
  const questions = entry.targetWordIds.map((wordId, index) =>
    normalizeQuestion(entry.content!.questions[index], wordId));
  if (questions.some((question) => question === null)) return undefined;
  return {
    schemaVersion: DAILY_CLOZE_SCHEMA_VERSION,
    promptVersion: DAILY_CLOZE_PROMPT_VERSION,
    inputKey: entry.inputKey,
    localDate: entry.localDate,
    targetWordIds: [...entry.targetWordIds],
    content: {
      passage,
      questions: questions as DailyClozeQuestion[],
    },
    generatedAt: entry.generatedAt,
    source: "ai",
  };
}

export function isCurrentDailyClozeCache(
  entry: DailyClozeCacheEntry | undefined,
  input: DailyClozeInput,
) {
  const normalized = normalizeDailyClozeCacheEntry(entry);
  return Boolean(
    normalized
    && normalized.localDate === input.localDate
    && normalized.inputKey === buildDailyClozeInputKey(input)
    && normalizeDailyClozeContent(normalized.content, input),
  );
}

export function buildDailyClozeQuestions(
  entry: DailyClozeCacheEntry,
  words: readonly Word[],
): QuizQuestion[] {
  const wordById = new Map(words.flatMap((word) =>
    validWordId(word.id) ? [[word.id, word] as const] : []));
  return entry.content.questions.flatMap<QuizQuestion>((question, index) => {
    const word = wordById.get(question.wordId);
    if (!word) return [];
    const prompt = clozeSentence(entry.content.passage, word.word);
    if (!prompt || !question.options.includes(word.word)) return [];
    return [{
      id: `passage-cloze:${entry.localDate}:${question.wordId}:${index}`,
      mode: "passage-cloze",
      wordId: question.wordId,
      word,
      prompt,
      answer: word.word,
      options: [...question.options],
      label: "短文填词",
      explanation: question.explanation,
    }];
  });
}
