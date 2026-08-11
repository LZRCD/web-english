"use client";

import {
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  analyzeArticleCandidates,
  filterArticleCandidates,
  selectVisibleArticleCandidates,
  type ArticleAnalysisResult,
  type ArticleCandidate,
  type ArticleLearningStatus,
} from "../../lib/article-extraction";
import type { LookupResult } from "../../lib/selection-lookup";
import type { LookupWord, Word } from "../../lib/study";
import type { WordProgressMap } from "../../lib/learning";
import { tokenizeEnglishArticle } from "../../lib/word-utils";

type ArticleWordExtractorProps = {
  redbookWords: readonly Word[];
  lookupWords: LookupWord[];
  wordProgress: WordProgressMap;
  queryDictionary: (query: string) => Promise<LookupResult | null>;
  onConfirm: (
    candidates: readonly ArticleCandidate[],
    selectedTokens: ReadonlySet<string>,
  ) => boolean;
};

type ArticleAnalysisView = ArticleAnalysisResult & {
  totalUniqueCount: number;
  truncatedCount: number;
};

const ARTICLE_TEXT_LIMIT = 20_000;

const STATUS_LABELS: Record<ArticleLearningStatus, string> = {
  unlearned: "未学习",
  learning: "学习中",
  reviewing: "复习中",
  mastered: "项目内已掌握",
};

const SOURCE_LABELS = {
  redbook: "红宝书",
  lookup: "已有划词",
  dictionary: "ECDICT 本地辞典",
} as const;

