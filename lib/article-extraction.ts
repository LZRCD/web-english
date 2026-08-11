import type { WordProgressMap } from "./learning.ts";
import {
  buildWordTextIndex,
  learningWordId,
  lookupIdentity,
  upsertLookupWord,
  type LookupResult,
} from "./selection-lookup.ts";
import type { LookupWord, Word } from "./study.ts";

export type ArticleLearningStatus =
  | "unlearned"
  | "learning"
  | "reviewing"
  | "mastered";

export type ArticleCandidateSource = "redbook" | "lookup" | "dictionary";

export type ArticleCandidate = {
  token: string;
  word: string;
  source: ArticleCandidateSource;
  status: ArticleLearningStatus;
  learningWordId?: number;
  lookupWord?: LookupWord;
  lookupResult?: LookupResult;
};

export type ArticleStatusCounts = Record<ArticleLearningStatus, number>;

export type ArticleAnalysisResult = {
  candidates: ArticleCandidate[];
  statusCounts: ArticleStatusCounts;
  unmatchedCount: number;
  failedCount: number;
};

type AnalyzeArticleCandidatesInput = {
  tokens: readonly string[];
  redbookWords: readonly Word[];
  lookupWords: readonly LookupWord[];
  wordProgress: WordProgressMap;
  queryDictionary: (query: string) => Promise<LookupResult | null>;
};

type FilterArticleCandidatesOptions = {
  status: "all" | ArticleLearningStatus;
  showMastered: boolean;
};

type ProjectArticleConfirmationInput = {
  candidates: readonly ArticleCandidate[];
  selectedTokens: ReadonlySet<string>;
  lookupWords: LookupWord[];
  confirmedAt: string;
};

export type ArticleConfirmationProjection = {
  lookupWords: LookupWord[];
  wordIds: number[];
  changed: boolean;
};

const ARTICLE_DICTIONARY_CONCURRENCY = 4;

function learningStatus(
  wordId: number | undefined,
  wordProgress: WordProgressMap,
): ArticleLearningStatus {
  if (wordId === undefined) return "unlearned";
  return wordProgress[wordId]?.status ?? "unlearned";
}

function statusCounts(candidates: readonly ArticleCandidate[]): ArticleStatusCounts {
  const counts: ArticleStatusCounts = {
    unlearned: 0,
    learning: 0,
    reviewing: 0,
    mastered: 0,
  };
  for (const candidate of candidates) counts[candidate.status] += 1;
  return counts;
}

/** 按红宝书、既有划词、ECDICT 的固定优先级解析文章 token。 */
export async function analyzeArticleCandidates(
  input: AnalyzeArticleCandidatesInput,
): Promise<ArticleAnalysisResult> {
  const wordByText = buildWordTextIndex(input.redbookWords);
  const candidatesByIndex = new Array<ArticleCandidate | undefined>(
    input.tokens.length,
  );
  const unresolvedIndexes: number[] = [];

  input.tokens.forEach((rawToken, index) => {
    const token = rawToken.trim().toLowerCase();
    const redbookWord = wordByText.folded.get(token)?.[0];
    if (redbookWord?.id !== undefined) {
      candidatesByIndex[index] = {
        token,
        word: redbookWord.word,
        source: "redbook",
        status: learningStatus(redbookWord.id, input.wordProgress),
        learningWordId: redbookWord.id,
      };
      return;
    }

    const savedLookup = input.lookupWords.find(
      (word) => word.query.trim().toLowerCase() === token,
    );
    if (savedLookup) {
      const wordId = learningWordId(savedLookup);
      candidatesByIndex[index] = {
        token,
        word: savedLookup.query,
        source: "lookup",
        status: learningStatus(wordId, input.wordProgress),
        learningWordId: wordId,
        lookupWord: savedLookup,
      };
      return;
    }

    unresolvedIndexes.push(index);
  });

  let nextUnresolved = 0;
  let unmatchedCount = 0;
  let failedCount = 0;
  const workers = Array.from(
    {
      length: Math.min(
        ARTICLE_DICTIONARY_CONCURRENCY,
        unresolvedIndexes.length,
      ),
    },
    async () => {
      while (nextUnresolved < unresolvedIndexes.length) {
        const unresolvedPosition = nextUnresolved;
        nextUnresolved += 1;
        const candidateIndex = unresolvedIndexes[unresolvedPosition]!;
        const token = input.tokens[candidateIndex]!.trim().toLowerCase();
        try {
          const result = await input.queryDictionary(token);
          if (!result) {
            unmatchedCount += 1;
            continue;
          }
          candidatesByIndex[candidateIndex] = {
            token,
            word: result.query,
            source: "dictionary",
            status: "unlearned",
            lookupResult: result,
          };
        } catch {
          failedCount += 1;
        }
      }
    },
  );
  await Promise.all(workers);

  const candidates = candidatesByIndex.filter(
    (candidate): candidate is ArticleCandidate => candidate !== undefined,
  );
  return {
    candidates,
    statusCounts: statusCounts(candidates),
    unmatchedCount,
    failedCount,
  };
}

export function filterArticleCandidates(
  candidates: readonly ArticleCandidate[],
  options: FilterArticleCandidatesOptions,
) {
  return candidates.filter((candidate) =>
    (options.showMastered || candidate.status !== "mastered")
    && (options.status === "all" || candidate.status === options.status));
}

/** 在不清除其他筛选下选择的前提下，加入当前可见候选。 */
export function selectVisibleArticleCandidates(
  selectedTokens: ReadonlySet<string>,
  visibleCandidates: readonly ArticleCandidate[],
) {
  const next = new Set(selectedTokens);
  for (const candidate of visibleCandidates) next.add(candidate.token);
  return next;
}

/** 一次性投影最终 lookupWords 和 article 会话真实 ID。 */
export function projectArticleConfirmation(
  input: ProjectArticleConfirmationInput,
): ArticleConfirmationProjection {
  const selectedCandidates = input.candidates.filter((candidate) =>
    input.selectedTokens.has(candidate.token));
  if (!selectedCandidates.length) {
    return {
      lookupWords: input.lookupWords,
      wordIds: [],
      changed: false,
    };
  }

  let projectedLookupWords = input.lookupWords;
  let changed = false;
  for (const candidate of selectedCandidates) {
    if (candidate.source !== "dictionary" || !candidate.lookupResult) continue;
    projectedLookupWords = upsertLookupWord(
      projectedLookupWords,
      candidate.lookupResult,
      input.confirmedAt,
    );
    changed = true;
  }

  const wordIds: number[] = [];
  for (const candidate of selectedCandidates) {
    let wordId = candidate.learningWordId;
    if (wordId === undefined && candidate.lookupResult) {
      const identity = lookupIdentity(candidate.lookupResult);
      const stored = projectedLookupWords.find(
        (word) => lookupIdentity(word) === identity,
      );
      wordId = stored ? learningWordId(stored) : undefined;
    }
    if (wordId !== undefined && !wordIds.includes(wordId)) wordIds.push(wordId);
  }

  return {
    lookupWords: projectedLookupWords,
    wordIds,
    changed,
  };
}
