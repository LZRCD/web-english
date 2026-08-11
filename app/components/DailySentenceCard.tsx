"use client";

import { useEffect, useRef, useState } from "react";
import {
  buildDailySentenceCacheEntry,
  normalizeDailySentenceContent,
  type DailySentenceCacheEntry,
  type DailySentenceClause,
  type DailySentenceInput,
} from "../../lib/daily-sentence";
import {
  cancelTextSpeech,
  pauseTextSpeech,
  resumeTextSpeech,
  speakText,
  supportsTextSpeech,
} from "../../lib/word-audio";

type DailySentenceCardProps = {
  input: DailySentenceInput;
  cache?: DailySentenceCacheEntry;
  onChange: (entry: DailySentenceCacheEntry) => void;
};

const CLAUSE_LABELS: Record<DailySentenceClause["type"], string> = {
  main: "主句",
  relative: "定语从句",
  noun: "名词性从句",
  adverbial: "状语从句",
  appositive: "同位语从句",
  coordinate: "并列结构",
  other: "其他结构",
};

export default function DailySentenceCard({
  input,
  cache,
  onChange,
}: DailySentenceCardProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [speechSupported, setSpeechSupported] = useState<boolean | null>(null);
  const [speechState, setSpeechState] = useState<
    "idle" | "speaking" | "paused" | "ended" | "error"
  >("idle");
  const requestRef = useRef<AbortController | undefined>(undefined);
  const requestLockedRef = useRef(false);

  useEffect(() => {
    queueMicrotask(() => setSpeechSupported(supportsTextSpeech()));
  }, []);

  useEffect(() => {
    cancelTextSpeech();
    queueMicrotask(() => setSpeechState("idle"));
  }, [cache?.generatedAt, cache?.content.sentence]);

  useEffect(() => () => {
    requestRef.current?.abort();
    cancelTextSpeech();
  }, []);

  async function generate() {
    if (requestLockedRef.current) return;
    requestLockedRef.current = true;
    const requestInput = input;
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/daily-sentence", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ localDate: requestInput.localDate }),
      });
      const body = await response.json().catch(() => null) as unknown;
      if (!response.ok) {
        const message = body && typeof body === "object" && "error" in body
          && typeof body.error === "string"
          ? body.error
          : `今日长难句暂不可用（${response.status}）`;
        throw new Error(message);
      }
      const content = normalizeDailySentenceContent(body, requestInput);
      if (!content) throw new Error("AI 返回的长难句结构无效，请重试");
      onChange(buildDailySentenceCacheEntry(requestInput, content, new Date()));
      setExpanded(true);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(
        caught instanceof Error
          ? caught.message
          : "今日长难句暂不可用，请稍后重试",
      );
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = undefined;
        requestLockedRef.current = false;
        setLoading(false);
      }
    }
  }

  function startSpeech() {
    if (!cache) return;
    const started = speakText(cache.content.sentence, {
      rate: 0.8,
      onStart: () => setSpeechState("speaking"),
      onEnd: () => setSpeechState("ended"),
      onError: () => setSpeechState("error"),
    });
    if (!started) {
      setSpeechSupported(false);
      setSpeechState("error");
      return;
    }
    setSpeechState("speaking");
  }

  function togglePause() {
    if (speechState === "paused") {
      if (resumeTextSpeech()) setSpeechState("speaking");
      return;
    }
    if (speechState === "speaking" && pauseTextSpeech()) {
      setSpeechState("paused");
    }
  }

  return (
    <section
      className="daily-sentence-card"
      aria-label="今日长难句"
      aria-busy={loading}
    >
      <div className="daily-sentence-heading">
        <div>
          <span className="eyebrow">DAILY SENTENCE</span>
          <h2>今日长难句</h2>
          <strong>AI 原创长难句 · 非历年真题</strong>
        </div>
        {cache ? (
          <button type="button" onClick={generate} disabled={loading}>
            {loading ? "重新生成中…" : "重新生成"}
          </button>
        ) : (
          <button type="button" onClick={generate} disabled={loading}>
            {loading ? "正在生成今日长难句…" : "生成今日长难句"}
          </button>
        )}
      </div>

      {cache ? (
        <>
          <p className="daily-sentence-text" lang="en">{cache.content.sentence}</p>
          <p className="daily-sentence-translation">{cache.content.translation}</p>
          <div className="daily-sentence-meta">
            <span>{cache.localDate} · 今日缓存</span>
            <div className="daily-sentence-audio">
              {speechSupported === false ? (
                <span role="status">当前浏览器不支持长句朗读，文字与解析仍可正常使用。</span>
              ) : (
                <>
                  <button type="button" onClick={startSpeech}>
                    {speechState === "ended" ? "再次朗读" : "朗读"}
                  </button>
                  <button
                    type="button"
                    onClick={togglePause}
                    disabled={speechState !== "speaking" && speechState !== "paused"}
                  >
                    {speechState === "paused" ? "继续" : "暂停"}
                  </button>
                  <button type="button" onClick={startSpeech}>重播</button>
                  <span aria-live="polite">
                    {speechState === "speaking"
                      ? "正在朗读"
                      : speechState === "paused"
                        ? "朗读已暂停"
                        : speechState === "error"
                          ? "朗读不可用"
                          : "朗读就绪"}
                  </span>
                </>
              )}
            </div>
          </div>
          <button
            type="button"
            className="daily-sentence-toggle"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
          >
            {expanded ? "收起句子解析" : "展开句子解析"}
          </button>
          {expanded && (
            <div className="daily-sentence-analysis">
              <div>
                <h3>句子主干</h3>
                <p>{cache.content.backbone}</p>
              </div>
              <div>
                <h3>从句结构</h3>
                <ol>
                  {cache.content.clauses.map((clause, index) => (
                    <li key={`${clause.type}-${clause.text}-${index}`}>
                      <strong>{CLAUSE_LABELS[clause.type]}</strong>
                      <span lang="en">{clause.text}</span>
                      <small>{clause.function}</small>
                    </li>
                  ))}
                </ol>
              </div>
              <div>
                <h3>修饰关系</h3>
                <ul>
                  {cache.content.modifiers.map((modifier, index) => (
                    <li key={`${modifier.text}-${index}`}>
                      <strong lang="en">{modifier.text}</strong>
                      <span>→ {modifier.target}</span>
                      <small>{modifier.relation}</small>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="daily-sentence-empty">
          仅在你点击后生成；同一本地自然日会直接使用合法缓存。
        </p>
      )}

      {error && <p className="daily-sentence-error" role="alert">{error}</p>}
    </section>
  );
}
