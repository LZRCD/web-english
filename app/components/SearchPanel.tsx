"use client";

import type { WordProgressMap } from "../../lib/learning";
import { wordRetrievability } from "../../lib/learning";
import { formatDueTime, splitMeaning } from "../../lib/study";
import { useRef } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import type { Word } from "../../lib/study";

type SearchPanelProps = {
  open: boolean;
  query: string;
  results: Word[];
  selectedIds: number[];
  wordProgress: WordProgressMap;
  clock: number;
  onQueryChange: (value: string) => void;
  onToggleSelect: (wordId: number) => void;
  onStartSearch: () => void;
  onStartWordSession: (wordIds: number[]) => void;
  onClose: () => void;
};

export default function SearchPanel({
  open,
  query,
  results,
  selectedIds,
  wordProgress,
  clock,
  onQueryChange,
  onToggleSelect,
  onStartSearch,
  onStartWordSession,
  onClose,
}: SearchPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  useFocusTrap(panelRef, open);

  if (!open) return null;
  const now = new Date(clock);

  return (
    <div className="search-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={panelRef}
        className="search-panel"
        role="dialog"
        aria-modal="true"
        aria-label="全局查词"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="search-head">
          <div>
            <p className="eyebrow">GLOBAL VOCABULARY SEARCH</p>
            <h2>查单词、释义或编号</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭查词">×</button>
        </div>
        <input
          autoFocus
          value={query}
          onChange={(event) => {
            onQueryChange(event.target.value);
          }}
          placeholder="例如 outline、轮廓、1172"
          aria-label="搜索红宝书词库"
        />
        <div className="search-summary">
          <span>{query ? `找到 ${results.length} 条结果` : "输入关键词开始搜索"}</span>
          {results.length > 0 && (
            <button type="button" onClick={onStartSearch}>
              {selectedIds.length
                ? `学习已选 ${selectedIds.length} 词`
                : `学习当前 ${results.length} 词`}
            </button>
          )}
        </div>
        <div className="search-results">
          {results.map((word) => {
            const progressItem = word.id === undefined ? undefined : wordProgress[word.id];
            const selected = word.id !== undefined && selectedIds.includes(word.id);
            return (
              <article key={word.id}>
                <button
                  type="button"
                  className={selected ? "search-select selected" : "search-select"}
                  onClick={() => {
                    if (word.id === undefined) return;
                    onToggleSelect(word.id);
                  }}
                  aria-pressed={selected}
                  aria-label={selected ? `取消选择 ${word.word}` : `选择 ${word.word}`}
                >
                  {selected ? "✓" : "+"}
                </button>
                <div>
                  <div><strong>{word.word}</strong><span>{splitMeaning(word.meaning).part}</span></div>
                  <p>{splitMeaning(word.meaning).meaning}</p>
                  <small>
                    {word.section} · Unit {word.unit}
                    {progressItem
                      ? ` · 牢固度 ${wordRetrievability(progressItem, now)}% · ${progressItem.status === "mastered" ? "已掌握" : formatDueTime(progressItem.nextDueAt, now)}`
                      : " · 未学习"}
                  </small>
                </div>
                <button type="button" className="search-learn" onClick={() => {
                  onStartWordSession(word.id === undefined ? [] : [word.id]);
                  onClose();
                }}>
                  学习
                </button>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
