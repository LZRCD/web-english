import { isPrimaryLearningWord } from "./redbook.ts";
import type { Word } from "./study.ts";

export const VOCAB_TEST_SECTIONS = ["必考词", "基础词", "超纲词"] as const;
export type VocabTestSection = (typeof VOCAB_TEST_SECTIONS)[number];

export const VOCAB_TEST_TARGETS: Record<VocabTestSection, number> = {
  必考词: 1856,
  基础词: 3680,
  超纲词: 1014,
};

export const VOCAB_TEST_LAYER_QUOTAS: Record<VocabTestSection, number> = {
  必考词: 6,
  基础词: 11,
  超纲词: 3,
};

export const VOCAB_TEST_TOTAL_TARGET = 6550;
export const VOCAB_TEST_LAYER_SIZE = 100;
export const VOCAB_TEST_SAMPLE_SIZE = 3;

export type VocabTestWord = {
  id: number;
  word: string;
  section: VocabTestSection;
};

export type VocabTestLayer = {
  section: VocabTestSection;
  index: number;
  words: VocabTestWord[];
};

export type VocabTestLayers = Record<VocabTestSection, VocabTestLayer[]>;

export type VocabTestQuestion = VocabTestWord & {
  layerIndex: number;
};

export type VocabTestAnswer = VocabTestQuestion & {
  known: boolean;
};

export type VocabTestLayerOutcome = {
  layerIndex: number;
  known: boolean;
};

type VocabTestSectionState = {
  visitedLayerIndexes: number[];
  outcomes: VocabTestLayerOutcome[];
};

export type VocabTestSession = {
  seed: number;
  layers: VocabTestLayers;
  sectionStates: Record<VocabTestSection, VocabTestSectionState>;
  sectionIndex: number;
  currentLayerIndex?: number;
  currentQuestions: VocabTestQuestion[];
  currentQuestionIndex: number;
  answers: VocabTestAnswer[];
  expectedQuestionCount: number;
  complete: boolean;
};

export type VocabTestEstimate = {
  total: number;
  bySection: Record<VocabTestSection, number>;
  actualQuestionCount: number;
  unknownCount: number;
};

function emptyLayers(): VocabTestLayers {
  return { 必考词: [], 基础词: [], 超纲词: [] };
}

function emptySectionStates(): Record<VocabTestSection, VocabTestSectionState> {
  return {
    必考词: { visitedLayerIndexes: [], outcomes: [] },
    基础词: { visitedLayerIndexes: [], outcomes: [] },
    超纲词: { visitedLayerIndexes: [], outcomes: [] },
  };
}

function isVocabTestSection(value?: string): value is VocabTestSection {
  return VOCAB_TEST_SECTIONS.includes(value as VocabTestSection);
}

/** 按红宝书现有顺序，把三个分册的主学习项分别切成每层最多 100 词。 */
export function buildVocabTestLayers(words: readonly Word[]): VocabTestLayers {
  const grouped: Record<VocabTestSection, VocabTestWord[]> = {
    必考词: [],
    基础词: [],
    超纲词: [],
  };
  const seenWordIds = new Set<number>();

  for (const word of words) {
    if (
      word.id === undefined
      || !Number.isSafeInteger(word.id)
      || word.id <= 0
      || !isPrimaryLearningWord(word.id)
      || !isVocabTestSection(word.section)
      || seenWordIds.has(word.id)
    ) {
      continue;
    }
    seenWordIds.add(word.id);
    grouped[word.section].push({
      id: word.id,
      word: word.word,
      section: word.section,
    });
  }

  const result = emptyLayers();
  for (const section of VOCAB_TEST_SECTIONS) {
    const sectionWords = grouped[section];
    result[section] = Array.from(
      { length: Math.ceil(sectionWords.length / VOCAB_TEST_LAYER_SIZE) },
      (_, index) => ({
        section,
        index,
        words: sectionWords.slice(
          index * VOCAB_TEST_LAYER_SIZE,
          (index + 1) * VOCAB_TEST_LAYER_SIZE,
        ),
      }),
    );
  }
  return result;
}

function mixedHash(value: number) {
  let hash = value | 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  return (hash ^ (hash >>> 16)) >>> 0;
}

/** 固定 seed 的层内抽样；不修改层内原数组。 */
export function sampleVocabTestLayer(
  layer: VocabTestLayer,
  seed: number,
  excludedWordIds: readonly number[] = [],
): VocabTestQuestion[] {
  const excluded = new Set(excludedWordIds);
  const sectionSalt = VOCAB_TEST_SECTIONS.indexOf(layer.section) + 1;
  return layer.words
    .filter((word) => !excluded.has(word.id))
    .map((word, index) => ({
      word,
      index,
      score: mixedHash(
        (Math.trunc(seed) || 1)
        ^ Math.imul(sectionSalt, 0x9e3779b1)
        ^ Math.imul(layer.index + 1, 0x85ebca6b)
        ^ Math.imul(word.id, 0xc2b2ae35),
      ),
    }))
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .slice(0, VOCAB_TEST_SAMPLE_SIZE)
    .map(({ word }) => ({ ...word, layerIndex: layer.index }));
}

