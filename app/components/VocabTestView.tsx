"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Word } from "../../lib/study";
import {
  answerVocabTestQuestion,
  collectUnknownVocabTestWordIds,
  createVocabTestSession,
  currentVocabTestQuestion,
  estimateVocabTest,
  VOCAB_TEST_SECTIONS,
  VOCAB_TEST_TARGETS,
} from "../../lib/vocab-test";

type VocabTestViewProps = {
  words: readonly Word[];
  source: "welcome" | "wordbook";
  onExit: () => void;
  onStartLearning: (wordIds: number[]) => void;
};

function createSeed() {
  const random = new Uint32Array(1);
  globalThis.crypto?.getRandomValues?.(random);
  return (random[0] || Date.now()) >>> 0;
}

export default function VocabTestView({
  words,
  source,
  onExit,
  onStartLearning,
}: VocabTestViewProps) {
  const [session, setSession] = useState(() =>
    createVocabTestSession(words, createSeed()));
  const knownButtonRef = useRef<HTMLButtonElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const question = currentVocabTestQuestion(session);
  const estimate = useMemo(() => estimateVocabTest(session), [session]);
  const unknownWordIds = useMemo(
    () => collectUnknownVocabTestWordIds(session.answers),
    [session.answers],
  );
  const returnLabel = source === "welcome" ? "返回欢迎页" : "返回词本";

  useEffect(() => {
    if (session.complete) resultHeadingRef.current?.focus();
    else knownButtonRef.current?.focus();
  }, [question?.id, session.complete]);

  function answer(known: boolean) {
    setSession((current) => answerVocabTestQuestion(current, known));
  }

  function restart() {
    setSession(createVocabTestSession(words, createSeed()));
  }

  return (
    <section
      className="vocab-test-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vocab-test-title"
      aria-describedby="vocab-test-description"
    >
      <div className="vocab-test-card">
        <header className="vocab-test-header">
          <div>
            <p className="eyebrow">LOCAL · REDBOOK SELF-ASSESSMENT</p>
            <h1 id="vocab-test-title">词汇量测试</h1>
          </div>
          <button type="button" className="vocab-test-exit" onClick={onExit}>
            退出测试
          </button>
        </header>
        <p id="vocab-test-description" className="vocab-test-description">
          按红宝书词序分层抽样。只凭第一反应判断，不展示释义或例句。
        </p>

        {!session.complete && question && (
          <div className="vocab-test-question-panel">
            <div className="vocab-test-progress">
              <span>
                第 {session.answers.length + 1} 题 / 预计 {session.expectedQuestionCount} 题
              </span>
              <strong>{question.section}</strong>
            </div>
            <div
              className="vocab-test-question"
              role="group"
              aria-label={`判断单词 ${question.word}`}
            >
              <p className="vocab-test-word">{question.word}</p>
              <div className="vocab-test-answer-actions">
                <button
                  ref={knownButtonRef}
                  type="button"
                  className="known"
                  onClick={() => answer(true)}
                >
                  认识
                  <small>我能说出它的常见意思</small>
                </button>
                <button
                  type="button"
                  className="unknown"
                  onClick={() => answer(false)}
                >
                  不认识
                  <small>我无法确认它的意思</small>
                </button>
              </div>
            </div>
            <small className="vocab-test-keyboard-hint">
              可使用 Tab 切换，Enter 或空格确认
            </small>
          </div>
        )}

        {session.complete && (
          <div className="vocab-test-result">
            <div className="vocab-test-result-heading">
              <p className="eyebrow">ESTIMATED VOCABULARY</p>
              <h2 ref={resultHeadingRef} tabIndex={-1}>本轮估算完成</h2>
              <strong>{estimate.total.toLocaleString("zh-CN")} <small>/ 6550</small></strong>
            </div>
            <div className="vocab-test-result-grid">
              {VOCAB_TEST_SECTIONS.map((section) => (
                <div key={section}>
                  <span>{section.replace("词", "")}估算</span>
                  <strong>
                    {estimate.bySection[section].toLocaleString("zh-CN")}
                    <small> / {VOCAB_TEST_TARGETS[section]}</small>
                  </strong>
                </div>
              ))}
              <div>
                <span>本轮实际题数</span>
                <strong>{estimate.actualQuestionCount}</strong>
              </div>
              <div>
                <span>不认识题数</span>
                <strong>{estimate.unknownCount}</strong>
              </div>
            </div>
            <p className="vocab-test-disclaimer">
              这是基于红宝书分层抽样的自评估算，不等于已完成学习、FSRS 掌握或考研达标。
            </p>
            {unknownWordIds.length === 0 ? (
              <p className="vocab-test-clear">本轮没有标记“不认识”的词，无需创建补漏学习。</p>
            ) : (
              <button
                type="button"
                className="vocab-test-learn"
                onClick={() => onStartLearning(unknownWordIds)}
              >
                一键补漏学习（{unknownWordIds.length} 词）
              </button>
            )}
            <div className="vocab-test-result-actions">
              <button type="button" onClick={restart}>重新测试</button>
              <button type="button" onClick={onExit}>{returnLabel}</button>
            </div>
          </div>
        )}

        {session.complete && session.answers.length === 0 && (
          <p className="vocab-test-empty">本地红宝书暂无可抽样学习项，请返回后重试。</p>
        )}
      </div>
    </section>
  );
}
