"use client";

import {
  useMemo,
  useState,
  type FormEventHandler,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import type {
  SenseFrequencyEntry,
  StudySession,
  StudyWordSource,
  WordEnrichment,
  WordProgress,
} from "../../lib/learning";
import type { ReusedSentence } from "../../lib/sentence-index";
import { wordRetrievability } from "../../lib/learning";
import type {
  StabilizedDimension,
  WordRecallStats,
} from "../../lib/weak-signals";
import type { LookupStat, Word } from "../../lib/study";
import { formatDueTime } from "../../lib/study";
import type { RedbookLoadGuidance } from "../../lib/redbook";
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
  redbookLoadGuidance?: RedbookLoadGuidance;

  // 当前单词
  current: Word;
  currentSenses: { part: string; meaning: string }[];
  currentFamiliarMeanings: Set<string>;
  currentEnrichment?: WordEnrichment;
  currentProgress?: WordProgress;
  isFavorite: boolean;
  hasRecordedAudio: boolean;
  /** 隐藏下方释义的中文 */
  hideChineseMeaning: boolean;
  /** 多释义单词先显示英文语境句，让人猜测后再展开中文释义 */
  guessContextFirst: boolean;
  /** 当前词的义项考频（AI 生成缓存） */
  currentSenseFrequency?: SenseFrequencyEntry[];
  /** 义项考频生成中 */
  frequencyLoading: boolean;
  /** 该词出现在这些已见例句中（跨词复用） */
  reusedSentences: ReusedSentence[];
  /** 该词在隐藏释义阶段猜错的累计次数 */
  guessMistakeCount: number;
  /** 该词的划词查询统计（用于补漏提示） */
  currentLookupStat?: LookupStat;
  /** 该词最近评分的回忆耗时统计 */
  currentRecallStats?: WordRecallStats;
  /** 该词薄弱信号标签（任意会话态展示） */
  sprintWeakSignals?: string[];
  /** 薄弱信号区文案（冲刺态/日常态区分） */
  sprintWeakLabel?: string;
  /** 一键把当前词加入今日任务 */
  onAddToToday?: () => void;
  /** 该词的薄弱信号时间线文本（多行，供标签悬停查看） */
  signalTimelineText?: string;
  /** 曾有真实薄弱证据、现已满足恢复条件的维度（正向反馈） */
  stabilizedDimensions?: StabilizedDimension[];
  /** 点击例句来源词跳转到该词学习卡；sourceId 缺失时降级为纯文本 */
  onFocusSourceWord?: (sourceId: number | undefined, sourceWord: string) => void;

  // 上下文
  activeSession?: StudySession;
  wordSource: StudyWordSource;
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
  onRetryRedbookLoad: () => void;
  onToggleFavorite: () => void;
  onSpeak: () => void;
  onToggleMeaningFamiliar: (meaning: string) => void;
  onEnrichWord: () => void;
  onGenerateSenseFrequency: () => void;
  /** 记录一次猜词猜错 */
  onGuessMistake: () => void;
  /** AI 判分猜词：命中任一义项即对，不看语境；返回 null 表示判分不可用，回退本地匹配 */
  onGuessCheck?: (payload: {
    word: string;
    sentence: string;
    translation?: string;
    senses: string[];
    guess: string;
  }) => Promise<{ correct: boolean; matched: string } | null>;
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
  redbookLoadGuidance,
  current,
  currentSenses,
  currentFamiliarMeanings,
  currentEnrichment,
  currentProgress,
  isFavorite,
  hasRecordedAudio,
  hideChineseMeaning,
  guessContextFirst,
  currentSenseFrequency,
  frequencyLoading,
  reusedSentences,
  guessMistakeCount,
  currentLookupStat,
  currentRecallStats,
  sprintWeakSignals,
  sprintWeakLabel,
  signalTimelineText,
  stabilizedDimensions,
  onAddToToday,
  onFocusSourceWord,
  activeSession,
  wordSource,
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
  onRetryRedbookLoad,
  onToggleFavorite,
  onSpeak,
  onToggleMeaningFamiliar,
  onEnrichWord,
  onGenerateSenseFrequency,
  onGuessMistake,
  onGuessCheck,
  onReportSenseMismatch,
  onRewriteSenseExample,
  onTextSelection,
  onSetReinforcementInput,
  onClearReinforcementFeedback,
  onSubmitReinforcement,
  onSkipReinforcement,
}: WordCardProps) {
  // 释义隐藏逻辑：隐藏全部中文，或对多释义单词先猜语境
  const [sensesExpanded, setSensesExpanded] = useState(false);
  const currentSenseItems = useMemo(
    () => [...new Set(
      currentSenses.flatMap((sense) => splitSenseItems(sense.meaning)),
    )],
    [currentSenses],
  );
  const hideSenses = hideChineseMeaning
    || (guessContextFirst && currentSenseItems.length >= 2);
  // 切换单词时收起释义（渲染期间调整状态，避免沿用上一词的展开状态）
  const [lastSenseWordId, setLastSenseWordId] = useState(current.id);
  if (lastSenseWordId !== current.id) {
    setLastSenseWordId(current.id);
    setSensesExpanded(false);
  }
  const guessSentence =
    currentEnrichment?.senseExamples?.[0]?.sentence
    ?? current.sentence;
  const guessTranslation =
    currentEnrichment?.senseExamples?.[0]?.translation;
  // 隐藏释义阶段猜词：输入中文，命中任一义项即展开
  const [guessInput, setGuessInput] = useState("");
  const [guessing, setGuessing] = useState(false);
  const [guessFeedback, setGuessFeedback] = useState<
    | { kind: "correct"; matched: string }
    | { kind: "wrong" }
    | undefined
  >(undefined);
  const submitGuess = async () => {
    const input = guessInput.trim();
    if (!input || guessing) return;
    const localMatched = currentSenseItems.find((item) =>
      item.includes(input) || input.includes(item),
    );
    // AI 判分优先：任一义项命中即对、不看语境；失败时退回本地子串匹配
    if (onGuessCheck) {
      setGuessing(true);
      try {
        const verdict = await onGuessCheck({
          word: current.word,
          sentence: guessSentence ?? "",
          translation: guessTranslation,
          senses: currentSenseItems,
          guess: input,
        });
        if (verdict) {
          if (verdict.correct) {
            setGuessFeedback({ kind: "correct", matched: verdict.matched });
            setSensesExpanded(true);
          } else {
            setGuessFeedback({ kind: "wrong" });
            onGuessMistake();
          }
          return;
        }
      } finally {
        setGuessing(false);
      }
    }
    if (localMatched) {
      setGuessFeedback({ kind: "correct", matched: localMatched });
      setSensesExpanded(true);
    } else {
      setGuessFeedback({ kind: "wrong" });
      onGuessMistake();
    }
  };
  // 切换单词时清空猜词状态
  if (lastSenseWordId !== current.id) {
    setGuessInput("");
    setGuessFeedback(undefined);
  }

  // 义项考频等级文案
  const frequencyLabel = (level: SenseFrequencyEntry["level"]) =>
    level === "high"
      ? "★ 高频常考"
      : level === "medium"
        ? "◐ 中频"
        : "· 低频";

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
      <div
        className="word-source"
        role="note"
        aria-label={`当前单词来源：${wordSource.label}。${wordSource.description}`}
      >
        <span>{wordSource.label}</span>
        <small>{wordSource.description}</small>
      </div>

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

      {redbookStatus === "error" && redbookLoadGuidance && (
        <section className="redbook-load-error" role="alert" aria-live="assertive">
          <strong>{redbookLoadGuidance.title}</strong>
          <p>{redbookLoadGuidance.detail}</p>
          <button type="button" onClick={onRetryRedbookLoad}>
            重新读取词库
          </button>
        </section>
      )}

      {/* 揭示后：释义面板 */}
      {revealed && redbookReady && reinforcementRating === null && (
        <div className="meaning-panel">
          {/* 划词补漏提示：查过多少次、最近查于何时 */}
          {currentLookupStat && currentLookupStat.count > 0 && (
            <p className="lookup-hint">
              你之前查过 {currentLookupStat.count} 次，最近查于{" "}
              {new Date(currentLookupStat.lastAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
            </p>
          )}
          {currentRecallStats && (
            <p className="lookup-hint recall">
              平均回忆 {(currentRecallStats.averageMs / 1000).toFixed(1)}s
              {" · "}中位 {(currentRecallStats.medianMs / 1000).toFixed(1)}s
              {" · "}{currentRecallStats.sampleCount} 次评分
            </p>
          )}
          {sprintWeakSignals && sprintWeakSignals.length > 0 && (
            <div className="sprint-weak-reasons" title={signalTimelineText}>
              <span>{sprintWeakLabel ?? "本词存在薄弱信号："}</span>
              <div className="weak-signal-tags">
                {sprintWeakSignals.map((signal) => (
                  <span className="weak-signal-tag" key={signal}>{signal}</span>
                ))}
              </div>
              {onAddToToday && (
                <button type="button" className="weak-add-today" onClick={onAddToToday}>
                  加入今日任务
                </button>
              )}
            </div>
          )}
          {stabilizedDimensions && stabilizedDimensions.length > 0 && (
            <div className="weak-stabilized" title="曾有薄弱记录，满足各维度既有恢复条件后已稳定">
              <span className="weak-stabilized-tag">
                已稳定 · {stabilizedDimensions.map((dimension) => dimension.label).join("、")}弱点已消除
              </span>
            </div>
          )}
          {hideSenses && !sensesExpanded && (
            <div className="meaning-hidden">
              {guessSentence ? (
                <>
                  <p className="guess-context-label">
                    读英文句子，猜猜 {current.word} 在这个语境里的意思
                  </p>
                  <p className="context-sentence">{guessSentence}</p>
                  {/* 开启「隐藏释义中文」时不显示翻译提示，避免泄漏答案 */}
                  {guessTranslation && !hideChineseMeaning && (
                    <small className="guess-context-hint">
                      {guessTranslation}
                    </small>
                  )}
                </>
              ) : (
                <p className="guess-context-label">
                  释义已隐藏，先在心里回忆 {current.word} 的含义
                </p>
              )}
              {/* 猜词：输入中文猜测词义 */}
              <div className="guess-input-row">
                <input
                  value={guessInput}
                  onChange={(event) => {
                    setGuessInput(event.target.value);
                    setGuessFeedback(undefined);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      submitGuess();
                    }
                  }}
                  placeholder="输入中文释义（回车确认）"
                  autoComplete="off"
                  aria-label={`猜测 ${current.word} 的中文释义`}
                />
                <button
                  type="button"
                  onClick={submitGuess}
                  disabled={!guessInput.trim() || guessing}
                >
                  {guessing ? "判分中…" : "猜一猜"}
                </button>
              </div>
              {guessFeedback?.kind === "wrong" && (
                <p className="guess-wrong" role="alert">
                  没猜中，已记录一次。看看例句再试试，或直接看释义。
                </p>
              )}
              {guessMistakeCount > 0 && (
                <small className="guess-mistake-badge">
                  这个词已猜错 {guessMistakeCount} 次
                </small>
              )}
              <button
                type="button"
                className="meaning-reveal"
                onClick={() => setSensesExpanded(true)}
              >
                显示释义
              </button>
            </div>
          )}
          {(!hideSenses || sensesExpanded) && (
            <>
              {guessFeedback?.kind === "correct" && (
                <p className="guess-correct">
                  {guessFeedback.matched
                    ? `猜中了「${guessFeedback.matched}」，看下完整释义确认`
                    : "猜中了，看下完整释义确认"}
                </p>
              )}
              <div className="meaning-main">
            {currentSenses.map((sense) => (
              <div className="meaning-row" key={sense.part}>
                <span>{sense.part}</span>
                <div className="meaning-sense-list">
                  {splitSenseItems(sense.meaning).map((meaning, senseIndex) => {
                    const familiar = currentFamiliarMeanings.has(meaning);
                    const frequency = currentSenseFrequency?.find(
                      (entry) => entry.meaning === meaning,
                    );
                    // 核心义以 AI 考频为据：仅真题高频常考义（high）才标注，无考频时不显示
                    const isCore = frequency?.level === "high";
                    return (
                      <button
                        type="button"
                        className={[
                          "meaning-sense",
                          familiar && "familiar",
                          isCore && "sense-frequency-highlight",
                        ].filter(Boolean).join(" ")}
                        key={meaning}
                        onClick={() => onToggleMeaningFamiliar(meaning)}
                        aria-pressed={familiar}
                        title={
                          familiar ? "取消熟练标记" : "标记为熟练义项"
                        }
                      >
                        <span className="sense-index">{senseIndex + 1}</span>
                        {meaning}
                        {frequency && (
                          <small className={`sense-frequency ${frequency.level}`}>
                            {frequencyLabel(frequency.level)}
                          </small>
                        )}
                        {isCore && (
                          <small className="sense-core">核心义</small>
                        )}
                        {familiar && <small>✓ 熟练</small>}
                        {frequency?.note && (
                          <em className="sense-frequency-note">{frequency.note}</em>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
              </div>
              {hideSenses && sensesExpanded && (
                <button
                  type="button"
                  className="meaning-collapse"
                  onClick={() => setSensesExpanded(false)}
                >
                  收起释义
                </button>
              )}
            </>
          )}

          {/* 义项考频生成（多义词、释义可见、未缓存时） */}
          {currentSenseItems.length >= 2
            && !currentSenseFrequency
            && (!hideSenses || sensesExpanded) && (
            <button
              type="button"
              className="sense-frequency-generate"
              onClick={onGenerateSenseFrequency}
              disabled={frequencyLoading}
            >
              {frequencyLoading
                ? "正在分析各义项考频…"
                : `生成义项考频提示（${currentSenseItems.length} 个义项）`}
            </button>
          )}

          {/* 跨词例句复用：该词出现在已生成/已见的例句里 */}
          {reusedSentences.length > 0 && (!hideSenses || sensesExpanded) && (
            <div className="reused-sentences">
              <span>该词出现在这些已见例句</span>
              <ol>
                {reusedSentences.slice(0, 3).map((item, index) => (
                  <li key={`${item.sourceWord}-${index}`}>
                    <p className="context-sentence">{item.sentence}</p>
                    {!hideChineseMeaning && item.translation && (
                      <p className="context-translation">{item.translation}</p>
                    )}
                    <small>
                      来自{" "}
                      {onFocusSourceWord && item.sourceId !== undefined ? (
                        <button
                          type="button"
                          className="reused-source-link"
                          onClick={() => onFocusSourceWord(item.sourceId, item.sourceWord)}
                          title={`去学习「${item.sourceWord}」`}
                        >
                          {item.sourceWord}
                        </button>
                      ) : (
                        item.sourceWord
                      )}
                      {" "}的例句
                    </small>
                  </li>
                ))}
              </ol>
              {reusedSentences.length > 3 && (
                <small className="reused-more">
                  还有 {reusedSentences.length - 3} 条例句，复习时划词即可查看
                </small>
              )}
            </div>
          )}

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
                        <strong>{index + 1}. {(!hideSenses || sensesExpanded) ? example.meaning : ""}</strong>
                        <p className="context-sentence">{example.sentence}</p>
                        {(!hideSenses || sensesExpanded) && (
                          <p className="context-translation">
                            {example.translation}
                          </p>
                        )}
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
                  {(!hideSenses || sensesExpanded) && (
                    <p className="context-translation">{current.translation}</p>
                  )}
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
                    : reusedSentences.length
                      ? `已有 ${reusedSentences.length} 条例句含该词可复用，仍可生成专属例句`
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
                <span>记忆牢固度</span>
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
