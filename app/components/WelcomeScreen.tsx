"use client";

import {
  useEffect,
  useRef,
  useState,
} from "react";

type WelcomeScreenProps = {
  onBegin: () => void;
  onStartVocabTest: () => void;
  vocabTestReady: boolean;
  inactive?: boolean;
};

const GUIDE_STEPS = [
  {
    title: "从今日任务开始",
    description: "完成引导后会直接开始今日任务；没有待学内容时，会进入当前词书的额外练习。",
    shortcut: "今日任务按当天随机顺序出词",
  },
  {
    title: "先回忆，再揭示并评分",
    description: "先看单词主动回忆，按空格揭示释义，再用 1～4 评分；评分会继续使用现有复习规则。",
    shortcut: "空格揭示 · 1～4 评分",
  },
  {
    title: "随时查词，收进词本",
    description: "按 / 打开全局查词；学习时按 F 收藏当前词，再从侧栏“词本”集中复习。",
    shortcut: "/ 查词 · F 收藏",
  },
] as const;

export default function WelcomeScreen({
  onBegin,
  onStartVocabTest,
  vocabTestReady,
  inactive = false,
}: WelcomeScreenProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const step = GUIDE_STEPS[stepIndex];
  const isLastStep = stepIndex === GUIDE_STEPS.length - 1;

  useEffect(() => {
    nextButtonRef.current?.focus();
  }, []);

  function goForward() {
    if (isLastStep) {
      onBegin();
      return;
    }
    setStepIndex((current) => current + 1);
  }

  return (
    <section
      className="welcome"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
      aria-describedby="welcome-description"
      inert={inactive}
    >
      <div className="welcome-card">
        <span className="welcome-mark" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="welcome-name">词环</span>
        <p className="welcome-step">首次使用 · 第 {stepIndex + 1} / {GUIDE_STEPS.length} 步</p>
        <h1 id="welcome-title">{step.title}</h1>
        <p id="welcome-description" className="welcome-description">
          {step.description}
        </p>
        <strong className="welcome-shortcut">{step.shortcut}</strong>

        <div className="welcome-progress" aria-label={`引导进度：第 ${stepIndex + 1} 步，共 ${GUIDE_STEPS.length} 步`}>
          {GUIDE_STEPS.map((item, index) => (
            <span key={item.title} className={index === stepIndex ? "active" : ""} />
          ))}
        </div>

        <div className="welcome-vocab-entry">
          <button
            type="button"
            onClick={onStartVocabTest}
            disabled={!vocabTestReady}
            aria-describedby="welcome-vocab-status"
          >
            先测词汇量
          </button>
          <small id="welcome-vocab-status">
            {vocabTestReady
              ? "约 60 题纯本地自评，不会完成引导或写入学习记录"
              : "本地红宝书正在载入，载入完成后即可测试"}
          </small>
        </div>

        <div className="welcome-actions">
          <button type="button" className="welcome-skip" onClick={onBegin}>
            跳过引导
          </button>
          <div>
            <button
              type="button"
              className="welcome-back"
              onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
              disabled={stepIndex === 0}
            >
              上一步
            </button>
            <button
              ref={nextButtonRef}
              type="button"
              className="welcome-next"
              onClick={goForward}
            >
              {isLastStep ? "开始今日任务" : "下一步"}
            </button>
          </div>
        </div>
        <small className="welcome-hint">Tab 选择操作 · Enter / 空格确认</small>
      </div>
    </section>
  );
}
