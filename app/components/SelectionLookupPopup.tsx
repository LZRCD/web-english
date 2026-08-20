"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import {
  splitWordSensesByPart,
  type SelectionLookupState,
  type WordSenseGroup,
} from "../../lib/selection-lookup";
import type { SenseFrequencyEntry } from "../../lib/learning";

type SelectionLookupPopupProps = {
  lookup: SelectionLookupState;
  senseFrequency?: SenseFrequencyEntry[];
  onTranslate: (options?: { forceAi?: boolean }) => void;
  onSpeak: () => void;
  onClose: () => void;
};

/** 与选中词保持的视觉间距 / 视口安全边距（px） */
const GAP = 12;
const EDGE = 12;

/**
 * 词性收纳阈值：词性分组 > 1 且总释义条数超过阈值才启用折叠；
 * 短内容（如 vt. 陈述/说明）直接全部展开，不为 Accordion 而 Accordion。
 */
const ACCORDION_SENSE_THRESHOLD = 6;

/** 折叠摘要完整展示的释义上限：4 条以内用「 · 」连接，超出改用「A、B等 N 项」。 */
const PREVIEW_FULL_LIMIT = 4;

function shouldEnableAccordion(groups: WordSenseGroup[]): boolean {
  if (groups.length <= 1) return false;
  const totalSenses = groups.reduce(
    (sum, group) => sum + group.senses.length,
    0,
  );
  return totalSenses > ACCORDION_SENSE_THRESHOLD;
}

function buildSensePreview(senses: string[]): string {
  if (senses.length > PREVIEW_FULL_LIMIT) {
    return `${senses[0]}、${senses[1]}等 ${senses.length} 项`;
  }
  return senses.join(" · ");
}

/**
 * 初始展开的词性（仅启用收纳时使用）：
 * 1. 可信语境词性（contextPart，如 AI 按 context 推断）命中分组时展开该组；
 * 2. 否则展开包含「高频常考」释义的词性（多个时取首个）；
 * 3. 否则展开词典第一主要词性。
 * 没有可靠语境词性时绝不伪造「当前词性」。
 */
function buildInitialExpanded(
  groups: WordSenseGroup[],
  contextPart: string | undefined,
  senseFrequency: SenseFrequencyEntry[] | undefined,
): Record<string, boolean> {
  const expanded: Record<string, boolean> = {};
  if (groups.length === 0) return expanded;
  let preferred = groups[0].part;
  if (contextPart) {
    const contextual = groups.find(
      (group) =>
        group.part.trim().toLowerCase() === contextPart.trim().toLowerCase(),
    );
    if (contextual) preferred = contextual.part;
  } else {
    const highGroup = groups.find((group) =>
      group.senses.some((sense) =>
        senseFrequency?.some(
          (entry) => entry.meaning === sense && entry.level === "high",
        ),
      ),
    );
    if (highGroup) preferred = highGroup.part;
  }
  expanded[preferred] = true;
  return expanded;
}

type SelectionLookupBodyProps = {
  lookup: SelectionLookupState;
  senseGroups: WordSenseGroup[];
  accordionEnabled: boolean;
  senseFrequency?: SenseFrequencyEntry[];
  onTranslate: (options?: { forceAi?: boolean }) => void;
};

/**
 * 弹窗可滚动正文。以 contentKey 作为 React key 由外层重挂载：
 * 切换查询词后天然重置默认展开词性与 scrollTop，不继承上一个单词的状态。
 */
