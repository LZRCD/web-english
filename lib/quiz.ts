import {
  isWeakProgress,
  type SenseFrequencyMap,
  type StubbornWordMap,
  type WordProgressMap,
} from "./learning.ts";
import type {
  FamiliarMeaningMap,
  LookupStats,
  LookupWord,
  Word,
} from "./study.ts";
import { seededScore, splitSenseItems } from "./word-utils.ts";

export type QuizMode =
  | "listening-spelling"
  | "chinese-to-english"
  | "meaning-choice";

export type QuizQuestion = {
  id: string;
  mode: QuizMode;
  wordId: number;
  word: Word;
  prompt: string;
  answer: string;
  options?: string[];
  label: "听音拼写" | "中译英" | "熟词僻义" | "近义辨析";
  explanation: string;
};

export type QuizModeDefinition = {
  id: QuizMode;
  title: string;
  description: string;
  minimumLearnedWords: number;
};

export const QUIZ_MODE_DEFINITIONS: QuizModeDefinition[] = [
  {
    id: "listening-spelling",
    title: "听音拼写",
    description: "只听红宝书原声，完整输入听到的单词。",
    minimumLearnedWords: 1,
  },
  {
    id: "chinese-to-english",
    title: "看中文输入英文",
    description: "根据红宝书释义主动写出英文，不依赖词形提示。",
    minimumLearnedWords: 1,
  },
  {
    id: "meaning-choice",
    title: "熟词僻义、近义词辨析",
    description: "优先抽取未熟练义项，并用相近释义形成干扰项。",
    minimumLearnedWords: 4,
  },
];

function normalizeAnswer(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}
export function isQuizAnswerCorrect(
  question: Pick<QuizQuestion, "answer">,
  answer: string,
) {
  return Boolean(normalizeAnswer(answer))
    && normalizeAnswer(answer) === normalizeAnswer(question.answer);
}

export type QuizAttempt = {
  id: string;
  wordId: number;
  mode: QuizMode;
  correct: boolean;
  recallMs: number;
  answeredAt: string;
  /** 本次作答是否写入了 FSRS 排程（每日首次/到期词首次） */
  appliedToSchedule: boolean;
};

/** 未完成测验的持久化进度：按 seed 重建同一组题目，避免刷新丢失。 */
export type QuizSessionState = {
  id: string;
  mode: QuizMode;
  seed: number;
  index: number;
  correctCount: number;
  answers: Record<string, { answer: string; correct: boolean }>;
  complete: boolean;
  startedAt: string;
};

export function createQuizSession(
  mode: QuizMode,
  seed: number,
  now = new Date(),
): QuizSessionState {
  return {
    id: `quiz:${mode}:${seed}:${now.getTime()}`,
    mode,
    seed,
    index: 0,
    correctCount: 0,
    answers: {},
    complete: false,
    startedAt: now.toISOString(),
  };
}

/** 用已保存的 seed 重建同一组题目（选项与顺序均与当时一致）。 */
export function restoreQuizQuestions(
  session: Pick<QuizSessionState, "mode" | "seed">,
  words: Word[],
  progress: WordProgressMap,
  familiarMeanings: FamiliarMeaningMap,
  signals?: Pick<Parameters<typeof buildQuizQuestions>[0],
    | "lookupStats"
    | "lookupWords"
    | "senseFrequency"
    | "stubbornWords">,
) {
  return buildQuizQuestions({
    words,
    progress,
    familiarMeanings,
    mode: session.mode,
    count: 10,
    seed: session.seed,
    ...signals,
  });
}

/**
 * 测验是否应写入 FSRS 排程：仅每个词「每日首次有效作答」写入，
 * 避免反复「再来一组」不断改写同一批词的排程。
 */
export function shouldApplyQuizToSchedule(
  attempts: readonly QuizAttempt[],
  wordId: number,
  now: Date,
) {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return !attempts.some(
    (attempt) =>
      attempt.wordId === wordId
      && attempt.answeredAt.slice(0, 10) === today,
  );
}
function wordId(word: Word): word is Word & { id: number } {
  return Number.isSafeInteger(word.id);
}

