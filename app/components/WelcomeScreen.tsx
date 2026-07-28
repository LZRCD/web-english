"use client";

type WelcomeScreenProps = {
  onBegin: () => void;
};

export default function WelcomeScreen({ onBegin }: WelcomeScreenProps) {
  return (
    <button className="welcome" onClick={onBegin} aria-label="开始学习">
      <span className="welcome-mark" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="welcome-name">词环</span>
      <span className="welcome-hint">按空格键或点击开始</span>
    </button>
  );
}
