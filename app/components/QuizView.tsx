"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  buildQuizQuestions,
  isQuizAnswerCorrect,
  QUIZ_MODE_DEFINITIONS,
  recoverQuizSession,
  restoreQuizQuestions,
  snapshotQuizQuestions,
  type QuizMode,
  type QuizQuestion,
  type QuizSessionState,
} from "../../lib/quiz";
import {
  isWeakProgress,
  type SenseFrequencyMap,
  type StubbornWordMap,
  type WordProgressMap,
} from "../../lib/learning";
import type {
  FamiliarMeaningMap,
  LookupStats,
  LookupWord,
  Word,
} from "../../lib/study";

type QuizViewProps = {
  words: Word[];
  wordProgress: WordProgressMap;
  familiarMeanings: FamiliarMeaningMap;
  /** 划词查询统计：查得多的词优先出题 */
  lookupStats: LookupStats;
  /** 划词记录：把查询词归并回学习项 */
  lookupWords: LookupWord[];
  /** 义项考频：低频义项多的词优先出题 */
  senseFrequency: SenseFrequencyMap;
  /** 顽固词：活跃顽固词优先出题 */
  stubbornWords: StubbornWordMap;
  soundOn: boolean;
  onSpeak: (word: string, wordId?: number) => void;
  onRecordResult: (
    question: QuizQuestion,
    correct: boolean,
    recallMs: number,
    sessionId?: string,
  ) => void;
  savedQuiz?: QuizSessionState;
  onQuizStateChange: (session: QuizSessionState | undefined) => void;
  /** 维度化处置限定词集；未提供时保持普通测验选题。 */
  candidateWordIds?: number[];
  /** 全部题目失效后的说明；模式选择页同时提供重新开始入口。 */
  recoveryNotice?: string;
  onRecoveryNoticeClear?: () => void;
};

type AnswerResult = {
  answer: string;
  correct: boolean;
};

