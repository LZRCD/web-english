"use client";

import type {
  FormEventHandler,
  MouseEvent,
  PointerEvent,
  RefObject,
} from "react";
import type { WordEnrichment, WordProgress, StudySession } from "../../lib/learning";
import { wordRetrievability } from "../../lib/learning";
import type { Word } from "../../lib/study";
import { formatDueTime } from "../../lib/study";
import { maskWord, splitSenseItems } from "../../lib/word-utils";

type RedbookStatus = "loading" | "ready" | "error";
type ReinforcementRating = 0 | 1;

type WordCardProps = {
  // Refs
  wordCardRef: RefObject<HTMLElement | null>;
  reinforcementInputRef: RefObject<HTMLInputElement | null>;

  // 展示状态
  revealed: boolean;
  reinforcementRating: ReinforcementRating | null;
  redbookReady: boolean;
  redbookStatus: RedbookStatus;

  // 当前单词
  current: Word;
  currentSenses: { part: string; meaning: string }[];
  currentFamiliarMeanings: Set<string>;
  currentEnrichment?: WordEnrichment;
  currentProgress?: WordProgress;
  isFavorite: boolean;
  hasRecordedAudio: boolean;

  // 上下文
  activeSession?: StudySession;
  newCount: number;
  clock: number;

  // 强化表单
  reinforcementInput: string;
  reinforcementFeedback: string;
  reinforcementSentence: string;
  reinforcementMeaning: string;

  // 富化
  enrichmentLoading: boolean;
  reviewingSense: number | null;
  rewritingSense: number | null;
  unfamiliarMeanings: string[];

  // 回调
  onReveal: () => void;
  onToggleFavorite: () => void;
  onSpeak: () => void;
  onToggleMeaningFamiliar: (meaning: string) => void;
  onEnrichWord: () => void;
  onReportSenseMismatch: (index: number) => void;
  onRewriteSenseExample: (index: number) => void;
  onTextSelection: (
    event: MouseEvent<HTMLElement> | PointerEvent<HTMLElement>,
  ) => void;
  onSetReinforcementInput: (value: string) => void;
  onClearReinforcementFeedback: () => void;
  onSubmitReinforcement: FormEventHandler<HTMLFormElement>;
  onSkipReinforcement: () => void;
};

