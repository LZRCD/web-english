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
import { localDateKey } from "./date-utils.ts";

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

/** activeQuiz 中持久化的题目呈现快照；运行时 Word 仍从当前有效词条解析。 */
export type QuizQuestionSnapshot = Omit<QuizQuestion, "word">;

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

/** 按原顺序追加作答历史，不静默丢弃合法旧记录。 */
export function appendQuizAttempt(
  attempts: readonly QuizAttempt[],
  attempt: QuizAttempt,
) {
  return [...attempts, attempt];
}

export const MAX_QUIZ_QUESTION_WORD_IDS = 30;
const QUIZ_QUESTION_LABELS = new Set<QuizQuestion["label"]>([
  "听音拼写",
  "中译英",
  "熟词僻义",
  "近义辨析",
]);

/** 清洗持久化题组快照：只保留有序、唯一的有效学习项 id。 */
export function normalizeQuizQuestionWordIds(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<number>();
  const wordIds: number[] = [];
  for (const item of value) {
    if (typeof item !== "number" || !Number.isSafeInteger(item) || item <= 0) {
      continue;
    }
    if (seen.has(item)) continue;
    seen.add(item);
    wordIds.push(item);
    if (wordIds.length >= MAX_QUIZ_QUESTION_WORD_IDS) break;
  }
  return wordIds;
}

/** 清洗完整题目快照：限制数量、去重目标，并拒绝无法安全呈现的题目。 */
export function normalizeQuizQuestionSnapshots(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const seenWordIds = new Set<number>();
  const snapshots: QuizQuestionSnapshot[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Partial<QuizQuestionSnapshot>;
    if (
      typeof record.id !== "string"
      || !record.id
      || !QUIZ_MODE_DEFINITIONS.some(({ id }) => id === record.mode)
      || typeof record.wordId !== "number"
      || !Number.isSafeInteger(record.wordId)
      || record.wordId <= 0
      || typeof record.prompt !== "string"
      || !record.prompt
      || typeof record.answer !== "string"
      || !record.answer
      || typeof record.label !== "string"
      || !QUIZ_QUESTION_LABELS.has(record.label as QuizQuestion["label"])
      || typeof record.explanation !== "string"
      || seenWordIds.has(record.wordId)
    ) {
      continue;
    }
    const options = Array.isArray(record.options)
      ? Array.from(new Set(record.options.filter(
          (option): option is string => typeof option === "string" && Boolean(option),
        ))).slice(0, 4)
      : undefined;
    if (
      record.mode === "meaning-choice"
      && (options?.length !== 4 || !options.includes(record.answer))
    ) {
      continue;
    }
    seenWordIds.add(record.wordId);
    snapshots.push({
      id: record.id,
      mode: record.mode as QuizMode,
      wordId: record.wordId,
      prompt: record.prompt,
      answer: record.answer,
      ...(record.mode === "meaning-choice" ? { options } : {}),
      label: record.label as QuizQuestion["label"],
      explanation: record.explanation,
    });
    if (snapshots.length >= MAX_QUIZ_QUESTION_WORD_IDS) break;
  }
  return snapshots;
}

export function snapshotQuizQuestions(
  questions: readonly QuizQuestion[],
): QuizQuestionSnapshot[] {
  return questions.slice(0, MAX_QUIZ_QUESTION_WORD_IDS).map((question) => ({
    id: question.id,
    mode: question.mode,
    wordId: question.wordId,
    prompt: question.prompt,
    answer: question.answer,
    ...(question.options ? { options: [...question.options] } : {}),
    label: question.label,
    explanation: question.explanation,
  }));
}

/** 未完成测验的持久化进度：按题组快照与 seed 精确恢复。 */
export type QuizSessionState = {
  id: string;
  mode: QuizMode;
  seed: number;
  /** 实际生成题目的目标词 id，有序快照；旧会话可缺省。 */
  questionWordIds?: number[];
  /** 题干、正确答案与选项快照；旧的仅 id 会话可缺省。 */
  questionSnapshots?: QuizQuestionSnapshot[];
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
  session: Pick<QuizSessionState,
    "mode" | "seed" | "questionWordIds" | "questionSnapshots">,
  words: Word[],
  progress: WordProgressMap,
  familiarMeanings: FamiliarMeaningMap,
  signals?: Pick<Parameters<typeof buildQuizQuestions>[0],
    | "lookupStats"
    | "lookupWords"
    | "senseFrequency"
    | "stubbornWords"
    | "candidateWordIds">,
) {
  const snapshots = normalizeQuizQuestionSnapshots(session.questionSnapshots);
  if (snapshots !== undefined) {
    const learnedWordById = new Map(
      words.filter(wordId).filter((word) => Boolean(progress[word.id]))
        .map((word) => [word.id, word]),
    );
    return snapshots.flatMap<QuizQuestion>((snapshot) => {
      if (snapshot.mode !== session.mode) return [];
      const word = learnedWordById.get(snapshot.wordId);
      return word
        ? [{
            ...snapshot,
            ...(snapshot.options ? { options: [...snapshot.options] } : {}),
            word,
          }]
        : [];
    }).slice(0, 10);
  }
  return buildQuizQuestions({
    words,
    progress,
    familiarMeanings,
    mode: session.mode,
    count: 10,
    seed: session.seed,
    ...signals,
    questionWordIds: session.questionWordIds,
  });
}

export type QuizSessionRecovery = {
  session?: QuizSessionState;
  removedCount: number;
  status: "unchanged" | "partial" | "cleared";
};

