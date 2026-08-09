import {
  Dispatch,
  FormEvent,
  SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { SenseExample, SenseFrequencyEntry, SenseFrequencyMap, WordEnrichment } from "../../lib/learning";
import type { Word } from "../../lib/study";
import { buildLocalCoach } from "../../lib/word-utils";

type UseAiCoachOptions = {
  current: Word;
  enrichments: Record<number, WordEnrichment>;
  setEnrichments: Dispatch<SetStateAction<Record<number, WordEnrichment>>>;
  setSenseFrequency: Dispatch<SetStateAction<SenseFrequencyMap>>;
  unfamiliarMeanings: string[];
  currentFamiliarMeanings: Set<string>;
  /** 已见例句原文（本词既有释义例句 + 跨词复用例句），生成时禁止与其重复 */
  existingSentences: string[];
  onNotify: (message: string, duration?: number) => void;
};

const DEFAULT_ANSWER = "我会用语境、联想和小测验帮你真正记住这个词。";

/** AI 记忆教练状态 + API 调用 */
export function useAiCoach({
  current,
  enrichments,
  setEnrichments,
  setSenseFrequency,
  unfamiliarMeanings,
  currentFamiliarMeanings,
  existingSentences,
  onNotify,
}: UseAiCoachOptions) {
  const [aiOpen, setAiOpen] = useState(false);
  const [aiInput, setAiInput] = useState("");
  const [aiAnswer, setAiAnswer] = useState(DEFAULT_ANSWER);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiMode, setAiMode] = useState<"unknown" | "cloud" | "local">(
    "unknown",
  );
  const [enrichmentLoading, setEnrichmentLoading] = useState(false);
  const [reviewingSense, setReviewingSense] = useState<number | null>(null);
  const [rewritingSense, setRewritingSense] = useState<number | null>(null);
  const [frequencyLoading, setFrequencyLoading] = useState(false);

  // 保持 current 引用最新，避免闭包陷阱
  const currentRef = useRef(current);
  const enrichmentsRef = useRef(enrichments);
  useEffect(() => {
    currentRef.current = current;
    enrichmentsRef.current = enrichments;
  });

  const updateSenseExample = useCallback((
    wordId: number,
    index: number,
    update: (example: SenseExample) => SenseExample,
  ) => {
    setEnrichments((items) => {
      const enrichment = items[wordId];
      if (!enrichment?.senseExamples?.[index]) return items;
      const senseExamples = enrichment.senseExamples.map((example, itemIndex) =>
        itemIndex === index ? update(example) : example);
      return {
        ...items,
        [wordId]: {
          ...enrichment,
          senseExamples,
          sentence: senseExamples[0]?.sentence ?? enrichment.sentence,
          translation: senseExamples[0]?.translation ?? enrichment.translation,
        },
      };
    });
  }, [setEnrichments]);

  const requestExampleReview = useCallback(async ({
    word,
    wordId,
    index,
    example,
    reason,
  }: {
    word: string;
    wordId: number;
    index: number;
    example: SenseExample;
    reason: "meaning-mismatch" | "low-confidence";
  }) => {
    setReviewingSense(index);
    updateSenseExample(wordId, index, (item) => ({
      ...item,
      feedback: reason === "meaning-mismatch"
        ? item.feedback ?? {
            reason: "meaning-mismatch",
            reportedAt: new Date().toISOString(),
          }
        : item.feedback,
      review: { status: "pending" },
    }));
    try {
      const response = await fetch("/api/enrich/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 附带同词其他义项的例句，供质检员判断是否雷同
        body: JSON.stringify({
          word,
          ...example,
          reason,
          contextSentences: enrichmentsRef.current[wordId]?.senseExamples
            ?.filter((_, itemIndex) => itemIndex !== index)
            .map((item) => item.sentence)
            .slice(0, 6) ?? [],
        }),
        signal: AbortSignal.timeout(20_000),
      });
      const result = await response.json() as {
        matches?: boolean;
        confidence?: number;
        note?: string;
        error?: string;
      };
      if (!response.ok || typeof result.matches !== "boolean") {
        throw new Error(result.error ?? "语义二审失败");
      }
      updateSenseExample(wordId, index, (item) => ({
        ...item,
        review: {
          status: result.matches ? "passed" : "failed",
          confidence: result.confidence,
          note: result.note,
          reviewedAt: new Date().toISOString(),
        },
      }));
      onNotify(
        result.matches ? "语义二审通过" : "二审确认例句可能不符合义项，可单条重写",
        2600,
      );
    } catch (error) {
      updateSenseExample(wordId, index, (item) => ({
        ...item,
        review: {
          status: "failed",
          note: error instanceof Error ? error.message : "语义二审失败",
          reviewedAt: new Date().toISOString(),
        },
      }));
      onNotify(error instanceof Error ? error.message : "语义二审失败", 2400);
    } finally {
      setReviewingSense((active) => active === index ? null : active);
    }
  }, [onNotify, updateSenseExample]);

  const askCoach = useCallback(async (prompt: string) => {
    const question = prompt.trim();
    if (!question || aiLoading) return;
    setAiLoading(true);
    setAiInput("");
    const word = currentRef.current;
    try {
      const response = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word, prompt: question.slice(0, 500) }),
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error("request failed");
      const data = (await response.json()) as {
        answer: string;
        mode?: "cloud" | "local";
      };
      setAiAnswer(data.answer);
      setAiMode(data.mode === "cloud" ? "cloud" : "local");
    } catch {
      setAiAnswer(buildLocalCoach(word, question));
      setAiMode("local");
    } finally {
      setAiLoading(false);
    }
  }, [aiLoading]);

  /** 生成当前多义词的义项考频标注并缓存；失败时保留编号兜底 */
  async function generateSenseFrequency() {
    const word = currentRef.current;
    if (word.id === undefined || frequencyLoading) return;
    const items = currentRef.current.meaning
      ? currentRef.current.meaning
          .split(/[;；]/)
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 8)
      : [];
    if (items.length < 2) {
      onNotify("这个词只有一个义项，无需考频提示", 1800);
      return;
    }
    setFrequencyLoading(true);
    try {
      const response = await fetch("/api/sense-frequency", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word: word.word, senses: items }),
        signal: AbortSignal.timeout(25000),
      });
      const data = await response.json() as {
        senses?: SenseFrequencyEntry[];
        error?: string;
      };
      if (!response.ok || !Array.isArray(data.senses) || data.senses.length === 0) {
        throw new Error(data.error ?? "义项考频生成失败");
      }
      setSenseFrequency((items) => ({ ...items, [word.id!]: data.senses! }));
      onNotify("已生成义项考频标注并缓存", 2200);
    } catch (error) {
      onNotify(
        error instanceof Error ? error.message : "义项考频生成失败",
        2400,
      );
    } finally {
      setFrequencyLoading(false);
    }
  }

  async function enrichCurrentWord() {
    const word = currentRef.current;
    if (word.id === undefined || enrichmentLoading) return;
    if (!unfamiliarMeanings.length) {
      onNotify("所有中文义项都已标记熟练，请先取消一个义项", 2400);
      return;
    }
    setEnrichmentLoading(true);
    try {
      const response = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          word: word.word,
          meaning: unfamiliarMeanings.join("；"),
          senses: unfamiliarMeanings.slice(0, 6),
          familiarMeanings: [...currentFamiliarMeanings],
          existingSentences,
        }),
        signal: AbortSignal.timeout(30000),
      });
      const data = (await response.json()) as WordEnrichment & {
        error?: string;
      };
      if (!response.ok || data.source !== "ai") {
        throw new Error(data.error ?? "内容补充失败");
      }
      setEnrichments((items) => ({ ...items, [word.id!]: data }));
      onNotify(
        `已按 ${unfamiliarMeanings.length} 个未熟练义项生成并缓存`,
        2400,
      );
      const lowConfidenceExamples = data.senseExamples
        ?.map((example, index) => ({ example, index }))
        .filter(({ example }) =>
          typeof example.confidence === "number" && example.confidence < 0.65)
        ?? [];
      if (lowConfidenceExamples.length) {
        void (async () => {
          for (const { example, index } of lowConfidenceExamples) {
            await requestExampleReview({
              word: word.word,
              wordId: word.id!,
              index,
              example,
              reason: "low-confidence",
            });
          }
        })();
      }
    } catch (error) {
      onNotify(
        error instanceof Error ? error.message : "内容补充失败",
        2400,
      );
    } finally {
      setEnrichmentLoading(false);
    }
  }

  function reportSenseMismatch(index: number) {
    const word = currentRef.current;
    const example = word.id === undefined
      ? undefined
      : enrichmentsRef.current[word.id]?.senseExamples?.[index];
    if (word.id === undefined || !example || reviewingSense !== null) return;
    void requestExampleReview({
      word: word.word,
      wordId: word.id,
      index,
      example,
      reason: "meaning-mismatch",
    });
  }

  async function rewriteSenseExample(index: number) {
    const word = currentRef.current;
    const enrichment = word.id === undefined
      ? undefined
      : enrichmentsRef.current[word.id];
    const example = enrichment?.senseExamples?.[index];
    if (word.id === undefined || !example || rewritingSense !== null) return;
    setRewritingSense(index);
    try {
      const response = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          word: word.word,
          meaning: example.meaning,
          senses: [example.meaning],
          familiarMeanings: [...currentFamiliarMeanings],
          // 其余义项例句 + 已见例句，重写后不得与其雷同
          existingSentences: [
            ...new Set([
              ...(enrichment?.senseExamples
                ?.filter((_, itemIndex) => itemIndex !== index)
                .map((item) => item.sentence) ?? []),
              ...existingSentences,
            ]),
          ].slice(0, 6),
        }),
        signal: AbortSignal.timeout(30_000),
      });
      const data = await response.json() as WordEnrichment & { error?: string };
      const replacement = data.senseExamples?.[0];
      if (!response.ok || data.source !== "ai" || !replacement) {
        throw new Error(data.error ?? "单条例句重写失败");
      }
      updateSenseExample(word.id, index, () => replacement);
      onNotify(`“${example.meaning}”的例句已单独重写`, 2200);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "单条例句重写失败", 2400);
    } finally {
      setRewritingSense(null);
    }
  }

  const submitCoach = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      askCoach(aiInput);
    },
    [aiInput, askCoach],
  );

  return {
    aiOpen,
    aiInput,
    aiAnswer,
    aiLoading,
    aiMode,
    enrichmentLoading,
    reviewingSense,
    rewritingSense,
    frequencyLoading,
    setAiOpen,
    setAiInput,
    setAiAnswer,
    setAiMode,
    submitCoach,
    askCoach,
    enrichCurrentWord,
    generateSenseFrequency,
    reportSenseMismatch,
    rewriteSenseExample,
  } as const;
}
