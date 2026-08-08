"use client";

import type { KeyboardEvent } from "react";
import { dateKey, formatDueTime, buildActivityCalendar, type LookupStats, type LookupWord, type Review } from "../../lib/study";
import type {
  LearningInsights,
  ReviewForecastDay,
  WeeklyLearningReport,
} from "../../lib/insights";
import type { ExamPhase, ExamProgressTiers } from "../../lib/learning";
import type { SprintDimensionWithTrend } from "../../lib/session-summary";
import {
  emphasizedWeakDimensions,
  type SprintEffectivenessWeek,
  type SprintHistory,
  type SprintRelapse,
  type SprintRelapseWeek,
  type WeakDimensionTrendWeek,
  type WeakSectionConcentration,
} from "../../lib/weak-signals";

type ActivityRange = 140 | 182 | 365;

type HistoryViewProps = {
  stats: {
    newCount: number;
    reviewCount: number;
    completionCount: number;
    coveredCount: number;
    streak: number;
    dueCount: number;
    retrievability: number;
  };
  effectiveNewGoal: number;
  dailyGoal: number;
  reviews: Review[];
  lookupStats: LookupStats;
  lookupWords: LookupWord[];
  clock: number;
  activityRange: ActivityRange;
  activityOffset: number;
  activityRangeLabels: Record<ActivityRange, string>;
  selectedActivityDate: string;
  ratingLabels: string[];
  insights: LearningInsights;
  reviewForecast: ReviewForecastDay[];
  weeklyReport: WeeklyLearningReport;
  /** 薄弱维度近 N 周趋势（按时间升序，含本周） */
  weakTrendSeries: WeakDimensionTrendWeek[];
  /** 考研阶段（可选）：冲刺/临考期强调关键薄弱维度 */
  examPhase?: ExamPhase;
  examProgress: ExamProgressTiers | null;
  /** 冲刺历史（按 sessionId 分组派生） */
  sprintHistory: SprintHistory;
  /** 考前薄弱冲刺词数（冲刺/临考期显示入口） */
  sprintCount: number;
  /** 薄弱集中区（按词本分册/单元派生） */
  weakConcentration: WeakSectionConcentration[];
  /** 冲刺成效近 N 周序列（含本周，无冲刺周为 null） */
  sprintEffectivenessSeries: SprintEffectivenessWeek[];
  /** 最近 4 个已完成冲刺周截至当前仍薄弱率回溯（旧类型名仅为兼容） */
  sprintRelapseSeries: SprintRelapseWeek[];
  /** 上周冲刺当场达标词截至当前仍薄弱追踪（无上周冲刺为 null） */
  sprintRelapse: SprintRelapse | null;
  /** 当前仍薄弱词词名明细（wordId → 词名，供悬停展示） */
  sprintRelapseWords: { wordId: number; word: string }[];
  /** 冲刺后维度清零与周报对照（冲刺完成页派生） */
  sprintDimensionTrend: SprintDimensionWithTrend[];
  /** 各分册/单元词本总词数（section → unit → 总数，供集中度占比） */
  sectionUnitTotals: ReadonlyMap<string, ReadonlyMap<string, number>>;
  /** 用历史冲刺的词集再跑一次 */
  onResprintHistory?: (sessionId: string) => void;
  onStartSprint: () => void;
  onCopySprint: () => void;
  onExportSprint: () => void;
  /** 集中区按分册/单元发起冲刺 */
  onScopedSprint?: (section: string, unit?: string) => void;
  /** 当前仍薄弱词一键再冲刺 */
  onSprintRelapse?: () => void;
  onStartTodaySession: () => void;
  onActivityRangeChange: (range: ActivityRange) => void;
  onActivityNavigate: (direction: number) => void;
  onActivityToday: () => void;
  onSelectDate: (date: string) => void;
};

