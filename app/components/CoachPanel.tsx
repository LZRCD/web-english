"use client";

import type { FormEvent } from "react";

type CoachPanelProps = {
  open: boolean;
  word: string;
  meaning: string;
  aiMode: "unknown" | "cloud" | "local";
  aiAnswer: string;
  aiLoading: boolean;
  aiInput: string;
  onInputChange: (value: string) => void;
  onAsk: (prompt: string) => void;
  onSubmit: (event: FormEvent) => void;
  onClose: () => void;
};

const QUICK_PROMPTS = ["给我一个记忆联想", "换个真实语境", "解释近义词区别", "出一道小测验"];

export default function CoachPanel({
  open,
  word,
  meaning,
  aiMode,
  aiAnswer,
  aiLoading,
  aiInput,
  onInputChange,
  onAsk,
  onSubmit,
  onClose,
}: CoachPanelProps) {
  return (
    <aside className={open ? "coach-panel open" : "coach-panel"} aria-label="AI 记忆教练">
      <div className="coach-head">
        <div><span className="coach-badge">AI</span><div><strong>记忆教练</strong><small>围绕 {word}</small></div></div>
        <button onClick={onClose} aria-label="关闭 AI 教练">×</button>
      </div>
      <div className="coach-context">
        <span>正在学习</span>
        <strong>{word}</strong>
        <small>{meaning}</small>
      </div>
      <div className="coach-answer">
        <span>词环 AI{aiMode === "cloud" ? " · 云端" : aiMode === "local" ? " · 本地" : ""}</span>
        <p>{aiLoading ? "正在组织一个更容易记住的解释…" : aiAnswer}</p>
      </div>
      <div className="coach-prompts">
        {QUICK_PROMPTS.map((prompt) => (
          <button key={prompt} onClick={() => onAsk(prompt)}>{prompt}</button>
        ))}
      </div>
      <form onSubmit={onSubmit}>
        <input value={aiInput} maxLength={500} onChange={(event) => onInputChange(event.target.value)} placeholder="问问这个词该怎么记…" aria-label="向 AI 教练提问" />
        <button type="submit" aria-label="发送问题">↗</button>
      </form>
      <p className="coach-note">
        {aiMode === "cloud" ? "本次由 DeepSeek 云端回答" : aiMode === "local" ? "云端不可用，本次使用本地提示" : "AI 会结合当前单词和语境回答"}
      </p>
    </aside>
  );
}
