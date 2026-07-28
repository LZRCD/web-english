export const REDBOOK_SOURCE_TOTAL = 6550;

const CANONICAL_WORD_IDS: Record<number, number> = {
  6177: 2506,
};

export function canonicalWordId(wordId: number) {
  return CANONICAL_WORD_IDS[wordId] ?? wordId;
}

export function isPrimaryLearningWord(wordId?: number) {
  return wordId === undefined || canonicalWordId(wordId) === wordId;
}