export function selectNextVocabTestLayer(input: {
  layerCount: number;
  currentLayerIndex: number;
  majorityKnown: boolean;
  visitedLayerIndexes: readonly number[];
  outcomes?: readonly VocabTestLayerOutcome[];
}): number | undefined {
  const visited = new Set(input.visitedLayerIndexes);
  const unvisited = Array.from(
    { length: Math.max(0, input.layerCount) },
    (_, index) => index,
  ).filter((index) => !visited.has(index));
  if (!unvisited.length) return undefined;

  const directional = unvisited.filter((index) =>
    input.majorityKnown
      ? index > input.currentLayerIndex
      : index < input.currentLayerIndex);
  if (directional.length) {
    return directional[Math.floor((directional.length - 1) / 2)];
  }

  const outcomes = input.outcomes ?? [];
  const knownIndexes = outcomes
    .filter((outcome) => outcome.known)
    .map((outcome) => outcome.layerIndex);
  const unknownIndexes = outcomes
    .filter((outcome) => !outcome.known)
    .map((outcome) => outcome.layerIndex);
  const knownBoundary = knownIndexes.length ? Math.max(...knownIndexes) + 0.5 : -0.5;
  const unknownBoundary = unknownIndexes.length ? Math.min(...unknownIndexes) - 0.5 : input.layerCount - 0.5;
  const estimatedBoundary = (knownBoundary + unknownBoundary) / 2;

  return [...unvisited].sort((left, right) =>
    Math.abs(left - estimatedBoundary) - Math.abs(right - estimatedBoundary)
    || (input.majorityKnown ? right - left : left - right))[0];
}

function expectedQuestionCount(layers: VocabTestLayers) {
  return VOCAB_TEST_SECTIONS.reduce((total, section) => {
    const sectionLayers = layers[section];
    const layerLimit = Math.min(
      VOCAB_TEST_LAYER_QUOTAS[section],
      sectionLayers.length,
    );
    const itemCount = sectionLayers.reduce(
      (sum, layer) => sum + layer.words.length,
      0,
    );
    return total + Math.min(itemCount, layerLimit * VOCAB_TEST_SAMPLE_SIZE);
  }, 0);
}

function openFirstAvailableSection(session: VocabTestSession): VocabTestSession {
  for (
    let sectionIndex = session.sectionIndex;
    sectionIndex < VOCAB_TEST_SECTIONS.length;
    sectionIndex += 1
  ) {
    const section = VOCAB_TEST_SECTIONS[sectionIndex];
    const layers = session.layers[section];
    if (!layers.length) continue;
    const layerIndex = Math.floor((layers.length - 1) / 2);
    const questions = sampleVocabTestLayer(
      layers[layerIndex],
      session.seed,
      session.answers.map((answer) => answer.id),
    );
    if (!questions.length) continue;
    return {
      ...session,
      sectionIndex,
      currentLayerIndex: layerIndex,
      currentQuestions: questions,
      currentQuestionIndex: 0,
      sectionStates: {
        ...session.sectionStates,
        [section]: {
          ...session.sectionStates[section],
          visitedLayerIndexes: [layerIndex],
        },
      },
    };
  }
  return {
    ...session,
    sectionIndex: VOCAB_TEST_SECTIONS.length,
    currentLayerIndex: undefined,
    currentQuestions: [],
    currentQuestionIndex: 0,
    complete: true,
  };
}

export function createVocabTestSession(
  words: readonly Word[],
  seed: number,
): VocabTestSession {
  const layers = buildVocabTestLayers(words);
  return openFirstAvailableSection({
    seed: Math.trunc(seed) || 1,
    layers,
    sectionStates: emptySectionStates(),
    sectionIndex: 0,
    currentQuestions: [],
    currentQuestionIndex: 0,
    answers: [],
    expectedQuestionCount: expectedQuestionCount(layers),
    complete: false,
  });
}

export function currentVocabTestQuestion(
  session: VocabTestSession,
): VocabTestQuestion | undefined {
  return session.currentQuestions[session.currentQuestionIndex];
}

