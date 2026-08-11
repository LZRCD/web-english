import {
  buildWordWeakSignals,
  isLookupDemoted,
  lookupStatByWordId,
  parseSprintSessionId,
} from "./detection.ts";
import {
  SPRINT_TREATMENT_DIMENSIONS,
  STUBBORN_TREATMENT_SEQUENCE,
  type DimensionObservationReport,
  type PairedRecallChange,
  type SprintEffectiveness,
  type SprintEffectivenessWeek,
  type SprintHistory,
  type SprintHistoryRecord,
  type SprintRelapse,
  type SprintRelapseWeek,
  type SprintRetention,
  type SprintRetentionWeek,
  type StubbornTreatmentMode,
  type WeakDimensionTrend,
  type WeakDimensionTrendWeek,
  type WeakSignalInput,
  type WordSignalEvent,
} from "./types.ts";
import type { ExamPhase, ReviewEvent } from "../learning.ts";
import type { QuizMode } from "../quiz.ts";
import {
  DEFAULT_WEAK_THRESHOLDS,
  type LookupStat,
  type WeakThresholds,
} from "../study.ts";
import {
  addLocalDays,
  localDateKey,
  localWeekStart,
} from "../date-utils.ts";

/**
 * 从评分日志派生冲刺历史：按 `sessionId.startsWith("sprint:")` 分组，
 * 每条记录取内嵌 ISO 时间、去重词数、成功词数与平均回忆耗时。
 */
export function buildSprintHistory(
  reviews: readonly ReviewEvent[],
): SprintHistory {
  const groups = new Map<string, ReviewEvent[]>();
  for (const review of reviews) {
    const sessionId = review.sessionId;
    if (!sessionId || !sessionId.startsWith("sprint:")) continue;
    const items = groups.get(sessionId) ?? [];
    items.push(review);
    groups.set(sessionId, items);
  }
  const records = [...groups.entries()].flatMap(([sessionId, items]) => {
    const startedAt = parseSprintSessionId(sessionId)?.startedAt;
    if (!startedAt) return [];
    const wordIds = new Set(
      items
        .map((review) => review.wordId)
        .filter((wordId): wordId is number => wordId !== undefined),
    );
    const successIds = new Set(
      items
        .filter((review) => review.rating >= 2)
        .map((review) => review.wordId)
        .filter((wordId): wordId is number => wordId !== undefined),
    );
    const recallTimes = items
      .map((review) => review.recallMs)
      .filter((value): value is number =>
        typeof value === "number"
        && Number.isFinite(value)
        && value >= 0);
    return [{
      sessionId,
      startedAt,
      wordCount: wordIds.size,
      successCount: successIds.size,
      averageRecallMs: recallTimes.length
        ? Math.round(
            recallTimes.reduce((sum, ms) => sum + ms, 0) / recallTimes.length,
          )
        : null,
    }];
  });
  records.sort((first, second) =>
    new Date(second.startedAt).getTime() - new Date(first.startedAt).getTime()
    || second.sessionId.localeCompare(first.sessionId));
  const validSessionIds = new Set(records.map((record) => record.sessionId));
  return {
    records,
    totalCount: records.length,
    totalWordCount: new Set(
      reviews
        .filter((review) =>
          review.sessionId !== undefined
          && validSessionIds.has(review.sessionId)
          && review.wordId !== undefined)
        .map((review) => review.wordId),
    ).size,
  };
}

/** 提取某次冲刺覆盖的去重词 id（供「再跑一次」复用） */
export function buildSprintRecordWordIds(
  reviews: readonly ReviewEvent[],
  sessionId: string,
): number[] {
  const wordIds = new Set<number>();
  for (const review of reviews) {
    if (review.sessionId !== sessionId || review.wordId === undefined) continue;
    wordIds.add(review.wordId);
  }
  return [...wordIds];
}

