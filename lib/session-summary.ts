import {
  wordRetrievability,
  type Rating,
  type ReviewEvent,
  type StudySession,
  type WordProgressMap,
} from "./learning.ts";

const REINFORCEMENT_LIMIT = 5;

export type ReinforcementWord = {
  wordId: number;
  word: string;
  rating: Rating;
  recallMs?: number;
  retrievability: number | null;
};

export type SessionCompletionSummary = {
  sessionId: string;
  kind: StudySession["kind"];
  title: string;
  completedCount: number;
  totalCount: number;
  newCount: number;
  reviewCount: number;
  successRate: number | null;
  averageRecallMs: number | null;
  weakCount: number;
  todayNewCount: number;
  todayReviewCount: number;
  tomorrowDueCount: number;
  reinforcementWords: ReinforcementWord[];
};

type BuildSessionCompletionSummaryInput = {
  session: StudySession;
  reviews: readonly ReviewEvent[];
  wordProgress: WordProgressMap;
  now?: Date;
};

function validTime(value: string) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function localDayStart(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function latestReviewByWord(
  reviews: readonly ReviewEvent[],
  allowedWordIds: ReadonlySet<number>,
) {
  const latest = new Map<number, ReviewEvent>();
  for (const review of reviews) {
    if (review.wordId === undefined || !allowedWordIds.has(review.wordId)) {
      continue;
    }
    const previous = latest.get(review.wordId);
    if (
      !previous
      || (validTime(review.reviewedAt) ?? -1)
        > (validTime(previous.reviewedAt) ?? -1)
    ) {
      latest.set(review.wordId, review);
    }
  }
  return latest;
}

/**
 * 新记录优先按 sessionId 精确归属；旧记录则按会话开始时间和已完成词序回退。
 */
export function reviewsForSession(
  session: StudySession,
  reviews: readonly ReviewEvent[],
) {
  const completedIds = session.wordIds.slice(
    0,
    Math.min(session.wordIds.length, Math.max(0, session.index)),
  );
  const allowedWordIds = new Set(completedIds);
  const tagged = latestReviewByWord(
    reviews.filter((review) => review.sessionId === session.id),
    allowedWordIds,
  );
  const startedAt = validTime(session.createdAt);
  const legacy = startedAt === null || startedAt <= 0
    ? new Map<number, ReviewEvent>()
    : latestReviewByWord(
        reviews.filter((review) => {
          if (review.sessionId) return false;
          const reviewedAt = validTime(review.reviewedAt);
          return reviewedAt !== null && reviewedAt >= startedAt;
        }),
        allowedWordIds,
      );

  return completedIds.flatMap((wordId) => {
    const review = tagged.get(wordId) ?? legacy.get(wordId);
    return review ? [review] : [];
  });
}

function retrievabilityForWord(
  wordId: number,
  wordProgress: WordProgressMap,
  now: Date,
) {
  const progress = wordProgress[wordId];
  if (!progress) return null;
  try {
    return wordRetrievability(progress, now);
  } catch {
    return null;
  }
}

export function selectReinforcementWords(
  sessionReviews: readonly ReviewEvent[],
  wordProgress: WordProgressMap,
  now = new Date(),
  limit = REINFORCEMENT_LIMIT,
) {
  const normalizedLimit = Number.isFinite(limit)
    ? Math.max(0, Math.trunc(limit))
    : 0;
  const latest = latestReviewByWord(
    sessionReviews,
    new Set(
      sessionReviews
        .map((review) => review.wordId)
        .filter((wordId): wordId is number => wordId !== undefined),
    ),
  );

  return [...latest.values()]
    .map<ReinforcementWord>((review) => ({
      wordId: review.wordId!,
      word: review.word,
      rating: review.rating,
      recallMs: review.recallMs,
      retrievability: retrievabilityForWord(
        review.wordId!,
        wordProgress,
        now,
      ),
    }))
    .sort((first, second) =>
      first.rating - second.rating
      || (second.recallMs ?? -1) - (first.recallMs ?? -1)
      || (first.retrievability ?? 101) - (second.retrievability ?? 101)
      || first.wordId - second.wordId)
    .slice(0, normalizedLimit);
}

export function buildSessionCompletionSummary({
  session,
  reviews,
  wordProgress,
  now = new Date(),
}: BuildSessionCompletionSummaryInput): SessionCompletionSummary {
  const sessionReviews = reviewsForSession(session, reviews);
  const successful = sessionReviews.filter((review) => review.rating >= 2);
  const recallTimes = sessionReviews
    .map((review) => review.recallMs)
    .filter((value): value is number =>
      value !== undefined && Number.isFinite(value) && value >= 0);
  const todayStart = localDayStart(now);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const dayAfterTomorrow = new Date(tomorrowStart);
  dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);
  const todayReviews = reviews.filter((review) => {
    const reviewedAt = validTime(review.reviewedAt);
    return reviewedAt !== null
      && reviewedAt >= todayStart.getTime()
      && reviewedAt < tomorrowStart.getTime();
  });
  const tomorrowDueCount = Object.values(wordProgress).filter((progress) => {
    const dueAt = validTime(progress.nextDueAt);
    return dueAt !== null
      && dueAt >= tomorrowStart.getTime()
      && dueAt < dayAfterTomorrow.getTime();
  }).length;

  return {
    sessionId: session.id,
    kind: session.kind,
    title: session.title,
    completedCount: Math.min(session.index, session.wordIds.length),
    totalCount: session.wordIds.length,
    newCount: sessionReviews.filter((review) => review.kind === "new").length,
    reviewCount: sessionReviews.filter((review) => review.kind === "review").length,
    successRate: sessionReviews.length
      ? Math.round((successful.length / sessionReviews.length) * 100)
      : null,
    averageRecallMs: recallTimes.length
      ? Math.round(
          recallTimes.reduce((sum, value) => sum + value, 0)
          / recallTimes.length,
        )
      : null,
    weakCount: sessionReviews.filter((review) => review.rating <= 1).length,
    todayNewCount: todayReviews.filter((review) => review.kind === "new").length,
    todayReviewCount: todayReviews.filter((review) => review.kind === "review").length,
    tomorrowDueCount,
    reinforcementWords: selectReinforcementWords(
      sessionReviews,
      wordProgress,
      now,
    ),
  };
}