/** 按恢复后的有效题集合协调进度、作答、正确数、完成态和结果分母。 */
export function recoverQuizSession(
  session: QuizSessionState,
  restoredQuestions: readonly QuizQuestion[],
): QuizSessionRecovery {
  const sourceWordIds = session.questionWordIds;
  if (sourceWordIds === undefined) {
    return { session, removedCount: 0, status: "unchanged" };
  }
  const restoredByWordId = new Map(
    restoredQuestions.map((question) => [question.wordId, question]),
  );
  const questions = sourceWordIds.flatMap((wordId) => {
    const question = restoredByWordId.get(wordId);
    return question ? [question] : [];
  });
  const removedCount = Math.max(0, sourceWordIds.length - questions.length);
  if (!questions.length) return { removedCount, status: "cleared" };
  if (removedCount === 0) {
    return { session, removedCount: 0, status: "unchanged" };
  }

  const questionIds = new Set(questions.map((question) => question.id));
  const answers = Object.fromEntries(
    Object.entries(session.answers).filter(([questionId]) =>
      questionIds.has(questionId)),
  );
  const completedBoundary = Math.min(
    sourceWordIds.length,
    Math.max(0, Math.trunc(session.index)),
  );
  const validWordIds = new Set(questions.map((question) => question.wordId));
  const index = Math.min(
    sourceWordIds.slice(0, completedBoundary)
      .filter((wordId) => validWordIds.has(wordId)).length,
    questions.length - 1,
  );
  return {
    session: {
      ...session,
      questionWordIds: questions.map((question) => question.wordId),
      questionSnapshots: snapshotQuizQuestions(questions),
      index,
      correctCount: Object.values(answers)
        .filter((answer) => answer.correct).length,
      answers,
      complete: questions.every((question) => Boolean(answers[question.id])),
    },
    removedCount,
    status: "partial",
  };
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
  const today = localDateKey(now);
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

function buildQuizExplanation(word: Word, relationship: string) {
  const context = [
    ["音标", word.phonetic],
    ["词性", word.part],
    ["例句", word.sentence],
    ["译文", word.translation],
  ].flatMap(([label, value]) => {
    const normalized = value?.trim();
    return normalized ? [`${label}：${normalized}。`] : [];
  });
  return [relationship, ...context].join(" ");
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
      explanation: buildQuizExplanation(
        word,
        `单词“${word.word}”的义项“${targetSense}”是本题的正确答案；完整释义为“${word.meaning}”。`,
      ),
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
    explanation: buildQuizExplanation(
      word,
      `题干“${targetSense}”对应英文单词“${word.word}”；该词完整释义为“${word.meaning}”。`,
    ),
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
  } else if (wordSenses(word).length >= 3) {
    // 冷启动代理：多义词未生成考频时给一个中等加分（低于低频考频、高于普通词）
    priority += 1_000;
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
  /** 维度化处置限定词集；干扰项仍可复用全部已学词。 */
  candidateWordIds?: readonly number[];
  /** 恢复时使用的实际题目目标词有序快照；优先于实时候选与优先级。 */
  questionWordIds?: readonly number[];
}) {
  const count = Math.max(1, Math.min(
    MAX_QUIZ_QUESTION_WORD_IDS,
    Math.trunc(input.count ?? 10),
  ));
  const seed = Number.isFinite(input.seed) ? Math.trunc(input.seed!) : Date.now();
  const learnedWords = input.words.filter(wordId).filter((word) =>
    Boolean(input.progress[word.id]));
  const signals: QuestionSignals = {
    lookupCountByWordId: lookupCountByWordId(input.lookupStats, input.lookupWords),
    senseFrequency: input.senseFrequency,
    stubbornWords: input.stubbornWords,
  };
  const candidateWordIds = input.candidateWordIds
    ? new Set(input.candidateWordIds)
    : undefined;
  const snapshotWordIds = normalizeQuizQuestionWordIds(input.questionWordIds);
  const learnedWordById = new Map(learnedWords.map((word) => [word.id, word]));
  const candidates = snapshotWordIds === undefined
    ? shuffled(
      candidateWordIds
        ? learnedWords.filter((word) => candidateWordIds.has(word.id))
        : learnedWords,
      seed,
      (word) => String(word.id),
    )
      .sort((first, second) =>
        candidatePriority(second, input.progress, signals)
        - candidatePriority(first, input.progress, signals))
      .map((word, index) => ({ word, seedOffset: index }))
    : snapshotWordIds.flatMap((id, seedOffset) => {
      const word = learnedWordById.get(id);
      return word ? [{ word, seedOffset }] : [];
    });

  return candidates.flatMap<QuizQuestion>(({ word, seedOffset }) => {
    if (input.mode === "listening-spelling") {
      return [{
        id: `${input.mode}:${word.id}:${seed}`,
        mode: input.mode,
        wordId: word.id,
        word,
        prompt: "播放发音后，输入你听到的完整单词",
        answer: word.word,
        label: "听音拼写",
        explanation: buildQuizExplanation(
          word,
          `本题播放的发音对应单词“${word.word}”，该词表示“${word.meaning}”。`,
        ),
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
        explanation: buildQuizExplanation(
          word,
          `题干“${word.meaning}”对应英文单词“${word.word}”。`,
        ),
      }];
    }
    const question = buildMeaningQuestion(
      word,
      learnedWords,
      input.familiarMeanings ?? {},
      seed + seedOffset,
    );
    return question ? [question] : [];
  }).slice(0, count);
}