function wordSenses(word: Word) {
  const normalized = word.meaning.replace(
    /(?:^|\s)(?:vlink|modal|usage|prep|conj|pron|suff|pref|adj|adv|det|int|num|aux|ord|vi|vt|n|v)\.\s*/gi,
    ";",
  ).replace(/^;+/, "");
  return splitSenseItems(normalized)
    .map((item) => item.trim())
    .filter(Boolean);
}

function shuffled<T>(items: readonly T[], seed: number, key: (item: T) => string) {
  return [...items].sort((first, second) =>
    seededScore(key(first), seed) - seededScore(key(second), seed));
}

function sharedMeaningScore(first: Word, second: Word) {
  const firstCharacters = new Set(
    [...first.meaning].filter((character) => /[\u3400-\u9fff]/.test(character)),
  );
  const secondCharacters = new Set(
    [...second.meaning].filter((character) => /[\u3400-\u9fff]/.test(character)),
  );
  let shared = 0;
  for (const character of firstCharacters) {
    if (secondCharacters.has(character)) shared += 1;
  }
  const samePart = wordSenses(first)[0] && wordSenses(second)[0]
    ? Number(first.meaning.split(".")[0] === second.meaning.split(".")[0])
    : 0;
  return shared * 4 + samePart;
}

function distinctOptions(
  answer: string,
  candidates: readonly string[],
  seed: number,
) {
  const seen = new Set([answer]);
  const distractors = candidates.filter((candidate) => {
    const normalized = candidate.trim();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  }).slice(0, 3);
  return shuffled([answer, ...distractors], seed, (item) => item);
}

function buildMeaningQuestion(
  word: Word & { id: number },
  learnedWords: readonly (Word & { id: number })[],
  familiarMeanings: FamiliarMeaningMap,
  seed: number,
): QuizQuestion | undefined {
  const senses = wordSenses(word);
  const familiar = new Set(familiarMeanings[word.id] ?? []);
  const unfamiliar = senses.filter((sense) => !familiar.has(sense));
  const targetSense = unfamiliar.at(-1) ?? senses.at(-1);
  if (!targetSense) return undefined;

  const related = learnedWords
    .filter((candidate) => candidate.id !== word.id)
    .sort((first, second) => {
      const similarity = sharedMeaningScore(word, second)
        - sharedMeaningScore(word, first);
      return similarity || first.id - second.id;
    });

  if (senses.length > 1) {
    const options = distinctOptions(
      targetSense,
      related.flatMap((candidate) => wordSenses(candidate).slice(-1)),
      seed,
    );
    if (options.length < 4) return undefined;
    return {
      id: `meaning-choice:${word.id}:${seed}`,
      mode: "meaning-choice",
      wordId: word.id,
      word,
      prompt: `“${word.word}”较容易忽略的义项是？`,
      answer: targetSense,
      options,
      label: "熟词僻义",
      explanation: `${word.word}：${word.meaning}`,
    };
  }

  const options = distinctOptions(
    word.word,
    related.map((candidate) => candidate.word),
    seed,
  );
  if (options.length < 4) return undefined;
  return {
    id: `meaning-choice:${word.id}:${seed}`,
    mode: "meaning-choice",
    wordId: word.id,
    word,
    prompt: `哪个单词最符合“${targetSense}”？`,
    answer: word.word,
    options,
    label: "近义辨析",
    explanation: `${word.word}：${word.meaning}`,
  };
}

/** 出题信号：划词查询次数（按学习项 id 归并）、义项考频、顽固词 */
type QuestionSignals = {
  lookupCountByWordId: Map<number, number>;
  senseFrequency?: SenseFrequencyMap;
  stubbornWords?: StubbornWordMap;
};