export default function QuizView({
  words,
  wordProgress,
  familiarMeanings,
  lookupStats,
  lookupWords,
  senseFrequency,
  stubbornWords,
  soundOn,
  onSpeak,
  onRecordResult,
  savedQuiz,
  onQuizStateChange,
  candidateWordIds,
  recoveryNotice,
  onRecoveryNoticeClear,
}: QuizViewProps) {
  const learnedCount = Object.keys(wordProgress).length;
  const weakCount = Object.values(wordProgress).filter(isWeakProgress).length;
  const [mode, setMode] = useState<QuizMode>();
  const [seed, setSeed] = useState(0);
  const [sessionId, setSessionId] = useState("");
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [answers, setAnswers] = useState<Record<string, AnswerResult>>({});
  const [correctCount, setCorrectCount] = useState(0);
  const [complete, setComplete] = useState(false);
  const questionStartedAt = useRef(0);
  const quizStartedAtRef = useRef(new Date().toISOString());
  const currentQuestion = questions[questionIndex];
  const answerResult = currentQuestion ? answers[currentQuestion.id] : undefined;
  const progressPercent = questions.length
    ? Math.round(((questionIndex + Number(Boolean(answerResult))) / questions.length) * 100)
    : 0;
  const availableModeIds = useMemo(() => new Set(
    QUIZ_MODE_DEFINITIONS
      .filter((definition) => learnedCount >= definition.minimumLearnedWords)
      .map((definition) => definition.id),
  ), [learnedCount]);

  // 恢复上次未完成的测验：用同一 seed 重建题目与进度（render 期调整派生状态）
  const [previousSavedQuiz, setPreviousSavedQuiz] = useState<QuizSessionState>();
  if (savedQuiz !== previousSavedQuiz) {
    setPreviousSavedQuiz(savedQuiz);
    if (savedQuiz && !mode && !questions.length) {
      const restored = restoreQuizQuestions(
        savedQuiz,
        words,
        wordProgress,
        familiarMeanings,
        {
          lookupStats,
          lookupWords,
          senseFrequency,
          stubbornWords,
          candidateWordIds,
        },
      );
      const recovery = recoverQuizSession(savedQuiz, restored);
      if (restored.length && recovery.session) {
        setMode(recovery.session.mode);
        setSeed(recovery.session.seed);
        setSessionId(recovery.session.id);
        setQuestions(restored);
        setQuestionIndex(Math.min(recovery.session.index, restored.length - 1));
        setCorrectCount(recovery.session.correctCount);
        setAnswers(recovery.session.answers);
        setComplete(recovery.session.complete);
      }
    }
  }

  // 恢复后初始化计时基准（仅 ref 写入，避免 render 期副作用）
  useEffect(() => {
    if (!savedQuiz || !questions.length) return;
    quizStartedAtRef.current = savedQuiz.startedAt ?? new Date().toISOString();
    questionStartedAt.current = new Date().getTime();
  }, [questions.length, savedQuiz]);

  // 测验进行中持续持久化进度（未完成可恢复）
  useEffect(() => {
    if (!mode || !questions.length) return;
    onQuizStateChange({
      id: sessionId || `quiz:${mode}:${seed}`,
      mode,
      seed,
      questionWordIds: questions.map((question) => question.wordId),
      questionSnapshots: snapshotQuizQuestions(questions),
      startedAt: quizStartedAtRef.current,
      index: questionIndex,
      correctCount,
      answers,
      complete,
    });
  }, [answers, complete, correctCount, mode, onQuizStateChange, questionIndex, questions, seed, sessionId]);

  const startQuiz = (nextMode: QuizMode) => {
    onRecoveryNoticeClear?.();
    const nextSeed = new Date().getTime();
    const nextQuestions = buildQuizQuestions({
      words,
      progress: wordProgress,
      familiarMeanings,
      lookupStats,
      lookupWords,
      senseFrequency,
      stubbornWords,
      candidateWordIds,
      mode: nextMode,
      count: 10,
      seed: nextSeed,
    });
    setMode(nextMode);
    setSeed(nextSeed);
    setSessionId(`quiz:${nextMode}:${nextSeed}`);
    setQuestions(nextQuestions);
    setQuestionIndex(0);
    setAnswer("");
    setAnswers({});
    setCorrectCount(0);
    setComplete(false);
    quizStartedAtRef.current = new Date().toISOString();
    questionStartedAt.current = new Date().getTime();
    const first = nextQuestions[0];
    if (first?.mode === "listening-spelling" && soundOn) {
      onSpeak(first.word.word, first.wordId);
    }
  };

  const submitAnswer = (submittedAnswer: string) => {
    if (!currentQuestion || answerResult) return;
    const normalized = submittedAnswer.trim();
    if (!normalized) return;
    const correct = isQuizAnswerCorrect(currentQuestion, normalized);
    const recallMs = Math.max(
      0,
      new Date().getTime() - questionStartedAt.current,
    );
    setAnswers((items) => ({
      ...items,
      [currentQuestion.id]: { answer: normalized, correct },
    }));
    if (correct) setCorrectCount((count) => count + 1);
    onRecordResult(currentQuestion, correct, recallMs, sessionId || undefined);
  };

  const submitTextAnswer = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitAnswer(answer);
  };

  const nextQuestion = () => {
    const nextIndex = questionIndex + 1;
    if (nextIndex >= questions.length) {
      setComplete(true);
      return;
    }
    const next = questions[nextIndex];
    setQuestionIndex(nextIndex);
    setAnswer("");
    questionStartedAt.current = new Date().getTime();
    if (next.mode === "listening-spelling" && soundOn) {
      onSpeak(next.word.word, next.wordId);
    }
  };

  const returnToModes = () => {
    onQuizStateChange(undefined);
    setMode(undefined);
    setSessionId("");
    setQuestions([]);
    setComplete(false);
    setAnswer("");
    setAnswers({});
    setCorrectCount(0);
  };

  if (!mode) {
    return (
      <div className="content-view quiz-view">
        <div className="section-heading">
          <div>
            <p className="eyebrow">ACTIVE RECALL LAB</p>
            <h1>主动写出来，才算真正会</h1>
          </div>
          <div className="quiz-readiness" aria-label="专项测验准备情况">
            <span><strong>{learnedCount}</strong> 已学习</span>
            <span><strong>{weakCount}</strong> 薄弱词</span>
          </div>
        </div>
        {recoveryNotice && (
          <div className="quiz-rule-note" role="status">
            <strong>上次测验已结束</strong>
            <span>{recoveryNotice}</span>
          </div>
        )}
        <div className="quiz-mode-grid">
          {QUIZ_MODE_DEFINITIONS.map((definition, index) => {
            const available = availableModeIds.has(definition.id);
            return (
              <button
                type="button"
                className="quiz-mode-card"
                key={definition.id}
                disabled={!available}
                onClick={() => startQuiz(definition.id)}
              >
                <span className="quiz-mode-number">0{index + 1}</span>
                <strong>{definition.title}</strong>
                <small>{definition.description}</small>
                <i>{available
                  ? recoveryNotice ? "重新开始 10 题 →" : "开始 10 题 →"
                  : `至少学习 ${definition.minimumLearnedWords} 词`}</i>
              </button>
            );
          })}
        </div>
        <div className="quiz-rule-note">
          <strong>测验如何影响复习？</strong>
          <span>每个词每天首次有效作答（或到期后首次作答）才会写入复习排程；重复作答只记录在测验历史，不再无限改写排程。错词始终进入薄弱词队列。</span>
        </div>
      </div>
    );
  }

  if (!questions.length) {
    return (
      <div className="content-view quiz-view">
        <div className="quiz-empty">
          <p className="eyebrow">QUIZ NOT READY</p>
          <h1>还没有足够的已学习词</h1>
          <p>先完成一些学习评分，再回来生成不会提前泄露答案的测验。</p>
          <button type="button" onClick={returnToModes}>返回测验选择</button>
        </div>
      </div>
    );
  }

  if (complete) {
    const accuracy = Math.round((correctCount / questions.length) * 100);
    return (
      <div className="content-view quiz-view">
        <div className="quiz-complete">
          <p className="eyebrow">QUIZ COMPLETE</p>
          <span className="quiz-complete-score">{accuracy}%</span>
          <h1>{accuracy >= 80 ? "主动回忆很扎实" : "薄弱点已经找出来了"}</h1>
          <p>{questions.length} 题中答对 {correctCount} 题，答错的词已进入薄弱词队列。</p>
          <div>
            <button type="button" onClick={() => startQuiz(mode)}>再来一组</button>
            <button type="button" className="quiet" onClick={returnToModes}>更换模式</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="content-view quiz-view">
      <div className="quiz-session-head">
        <button type="button" className="quiz-back" onClick={returnToModes}>← 退出本组</button>
        <div>
          <strong>{currentQuestion.label}</strong>
          <span>{questionIndex + 1} / {questions.length}</span>
        </div>
        <span>答对 {correctCount}</span>
      </div>
      <div className="quiz-progress" aria-label={`测验进度 ${progressPercent}%`}>
        <i style={{ width: `${progressPercent}%` }} />
      </div>
      <section className="quiz-question-card" aria-live="polite">
        <p className="eyebrow">QUESTION {String(questionIndex + 1).padStart(2, "0")}</p>
        {currentQuestion.mode === "listening-spelling" ? (
          <>
            <button
              type="button"
              className="quiz-audio-button"
              aria-label="重新播放本题发音"
              onClick={() => onSpeak(currentQuestion.word.word, currentQuestion.wordId)}
            >
              <span aria-hidden="true">◉</span>
              <strong>播放发音</strong>
              <small>可以重复收听</small>
            </button>
            <h1>{currentQuestion.prompt}</h1>
          </>
        ) : (
          <h1>{currentQuestion.prompt}</h1>
        )}

        {currentQuestion.options ? (
          <div className="quiz-options" role="group" aria-label="选择答案">
            {currentQuestion.options.map((option, index) => {
              const selected = answerResult?.answer === option;
              const correctOption = Boolean(answerResult) && option === currentQuestion.answer;
              const stateClass = correctOption
                ? " correct"
                : selected && !answerResult.correct
                  ? " wrong"
                  : "";
              return (
                <button
                  type="button"
                  key={option}
                  disabled={Boolean(answerResult)}
                  className={`quiz-option${stateClass}`}
                  onClick={() => submitAnswer(option)}
                >
                  <span>{String.fromCharCode(65 + index)}</span>
                  {option}
                </button>
              );
            })}
          </div>
        ) : (
          <form className="quiz-answer-form" onSubmit={submitTextAnswer}>
            <label htmlFor="quiz-answer">你的答案</label>
            <div>
              <input
                id="quiz-answer"
                value={answer}
                disabled={Boolean(answerResult)}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                placeholder="输入完整英文"
                onChange={(event) => setAnswer(event.target.value)}
              />
              {!answerResult && <button type="submit" disabled={!answer.trim()}>提交</button>}
            </div>
          </form>
        )}

        {answerResult && (
          <div className={`quiz-feedback ${answerResult.correct ? "correct" : "wrong"}`} role="status">
            <span>{answerResult.correct ? "回答正确" : "已加入薄弱词"}</span>
            <strong>解析：{currentQuestion.explanation}</strong>
            {!answerResult.correct && (
              <small>你的答案：{answerResult.answer} · 正确答案：{currentQuestion.answer}</small>
            )}
            <button type="button" onClick={nextQuestion} autoFocus>
              {questionIndex + 1 >= questions.length ? "查看结果" : "下一题 →"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
