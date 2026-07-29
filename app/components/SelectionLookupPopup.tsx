"use client";

import type { SelectionLookupState } from "../../lib/selection-lookup";

type SelectionLookupPopupProps = {
  lookup: SelectionLookupState;
  onTranslate: (options?: { forceAi?: boolean }) => void;
  onClose: () => void;
};

export default function SelectionLookupPopup({
  lookup,
  onTranslate,
  onClose,
}: SelectionLookupPopupProps) {
  return (
    <section
      className="selection-lookup"
      style={{ left: lookup.x, top: lookup.y }}
      role="dialog"
      aria-label={`划词查询：${lookup.query}`}
      aria-live="polite"
    >
      <div className="selection-lookup-head">
        <span>
          划词查义
          {lookup.result?.source === "redbook"
            ? " · 红宝书"
            : lookup.result?.source === "dictionary"
              ? " · ECDICT · 本地"
            : lookup.cached
              ? " · DS FLASH · 已缓存"
              : lookup.status === "idle"
                ? " · 待查询"
                : " · DS FLASH"}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭划词查询"
        >
          ×
        </button>
      </div>
      <div className="selection-lookup-query">
        <strong>{lookup.result?.query ?? lookup.query}</strong>
        {lookup.result?.phonetic && <small>{lookup.result.phonetic}</small>}
      </div>
      {lookup.status === "idle" && (
        <button
          className="selection-lookup-action"
          type="button"
          onClick={() => onTranslate()}
        >
          <span>翻译</span>
          <small>查询后自动加入划词集</small>
        </button>
      )}
      {lookup.status === "loading" && (
        <p className="selection-lookup-state">
          <i aria-hidden="true" />
          正在结合上下文判断词义…
        </p>
      )}
      {lookup.status === "error" && (
        <div className="selection-lookup-error">
          <p>{lookup.error}</p>
          <button type="button" onClick={() => onTranslate()}>重试</button>
        </div>
      )}
      {lookup.status === "ready" && lookup.result && (
        <>
          <div className="selection-lookup-meaning">
            <span>{lookup.result.part}</span>
            <p>{lookup.result.meaning}</p>
          </div>
          {lookup.result.note && (
            <small className="selection-lookup-note">{lookup.result.note}</small>
          )}
          <small className="selection-lookup-saved">已加入划词集</small>
          {lookup.result.source === "dictionary" && (
            <button
              className="selection-lookup-context"
              type="button"
              onClick={() => onTranslate({ forceAi: true })}
            >
              让 DS 结合当前语境辨义
            </button>
          )}
        </>
      )}
    </section>
  );
}