/** 把划词查询次数按学习项 id 归并（linkedWordId 优先，无则用划词自身 id） */
function lookupCountByWordId(
  lookupStats?: LookupStats,
  lookupWords?: LookupWord[],
) {
  const map = new Map<number, number>();
  if (!lookupStats || !lookupWords) return map;
  for (const word of lookupWords) {
    const count = lookupStats[word.query.trim().toLowerCase()]?.count ?? 0;
    if (!count) continue;
    const id = word.linkedWordId ?? word.id;
    map.set(id, Math.max(map.get(id) ?? 0, count));
  }
  return map;
}

function candidatePriority(
  word: Word & { id: number },
  progress: WordProgressMap,
  signals: QuestionSignals,
) {
  const item = progress[word.id];
  let priority = item
    ? (isWeakProgress(item) ? 1_000_000 : 0)
      + item.lapseCount * 10_000
      + (item.lastRating <= 1 ? 1_000 : 0)
      - item.consecutiveSuccesses * 10
    : 0;
  // 信号加成都低于「薄弱词」权重，保持现有语义：薄弱词仍最先出题
  const lookupCount = signals.lookupCountByWordId.get(word.id) ?? 0;
  priority += Math.min(40_000, lookupCount * 8_000);
  if (signals.stubbornWords?.[word.id]?.active) priority += 25_000;
  const frequencyEntries = signals.senseFrequency?.[word.id];
  if (frequencyEntries?.length) {
    let frequencyBoost = 0;
    for (const entry of frequencyEntries) {
      if (entry.level === "low") frequencyBoost += 1_500;
      else if (entry.level === "medium") frequencyBoost += 800;
    }
    priority += Math.min(15_000, frequencyBoost);
  }
  return priority;
}

export function buildQuizQuestions(input: {
  words: readonly Word[];
  progress: WordProgressMap;
  familiarMeanings?: FamiliarMeaningMap;
  mode: QuizMode;
  count?: number;
  seed?: number;
  /** 划词查询统计：查得多的词优先出题 */
  lookupStats?: LookupStats;
  /** 划词记录：把查询词归并回学习项 */
  lookupWords?: LookupWord[];
  /** 义项考频：低频义项多的词优先出题 */
  senseFrequency?: SenseFrequencyMap;
  /** 顽固词：活跃顽固词优先出题 */
  stubbornWords?: StubbornWordMap;
}) {
  const count = Math.max(1, Math.min(30, Math.trunc(input.count ?? 10)));
  const seed = Number.isFinite(input.seed) ? Math.trunc(input.seed!) : Date.now();
  const learnedWords = input.words.filter(wordId).filter((word) =>
    Boolean(input.progress[word.id]));
  const signals: QuestionSignals = {
    lookupCountByWordId: lookupCountByWordId(input.lookupStats, input.lookupWords),
    senseFrequency: input.senseFrequency,
    stubbornWords: input.stubbornWords,
  };
  const candidates = shuffled(learnedWords, seed, (word) => String(word.id))
    .sort((first, second) =>
      candidatePriority(second, input.progress, signals)
      - candidatePriority(first, input.progress, signals));

  return candidates.flatMap<QuizQuestion>((word, index) => {
    if (input.mode === "listening-spelling") {
      return [{
        id: `${input.mode}:${word.id}:${seed}`,
        mode: input.mode,
        wordId: word.id,
        word,
        prompt: "播放发音后，输入你听到的完整单词",
        answer: word.word,
        label: "听音拼写",
        explanation: `${word.word}：${word.meaning}`,
      }];
    }
    if (input.mode === "chinese-to-english") {
      return [{
        id: `${input.mode}:${word.id}:${seed}`,
        mode: input.mode,
        wordId: word.id,
        word,
        prompt: word.meaning,
        answer: word.word,
        label: "中译英",
        explanation: `${word.word}：${word.meaning}`,
      }];
    }
    const question = buildMeaningQuestion(
      word,
      learnedWords,
      input.familiarMeanings ?? {},
      seed + index,
    );
    return question ? [question] : [];
  }).slice(0, count);
}