export default function ArticleWordExtractor({
  redbookWords,
  lookupWords,
  wordProgress,
  queryDictionary,
  onConfirm,
}: ArticleWordExtractorProps) {
  const [open, setOpen] = useState(false);
  const [articleText, setArticleText] = useState("");
  const [analysis, setAnalysis] = useState<ArticleAnalysisView>();
  const [analysisStatus, setAnalysisStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [statusFilter, setStatusFilter] = useState<
    "all" | ArticleLearningStatus
  >("all");
  const [showMastered, setShowMastered] = useState(false);
  const [selectedTokens, setSelectedTokens] = useState<Set<string>>(new Set());
  const [inlineMessage, setInlineMessage] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const analysisRunRef = useRef(0);

  const visibleCandidates = useMemo(
    () => filterArticleCandidates(analysis?.candidates ?? [], {
      status: statusFilter,
      showMastered,
    }),
    [analysis, showMastered, statusFilter],
  );

  function closeExtractor() {
    analysisRunRef.current += 1;
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function handleTextChange(event: ChangeEvent<HTMLTextAreaElement>) {
    analysisRunRef.current += 1;
    setArticleText(event.target.value);
    setAnalysis(undefined);
    setAnalysisStatus("idle");
    setSelectedTokens(new Set());
    setInlineMessage("");
  }

  async function analyzeArticle() {
    const tokenization = tokenizeEnglishArticle(articleText);
    if (!tokenization.tokens.length) {
      setInlineMessage("请先粘贴包含英文单词的文章");
      return;
    }

    const runId = analysisRunRef.current + 1;
    analysisRunRef.current = runId;
    setAnalysisStatus("loading");
    setInlineMessage("");
    try {
      const result = await analyzeArticleCandidates({
        tokens: tokenization.tokens,
        redbookWords,
        lookupWords,
        wordProgress,
        queryDictionary,
      });
      if (analysisRunRef.current !== runId) return;
      setAnalysis({
        ...result,
        totalUniqueCount: tokenization.totalUniqueCount,
        truncatedCount: tokenization.truncatedCount,
      });
      setSelectedTokens(new Set(
        result.candidates
          .filter((candidate) => candidate.status !== "mastered")
          .map((candidate) => candidate.token),
      ));
      setStatusFilter("all");
      setShowMastered(false);
      setAnalysisStatus("ready");
    } catch {
      if (analysisRunRef.current !== runId) return;
      setAnalysisStatus("error");
      setInlineMessage("文章分析暂时失败，请重新分析");
    }
  }

  function toggleCandidate(token: string, checked: boolean) {
    setSelectedTokens((current) => {
      const next = new Set(current);
      if (checked) next.add(token);
      else next.delete(token);
      return next;
    });
    setInlineMessage("");
  }

  function confirmSelection() {
    if (!analysis || selectedTokens.size === 0) {
      setInlineMessage("请至少选择一个候选词");
      return;
    }
    if (!onConfirm(analysis.candidates, selectedTokens)) {
      setInlineMessage("请至少选择一个候选词");
    }
  }

  return (
    <section className="article-extractor-shell">
      <button
        ref={triggerRef}
        type="button"
        className="article-extractor-trigger"
        aria-expanded={open}
        aria-controls="article-word-extractor"
        onClick={() => setOpen((current) => !current)}
      >
        文章提词
      </button>
      {!open && (
        <small>粘贴英文文章，确认候选后再开始学习</small>
      )}

      {open && (
        <div
          id="article-word-extractor"
          className="article-extractor"
          role="region"
          aria-label="文章提词"
        >
          <div className="article-extractor-header">
            <div>
              <p className="eyebrow">ARTICLE WORD EXTRACTOR</p>
              <h2>从文章里挑出下一组生词</h2>
              <p>分析只读取本地词典；确认前不会写入学习状态。</p>
            </div>
            <button
              type="button"
              className="quiet"
              aria-label="关闭文章提词"
              onClick={closeExtractor}
            >
              关闭
            </button>
          </div>

          <label className="article-input-label" htmlFor="article-text-input">
            英文文章
          </label>
          <textarea
            id="article-text-input"
            value={articleText}
            maxLength={ARTICLE_TEXT_LIMIT}
            rows={8}
            placeholder="在这里粘贴英文文章……"
            onChange={handleTextChange}
          />
          <div className="article-input-meta">
            <small>最多输入 20,000 个字符</small>
            <small>{articleText.length.toLocaleString("zh-CN")} / 20,000</small>
          </div>
          <button
            type="button"
            className="article-analyze-button"
            disabled={!articleText.trim() || analysisStatus === "loading"}
            onClick={analyzeArticle}
          >
            {analysisStatus === "loading" ? "正在分析…" : "分析文章"}
          </button>

          {!articleText.trim() && analysisStatus === "idle" && (
            <p className="article-inline-note">请粘贴英文文章后再分析</p>
          )}
          {analysisStatus === "loading" && (
            <p className="article-analysis-status" role="status">
              正在分析前 200 个不同英文 token，并查询本地 ECDICT……
            </p>
          )}
          {analysisStatus === "ready" && analysis && (
            <p className="article-analysis-status" role="status">
              分析完成：找到 {analysis.candidates.length} 个候选词。
              {analysis.failedCount > 0 ? " 部分词典查询失败，可重新分析。" : ""}
            </p>
          )}
          {analysisStatus === "error" && (
            <p className="article-error" role="alert">{inlineMessage}</p>
          )}

          {analysis && (
            <>
              <div className="article-counts" aria-live="polite">
                <span>匹配候选 {analysis.candidates.length}</span>
                <span>未学习 {analysis.statusCounts.unlearned}</span>
                <span>学习中 {analysis.statusCounts.learning}</span>
                <span>复习中 {analysis.statusCounts.reviewing}</span>
                <span>项目内已掌握 {analysis.statusCounts.mastered}</span>
                <span>ECDICT 未命中 {analysis.unmatchedCount}</span>
                <span>查询失败 {analysis.failedCount}</span>
                <span>未分析 {analysis.truncatedCount}</span>
              </div>
              {analysis.truncatedCount > 0 && (
                <p className="article-inline-note">
                  共识别 {analysis.totalUniqueCount} 个不同 token；初版只分析前 200 个，
                  还有 {analysis.truncatedCount} 个未分析。
                </p>
              )}

              {analysis.candidates.length > 0 ? (
                <>
                  <div className="article-filters">
                    <label>
                      按学习状态筛选
                      <select
                        aria-label="按学习状态筛选"
                        value={statusFilter}
                        onChange={(event) => setStatusFilter(
                          event.target.value as "all" | ArticleLearningStatus,
                        )}
                      >
                        <option value="all">全部状态</option>
                        <option value="unlearned">未学习</option>
                        <option value="learning">学习中</option>
                        <option value="reviewing">复习中</option>
                        <option value="mastered">项目内已掌握</option>
                      </select>
                    </label>
                    <label className="article-mastered-toggle">
                      <input
                        type="checkbox"
                        checked={showMastered}
                        onChange={(event) => setShowMastered(event.target.checked)}
                      />
                      显示项目内已掌握
                    </label>
                    <button
                      type="button"
                      onClick={() => setSelectedTokens((current) =>
                        selectVisibleArticleCandidates(current, visibleCandidates))}
                    >
                      选择当前可见
                    </button>
                    <button
                      type="button"
                      className="quiet"
                      onClick={() => setSelectedTokens(new Set())}
                    >
                      清空选择
                    </button>
                  </div>

                  {visibleCandidates.length > 0 ? (
                    <ul className="article-candidate-list" aria-label="文章候选词">
                      {visibleCandidates.map((candidate) => (
                        <li key={candidate.token} data-token={candidate.token}>
                          <label>
                            <input
                              type="checkbox"
                              aria-label={`选择 ${candidate.token}`}
                              checked={selectedTokens.has(candidate.token)}
                              onChange={(event) => toggleCandidate(
                                candidate.token,
                                event.target.checked,
                              )}
                            />
                            <span className="article-candidate-word">
                              <strong>{candidate.word}</strong>
                              <small>{candidate.token}</small>
                            </span>
                            <span>{SOURCE_LABELS[candidate.source]}</span>
                            <span>{STATUS_LABELS[candidate.status]}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="article-inline-note">当前筛选下没有候选词</p>
                  )}
                </>
              ) : (
                <p className="article-empty-result">没有找到可学习的候选词</p>
              )}

              <div className="article-confirm-row">
                <button
                  type="button"
                  disabled={analysis.candidates.length === 0}
                  onClick={confirmSelection}
                >
                  开始文章学习（{selectedTokens.size} 词）
                </button>
                <small>只会保存你选中的新 ECDICT 词；文章原文不会保存。</small>
              </div>
            </>
          )}
          {inlineMessage && analysisStatus !== "error" && (
            <p className="article-error" role="alert">{inlineMessage}</p>
          )}
        </div>
      )}
    </section>
  );
}