export default function HistoryView({
  stats,
  effectiveNewGoal,
  dailyGoal,
  reviews,
  lookupStats,
  lookupWords,
  clock,
  activityRange,
  activityOffset,
  activityRangeLabels,
  selectedActivityDate,
  ratingLabels,
  insights,
  reviewForecast,
  weeklyReport,
  weakTrendSeries,
  examPhase,
  examProgress,
  sprintHistory,
  sprintCount,
  weakConcentration,
  sprintEffectivenessSeries,
  sprintRelapseSeries,
  sprintRelapse,
  sprintRelapseWords,
  sprintDimensionTrend,
  sectionUnitTotals,
  onResprintHistory,
  onStartSprint,
  onCopySprint,
  onExportSprint,
  onScopedSprint,
  onSprintRelapse,
  onStartTodaySession,
  onActivityRangeChange,
  onActivityNavigate,
  onActivityToday,
  onSelectDate,
}: HistoryViewProps) {
  const now = new Date(clock);
  // 回忆耗时格式化：毫秒 → x.xs；null 显示 —
  const formatRecall = (ms: number | null) =>
    ms === null ? "—" : `${(ms / 1000).toFixed(1)}s`;
  const maxConcentrationTotal = Math.max(
    1,
    ...weakConcentration.map((section) => section.total),
  );
  const todayKey = dateKey(now);
  const totalLookupCount = Object.values(lookupStats)
    .reduce((sum, stat) => sum + stat.count, 0);
  const recentLookupAt = Object.values(lookupStats)
    .map((stat) => stat.lastAt)
    .sort()
    .at(-1);
  // 查询次数分布：1 次 / 2 次 / 3-5 次 / 6+ 次的词数
  const lookupDistribution = (() => {
    const buckets = { once: 0, twice: 0, repeated: 0, frequent: 0 };
    for (const stat of Object.values(lookupStats)) {
      if (stat.count === 1) buckets.once += 1;
      else if (stat.count === 2) buckets.twice += 1;
      else if (stat.count <= 5) buckets.repeated += 1;
      else buckets.frequent += 1;
    }
    const max = Math.max(1,
      buckets.once, buckets.twice, buckets.repeated, buckets.frequent);
    return { ...buckets, max };
  })();
  // 查询 2 次以上的词 = 反复查 = 薄弱词依据
  const weakLookupCount = Object.values(lookupStats)
    .filter((stat) => stat.count >= 2).length;
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - (now.getDay() === 0 ? 6 : now.getDay() - 1));
  weekStart.setHours(0, 0, 0, 0);
  const weekNewLookups = lookupWords.filter(
    (item) => new Date(item.addedAt).getTime() >= weekStart.getTime(),
  ).length;
  const activityEndTime = (() => {
    const end = new Date(clock);
    end.setDate(end.getDate() - activityOffset);
    return end.getTime();
  })();
  const activityDays = buildActivityCalendar(reviews, activityRange, new Date(activityEndTime));
  const activityDateRange = activityDays.length
    ? `${activityDays[0].date.replaceAll("-", ".")} — ${activityDays.at(-1)?.date.replaceAll("-", ".")}`
    : "";
  const selectedDayEvents = selectedActivityDate
    ? reviews.filter((review) => dateKey(review.reviewedAt) === selectedActivityDate)
    : [];
  const selectedDayReviews = (() => {
    if (!selectedActivityDate) return [];
    const latestByWord = new Map<string, Review>();
    for (const review of reviews) {
      if (dateKey(review.reviewedAt) !== selectedActivityDate) continue;
      const key = review.wordId !== undefined
        ? `id:${review.wordId}`
        : `${review.section ?? ""}:${review.unit ?? ""}:${review.word.toLowerCase()}`;
      const previous = latestByWord.get(key);
      if (!previous || previous.reviewedAt < review.reviewedAt) {
        latestByWord.set(key, review);
      }
    }
    return [...latestByWord.values()].sort((first, second) =>
      second.reviewedAt.localeCompare(first.reviewedAt));
  })();
  const selectedWeakCount = selectedDayReviews.filter((review) => review.rating <= 1).length;
  const selectedDayNewCount = selectedDayEvents.filter((review) => review.kind === "new").length;
  const recentReviews = [...reviews].reverse().slice(0, 8);
  const forecastMax = Math.max(1, ...reviewForecast.map((day) => day.count));
  const activityTabDate = selectedActivityDate
    || (activityDays.some((day) => day.date === todayKey)
      ? todayKey
      : activityDays.at(-1)?.date);
  const moveActivityFocus = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const offset = {
      ArrowLeft: -7,
      ArrowRight: 7,
      ArrowUp: -1,
      ArrowDown: 1,
    }[event.key];
    if (offset === undefined) return;
    event.preventDefault();
    const nextIndex = Math.min(
      activityDays.length - 1,
      Math.max(0, index + offset),
    );
    const nextDate = activityDays[nextIndex]?.date;
    if (!nextDate) return;
    onSelectDate(nextDate);
    requestAnimationFrame(() => {
      document.getElementById(`activity-${nextDate}`)?.focus();
    });
  };

  return (
    <div className="content-view">
      <div className="section-heading">
        <div><p className="eyebrow">MEMORY TRACE</p><h1>每一次回忆都算数</h1></div>
        <div className="streak"><strong>{stats.streak}</strong><span>连续学习天</span></div>
      </div>
      <div className="stat-grid">
        <div><span>今日新学</span><strong>{stats.newCount}</strong><small>当前目标 {effectiveNewGoal} / 上限 {dailyGoal}</small></div>
        <div><span>今日复习</span><strong>{stats.reviewCount}</strong><small>评分事件</small></div>
        <div><span>完成次数</span><strong>{stats.completionCount}</strong><small>{stats.coveredCount} 个不同单词</small></div>
        <div><span>平均记忆牢固度</span><strong>{stats.retrievability}%</strong><small>综合近期评分与复习间隔</small></div>
        <button type="button" onClick={onStartTodaySession}>
          <span>已到期</span><strong>{stats.dueCount}</strong><small>开始今日任务 →</small>
        </button>
      </div>
      {lookupWords.length > 0 && (
        <section className="lookup-trace" aria-labelledby="lookup-trace-title">
          <div className="panel-title">
            <div>
              <p className="eyebrow">LOOKUP TRACE</p>
              <h2 id="lookup-trace-title">划词集</h2>
            </div>
            {recentLookupAt && (
              <small>最近查询 {new Date(recentLookupAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</small>
            )}
          </div>
          <div className="exam-progress-grid">
            <div><span>累计查询</span><strong>{totalLookupCount}</strong><small>划词查义次数</small></div>
            <div><span>划词收录</span><strong>{lookupWords.length}</strong><small>累计加入划词集</small></div>
            <div><span>本周新增</span><strong>{weekNewLookups}</strong><small>新查询并收录的词</small></div>
          </div>
          <div className="lookup-distribution" aria-label="查询次数分布">
            <div className="lookup-dist-head">
              <strong>查询次数分布</strong>
              <small>反复查询 = 薄弱词依据，共 {weakLookupCount} 个词查过 2 次以上</small>
            </div>
            {[
              { key: "once", label: "查过 1 次", count: lookupDistribution.once },
              { key: "twice", label: "查过 2 次", count: lookupDistribution.twice },
              { key: "repeated", label: "查过 3-5 次", count: lookupDistribution.repeated },
              { key: "frequent", label: "查过 6 次以上", count: lookupDistribution.frequent },
            ].map((row) => (
              <div className="lookup-dist-row" key={row.key}>
                <span>{row.label}</span>
                <div className="lookup-dist-bar">
                  <i
                    className={row.key === "frequent" ? "hot" : ""}
                    style={{ width: `${Math.max(4, (row.count / lookupDistribution.max) * 100)}%` }}
                  />
                </div>
                <strong>{row.count}</strong>
              </div>
            ))}
          </div>
          <p className="lookup-trace-note">
            在词本「划词集」标签可直接复习；查询过的释义会缓存复用，同一语境再次划选会秒出结果。
          </p>
        </section>
      )}
      {examProgress && (
        <section className="exam-progress" aria-labelledby="exam-progress-title">
          <div className="panel-title">
            <div>
              <p className="eyebrow">EXAM READINESS</p>
              <h2 id="exam-progress-title">考研备考就绪度</h2>
            </div>
            <small>考试日 {examProgress.examDate.replaceAll("-", ".")} · 可提取率 ≥ {examProgress.thresholdPercent}%</small>
          </div>
          <div className="exam-progress-grid">
            <div><span>已覆盖</span><strong>{examProgress.covered}</strong><small>至少学习一次</small></div>
            <div><span>已掌握</span><strong>{examProgress.mastered}</strong><small>达到稳定性门槛</small></div>
            <div><span>考试日就绪</span><strong>{examProgress.examReady}</strong><small>预测考试当天仍可提取</small></div>
          </div>
        </section>
      )}

      <section className="weekly-report" aria-labelledby="weekly-report-title">
        <div className="panel-title">
          <div>
            <p className="eyebrow">WEEKLY REPORT</p>
            <h2 id="weekly-report-title">每周学习报告</h2>
          </div>
          <small>{weeklyReport.weekStart.replaceAll("-", ".")} — {weeklyReport.weekEnd.replaceAll("-", ".")}</small>
        </div>
        <div className="weekly-report-grid">
          <div>
            <span>当前已掌握</span>
            <strong>{weeklyReport.masteredCount}</strong>
            <small className={weeklyReport.masteredChange >= 0 ? "positive" : "negative"}>
              本周 {weeklyReport.masteredChange >= 0 ? "+" : ""}{weeklyReport.masteredChange}
            </small>
          </div>
          <div>
            <span>本周遗忘</span>
            <strong>{weeklyReport.forgottenWordCount}</strong>
            <small className={weeklyReport.forgottenChange <= 0 ? "positive" : "negative"}>
              较上周 {weeklyReport.forgottenChange > 0 ? "+" : ""}{weeklyReport.forgottenChange}
            </small>
          </div>
          <div>
            <span>活跃顽固词</span>
            <strong>{weeklyReport.stubbornCount}</strong>
            <small className={weeklyReport.stubbornChange <= 0 ? "positive" : "negative"}>
              本周 {weeklyReport.stubbornChange > 0 ? "+" : ""}{weeklyReport.stubbornChange}
            </small>
          </div>
          <div>
            <span>下周预计复习</span>
            <strong>{weeklyReport.nextWeekReviewCount}</strong>
            <small>
              日均 {weeklyReport.nextWeekDailyAverage}
              {weeklyReport.nextWeekPeak
                ? ` · 峰值 ${weeklyReport.nextWeekPeak.date.slice(5)} ${weeklyReport.nextWeekPeak.count} 词`
                : ""}
            </small>
          </div>
        </div>
        {weakTrendSeries.length > 1 && (
          <div className="weak-trend-series" aria-label="薄弱维度近 4 周趋势">
            <div className="weak-trend-head">
              <strong>薄弱维度近 4 周趋势</strong>
              <small>
                {weakTrendSeries[0].weekStart.replaceAll("-", ".")} — {weakTrendSeries.at(-1)!.weekStart.replaceAll("-", ".")}
              </small>
            </div>
            <div className="weak-trend-series-grid">
              {(() => {
                const emphasized = new Set(emphasizedWeakDimensions(examPhase));
                return weakTrendSeries[0].dimensions.map((dimension) => (
                <div
                  className={
                    emphasized.has(dimension.key)
                      ? "weak-trend-series-row emphasized"
                      : "weak-trend-series-row"
                  }
                  key={dimension.key}
                >
                  <span>{dimension.label}</span>
                  <div className="weak-trend-series-bars">
                    {weakTrendSeries.map((week, weekIndex) => {
                      const current = week.dimensions.find((row) => row.key === dimension.key);
                      const value = current?.count ?? 0;
                      const max = Math.max(1, ...weakTrendSeries.flatMap(
                        (item) => item.dimensions
                          .filter((row) => row.key === dimension.key)
                          .map((row) => row.count),
                      ));
                      return (
                        <div className="weak-trend-series-col" key={week.weekStart}>
                          <i
                            className={value > 0 ? "active" : ""}
                            style={{ height: `${Math.max(4, (value / max) * 26)}px` }}
                          />
                          <small>
                            {weekIndex === weakTrendSeries.length - 1 ? "本周" : week.weekStart.slice(5)}
                          </small>
                          <strong>{value}</strong>
                        </div>
                      );
                    })}
                  </div>
                </div>
                ));
              })()}
            </div>
            {(examPhase === "冲刺期" || examPhase === "临考期") && sprintCount > 0 && (
              <div className="sprint-actions">
                <button type="button" className="sprint-start" onClick={onStartSprint}>
                  开始考前薄弱冲刺（{sprintCount} 词）
                </button>
                <button type="button" className="sprint-copy" onClick={onCopySprint}>
                  复制薄弱清单
                </button>
                <button type="button" className="sprint-copy" onClick={onExportSprint}>
                  导出 CSV
                </button>
              </div>
            )}
          </div>
        )}
        {weeklyReport.weakTrend.length > 0 && (
          <div className="weak-trend" aria-label="本周薄弱维度趋势">
            <div className="weak-trend-head">
              <strong>本周薄弱维度趋势</strong>
              <small>本周出现该信号的不同单词数 · 较上周变化</small>
            </div>
            <div className="weak-trend-grid">
              {weeklyReport.weakTrend.map((row) => (
                <div className="weak-trend-item" key={row.key}>
                  <span>{row.label}</span>
                  <strong>{row.count}</strong>
                  <small className={
                    row.change === null
                      ? "neutral"
                      : row.change > 0
                        ? "negative"
                        : "positive"
                  }>
                    {row.change === null
                      ? "累计"
                      : row.change > 0
                        ? `+${row.change}`
                        : row.change === 0
                          ? "持平"
                          : `${row.change}`}
                  </small>
                </div>
              ))}
            </div>
          </div>
        )}
                {weeklyReport.sprintEffectiveness && (
          <div className="weak-trend" aria-label="本周冲刺成效">
            <div className="weak-trend-head">
              <strong>本周冲刺成效</strong>
              <small>冲刺次数 · 覆盖词数 · 平均回忆变化 · 解决词数</small>
            </div>
            <div className="weak-trend-grid">
              <div className="weak-trend-item">
                <span>冲刺次数</span>
                <strong>{weeklyReport.sprintEffectiveness.sprintCount}</strong>
              </div>
              <div className="weak-trend-item">
                <span>覆盖词数</span>
                <strong>{weeklyReport.sprintEffectiveness.coveredWordCount}</strong>
              </div>
              <div className="weak-trend-item">
                <span>平均回忆</span>
                <strong title={`冲刺前 ${formatRecall(weeklyReport.sprintEffectiveness.beforeAverageRecallMs)} → 冲刺 ${formatRecall(weeklyReport.sprintEffectiveness.sprintAverageRecallMs)}`}>
                  {formatRecall(weeklyReport.sprintEffectiveness.sprintAverageRecallMs)}
                </strong>
                <small className={
                  weeklyReport.sprintEffectiveness.recallImprovementMs === null
                    ? "neutral"
                    : weeklyReport.sprintEffectiveness.recallImprovementMs > 0
                      ? "positive"
                      : "negative"
                }>
                  {weeklyReport.sprintEffectiveness.recallImprovementMs === null
                    ? "无样本"
                    : weeklyReport.sprintEffectiveness.recallImprovementMs > 0
                      ? `↑ 提升 ${(weeklyReport.sprintEffectiveness.recallImprovementMs / 1000).toFixed(1)}s`
                      : `↓ 变慢 ${(-weeklyReport.sprintEffectiveness.recallImprovementMs / 1000).toFixed(1)}s`}
                </small>
              </div>
              <div className="weak-trend-item">
                <span>解决词数</span>
                <strong>{weeklyReport.sprintEffectiveness.resolvedCount}</strong>
              </div>
            </div>
          </div>
        )}
        {sprintEffectivenessSeries.length > 0 && (
          <div className="weak-trend" aria-label="冲刺成效 4 周">
            <div className="weak-trend-head">
              <strong>冲刺成效 4 周</strong>
              <small>每周冲刺次数 · 解决词数 · 平均回忆变化</small>
            </div>
            <div className="sprint-effectiveness-series">
              {sprintEffectivenessSeries.map((week) => (
                <div className="sprint-effectiveness-week" key={week.weekStart}>
                  <span>{week.weekStart === weeklyReport.weekStart ? "本周" : week.weekStart.slice(5)}</span>
                  {week.effectiveness ? (
                    <>
                      <strong>{week.effectiveness.sprintCount} 次</strong>
                      <small>解决 {week.effectiveness.resolvedCount} 词</small>
                      <small className={
                        week.effectiveness.recallImprovementMs === null
                          ? "neutral"
                          : week.effectiveness.recallImprovementMs > 0
                            ? "positive"
                            : "negative"
                      }>
                        {week.effectiveness.recallImprovementMs === null
                          ? "无样本"
                          : week.effectiveness.recallImprovementMs > 0
                            ? `↑ ${(week.effectiveness.recallImprovementMs / 1000).toFixed(1)}s`
                            : `↓ ${(-week.effectiveness.recallImprovementMs / 1000).toFixed(1)}s`}
                      </small>
                    </>
                  ) : (
                    <small className="neutral">—</small>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {sprintRelapseSeries.length > 0 && (
          <div className="weak-trend" aria-label="冲刺后当前仍薄弱率 4 周回溯">
            <div className="weak-trend-head">
              <strong>冲刺后当前仍薄弱率 4 周</strong>
              <small>按最近一次达标处置周分组 · 未区分从未恢复与恢复后再次薄弱</small>
            </div>
            <div className="sprint-effectiveness-series">
              {sprintRelapseSeries.map((week) => (
                <div className="sprint-effectiveness-week" key={week.weekStart}>
                  <span>{week.weekStart.slice(5)}</span>
                  {week.relapse ? (
                    <>
                      <strong>{week.relapse.relapseRate}%</strong>
                      <small>
                        当场达标 {week.relapse.solvedCount} 词 · 当前仍薄弱 {week.relapse.relapsedCount} 词
                      </small>
                      <small className={week.relapse.relapseRate === 0 ? "positive" : "negative"}>
                        {week.relapse.relapseRate === 0 ? "截至当前均不薄弱" : "截至当前需关注"}
                      </small>
                    </>
                  ) : (
                    <small className="neutral">无冲刺当场达标词</small>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {sprintRelapse && (
          <div className="weak-trend" aria-label="冲刺后当前仍薄弱追踪">
            <div className="weak-trend-head">
              <strong>冲刺后当前仍薄弱追踪</strong>
              <small>上周冲刺当场达标词中当前仍薄弱的比例；未区分从未恢复与恢复后再次薄弱</small>
            </div>
            <div
              className="sprint-relapse-row"
              title={sprintRelapseWords.length
                ? `当前仍薄弱：${sprintRelapseWords.slice(0, 10).map((item) => item.word).join("、")}${sprintRelapseWords.length > 10 ? ` 等 ${sprintRelapseWords.length} 词` : ""}`
                : undefined}
            >
              <span>上周当场达标 <strong>{sprintRelapse.solvedCount}</strong> 词</span>
              <span>当前仍薄弱 <strong>{sprintRelapse.relapsedCount}</strong> 词</span>
              <span className={sprintRelapse.relapseRate === 0 ? "positive" : "negative"}>
                当前仍薄弱率 <strong>{sprintRelapse.relapseRate}%</strong>
                {sprintRelapse.relapseRate === 0 ? " · 当前均不薄弱" : " · 需关注"}
              </span>
              {onSprintRelapse && sprintRelapse.relapsedCount > 0 && (
                <button
                  type="button"
                  className="concentration-sprint"
                  onClick={onSprintRelapse}
                >
                  再冲刺当前仍薄弱词（{sprintRelapse.relapsedCount}）
                </button>
              )}
            </div>
          </div>
        )}
        {sprintDimensionTrend.length > 0 && (
          <div className="weak-trend" aria-label="冲刺维度归因">
            <div className="weak-trend-head">
              <strong>冲刺维度归因</strong>
              <small>冲刺后已清零的维度标绿 · 周报仍薄弱标红</small>
            </div>
            <div className="weak-trend-grid">
              {sprintDimensionTrend.map((row) => (
                <div className="weak-trend-item" key={row.key}>
                  <span>{row.label}</span>
                  <strong>{row.sprintCount}</strong>
                  <small className={row.cleared ? "positive" : "negative"}>
                    {row.cleared
                      ? "已清零"
                      : row.weeklyCount !== null && row.weeklyCount > 0
                        ? `本周仍 ${row.weeklyCount} 词`
                        : "仍需关注"}
                  </small>
                </div>
              ))}
            </div>
          </div>
        )}
        {weakConcentration.length > 0 && (
          <div className="weak-concentration" aria-label="薄弱集中区">
            <div className="weak-trend-head">
              <strong>薄弱集中区</strong>
              <small>按词本分册统计薄弱词分布 · 悬停查看单元明细</small>
            </div>
            {weakConcentration.map((section) => {
              const sectionTotal = [...(sectionUnitTotals.get(section.section)?.values() ?? [])]
                .reduce((sum, count) => sum + count, 0);
              const sectionPct = sectionTotal > 0
                ? Math.round((section.total / sectionTotal) * 100)
                : 0;
              return (
                <div className="weak-concentration-row" key={section.section}>
                  <span className="weak-concentration-label">{section.section}</span>
                  <div className="weak-concentration-track">
                    <div
                      className="weak-concentration-fill"
                      style={{ width: `${Math.round((section.total / maxConcentrationTotal) * 100)}%` }}
                    />
                  </div>
                  <strong className="weak-concentration-count">
                    {section.total}
                    {sectionTotal > 0 && <small>{sectionPct}%</small>}
                  </strong>
                  <small
                    className="weak-concentration-units"
                    title={section.units
                      .map((unit) => {
                        const unitTotal = sectionUnitTotals.get(section.section)?.get(unit.unit) ?? 0;
                        const unitPct = unitTotal > 0
                          ? Math.round((unit.count / unitTotal) * 100)
                          : 0;
                        return `${unit.unit}：${unit.count} 词 / ${unitTotal} 词${unitPct > 0 ? `（${unitPct}%）` : ""}`;
                      })
                      .join("；")}
                  >
                    {onScopedSprint
                      ? section.units.slice(0, 5).map((unit) => {
                        const unitTotal = sectionUnitTotals.get(section.section)?.get(unit.unit) ?? 0;
                        const unitPct = unitTotal > 0
                          ? Math.round((unit.count / unitTotal) * 100)
                          : 0;
                        return (
                          <button
                            type="button"
                            className="concentration-unit"
                            key={unit.unit}
                            title={`${unit.unit}：${unit.count} 词 / ${unitTotal} 词${unitPct > 0 ? `（${unitPct}%）` : ""}`}
                            onClick={() => onScopedSprint(section.section, unit.unit)}
                          >
                            {unit.unit} {unit.count}词
                          </button>
                        );
                      })
                      : section.units
                        .slice(0, 3)
                        .map((unit) => `${unit.unit} ${unit.count}词`)
                        .join("、")}
                    {section.units.length > 5 && onScopedSprint
                      ? ` 等 ${section.units.length} 个单元`
                      : section.units.length > 3 && !onScopedSprint
                        ? ` 等 ${section.units.length} 个单元`
                        : ""}
                  </small>
                  {onScopedSprint && (
                    <button
                      type="button"
                      className="concentration-sprint"
                      onClick={() => onScopedSprint(section.section)}
                      disabled={section.total === 0}
                    >
                      冲刺
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
<div className={`weekly-pace-advice ${weeklyReport.paceStatus}`}>
          <span aria-hidden="true">↗</span>
          <p><strong>考研节奏建议</strong>{weeklyReport.paceAdvice}</p>
        </div>
      </section>
      {sprintHistory.totalCount > 0 && (
        <section className="sprint-history" aria-labelledby="sprint-history-title">
          <div className="panel-title">
            <div>
              <p className="eyebrow">SPRINT TRACE</p>
              <h2 id="sprint-history-title">冲刺记录</h2>
            </div>
            <small>共 {sprintHistory.totalCount} 次 · 覆盖 {sprintHistory.totalWordCount} 个不同单词</small>
          </div>
          <div className="sprint-history-list">
            {sprintHistory.records.slice(0, 5).map((record) => {
              const started = new Date(record.startedAt);
              const successRate = record.wordCount > 0
                ? Math.round((record.successCount / record.wordCount) * 100)
                : 0;
              return (
                <div className="sprint-history-row" key={record.sessionId}>
                  <strong>
                    {started.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })}
                    <small>{started.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</small>
                  </strong>
                  <span>{record.wordCount} 词</span>
                  <span>顺利 {successRate}%</span>
                  <span>
                    平均回忆{" "}
                    {record.averageRecallMs === null
                      ? "—"
                      : `${(record.averageRecallMs / 1000).toFixed(1)}s`}
                  </span>
                  {onResprintHistory && (
                    <button
                      type="button"
                      className="sprint-history-rerun"
                      onClick={() => onResprintHistory(record.sessionId)}
                    >
                      再跑一次
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
      <section className="insights-panel" aria-labelledby="insights-title">
        <div className="panel-title">
          <h2 id="insights-title">学习趋势</h2>
          <small>近 7 天</small>
        </div>
        <div className="insights-grid">
          <div className="insight-card">
            <span>成功率</span>
            <strong>{Math.round(insights.successRate)}%</strong>
            <small>
              {insights.successRateDelta !== null
                ? `${insights.successRateDelta >= 0 ? "↑" : "↓"} ${Math.abs(Math.round(insights.successRateDelta))}%`
                : "—"}
            </small>
          </div>
          <div className="insight-card">
            <span>平均回忆</span>
            <strong>
              {insights.averageRecallMs !== null
                ? `${(insights.averageRecallMs / 1000).toFixed(1)}s`
                : "—"}
            </strong>
            <small>反应耗时</small>
          </div>
          <div className="insight-card">
            <span>学习天数</span>
            <strong>{insights.activeDays}</strong>
            <small>/ 7 天</small>
          </div>
          <div className="insight-card">
            <span>不同单词</span>
            <strong>{insights.uniqueWordCount}</strong>
            <small>{insights.reviewCount} 次评分</small>
          </div>
        </div>
        {reviewForecast.length > 0 && (
          <div className="forecast-panel">
            <div className="forecast-title">
              <span>未来 7 天到期复习</span>
              <small>共 {reviewForecast.reduce((sum, day) => sum + day.count, 0)} 词</small>
            </div>
            <div className="forecast-bars">
              {reviewForecast.map((day) => {
                const level = day.count === 0 ? 0 : day.count < 5 ? 1 : day.count < 10 ? 2 : day.count < 20 ? 3 : 4;
                return (
                  <div className="forecast-day" key={day.date} title={`${day.date} · ${day.count} 词到期`}>
                    <small>{day.date.slice(5)}</small>
                    <div
                      className={`forecast-bar level-${level}`}
                      style={{ height: `${Math.max(4, (day.count / forecastMax) * 48)}px` }}
                    />
                    <span>{day.count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
      <section className="activity-panel" aria-labelledby="activity-title">
        <div className="panel-title">
          <div className="activity-heading">
            <h2 id="activity-title">背诵日历</h2>
            <small>{activityDateRange}</small>
          </div>
          <div className="activity-panel-tools">
            <span>{activityDays.filter((day) => day.count > 0).length} 个学习日</span>
            <div className="activity-controls" aria-label="背诵日历范围">
              <div className="activity-range">
                {(Object.keys(activityRangeLabels).map(Number) as ActivityRange[]).map((range) => (
                  <button
                    type="button"
                    className={activityRange === range ? "active" : ""}
                    key={range}
                    aria-pressed={activityRange === range}
                    onClick={() => {
                      onActivityRangeChange(range);
                      onSelectDate("");
                    }}
                  >
                    {activityRangeLabels[range]}
                  </button>
                ))}
              </div>
              <div className="activity-nav">
                <button
                  type="button"
                  aria-label="查看更早日期"
                  title="查看更早日期"
                  onClick={() => {
                    onActivityNavigate(1);
                    onSelectDate("");
                  }}
                >
                  ←
                </button>
                <button
                  type="button"
                  aria-label="查看更近日期"
                  title="查看更近日期"
                  disabled={activityOffset === 0}
                  onClick={() => {
                    onActivityNavigate(-1);
                    onSelectDate("");
                  }}
                >
                  →
                </button>
              </div>
              {activityOffset > 0 && (
                <button
                  type="button"
                  className="activity-today"
                  onClick={() => {
                    onActivityToday();
                    onSelectDate("");
                  }}
                >
                  回到今天
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="activity-scroll">
          {reviews.length === 0 ? (
            <div className="activity-empty" role="status">
              <p>还没有学习记录</p>
              <span>完成今天的任务后，这里会按天点亮你的背诵足迹。</span>
            </div>
          ) : (
          <div className="activity-grid" aria-label={`${activityRangeLabels[activityRange]}每日背诵数量`}>
            {activityDays.map((day, index) => (
              <button
                type="button"
                id={`activity-${day.date}`}
                key={day.date}
                className={`activity-cell level-${day.level}${day.date === todayKey ? " today" : ""}${day.date === selectedActivityDate ? " selected" : ""}`}
                title={`${day.date} · ${day.count} 词`}
                aria-label={`${day.date}，背诵 ${day.count} 个单词`}
                aria-pressed={day.date === selectedActivityDate}
                tabIndex={day.date === activityTabDate ? 0 : -1}
                onKeyDown={(event) => moveActivityFocus(event, index)}
                onClick={() => onSelectDate(day.date === selectedActivityDate ? "" : day.date)}
              />
            ))}
          </div>
          )}
          <div className="activity-legend" aria-hidden="true">
            <span>少</span>
            {[0, 1, 2, 3, 4].map((level) => <i className={`level-${level}`} key={level} />)}
            <span>多</span>
          </div>
        </div>
        {selectedActivityDate && (
          <div className="activity-detail" aria-live="polite">
            <div className="activity-detail-head">
              <div>
                <strong>{selectedActivityDate.replaceAll("-", ".")}</strong>
                <span>
                  {selectedDayReviews.length
                    ? `${selectedDayNewCount} 新学 · ${selectedDayEvents.length - selectedDayNewCount} 复习 · ${selectedDayReviews.length} 个不同单词 · ${selectedWeakCount} 个薄弱`
                    : "当天没有学习记录"}
                </span>
              </div>
              <button
                type="button"
                aria-label="关闭日期详情"
                onClick={() => onSelectDate("")}
              >
                ×
              </button>
            </div>
            {selectedDayReviews.length > 0 && (
              <div className="activity-word-list">
                {selectedDayReviews.map((review) => (
                  <span
                    className={`activity-word rating-${review.rating}`}
                    key={`${review.wordId ?? review.word}-${review.reviewedAt}`}
                  >
                    <strong>{review.word}</strong>
                    <small>{review.kind === "new" ? "新学" : "复习"} · {ratingLabels[review.rating]}</small>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
      <div className="history-panel">
        <div className="panel-title"><h2>最近学习</h2><span>{reviews.length} 次记忆记录</span></div>
        {recentReviews.length ? recentReviews.map((review) => (
          <div className="history-row" key={`${review.word}-${review.reviewedAt}`}>
            <strong>{review.word}</strong>
            <span className={`rating-dot rating-${review.rating}`}>{review.kind === "new" ? "新学" : "复习"} · {ratingLabels[review.rating]}</span>
            <span>{formatDueTime(review.dueAt, now)}</span>
          </div>
        )) : <div className="empty-state">完成第一个单词后，记忆轨迹会出现在这里。</div>}
      </div>
    </div>
  );
}
