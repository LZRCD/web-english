"use client";

import type { KeyboardEvent } from "react";
import { dateKey, formatDueTime, buildActivityCalendar, type Review } from "../../lib/study";
import type {
  LearningInsights,
  ReviewForecastDay,
  WeeklyLearningReport,
} from "../../lib/insights";
import type { ExamProgressTiers } from "../../lib/learning";

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
  clock: number;
  activityRange: ActivityRange;
  activityOffset: number;
  activityRangeLabels: Record<ActivityRange, string>;
  selectedActivityDate: string;
  ratingLabels: string[];
  insights: LearningInsights;
  reviewForecast: ReviewForecastDay[];
  weeklyReport: WeeklyLearningReport;
  examProgress: ExamProgressTiers | null;
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
  clock,
  activityRange,
  activityOffset,
  activityRangeLabels,
  selectedActivityDate,
  ratingLabels,
  insights,
  reviewForecast,
  weeklyReport,
  examProgress,
  onStartTodaySession,
  onActivityRangeChange,
  onActivityNavigate,
  onActivityToday,
  onSelectDate,
}: HistoryViewProps) {
  const now = new Date(clock);
  const todayKey = dateKey(now);
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
        <div className={`weekly-pace-advice ${weeklyReport.paceStatus}`}>
          <span aria-hidden="true">↗</span>
          <p><strong>考研节奏建议</strong>{weeklyReport.paceAdvice}</p>
        </div>
      </section>
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