function isValidRecallMs(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** 由指定目标事件和时间边界构建一致的同词配对观察。 */
export function buildPairedRecallChange(
  reviews: readonly ReviewEvent[],
  targetReviews: readonly ReviewEvent[],
  beforeBoundaryMs: number,
): PairedRecallChange {
  if (!Number.isFinite(beforeBoundaryMs)) {
    return {
      pairedWordCount: 0,
      pairedBeforeAverageRecallMs: null,
      pairedTargetAverageRecallMs: null,
      pairedChangeMs: null,
    };
  }

  const targetByWordId = new Map<number, { totalMs: number; count: number }>();
  for (const review of targetReviews) {
    if (review.wordId === undefined || !isValidRecallMs(review.recallMs)) continue;
    const current = targetByWordId.get(review.wordId) ?? { totalMs: 0, count: 0 };
    current.totalMs += review.recallMs;
    current.count += 1;
    targetByWordId.set(review.wordId, current);
  }

  const beforeByWordId = new Map<
    number,
    { reviewedAtMs: number; recallMs: number; id: string }
  >();
  for (const review of reviews) {
    if (
      review.wordId === undefined
      || !targetByWordId.has(review.wordId)
      || review.sessionId?.startsWith("sprint:")
      || !isValidRecallMs(review.recallMs)
    ) continue;
    const reviewedAtMs = new Date(review.reviewedAt).getTime();
    if (!Number.isFinite(reviewedAtMs) || reviewedAtMs >= beforeBoundaryMs) continue;
    const previous = beforeByWordId.get(review.wordId);
    if (
      !previous
      || reviewedAtMs > previous.reviewedAtMs
      || (reviewedAtMs === previous.reviewedAtMs
        && review.id.localeCompare(previous.id) < 0)
    ) {
      beforeByWordId.set(review.wordId, {
        reviewedAtMs,
        recallMs: review.recallMs,
        id: review.id,
      });
    }
  }

  let pairedWordCount = 0;
  let beforeTotalMs = 0;
  let targetTotalMs = 0;
  for (const [wordId, target] of targetByWordId) {
    const before = beforeByWordId.get(wordId);
    if (!before) continue;
    pairedWordCount += 1;
    beforeTotalMs += before.recallMs;
    targetTotalMs += target.totalMs / target.count;
  }
  if (!pairedWordCount) {
    return {
      pairedWordCount: 0,
      pairedBeforeAverageRecallMs: null,
      pairedTargetAverageRecallMs: null,
      pairedChangeMs: null,
    };
  }
  const pairedBeforeAverageRecallMs = Math.round(
    beforeTotalMs / pairedWordCount,
  );
  const pairedTargetAverageRecallMs = Math.round(
    targetTotalMs / pairedWordCount,
  );
  return {
    pairedWordCount,
    pairedBeforeAverageRecallMs,
    pairedTargetAverageRecallMs,
    pairedChangeMs:
      pairedTargetAverageRecallMs - pairedBeforeAverageRecallMs,
  };
}

/**
 * 从评分日志按本地周一聚合本周冲刺观察。
 * 周归属用 reviewedAt；目标侧为周窗内全部冲刺事件，配对边界为该周
 * 首个冲刺事件时间，基线只取每个目标词边界前最近一次非冲刺事件。
 */
export function buildSprintEffectiveness(
  reviews: readonly ReviewEvent[],
  now = new Date(),
): SprintEffectiveness | null {
  const weekStart = localWeekStart(now);
  const weekStartMs = weekStart.getTime();
  const weekEndMs = addLocalDays(weekStart, 7).getTime();
  const weekSprints = reviews.filter((review) =>
    review.sessionId?.startsWith("sprint:")
    && inWindow(review.reviewedAt, weekStartMs, weekEndMs));
  if (!weekSprints.length) return null;
  const firstSprintMs = weekSprints.reduce<number>((min, review) => {
    const ms = new Date(review.reviewedAt).getTime();
    return Number.isFinite(ms) && ms < min ? ms : min;
  }, Number.POSITIVE_INFINITY);
  const coveredIds = new Set(
    weekSprints
      .map((review) => review.wordId)
      .filter((wordId): wordId is number => wordId !== undefined),
  );
  const resolvedCount = new Set(
    weekSprints
      .filter((review) => review.rating >= 2)
      .map((review) => review.wordId),
  ).size;
  return {
    sprintCount: new Set(weekSprints.map((review) => review.sessionId)).size,
    coveredWordCount: coveredIds.size,
    pairedRecall: buildPairedRecallChange(reviews, weekSprints, firstSprintMs),
    resolvedCount,
  };
}

/**
 * 冲刺成效近 N 周序列（含本周，按时间升序）。
 * 复用 buildSprintEffectiveness 的单周口径：对每周围一个该周内的 now 派生，
 * 无冲刺周的周为 null（不虚报 0），与 buildWeakDimensionTrendSeries 同构。
 */
export function buildSprintEffectivenessSeries(
  reviews: readonly ReviewEvent[],
  now = new Date(),
  weeks = 4,
): SprintEffectivenessWeek[] {
  const thisWeekStart = localWeekStart(now);
  const count = Math.max(1, Math.trunc(weeks));
  const series: SprintEffectivenessWeek[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const start = addLocalDays(thisWeekStart, -offset * 7);
    const weekNow = addLocalDays(start, 3);
    weekNow.setHours(12, 0, 0, 0);
    series.push({
      weekStart: localDateKey(start),
      effectiveness: buildSprintEffectiveness(reviews, weekNow),
    });
  }
  return series;
}

/**
 * 一次扫描按本地周收集冲刺当场达标词，供单周追踪与多周回溯共用。
 * 同词在多个所选周达标时只归最近一次处置周，避免跨周重复样本。
 */
function buildSprintSolvedCohorts(
  reviews: readonly ReviewEvent[],
  weekStarts: readonly Date[],
): Map<string, Set<number>> {
  const cohorts = new Map(
    weekStarts.map((start) => [localDateKey(start), new Set<number>()]),
  );
  const latestCohortByWordId = new Map<
    number,
    { weekKey: string; reviewedAtMs: number }
  >();
  for (const review of reviews) {
    if (
      !review.sessionId?.startsWith("sprint:")
      || review.rating < 2
      || review.wordId === undefined
    ) continue;
    const reviewedAtMs = new Date(review.reviewedAt).getTime();
    if (!Number.isFinite(reviewedAtMs)) continue;
    const weekKey = localDateKey(localWeekStart(new Date(reviewedAtMs)));
    if (!cohorts.has(weekKey)) continue;
    const previous = latestCohortByWordId.get(review.wordId);
    if (!previous || reviewedAtMs > previous.reviewedAtMs) {
      latestCohortByWordId.set(review.wordId, { weekKey, reviewedAtMs });
    }
  }
  for (const [wordId, { weekKey }] of latestCohortByWordId) {
    cohorts.get(weekKey)?.add(wordId);
  }
  return cohorts;
}

/** 用当前统一薄弱画像判断一个当场达标 cohort，并复用跨 cohort 的判定缓存。 */
function buildSprintCohortRelapse(
  solvedIds: ReadonlySet<number> | undefined,
  input: WeakSignalInput,
  thresholds: WeakThresholds,
  weakSignalCountByWordId = new Map<number, number>(),
): SprintRelapse | null {
  if (!solvedIds?.size) return null;
  const relapsedIds = [...solvedIds]
    .map((wordId) => {
      let signalCount = weakSignalCountByWordId.get(wordId);
      if (signalCount === undefined) {
        signalCount = buildWordWeakSignals(
          wordId,
          input,
          undefined,
          thresholds,
        ).length;
        weakSignalCountByWordId.set(wordId, signalCount);
      }
      return { wordId, signalCount };
    })
    .filter((item) => item.signalCount > 0)
    .sort((first, second) => second.signalCount - first.signalCount)
    .map((item) => item.wordId);
  return {
    solvedCount: solvedIds.size,
    relapsedCount: relapsedIds.length,
    relapseRate: Math.round((relapsedIds.length / solvedIds.size) * 100),
    relapsedIds,
  };
}

/**
 * 追踪上周冲刺当场达标词的当前薄弱情况：取上周一至本周一之间、
 * 且 sessionId 为冲刺会话的 rating≥2 去重词集，再过滤当前仍薄弱的词。
 * 周划分与 buildSprintEffectiveness 一致（本地周一）。
 * 旧接口名仅为兼容；当前状态不能区分从未恢复与恢复后再次薄弱。
 */
export function buildSprintRelapse(
  reviews: readonly ReviewEvent[],
  input: WeakSignalInput,
  now = new Date(),
  thresholds: WeakThresholds = DEFAULT_WEAK_THRESHOLDS,
): SprintRelapse | null {
  const weekStart = localWeekStart(now);
  const lastWeekStart = addLocalDays(weekStart, -7);
  const weekKey = localDateKey(lastWeekStart);
  const cohorts = buildSprintSolvedCohorts(reviews, [lastWeekStart]);
  return buildSprintCohortRelapse(
    cohorts.get(weekKey),
    input,
    thresholds,
  );
}

/**
 * 最近 N 个已完成冲刺周的截至当前薄弱率回溯（按时间升序）。
 * 这是按最近一次达标处置周分组后用当前统一薄弱画像回看，
 * 不是历史周末状态快照，也不能区分从未恢复与恢复后再次薄弱。
 */
export function buildSprintRelapseSeries(
  reviews: readonly ReviewEvent[],
  input: WeakSignalInput,
  now = new Date(),
  weeks = 4,
  thresholds: WeakThresholds = DEFAULT_WEAK_THRESHOLDS,
): SprintRelapseWeek[] {
  const thisWeekStart = localWeekStart(now);
  const count = Math.max(1, Math.trunc(weeks));
  const weekStarts: Date[] = [];
  for (let offset = count; offset >= 1; offset -= 1) {
    weekStarts.push(addLocalDays(thisWeekStart, -offset * 7));
  }
  const cohorts = buildSprintSolvedCohorts(reviews, weekStarts);
  const weakSignalCountByWordId = new Map<number, number>();
  return weekStarts.map((start) => {
    const weekStart = localDateKey(start);
    return {
      weekStart,
      relapse: buildSprintCohortRelapse(
        cohorts.get(weekStart),
        input,
        thresholds,
        weakSignalCountByWordId,
      ),
    };
  });
}

type OrderedReview = {
  review: ReviewEvent;
  reviewedAtMs: number;
};

function compareOrderedReview(first: OrderedReview, second: OrderedReview) {
  return first.reviewedAtMs - second.reviewedAtMs
    || first.review.id.localeCompare(second.review.id);
}

function isStrictlyAfterReview(first: OrderedReview, second: OrderedReview) {
  return compareOrderedReview(first, second) > 0;
}

/**
 * 最近 N 个完整本地周的“成功冲刺 → 下一次冲刺前首条非冲刺 review”观察。
 *
 * 每个 wordId 只取窗口内时间总序上最近一次 rating≥2 冲刺为锚点，
 * 再按 (reviewedAtMs, id) 扫描真实 review；下一次冲刺会截断旧锚点。
 * quiz:* review 和无 sessionId 的旧 review 都是正常随访，quizAttempts 不在输入中。
 */
export function buildSprintRetentionSeries(
  reviews: readonly ReviewEvent[],
  now = new Date(),
  weeks = 4,
): SprintRetentionWeek[] {
  const nowMs = now.getTime();
  const thisWeekStart = localWeekStart(now);
  const count = Math.max(1, Math.trunc(weeks));
  const weekStarts: Date[] = [];
  for (let offset = count; offset >= 1; offset -= 1) {
    weekStarts.push(addLocalDays(thisWeekStart, -offset * 7));
  }
  const series = weekStarts.map((start) => ({
    weekStart: localDateKey(start),
    retention: null as SprintRetention | null,
  }));
  if (!Number.isFinite(nowMs)) return series;

  const windowStartMs = weekStarts[0]!.getTime();
  const windowEndMs = thisWeekStart.getTime();
  const orderedByWordId = new Map<number, OrderedReview[]>();
  const latestAnchorByWordId = new Map<number, OrderedReview>();

  for (const review of reviews) {
    if (review.wordId === undefined) continue;
    const reviewedAtMs = new Date(review.reviewedAt).getTime();
    if (!Number.isFinite(reviewedAtMs) || reviewedAtMs > nowMs) continue;
    const ordered = { review, reviewedAtMs };
    const wordReviews = orderedByWordId.get(review.wordId) ?? [];
    wordReviews.push(ordered);
    orderedByWordId.set(review.wordId, wordReviews);
    if (
      reviewedAtMs < windowStartMs
      || reviewedAtMs >= windowEndMs
      || !review.sessionId?.startsWith("sprint:")
      || review.rating < 2
    ) continue;
    const previous = latestAnchorByWordId.get(review.wordId);
    if (!previous || compareOrderedReview(ordered, previous) > 0) {
      latestAnchorByWordId.set(review.wordId, ordered);
    }
  }

  for (const wordReviews of orderedByWordId.values()) {
    wordReviews.sort(compareOrderedReview);
  }

  const anchorsByWeek = new Map<string, OrderedReview[]>();
  for (const anchor of latestAnchorByWordId.values()) {
    const weekKey = localDateKey(localWeekStart(new Date(anchor.reviewedAtMs)));
    const anchors = anchorsByWeek.get(weekKey) ?? [];
    anchors.push(anchor);
    anchorsByWeek.set(weekKey, anchors);
  }

  return series.map(({ weekStart }) => {
    const anchors = anchorsByWeek.get(weekStart);
    if (!anchors?.length) return { weekStart, retention: null };

    let followedUpCount = 0;
    let truncatedCount = 0;
    let retainedCount = 0;
    let delayTotalMs = 0;
    let pairedSampleCount = 0;
    let sprintRecallTotalMs = 0;
    let followUpRecallTotalMs = 0;

    for (const anchor of anchors) {
      const wordId = anchor.review.wordId!;
      const next = orderedByWordId.get(wordId)
        ?.find((candidate) => isStrictlyAfterReview(candidate, anchor));
      if (!next) continue;
      if (next.review.sessionId?.startsWith("sprint:")) {
        truncatedCount += 1;
        continue;
      }
      followedUpCount += 1;
      delayTotalMs += next.reviewedAtMs - anchor.reviewedAtMs;
      if (next.review.rating >= 2) retainedCount += 1;
      if (
        isValidRecallMs(anchor.review.recallMs)
        && isValidRecallMs(next.review.recallMs)
      ) {
        pairedSampleCount += 1;
        sprintRecallTotalMs += anchor.review.recallMs;
        followUpRecallTotalMs += next.review.recallMs;
      }
    }

    const cohortWordCount = anchors.length;
    const unobservedCount = cohortWordCount - followedUpCount;
    const sprintAverageRecallMs = pairedSampleCount
      ? Math.round(sprintRecallTotalMs / pairedSampleCount)
      : null;
    const followUpAverageRecallMs = pairedSampleCount
      ? Math.round(followUpRecallTotalMs / pairedSampleCount)
      : null;
    return {
      weekStart,
      retention: {
        cohortWordCount,
        followedUpCount,
        unobservedCount,
        truncatedCount,
        coverageRate: Math.round((followedUpCount / cohortWordCount) * 100),
        retainedCount,
        retentionRate: followedUpCount
          ? Math.round((retainedCount / followedUpCount) * 100)
          : null,
        followUpDelayMs: followedUpCount
          ? Math.round(delayTotalMs / followedUpCount)
          : null,
        pairedRecall: {
          sampleCount: pairedSampleCount,
          sprintAverageRecallMs,
          followUpAverageRecallMs,
          changeMs: pairedSampleCount
            ? followUpAverageRecallMs! - sprintAverageRecallMs!
            : null,
        },
      },
    };
  });
}

/**
 * 最近完整本地周的分维度只读观察；维度只取统一 sessionId parser 的结果。
 * 活动、当前仍薄弱、保持随访与配对测时各自保留独立分母，不用于排序或推荐。
 */
export function buildDimensionObservationReport(
  reviews: readonly ReviewEvent[],
  input: WeakSignalInput,
  now = new Date(),
  weeks = 4,
  thresholds: WeakThresholds = DEFAULT_WEAK_THRESHOLDS,
): DimensionObservationReport {
  const thisWeekStart = localWeekStart(now);
  const count = Math.max(1, Math.trunc(weeks));
  const windowStart = addLocalDays(thisWeekStart, -count * 7);
  const windowStartMs = windowStart.getTime();
  const windowEndMs = thisWeekStart.getTime();
  const nowMs = now.getTime();
  const dimensions = [...SPRINT_TREATMENT_DIMENSIONS, "unknown" as const];
  const activity = new Map(dimensions.map((dimension) => [dimension, {
    sessions: new Set<string>(),
    coveredWordIds: new Set<number>(),
    resolvedWordIds: new Set<number>(),
    stubbornSubmodeSessions: new Map<StubbornTreatmentMode, Set<string>>(),
  }]));
  const orderedByWordId = new Map<number, OrderedReview[]>();
  const latestAnchorByWordId = new Map<number, OrderedReview>();

  for (const review of reviews) {
    const reviewedAtMs = new Date(review.reviewedAt).getTime();
    if (!Number.isFinite(reviewedAtMs) || reviewedAtMs > nowMs) continue;
    if (review.wordId !== undefined) {
      const ordered = { review, reviewedAtMs };
      const wordReviews = orderedByWordId.get(review.wordId) ?? [];
      wordReviews.push(ordered);
      orderedByWordId.set(review.wordId, wordReviews);
      if (
        reviewedAtMs >= windowStartMs
        && reviewedAtMs < windowEndMs
        && review.sessionId?.startsWith("sprint:")
        && review.rating >= 2
      ) {
        const previous = latestAnchorByWordId.get(review.wordId);
        if (!previous || compareOrderedReview(ordered, previous) > 0) {
          latestAnchorByWordId.set(review.wordId, ordered);
        }
      }
    }
    if (
      reviewedAtMs < windowStartMs
      || reviewedAtMs >= windowEndMs
      || !review.sessionId?.startsWith("sprint:")
    ) continue;
    const parsed = parseSprintSessionId(review.sessionId)!;
    const bucket = activity.get(parsed.dimension)!;
    bucket.sessions.add(review.sessionId);
    if (review.wordId !== undefined) {
      bucket.coveredWordIds.add(review.wordId);
      if (review.rating >= 2) bucket.resolvedWordIds.add(review.wordId);
    }
    if (parsed.dimension === "stubborn" && parsed.submode) {
      const sessions = bucket.stubbornSubmodeSessions.get(parsed.submode)
        ?? new Set<string>();
      sessions.add(review.sessionId);
      bucket.stubbornSubmodeSessions.set(parsed.submode, sessions);
    }
  }

  for (const wordReviews of orderedByWordId.values()) {
    wordReviews.sort(compareOrderedReview);
  }

  const anchorsByDimension = new Map(
    dimensions.map((dimension) => [dimension, [] as OrderedReview[]]),
  );
  for (const anchor of latestAnchorByWordId.values()) {
    const dimension = parseSprintSessionId(anchor.review.sessionId)?.dimension
      ?? "unknown";
    anchorsByDimension.get(dimension)!.push(anchor);
  }
  const weakSignalCountByWordId = new Map<number, number>();

  return {
    windowStart: localDateKey(windowStart),
    windowEnd: localDateKey(thisWeekStart),
    rows: dimensions.map((dimension) => {
      const bucket = activity.get(dimension)!;
      const anchors = anchorsByDimension.get(dimension)!;
      let followedUpCount = 0;
      let truncatedCount = 0;
      let retainedCount = 0;
      let delayTotalMs = 0;
      let pairedSampleCount = 0;
      let sprintRecallTotalMs = 0;
      let followUpRecallTotalMs = 0;
      let stillWeakCount = 0;

      for (const anchor of anchors) {
        const wordId = anchor.review.wordId!;
        let signalCount = weakSignalCountByWordId.get(wordId);
        if (signalCount === undefined) {
          signalCount = buildWordWeakSignals(
            wordId,
            input,
            undefined,
            thresholds,
          ).length;
          weakSignalCountByWordId.set(wordId, signalCount);
        }
        if (signalCount > 0) stillWeakCount += 1;

        const next = orderedByWordId.get(wordId)
          ?.find((candidate) => isStrictlyAfterReview(candidate, anchor));
        if (!next) continue;
        if (next.review.sessionId?.startsWith("sprint:")) {
          truncatedCount += 1;
          continue;
        }
        followedUpCount += 1;
        delayTotalMs += next.reviewedAtMs - anchor.reviewedAtMs;
        if (next.review.rating >= 2) retainedCount += 1;
        if (
          isValidRecallMs(anchor.review.recallMs)
          && isValidRecallMs(next.review.recallMs)
        ) {
          pairedSampleCount += 1;
          sprintRecallTotalMs += anchor.review.recallMs;
          followUpRecallTotalMs += next.review.recallMs;
        }
      }

      const cohortWordCount = anchors.length;
      const sprintAverageRecallMs = pairedSampleCount
        ? Math.round(sprintRecallTotalMs / pairedSampleCount)
        : null;
      const followUpAverageRecallMs = pairedSampleCount
        ? Math.round(followUpRecallTotalMs / pairedSampleCount)
        : null;
      const stubbornSubmodeSessionCounts = dimension === "stubborn"
        ? Object.fromEntries(
            STUBBORN_TREATMENT_SEQUENCE.map((submode) => [
              submode,
              bucket.stubbornSubmodeSessions.get(submode)?.size ?? 0,
            ]),
          ) as Record<StubbornTreatmentMode, number>
        : undefined;
      return {
        dimension,
        sessionCount: bucket.sessions.size,
        coveredWordCount: bucket.coveredWordIds.size,
        resolvedCount: bucket.resolvedWordIds.size,
        cohortWordCount,
        followedUpCount,
        unobservedCount: cohortWordCount - followedUpCount,
        truncatedCount,
        coverageRate: cohortWordCount
          ? Math.round((followedUpCount / cohortWordCount) * 100)
          : null,
        retainedCount,
        retentionRate: followedUpCount
          ? Math.round((retainedCount / followedUpCount) * 100)
          : null,
        followUpDelayMs: followedUpCount
          ? Math.round(delayTotalMs / followedUpCount)
          : null,
        pairedRecall: {
          sampleCount: pairedSampleCount,
          sprintAverageRecallMs,
          followUpAverageRecallMs,
          changeMs: pairedSampleCount
            ? followUpAverageRecallMs! - sprintAverageRecallMs!
            : null,
        },
        stillWeakCount,
        stillWeakRate: cohortWordCount
          ? Math.round((stillWeakCount / cohortWordCount) * 100)
          : null,
        ...(stubbornSubmodeSessionCounts
          ? { stubbornSubmodeSessionCounts }
          : {}),
      };
    }),
  };
}

const QUIZ_MODE_LABELS: Partial<Record<QuizMode, string>> = {
  "listening-spelling": "拼写测验",
  "chinese-to-english": "中译英",
  "meaning-choice": "辨析",
  "passage-cloze": "短文填词",
};

const REVIEW_RATING_LABELS = ["忘记", "模糊", "认识", "熟练"] as const;

/**
 * 该词的信号时间线：普通评分、回忆偏慢/lapse、测验答错、查词、顽固词触发，
 * 全部由现有状态派生，按时间升序；无记录返回空数组。
 */
export function buildWordSignalTimeline(
  wordId: number,
  input: WeakSignalInput,
  thresholds: WeakThresholds = DEFAULT_WEAK_THRESHOLDS,
): WordSignalEvent[] {
  const events: WordSignalEvent[] = [];
  const seenReviewIds = new Set<string>();
  for (const review of input.reviews) {
    if (review.wordId !== wordId) continue;
    if (seenReviewIds.has(review.id)) continue;
    seenReviewIds.add(review.id);
    // rating=0 已由既有 lapse 事件表达，避免同一动作重复显示为普通复习。
    if (review.rating !== 0) {
      events.push({
        at: review.reviewedAt,
        type: "review",
        detail: `${review.sessionId?.startsWith("sprint:") ? "冲刺复习" : "复习"} · ${REVIEW_RATING_LABELS[review.rating]}（评分 ${review.rating}）`,
      });
    }
    if (
      typeof review.recallMs === "number"
      && review.recallMs >= thresholds.slowRecallMs
    ) {
      events.push({
        at: review.reviewedAt,
        type: "slow-recall",
        detail: `回忆偏慢 ${(review.recallMs / 1000).toFixed(1)}s`,
      });
    }
    if (review.rating === 0) {
      events.push({
        at: review.reviewedAt,
        type: "lapse",
        detail: "遗忘（评分 0）",
      });
    }
  }
  for (const attempt of input.quizAttempts) {
    if (attempt.wordId !== wordId || attempt.correct) continue;
    events.push({
      at: attempt.answeredAt,
      type: "quiz",
      detail: `${QUIZ_MODE_LABELS[attempt.mode] ?? attempt.mode} 答错`,
    });
  }
  const lookupStat = lookupStatByWordId(input).get(wordId);
  if (lookupStat) {
    events.push({
      at: lookupStat.firstAt,
      type: "lookup",
      detail: `首次查词（累计 ${lookupStat.count} 次）`,
    });
    if (lookupStat.lastAt !== lookupStat.firstAt) {
      events.push({
        at: lookupStat.lastAt,
        type: "lookup",
        detail: `最近查词（累计 ${lookupStat.count} 次）`,
      });
    }
  }
  const stubborn = input.stubbornWords[wordId];
  if (stubborn?.active) {
    events.push({
      at: stubborn.triggeredAt,
      type: "stubborn",
      detail: "进入顽固词",
    });
  }
  return events.sort((first, second) => first.at.localeCompare(second.at));
}

/** 划词达到阈值且未被近期答对覆盖的词 id（今日任务插队，按查询次数倒序） */
export function lookupPriorityWordIds(
  input: WeakSignalInput,
  thresholds: WeakThresholds = DEFAULT_WEAK_THRESHOLDS,
): number[] {
  const items: { wordId: number; stat: LookupStat }[] = [];
  for (const [wordId, stat] of lookupStatByWordId(input)) {
    if ((stat.count ?? 0) < thresholds.lookupPriority) continue;
    if (isLookupDemoted(wordId, stat, input)) continue;
    items.push({ wordId, stat });
  }
  return items
    .sort((first, second) =>
      second.stat.count - first.stat.count
      || second.stat.lastAt.localeCompare(first.stat.lastAt))
    .map((item) => item.wordId);
}

function inWindow(value: string | undefined, startMs: number, endMs: number) {
  const ms = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(ms) && ms >= startMs && ms < endMs;
}

/** 单个维度的周级统计（startMs 所在周 vs 上一周） */
function buildTrendForWeek(
  input: WeakSignalInput,
  weekStartMs: number,
  weekEndMs: number,
  thresholds: WeakThresholds = DEFAULT_WEAK_THRESHOLDS,
): WeakDimensionTrend[] {
  const previousStartMs = weekStartMs - 7 * 24 * 60 * 60 * 1000;

  const lookupById = lookupStatByWordId(input);
  const lookupWords = (startMs: number, endMs: number) =>
    [...lookupById.values()].filter((stat) =>
      (stat.count ?? 0) >= thresholds.lookupWeak
      && inWindow(stat.lastAt, startMs, endMs)).length;
  const lookupCount = lookupWords(weekStartMs, weekEndMs);
  const lookupPrevious = lookupWords(previousStartMs, weekStartMs);

  const quizErrorWords = (mode: QuizMode, startMs: number, endMs: number) =>
    new Set(input.quizAttempts
      .filter((attempt) =>
        attempt.mode === mode
        && !attempt.correct
        && inWindow(attempt.answeredAt, startMs, endMs))
      .map((attempt) => attempt.wordId)).size;

  const reviewWords = (
    predicate: (review: ReviewEvent) => boolean,
    startMs: number,
    endMs: number,
  ) => new Set(input.reviews
    .filter((review) =>
      predicate(review) && inWindow(review.reviewedAt, startMs, endMs))
    .map((review) => review.wordId)
    .filter((wordId): wordId is number => wordId !== undefined)).size;
  const slowPredicate = (review: ReviewEvent) =>
    typeof review.recallMs === "number"
    && review.recallMs >= thresholds.slowRecallMs;
  const lapsePredicate = (review: ReviewEvent) => review.rating === 0;
  const slowCount = reviewWords(slowPredicate, weekStartMs, weekEndMs);
  const slowPrevious = reviewWords(slowPredicate, previousStartMs, weekStartMs);
  const lapseCount = reviewWords(lapsePredicate, weekStartMs, weekEndMs);
  const lapsePrevious = reviewWords(lapsePredicate, previousStartMs, weekStartMs);

  const stubbornWords = (startMs: number, endMs: number) =>
    new Set(Object.values(input.stubbornWords)
      .filter((record) =>
        record.active && inWindow(record.triggeredAt, startMs, endMs))
      .map((record) => record.wordId)).size;
  const stubbornCount = stubbornWords(weekStartMs, weekEndMs);
  const stubbornPrevious = stubbornWords(previousStartMs, weekStartMs);

  const guessCount = Object.keys(input.guessMistakes)
    .filter((wordId) => (input.guessMistakes[Number(wordId)] ?? 0) > 0)
    .length;

  const dimension = (
    key: WeakDimensionTrend["key"],
    label: string,
    count: number,
    previous: number,
  ): WeakDimensionTrend => ({ key, label, count, change: count - previous });

  return [
    dimension("lookup", "反复查词", lookupCount, lookupPrevious),
    { key: "guess", label: "猜词猜错", count: guessCount, change: null },
    dimension("quiz-spelling", "拼写测验错", quizErrorWords("listening-spelling", weekStartMs, weekEndMs), quizErrorWords("listening-spelling", previousStartMs, weekStartMs)),
    dimension("quiz-c2e", "中译英错", quizErrorWords("chinese-to-english", weekStartMs, weekEndMs), quizErrorWords("chinese-to-english", previousStartMs, weekStartMs)),
    dimension("quiz-choice", "辨析错", quizErrorWords("meaning-choice", weekStartMs, weekEndMs), quizErrorWords("meaning-choice", previousStartMs, weekStartMs)),
    dimension("quiz-cloze", "短文填词错", quizErrorWords("passage-cloze", weekStartMs, weekEndMs), quizErrorWords("passage-cloze", previousStartMs, weekStartMs)),
    dimension("slow-recall", "回忆偏慢", slowCount, slowPrevious),
    dimension("stubborn", "新顽固词", stubbornCount, stubbornPrevious),
    dimension("lapse", "遗忘词", lapseCount, lapsePrevious),
  ];
}

/**
 * 考研冲刺/临考期应强调的薄弱维度 key。
 * 这些维度直接决定临考记忆缺口，趋势区用红色系突出显示。
 */
export function emphasizedWeakDimensions(
  examPhase: ExamPhase | undefined,
): WeakDimensionTrend["key"][] {
  if (examPhase === "临考期" || examPhase === "冲刺期") {
    return ["lookup", "lapse", "slow-recall"];
  }
  return [];
}

/**
 * 本周各薄弱维度趋势（按本地周一划分，风格与 insights.ts 周报一致）。
 * 可归因到周的维度统计本周/上周去重词数；猜词猜错为累计口径（无周级时间源）。
 */
export function buildWeakDimensionTrend(
  input: WeakSignalInput,
  now = new Date(),
  thresholds: WeakThresholds = DEFAULT_WEAK_THRESHOLDS,
): WeakDimensionTrend[] {
  const weekStart = localWeekStart(now);
  return buildTrendForWeek(
    input,
    weekStart.getTime(),
    addLocalDays(weekStart, 7).getTime(),
    thresholds,
  );
}

/**
 * 薄弱维度近 N 周趋势序列（含本周，按时间升序）。
 * 复用 buildWeakDimensionTrend 的周划分与维度口径，供轨迹页连续观察。
 */
export function buildWeakDimensionTrendSeries(
  input: WeakSignalInput,
  now = new Date(),
  weeks = 4,
  thresholds: WeakThresholds = DEFAULT_WEAK_THRESHOLDS,
): WeakDimensionTrendWeek[] {
  const thisWeekStart = localWeekStart(now);
  const count = Math.max(1, Math.trunc(weeks));
  const series: WeakDimensionTrendWeek[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const start = addLocalDays(thisWeekStart, -offset * 7);
    const weekStartMs = start.getTime();
    series.push({
      weekStart: localDateKey(start),
      dimensions: buildTrendForWeek(
        input,
        weekStartMs,
        weekStartMs + 7 * 24 * 60 * 60 * 1000,
        thresholds,
      ),
    });
  }
  return series;
}
