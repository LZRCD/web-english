"use client";

import {
  useEffect,
  useRef,
  type CSSProperties,
} from "react";
import type {
  ReinforcementWord,
  SessionCompletionSummary,
} from "../../lib/session-summary";

type CompletionAction = {
  label: string;
  onClick: () => void;
};

export type SessionCompleteViewProps = {
  summary: SessionCompletionSummary;
  onReinforce: (wordIds: number[]) => void;
  onFreeStudy: () => void;
  primaryAction?: CompletionAction;
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

export default function SessionCompleteView({
  summary,
  onReinforce,
  onFreeStudy,
  primaryAction,
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
          <dt>顺利回忆</dt>
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
