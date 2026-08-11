import {
  wordRetrievability,
  type Rating,
  type ReviewEvent,
  type StudySession,
  type WordProgressMap,
} from "./learning.ts";
import {
  buildPairedRecallChange,
  buildWordWeakSignalEntries,
  type PairedRecallChange,
  type WeakDimensionTrend,
  type WeakSignalInput,
  type WeakSignalKey,
  type WeakThresholds,
} from "./weak-signals.ts";
import { localDayStart } from "./date-utils.ts";

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
  /** rating≥2 的当场达标占比，不代表长期保持。 */
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

/** 冲刺维度与周报联动后的展示结构：清零标记 + 本周趋势对照 */
export type SprintDimensionWithTrend = {
  key: WeakDimensionTrend["key"];
  label: string;
  /** 冲刺后仍薄弱词数（0 = 已清零） */
  sprintCount: number;
  /** 本周该维度薄弱词数（周报 weakTrend） */
  weeklyCount: number | null;
  /** 冲刺后是否已清零 */
  cleared: boolean;
};

/**
 * 把冲刺维度分布与周报薄弱维度趋势合并为展示结构：
 * sprintCount 为 0 标「已清零」，weeklyCount 取自同 key 的周报维度。
 */
export function mergeSprintWithTrend(
  sprintCounts: readonly WeakDimensionTrend[],
  weeklyCounts: readonly WeakDimensionTrend[],
): SprintDimensionWithTrend[] {
  const weeklyByKey = new Map(
    weeklyCounts.map((row) => [row.key, row.count]),
  );
  return sprintCounts.map((row) => ({
    key: row.key,
    label: row.label,
    sprintCount: row.count,
    weeklyCount: weeklyByKey.get(row.key) ?? null,
    cleared: row.count === 0,
  }));
}

/** 冲刺完成总结：本次冲刺的薄弱维度分布、回忆对比、当场达标/仍需关注 */
export type SprintCompletionSummary = {
  /** 本次冲刺完成的词数 */
  sprintWordCount: number;
  /** 冲刺期间评分词数 */
  reviewedCount: number;
  /** 冲刺期间当场达标（rating≥2）的去重词数 */
  resolvedCount: number;
  /** 冲刺后仍命中薄弱信号的词数（实时派生） */
  stillWeakCount: number;
  /** 本次冲刺与开始前最近非冲刺记录的同词配对观察 */
  pairedRecall: PairedRecallChange;
  /** 冲刺后仍薄弱的具体词（word + 薄弱标签与结构化信号 key） */
  stillWeakWords: {
    wordId: number;
    word: string;
    signals: string[];
    signalKeys: WeakSignalKey[];
  }[];
  /** 各薄弱维度词数分布（冲刺后仍命中） */
  dimensionCounts: WeakDimensionTrend[];
};

type SprintSummaryInput = {
  session: StudySession;
  reviews: readonly ReviewEvent[];
  weakSignals: WeakSignalInput;
  /** 薄弱判定阈值（可选）：覆盖默认薄弱画像阈值 */
  weakThresholds?: WeakThresholds;
};

/** 按结构化信号 key 归类维度词数（signalKeys 与标签同源，不解析中文文案） */
function sprintDimensionCounts(
  stillWeakWords: SprintCompletionSummary["stillWeakWords"],
): WeakDimensionTrend[] {
  const rows: WeakDimensionTrend[] = [
    { key: "lookup", label: "反复查词", count: 0, change: null },
    { key: "guess", label: "猜词猜错", count: 0, change: null },
    { key: "quiz-spelling", label: "拼写测验错", count: 0, change: null },
    { key: "quiz-c2e", label: "中译英错", count: 0, change: null },
    { key: "quiz-choice", label: "辨析错", count: 0, change: null },
    { key: "slow-recall", label: "回忆偏慢", count: 0, change: null },
    { key: "stubborn", label: "顽固词", count: 0, change: null },
    { key: "lapse", label: "遗忘词", count: 0, change: null },
  ];
  const rowByKey = new Map(rows.map((row) => [row.key, row]));
  for (const item of stillWeakWords) {
    for (const key of item.signalKeys) {
      const row = rowByKey.get(key);
      if (row) row.count += 1;
    }
  }
  return rows;
}

/** 构建冲刺完成总结（仅 kind === "sprint" 时使用） */
export function buildSprintCompletionSummary({
  session,
  reviews,
  weakSignals,
  weakThresholds,
}: SprintSummaryInput): SprintCompletionSummary {
  const sessionReviews = reviewsForSession(session, reviews);
  const reviewedWordIds = new Set(
    sessionReviews
      .map((review) => review.wordId)
      .filter((wordId): wordId is number => wordId !== undefined),
  );
  const resolvedCount = new Set(
    sessionReviews
      .filter((review) => review.rating >= 2)
      .map((review) => review.wordId),
  ).size;
  const startedAtMs = new Date(session.createdAt).getTime();
  const pairedRecall = buildPairedRecallChange(
    weakSignals.reviews,
    sessionReviews,
    startedAtMs,
  );
  // 冲刺后仍薄弱：实时派生（结构化信号条目非空）
  const stillWeakWords = [...reviewedWordIds].flatMap((wordId) => {
    const entries = buildWordWeakSignalEntries(
      wordId,
      weakSignals,
      undefined,
      weakThresholds,
    );
    if (!entries.length) return [];
    const word = sessionReviews.find((review) => review.wordId === wordId)?.word
      ?? `词 ${wordId}`;
    return [{
      wordId,
      word,
      signals: entries.map((entry) => entry.label),
      signalKeys: entries.map((entry) => entry.key),
    }];
  });
  return {
    sprintWordCount: session.wordIds.length,
    reviewedCount: sessionReviews.length,
    resolvedCount,
    stillWeakCount: stillWeakWords.length,
    pairedRecall,
    stillWeakWords,
    dimensionCounts: sprintDimensionCounts(stillWeakWords),
  };
}
