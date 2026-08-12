"use client";

import { useRef } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import DailySentenceCard from "./DailySentenceCard";
import type {
  DailySentenceCacheEntry,
  DailySentenceInput,
} from "../../lib/daily-sentence";

type DailySentenceOverlayProps = {
  open: boolean;
  input: DailySentenceInput;
  cache?: DailySentenceCacheEntry;
  onChange: (entry: DailySentenceCacheEntry) => void;
  onClose: () => void;
};

/**
 * 顶部导航「今日长难句」入口的弹层：复用 DailySentenceCard 的全部
 * 生成/缓存/朗读/解析逻辑，仅提供遮罩、关闭按钮与焦点陷阱。
 */
export default function DailySentenceOverlay({
  open,
  input,
  cache,
  onChange,
  onClose,
}: DailySentenceOverlayProps) {
  const panelRef = useRef<HTMLElement>(null);
  useFocusTrap(panelRef, open, onClose);

  if (!open) return null;

  return (
    <div
      className="daily-sentence-backdrop"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        ref={panelRef}
        className="daily-sentence-panel"
        role="dialog"
        aria-modal="true"
        aria-label="今日长难句"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="daily-sentence-panel-head">
          <p className="eyebrow">DAILY SENTENCE</p>
          <button
            type="button"
            className="daily-sentence-panel-close"
            onClick={onClose}
            aria-label="关闭今日长难句"
          >
            ×
          </button>
        </div>
        <DailySentenceCard input={input} cache={cache} onChange={onChange} />
      </section>
    </div>
  );
}
