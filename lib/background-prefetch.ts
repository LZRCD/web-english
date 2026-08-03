export const MAX_DICTIONARY_PREFETCH_LETTERS = 3;
export const MAX_DICTIONARY_LETTER_INDEX_BYTES = 64_000;
export const MAX_DICTIONARY_PREFETCH_BYTES =
  MAX_DICTIONARY_PREFETCH_LETTERS * MAX_DICTIONARY_LETTER_INDEX_BYTES;

export type NetworkConnectionSnapshot = {
  saveData?: boolean;
  effectiveType?: string;
};

export type BackgroundPrefetchEnvironment = {
  online?: boolean;
  visibilityState?: DocumentVisibilityState;
  connection?: NetworkConnectionSnapshot;
};

/** 只在前台、联网且非省流量/2G 环境执行非关键资源预取。 */
export function allowsBackgroundPrefetch({
  online = true,
  visibilityState = "visible",
  connection,
}: BackgroundPrefetchEnvironment = {}) {
  if (!online || visibilityState !== "visible" || connection?.saveData) {
    return false;
  }
  return connection?.effectiveType !== "slow-2g"
    && connection?.effectiveType !== "2g";
}

/**
 * 当前词优先，再按单词长度提取页面里最可能被划选内容的首字母。
 * 数量上限与单个索引构建上限共同形成明确的后台流量预算。
 */
export function likelyDictionaryLetters(
  texts: Array<string | undefined>,
  limit = MAX_DICTIONARY_PREFETCH_LETTERS,
) {
  if (limit <= 0) return [];
  const candidates = texts.flatMap((text, textIndex) =>
    [...(text?.matchAll(/[A-Za-z][A-Za-z'-]*/g) ?? [])].map((match, index) => ({
      textIndex,
      index,
      word: match[0],
    })));
  // 当前词优先；页面其余内容优先预取更长、查词概率更高的单词。
  candidates.sort((first, second) =>
    Number(first.textIndex !== 0) - Number(second.textIndex !== 0)
    || second.word.length - first.word.length
    || first.textIndex - second.textIndex
    || first.index - second.index);
  const letters: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const letter = candidate.word[0].toLowerCase();
    if (seen.has(letter)) continue;
    seen.add(letter);
    letters.push(letter);
    if (letters.length >= limit) return letters;
  }
  return letters;
}