/** 单词卡片：包含未揭示/已揭示/强化三种状态 */
export default function WordCard({
  wordCardRef,
  reinforcementInputRef,
  revealed,
  reinforcementRating,
  redbookReady,
  redbookStatus,
  current,
  currentSenses,
  currentFamiliarMeanings,
  currentEnrichment,
  currentProgress,
  isFavorite,
  hasRecordedAudio,
  activeSession,
  newCount,
  clock,
  reinforcementInput,
  reinforcementFeedback,
  reinforcementSentence,
  reinforcementMeaning,
  enrichmentLoading,
  reviewingSense,
  rewritingSense,
  unfamiliarMeanings,
  onReveal,
  onToggleFavorite,
  onSpeak,
  onToggleMeaningFamiliar,
  onEnrichWord,
  onReportSenseMismatch,
  onRewriteSenseExample,
  onTextSelection,
  onSetReinforcementInput,
  onClearReinforcementFeedback,
  onSubmitReinforcement,
  onSkipReinforcement,
}: WordCardProps) {
  const cardClass = [
    "word-card",
    revealed && "revealed",
    reinforcementRating !== null && "reinforcing",
    !redbookReady && "loading",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article
      ref={wordCardRef as RefObject<HTMLElement>}
      className={cardClass}
      aria-busy={redbookStatus === "loading"}
      tabIndex={-1}
      onMouseUp={onTextSelection}
      onPointerUp={(event) => {
        if (event.pointerType !== "mouse") onTextSelection(event);
      }}
    >
      {/* 词头：计数 + 收藏/发音 */}
      <div className="word-heading">
        <p className="word-count">
          {redbookReady
            ? activeSession
              ? `${String(Math.min(activeSession.index + 1, activeSession.wordIds.length)).padStart(2, "0")} / ${activeSession.wordIds.length}`
              : `${String(newCount).padStart(2, "0")} 新词`
            : "— / —"}
        </p>
        <div className="word-actions">
          <button
            className={isFavorite ? "favorite-button saved" : "favorite-button"}
            onClick={onToggleFavorite}
            disabled={!redbookReady}
            aria-label={
              isFavorite
                ? `将 ${current.word} 移出词本`
                : `将 ${current.word} 加入词本`
            }
            aria-pressed={isFavorite}
            title={isFavorite ? "移出词本" : "加入词本"}
          >
            {isFavorite ? "◆" : "◇"}
          </button>
          <button
            className="sound-button"
            onClick={onSpeak}
            disabled={!redbookReady}
            aria-label={`播放 ${current.word} 的发音`}
            title={
              hasRecordedAudio
                ? "2027 红宝书原声"
                : "浏览器 TTS 回退"
            }
          >
            ◖))
          </button>
        </div>
      </div>

      {/* 词面：单词 + 音标 + 揭示按钮 */}
      <button
        className="word-face"
        onClick={() => {
          if (!redbookReady) return;
          onReveal();
          onSpeak();
        }}
        disabled={!redbookReady}
        aria-label="显示单词释义"
      >
        <h1>
          {reinforcementRating === null
            ? current.word
            : maskWord(current.word)}
        </h1>
        <p>
          {redbookReady
            ? reinforcementRating === null
              ? current.phonetic || " "
              : `${current.word.replace(/\s/g, "").length} LETTERS`
            : "LOCAL VOCABULARY"}
        </p>
        {!redbookReady ? (
          <span>
            {redbookStatus === "loading"
              ? "正在读取 6550 个考研词汇…"
              : "未能读取本地红宝书词库"}
          </span>
        ) : (
          !revealed && <span>先在脑中回忆，再点击查看</span>
        )}
      </button>

      {/* 揭示后：释义面板 */}
      {revealed && redbookReady && reinforcementRating === null && (
        <div className="meaning-panel">
          <div className="meaning-main">
            {currentSenses.map((sense) => (
              <div className="meaning-row" key={sense.part}>
                <span>{sense.part}</span>
                <div className="meaning-sense-list">
                  {splitSenseItems(sense.meaning).map((meaning) => {
                    const familiar = currentFamiliarMeanings.has(meaning);
                    return (
                      <button
                        type="button"
                        className={
                          familiar ? "meaning-sense familiar" : "meaning-sense"
                        }
                        key={meaning}
                        onClick={() => onToggleMeaningFamiliar(meaning)}
                        aria-pressed={familiar}
                        title={
                          familiar ? "取消熟练标记" : "标记为熟练义项"
                        }
                      >
                        {meaning}
                        {familiar && <small>✓ 熟练</small>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* 词族 */}
          {current.relation && (
            <div
              className={`word-relation relation-${current.relation.kind}`}
            >
              <span>词族轨道</span>
              <div>
                <strong>{current.relation.label}</strong>
                <small>{current.relation.note}</small>
              </div>
            </div>
          )}

          {/* 例句 / 内容补充 */}
          {(current.sentence || currentEnrichment?.senseExamples?.length) ? (
            <div className="context-block">
              {currentEnrichment?.senseExamples?.length ? (
                <>
                  <span className="sense-examples-label">释义例句</span>
                  <ol className="sense-examples">
                    {currentEnrichment.senseExamples.map((example, index) => (
                      <li
                        className="sense-example"
                        key={`${example.meaning}-${index}`}
                      >
                        <strong>{index + 1}. {example.meaning}</strong>
                        <p className="context-sentence">{example.sentence}</p>
                        <p className="context-translation">
                          {example.translation}
                        </p>
                        {currentEnrichment.source === "ai" && (
                          <div className="sense-example-quality">
                            <small>
                              {example.review?.status === "pending"
                                ? "正在语义二审…"
                                : example.review?.status === "passed"
                                  ? "语义二审通过"
                                  : example.review?.status === "failed"
                                    ? `二审未通过${example.review.note ? `：${example.review.note}` : ""}`
                                    : typeof example.confidence === "number"
                                      ? `生成置信度 ${Math.round(example.confidence * 100)}%`
                                      : "尚未反馈"}
                            </small>
                            <span>
                              <button
                                type="button"
                                className="quiet"
                                disabled={
                                  reviewingSense !== null
                                  || rewritingSense !== null
                                }
                                onClick={() => onReportSenseMismatch(index)}
                              >
                                {reviewingSense === index
                                  ? "二审中…"
                                  : "例句与义项不符"}
                              </button>
                              <button
                                type="button"
                                disabled={
                                  reviewingSense !== null
                                  || rewritingSense !== null
                                }
                                onClick={() => onRewriteSenseExample(index)}
                              >
                                {rewritingSense === index ? "重写中…" : "只重写此条"}
                              </button>
                            </span>
                          </div>
                        )}
                      </li>
                    ))}
                  </ol>
                </>
              ) : (
                <>
                  <p className="context-sentence">{current.sentence}</p>
                  <p className="context-translation">{current.translation}</p>
                </>
              )}
              {currentEnrichment && (
                <div className="content-meta">
                  <small className="content-source">
                    {currentEnrichment.source === "ai"
                      ? "AI 生成 · 已缓存 · 未人工核验"
                      : "词典内容"}
                    {currentEnrichment.targetMeanings?.length
                      ? ` · 针对：${currentEnrichment.targetMeanings.join("、")}`
                      : ""}
                  </small>
                  {currentEnrichment.source === "ai" && (
                    <button
                      type="button"
                      onClick={onEnrichWord}
                      disabled={
                        enrichmentLoading || !unfamiliarMeanings.length
                      }
                    >
                      {enrichmentLoading
                        ? "重写中…"
                        : "按未熟练义项重写"}
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <button
              className="context-block context-ai"
              onClick={onEnrichWord}
              disabled={enrichmentLoading || !unfamiliarMeanings.length}
              aria-keyshortcuts="E"
            >
              <span>
                内容补充 <kbd>E</kbd>
              </span>
              <p>
                {!unfamiliarMeanings.length
                  ? "全部中文义项已标记熟练"
                  : enrichmentLoading
                    ? "正在按未熟练义项生成并校验格式…"
                    : `按 ${unfamiliarMeanings.length} 个未熟练义项生成例句与搭配`}
              </p>
            </button>
          )}

          {/* 常用搭配 */}
          {current.collocation && (
            <div className="collocation-block">
              <span>常用搭配</span>
              <p>{current.collocation}</p>
            </div>
          )}

          {/* 单词详情 */}
          <div className="word-details">
            <div>
              <span>所在分组</span>
              <strong>
                {current.section ?? ""} · Unit {current.unit ?? ""}
              </strong>
            </div>
            <div>
              <span>词汇序号</span>
              <strong>NO. {current.id ?? ""}</strong>
            </div>
            <div>
              <span>下次复习</span>
              <strong>
                {currentProgress
                  ? formatDueTime(currentProgress.nextDueAt, new Date(clock))
                  : "首次学习"}
              </strong>
            </div>
            {currentProgress && (
              <div>
                <span>FSRS 可提取率</span>
                <strong>
                  {wordRetrievability(currentProgress, new Date(clock))}%
                </strong>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 揭示后：强化拼写表单 */}
      {revealed && redbookReady && reinforcementRating !== null && (
        <form className="reinforcement-panel" onSubmit={onSubmitReinforcement}>
          <div className="reinforcement-heading">
            <span>
              {reinforcementRating === 0 ? "忘记后再认" : "模糊后加固"}
            </span>
            <strong>趁答案还在短时记忆里，再主动提取一次</strong>
          </div>
          <div className="reinforcement-cue">
            <small>
              {reinforcementSentence ? "语境填空" : "核心含义"}
            </small>
            <p>{reinforcementSentence || reinforcementMeaning}</p>
            {reinforcementRating === 0 &&
              (current.relation || current.root) && (
                <em>
                  {current.relation?.label ??
                    `词根提示：${current.root}`}
                </em>
              )}
          </div>
          <label className="reinforcement-input">
            <span>输入完整单词</span>
            <input
              ref={reinforcementInputRef}
              value={reinforcementInput}
              onChange={(event) => {
                onSetReinforcementInput(event.target.value);
                onClearReinforcementFeedback();
              }}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-describedby="reinforcement-feedback"
            />
          </label>
          <div className="reinforcement-actions">
            <button type="submit" disabled={!reinforcementInput.trim()}>
              完成强化
            </button>
            <button
              type="button"
              className="quiet"
              onClick={onSkipReinforcement}
            >
              暂时跳过
            </button>
          </div>
          <p
            id="reinforcement-feedback"
            className={
              reinforcementFeedback
                ? "reinforcement-feedback error"
                : "reinforcement-feedback"
            }
            aria-live="polite"
          >
            {reinforcementFeedback ||
              "只增加这一道短题，完成后自动进入下一词"}
          </p>
        </form>
      )}
    </article>
  );
}
