"use client";

import {
  useEffect,
  useRef,
  type CSSProperties,
} from "react";
import type {
  ReinforcementWord,
  SessionCompletionSummary,
  SprintCompletionSummary,
  SprintDimensionWithTrend,
} from "../../lib/session-summary";

type CompletionAction = {
  label: string;
  onClick: () => void;
};

export type SessionCompleteViewProps = {
  summary: SessionCompletionSummary;
  /** 冲刺会话专属总结（kind === "sprint" 时展示） */
  sprintSummary?: SprintCompletionSummary;
  /** 冲刺维度 × 周报趋势联动展示结构 */
  sprintDimensionTrend?: SprintDimensionWithTrend[];
  /** 一键再冲刺（只带仍需关注词） */
  onResprint?: () => void;
  onReinforce: (wordIds: number[]) => void;
  onFreeStudy: () => void;
  primaryAction?: CompletionAction;
  todayTaskStatus?: {
    remainingCount: number;
    nextBatchCount: number;
  };
  onUndo?: () => void;
};

const ratingLabels = ["忘记", "模糊", "认识", "熟练"] as const;

function formatAverageRecall(value: number | null) {
  if (value === null) return "—";
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}s`;
}

function candidateClassName(word: ReinforcementWord) {
  return word.rating <= 1
    ? "completion-candidate weak"
    : "completion-candidate steady";
}

/** 冲刺回忆对比条宽度：以两次中较大值为基准，至少 6% */
function sprintBarWidth(valueMs: number, maxMs: number) {
  return Math.max(6, Math.min(100, Math.round((valueMs / Math.max(1, maxMs)) * 100)));
}

export default function SessionCompleteView({
  summary,
  sprintSummary,
  sprintDimensionTrend,
  onResprint,
  onReinforce,
  onFreeStudy,
  primaryAction,
  todayTaskStatus,
  onUndo,
}: SessionCompleteViewProps) {
  const containerRef = useRef<HTMLElement>(null);
  const reinforcementIds = summary.reinforcementWords.map(
    (word) => word.wordId,
  );
  const reinforcementLabel = `再强化 ${reinforcementIds.length} 词`;

  useEffect(() => {
    containerRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <section
      ref={containerRef}
      className="session-complete session-complete-card"
      aria-labelledby="session-complete-title"
      tabIndex={-1}
    >
      <header className="session-complete-head">
        <div className="completion-orbit" aria-hidden="true">
          <span className="completion-check">✓</span>
          {summary.reinforcementWords.map((word, index) => (
            <i
              className={word.rating <= 1 ? "weak" : "steady"}
              key={word.wordId}
              style={{ "--node-index": index } as CSSProperties}
            />
          ))}
        </div>
        <div>
          <p className="eyebrow">MEMORY LOOP · {summary.title}</p>
          <h1 id="session-complete-title">这一轮记忆已闭合</h1>
          <p>
            完成 {summary.completedCount}/{summary.totalCount} 个词，评分已写入复习计划。
          </p>
          <small>
            今日累计 {summary.todayNewCount} 新学 · {summary.todayReviewCount} 复习
          </small>
        </div>
      </header>

      {todayTaskStatus && (
        <p className="today-batch-complete" role="status">
          <strong>
            {todayTaskStatus.remainingCount > 0
              ? "本批已完成"
              : "今日任务已完成"}
          </strong>
          <span>
            {todayTaskStatus.remainingCount > 0
              ? `今日剩余 ${todayTaskStatus.remainingCount} 词 · 下一批 ${todayTaskStatus.nextBatchCount} 词`
              : "完整剩余队列已清空"}
          </span>
        </p>
      )}

      <dl className="session-complete-stats">
        <div>
          <dt>本次新学</dt>
          <dd>{summary.newCount}</dd>
        </div>
        <div>
          <dt>本次复习</dt>
          <dd>{summary.reviewCount}</dd>
        </div>
        <div>
          <dt>当场达标</dt>
          <dd>{summary.successRate === null ? "—" : `${summary.successRate}%`}</dd>
        </div>
        <div>
          <dt>平均回忆</dt>
          <dd>{formatAverageRecall(summary.averageRecallMs)}</dd>
        </div>
        <div>
          <dt>薄弱词</dt>
          <dd>{summary.weakCount}</dd>
        </div>
        <div>
          <dt>明日到期</dt>
          <dd>{summary.tomorrowDueCount}</dd>
        </div>
      </dl>

      {sprintSummary && (
        <section
          className="sprint-completion"
          aria-labelledby="sprint-completion-title"
        >
          <div className="sprint-completion-head">
            <p className="eyebrow">SPRINT RESULT</p>
            <h2 id="sprint-completion-title">本次冲刺小结</h2>
          </div>
          <div className="sprint-completion-stats">
            <div><span>冲刺词数</span><strong>{sprintSummary.sprintWordCount}</strong></div>
            <div><span>当场达标</span><strong>{sprintSummary.resolvedCount}</strong></div>
            <div>
              <span>仍需关注</span>
              <strong className={sprintSummary.stillWeakCount > 0 ? "negative" : ""}>
                {sprintSummary.stillWeakCount}
              </strong>
            </div>
            <div>
              <span>配对词冲刺均值</span>
              <strong>
                {sprintSummary.pairedRecall.pairedTargetAverageRecallMs === null
                  ? "—"
                  : `${(sprintSummary.pairedRecall.pairedTargetAverageRecallMs / 1000).toFixed(1)}s`}
              </strong>
            </div>
          </div>
          {sprintSummary.stillWeakWords.length > 0 && (
            <div className="sprint-still-weak">
              <p className="sprint-still-weak-title">仍需关注：</p>
              <div className="sprint-still-weak-list">
                {sprintSummary.stillWeakWords.map((item) => (
                  <span className="completion-candidate weak" key={item.wordId}>
                    <strong>{item.word}</strong>
                    <small>{item.signals.join("、")}</small>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="sprint-recall-compare" aria-label="同词配对回忆变化">
            <p className="sprint-recall-compare-title">
              同词配对回忆变化 · {sprintSummary.pairedRecall.pairedWordCount} 个配对词
            </p>
            {sprintSummary.pairedRecall.pairedBeforeAverageRecallMs !== null
              && sprintSummary.pairedRecall.pairedTargetAverageRecallMs !== null
              && sprintSummary.pairedRecall.pairedChangeMs !== null ? (
              <>
              <div className="sprint-recall-compare-row">
                <span>最近非冲刺</span>
                <div className="sprint-recall-bar">
                  <i style={{ width: `${sprintBarWidth(sprintSummary.pairedRecall.pairedBeforeAverageRecallMs, Math.max(sprintSummary.pairedRecall.pairedBeforeAverageRecallMs, sprintSummary.pairedRecall.pairedTargetAverageRecallMs))}%` }} />
                </div>
                <strong>{(sprintSummary.pairedRecall.pairedBeforeAverageRecallMs / 1000).toFixed(1)}s</strong>
              </div>
              <div className="sprint-recall-compare-row">
                <span>本次冲刺</span>
                <div className="sprint-recall-bar">
                  <i className="after" style={{ width: `${sprintBarWidth(sprintSummary.pairedRecall.pairedTargetAverageRecallMs, Math.max(sprintSummary.pairedRecall.pairedBeforeAverageRecallMs, sprintSummary.pairedRecall.pairedTargetAverageRecallMs))}%` }} />
                </div>
                <strong>{(sprintSummary.pairedRecall.pairedTargetAverageRecallMs / 1000).toFixed(1)}s</strong>
              </div>
              <small className={
                sprintSummary.pairedRecall.pairedChangeMs < 0
                  ? "positive"
                  : sprintSummary.pairedRecall.pairedChangeMs > 0
                    ? "negative"
                    : "neutral"
              }>
                {sprintSummary.pairedRecall.pairedChangeMs < 0
                  ? `观察到本次较此前快 ${(-sprintSummary.pairedRecall.pairedChangeMs / 1000).toFixed(1)}s`
                  : sprintSummary.pairedRecall.pairedChangeMs > 0
                    ? `观察到本次较此前慢 ${(sprintSummary.pairedRecall.pairedChangeMs / 1000).toFixed(1)}s`
                    : "观察到本次与此前持平"}
              </small>
              </>
            ) : (
              <small className="neutral">无配对样本</small>
            )}
          </div>

          {sprintDimensionTrend && sprintDimensionTrend.some((row) => row.weeklyCount !== null) && (
            <div className="sprint-dimension-trend" aria-label="薄弱维度与本周趋势">
              <p className="sprint-recall-compare-title">薄弱维度 × 本周趋势</p>
              <div className="sprint-dimension-trend-list">
                {sprintDimensionTrend.map((row) => {
                  if (row.sprintCount === 0 && row.weeklyCount === 0) return null;
                  return (
                    <span
                      className={row.cleared ? "sprint-dimension cleared" : "sprint-dimension"}
                      key={row.key}
                    >
                      <strong>{row.label}</strong>
                      <small>
                        {row.cleared
                          ? "已清零"
                          : `冲刺后 ${row.sprintCount} 词`}
                        {row.weeklyCount !== null && row.weeklyCount > 0
                          ? ` · 本周 ${row.weeklyCount}`
                          : ""}
                      </small>
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {onResprint && sprintSummary.stillWeakCount > 0 && (
            <div className="sprint-actions">
              <button
                type="button"
                className="sprint-start"
                onClick={onResprint}
              >
                再冲刺仍需关注（{sprintSummary.stillWeakCount}）
              </button>
            </div>
          )}
        </section>
      )}

      <section
        className="completion-reinforcement"
        aria-labelledby="completion-reinforcement-title"
      >
        <div className="completion-reinforcement-copy">
          <p className="eyebrow">NEXT LOOP</p>
          <h2 id="completion-reinforcement-title">下一圈，精准强化</h2>
          <p>按本次评分与回忆耗时挑选，先处理最容易遗忘的词。</p>
        </div>
        {summary.reinforcementWords.length > 0 ? (
          <div className="completion-candidates" aria-label="待强化单词">
            {summary.reinforcementWords.map((word) => (
              <span className={candidateClassName(word)} key={word.wordId}>
                <strong>{word.word}</strong>
                <small>{ratingLabels[word.rating]}</small>
              </span>
            ))}
          </div>
        ) : (
          <p className="completion-candidates-empty">本轮没有可加入强化队列的单词。</p>
        )}
      </section>

      <footer className="session-complete-actions">
        {onUndo && (
          <button className="completion-undo-button quiet" type="button" onClick={onUndo}>
            撤销最后评分
          </button>
        )}
        {reinforcementIds.length > 0 && (
          <button
            className="completion-reinforce-button"
            type="button"
            onClick={() => onReinforce(reinforcementIds)}
          >
            {reinforcementLabel}
          </button>
        )}
        {primaryAction && (
          <button
            className={reinforcementIds.length ? "quiet" : "completion-primary-button"}
            type="button"
            onClick={primaryAction.onClick}
          >
            {primaryAction.label}
          </button>
        )}
        <button className="quiet" type="button" onClick={onFreeStudy}>
          返回额外练习
        </button>
      </footer>
    </section>
  );
}