function SelectionLookupBody({
  lookup,
  senseGroups,
  accordionEnabled,
  senseFrequency,
  onTranslate,
}: SelectionLookupBodyProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [expandedParts, setExpandedParts] = useState<
    Record<string, boolean>
  >(() => buildInitialExpanded(
    senseGroups,
    lookup.result?.contextPart,
    senseFrequency,
  ));
  const userToggledRef = useRef(false);

  useEffect(() => {
    if (userToggledRef.current) return;
    setExpandedParts(buildInitialExpanded(
      senseGroups,
      lookup.result?.contextPart,
      senseFrequency,
    ));
  }, [lookup.result?.contextPart, senseFrequency, senseGroups]);

  const togglePart = useCallback((part: string) => {
    userToggledRef.current = true;
    setExpandedParts((previous) => ({
      ...previous,
      [part]: !previous[part],
    }));
  }, []);

  return (
    <div className="selection-lookup-body" ref={bodyRef}>
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
            {senseGroups.length ? (
              <div className="selection-lookup-senses">
                {senseGroups.map((group, groupIndex) => {
                  const partKey = group.part || `part-${groupIndex}`;
                  const expanded = accordionEnabled
                    ? Boolean(expandedParts[partKey])
                    : true;
                  return (
                    <div
                      className="selection-lookup-sense-group"
                      key={partKey}
                    >
                      {accordionEnabled ? (
                        <button
                          type="button"
                          className="selection-lookup-sense-part-row"
                          aria-expanded={expanded}
                          onClick={() => togglePart(partKey)}
                        >
                          <span
                            className="selection-lookup-sense-arrow"
                            aria-hidden="true"
                          >
                            ›
                          </span>
                          {group.part && (
                            <span className="selection-lookup-sense-part">
                              {group.part}
                            </span>
                          )}
                          {!expanded && (
                            <span className="selection-lookup-sense-preview">
                              {buildSensePreview(group.senses)}
                            </span>
                          )}
                        </button>
                      ) : (
                        group.part && (
                          <span className="selection-lookup-sense-part">
                            {group.part}
                          </span>
                        )
                      )}
                      {expanded && (
                        <div className="selection-lookup-sense-items">
                          {group.senses.map((meaning) => {
                            const isHigh = senseFrequency?.some(
                              (entry) =>
                                entry.meaning === meaning
                                && entry.level === "high",
                            );
                            return (
                              <p
                                className={isHigh
                                  ? "selection-lookup-sense sense-frequency-highlight"
                                  : "selection-lookup-sense"}
                                key={meaning}
                              >
                                {meaning}
                                {isHigh && (
                                  <small className="sense-frequency high">
                                    ★ 高频常考
                                  </small>
                                )}
                              </p>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p>{lookup.result.meaning}</p>
            )}
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
    </div>
  );
}

export default function SelectionLookupPopup({
  lookup,
  senseFrequency,
  onTranslate,
  onSpeak,
  onClose,
}: SelectionLookupPopupProps) {
  const dialogRef = useRef<HTMLElement>(null);
  useFocusTrap(dialogRef, true, onClose);

  // 红宝书词目携带按词性分组的结构化释义；旧缓存与 ECDICT/AI 结果回退为整体一段。
  const senseGroups = useMemo(
    () =>
      lookup.result
        ? (lookup.result.sensesByPart
            ?? splitWordSensesByPart({
              meaning: lookup.result.meaning,
              part: lookup.result.part,
            }))
        : [],
    [lookup.result],
  );

  const accordionEnabled = useMemo(
    () => shouldEnableAccordion(senseGroups),
    [senseGroups],
  );

  // 内容指纹：查询词 / 词条身份 / 词性分组结构；变化时整体重挂载正文，
  // 重置默认展开词性与滚动位置（不继承上一个单词的展开/滚动状态）。
  const contentKey = useMemo(
    () =>
      [
        lookup.query,
        lookup.result?.linkedWordId ?? "",
        lookup.result?.source ?? "",
        senseGroups
          .map((group) => `${group.part}:${group.senses.join("|")}`)
          .join("~"),
      ].join("\u0001"),
    [
      lookup.query,
      lookup.result?.linkedWordId,
      lookup.result?.source,
      senseGroups,
    ],
  );

  // 基于选中词锚点 + 实际渲染尺寸重新定位：下方优先 → 翻转上方 → 视口内收拢。
  // 复用既有 translateX(-50%) 坐标体系（left 为弹窗中心 x），与初始定位逻辑一致。
  const reposition = useCallback(() => {
    const element = dialogRef.current;
    if (!element || !lookup.anchor) return;
    const rect = element.getBoundingClientRect();
    const { centerX, top: anchorTop, bottom: anchorBottom } = lookup.anchor;
    const left = Math.min(
      window.innerWidth - rect.width / 2 - EDGE,
      Math.max(EDGE + rect.width / 2, centerX),
    );
    element.style.left = `${left}px`;
    let top = anchorBottom + GAP;
    if (top + rect.height > window.innerHeight - EDGE) {
      top = anchorTop - rect.height - GAP;
    }
    top = Math.min(
      window.innerHeight - rect.height - EDGE,
      Math.max(EDGE, top),
    );
    element.style.top = `${top}px`;
  }, [lookup.anchor]);

  // 展开/收起、状态流转、结果（如异步音标补全）变化时，在绘制前重新定位；
  // 尺寸变化（含收纳展开/收起、滚动条出现）另由 ResizeObserver 在绘制前兜底处理。
  useLayoutEffect(() => {
    reposition();
  }, [reposition, lookup.status, lookup.result]);

  // 尺寸被任何因素改变（字体加载、滚动条出现等）以及窗口缩放（100%/125%/150%）时保持贴词
  useEffect(() => {
    reposition();
    const element = dialogRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => reposition());
    observer.observe(element);
    window.addEventListener("resize", reposition);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", reposition);
    };
  }, [reposition]);

  return (
    <section
      ref={dialogRef}
      className="selection-lookup"
      style={{ left: lookup.x, top: lookup.y }}
      role="dialog"
      aria-modal="true"
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
        <button
          className="selection-lookup-speak"
          type="button"
          onClick={onSpeak}
          disabled={lookup.status === "loading"}
          aria-label={`播放 ${lookup.result?.query ?? lookup.query} 的发音`}
          title="点击播放读音"
        >
          ◖))
        </button>
      </div>
      <SelectionLookupBody
        key={contentKey}
        lookup={lookup}
        senseGroups={senseGroups}
        accordionEnabled={accordionEnabled}
        senseFrequency={senseFrequency}
        onTranslate={onTranslate}
      />
    </section>
  );
}