export function answerVocabTestQuestion(
  session: VocabTestSession,
  known: boolean,
): VocabTestSession {
  const question = currentVocabTestQuestion(session);
  if (!question || session.complete) return session;
  const answer: VocabTestAnswer = { ...question, known };
  const answers = [...session.answers, answer];
  if (session.currentQuestionIndex + 1 < session.currentQuestions.length) {
    return {
      ...session,
      answers,
      currentQuestionIndex: session.currentQuestionIndex + 1,
    };
  }

  const section = VOCAB_TEST_SECTIONS[session.sectionIndex];
  const currentLayerIndex = session.currentLayerIndex;
  if (section === undefined || currentLayerIndex === undefined) {
    return { ...session, answers, complete: true };
  }
  const layerAnswers = answers.filter((item) =>
    item.section === section && item.layerIndex === currentLayerIndex);
  const knownCount = layerAnswers.filter((item) => item.known).length;
  const majorityKnown = knownCount >= Math.min(2, layerAnswers.length);
  const sectionState = session.sectionStates[section];
  const outcomes = [
    ...sectionState.outcomes,
    { layerIndex: currentLayerIndex, known: majorityKnown },
  ];
  const updatedSectionState = { ...sectionState, outcomes };
  const sectionStates = {
    ...session.sectionStates,
    [section]: updatedSectionState,
  };
  const quotaReached = updatedSectionState.visitedLayerIndexes.length
    >= Math.min(
      VOCAB_TEST_LAYER_QUOTAS[section],
      session.layers[section].length,
    );

  if (!quotaReached) {
    const nextLayerIndex = selectNextVocabTestLayer({
      layerCount: session.layers[section].length,
      currentLayerIndex,
      majorityKnown,
      visitedLayerIndexes: updatedSectionState.visitedLayerIndexes,
      outcomes,
    });
    if (nextLayerIndex !== undefined) {
      const nextQuestions = sampleVocabTestLayer(
        session.layers[section][nextLayerIndex],
        session.seed,
        answers.map((item) => item.id),
      );
      if (nextQuestions.length) {
        return {
          ...session,
          answers,
          sectionStates: {
            ...sectionStates,
            [section]: {
              ...updatedSectionState,
              visitedLayerIndexes: [
                ...updatedSectionState.visitedLayerIndexes,
                nextLayerIndex,
              ],
            },
          },
          currentLayerIndex: nextLayerIndex,
          currentQuestions: nextQuestions,
          currentQuestionIndex: 0,
        };
      }
    }
  }

  return openFirstAvailableSection({
    ...session,
    answers,
    sectionStates,
    sectionIndex: session.sectionIndex + 1,
    currentLayerIndex: undefined,
    currentQuestions: [],
    currentQuestionIndex: 0,
  });
}

export function collectUnknownVocabTestWordIds(
  answers: readonly VocabTestAnswer[],
) {
  const result: number[] = [];
  const seen = new Set<number>();
  for (const answer of answers) {
    if (answer.known || seen.has(answer.id)) continue;
    seen.add(answer.id);
    result.push(answer.id);
  }
  return result;
}

export function estimateVocabTestSection(
  section: VocabTestSection,
  layerCount: number,
  answers: readonly VocabTestAnswer[],
) {
  const target = VOCAB_TEST_TARGETS[section];
  const relevant = answers.filter((answer) => answer.section === section);
  if (!relevant.length || layerCount <= 0) return 0;

  let minimumError = Number.POSITIVE_INFINITY;
  const bestBoundaries: number[] = [];
  for (let boundary = 0; boundary <= layerCount; boundary += 1) {
    const error = relevant.reduce((sum, answer) => {
      const predictedKnown = answer.layerIndex < boundary;
      return sum + Number(predictedKnown !== answer.known);
    }, 0);
    if (error < minimumError) {
      minimumError = error;
      bestBoundaries.splice(0, bestBoundaries.length, boundary);
    } else if (error === minimumError) {
      bestBoundaries.push(boundary);
    }
  }
  const boundary = bestBoundaries.reduce((sum, value) => sum + value, 0)
    / bestBoundaries.length;
  return Math.max(
    0,
    Math.min(target, Math.round(boundary / layerCount * target)),
  );
}

export function estimateVocabTest(session: VocabTestSession): VocabTestEstimate {
  const bySection = Object.fromEntries(
    VOCAB_TEST_SECTIONS.map((section) => [
      section,
      estimateVocabTestSection(
        section,
        session.layers[section].length,
        session.answers,
      ),
    ]),
  ) as Record<VocabTestSection, number>;
  return {
    total: Math.min(
      VOCAB_TEST_TOTAL_TARGET,
      VOCAB_TEST_SECTIONS.reduce(
        (sum, section) => sum + bySection[section],
        0,
      ),
    ),
    bySection,
    actualQuestionCount: session.answers.length,
    unknownCount: collectUnknownVocabTestWordIds(session.answers).length,
  };
}
