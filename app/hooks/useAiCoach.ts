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
import { buildLocalCoach, splitWordSenses } from "../../lib/word-utils";
import type { DisplaySenseExample } from "../../lib/merged-senses";
import {
  buildEtymologyCacheEntry,
  etymologyInputForWord,
  normalizeEtymologyContent,
} from "../../lib/etymology";
import { mergeWordEnrichment } from "../../lib/enrichment";

/** 逐词生成入口的显式安全上限：覆盖当前最大 17 个义项并留余量，超限明确失败。 */
export const MAX_SENSES_PER_REQUEST = 18;

type UseAiCoachOptions = {
  current: Word;
  enrichments: Record<number, WordEnrichment>;
  setEnrichments: Dispatch<SetStateAction<Record<number, WordEnrichment>>>;
  setSenseFrequency: Dispatch<SetStateAction<SenseFrequencyMap>>;
  unfamiliarMeanings: string[];
  currentFamiliarMeanings: Set<string>;
  /** 已见例句原文（本词既有释义例句 + 跨词复用例句），随请求发给模型参考 */
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
  const [etymologyLoadingWordId, setEtymologyLoadingWordId] = useState<number | null>(null);
  const [etymologyError, setEtymologyError] = useState<{
    wordId: number;
    message: string;
  } | null>(null);

  // 保持 current 引用最新，避免闭包陷阱
  const currentRef = useRef(current);
  const enrichmentsRef = useRef(enrichments);
  const etymologyRequestRef = useRef<number | null>(null);
  useEffect(() => {
    currentRef.current = current;
    enrichmentsRef.current = enrichments;
  });

  /** 按义项文本 upsert 个人例句：只覆盖对应义项，其他义项（含基础例句）不受影响。 */
  const upsertSenseExampleByMeaning = useCallback((
    wordId: number,
    meaning: string,
    update: (example: SenseExample) => SenseExample,
  ) => {
    setEnrichments((items) => {
      const enrichment = items[wordId];
      const existing = enrichment?.senseExamples ?? [];
      const index = existing.findIndex((example) => example.meaning === meaning);
      const senseExamples = index >= 0
        ? existing.map((example, itemIndex) =>
          itemIndex === index ? update(example) : example)
        : [...existing, update({ meaning, sentence: "", translation: "" })];
      return {
        ...items,
        [wordId]: {
          ...(enrichment ?? { source: "ai" }),
          senseExamples,
          sentence: senseExamples[0]?.sentence ?? enrichment?.sentence,
          translation: senseExamples[0]?.translation ?? enrichment?.translation,
        },
      };
    });
  }, [setEnrichments]);

  const requestExampleReview = useCallback(async ({
    word,
    wordId,
    meaning,
    example,
    reason,
  }: {
    word: string;
    wordId: number;
    meaning: string;
    example: DisplaySenseExample;
    reason: "meaning-mismatch" | "low-confidence";
  }) => {
    setReviewingSense(example.senseIndex);
    upsertSenseExampleByMeaning(wordId, meaning, (item) => ({
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
          meaning,
          sentence: example.sentence,
          translation: example.translation,
          reason,
          contextSentences: [],
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
      upsertSenseExampleByMeaning(wordId, meaning, (item) => ({
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
      upsertSenseExampleByMeaning(wordId, meaning, (item) => ({
        ...item,
        review: {
          status: "failed",
          note: error instanceof Error ? error.message : "语义二审失败",
          reviewedAt: new Date().toISOString(),
        },
      }));
      onNotify(error instanceof Error ? error.message : "语义二审失败", 2400);
    } finally {
      setReviewingSense((active) =>
        active === example.senseIndex ? null : active);
    }
  }, [onNotify, upsertSenseExampleByMeaning]);

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
    const items = splitWordSenses(word).slice(0, MAX_SENSES_PER_REQUEST);
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
          senses: unfamiliarMeanings.slice(0, MAX_SENSES_PER_REQUEST),
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
      setEnrichments((items) => ({
        ...items,
        [word.id!]: mergeWordEnrichment(items[word.id!], data),
      }));
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
              meaning: example.meaning,
              example: {
                senseIndex: index,
                meaning: example.meaning,
                sentence: example.sentence,
                translation: example.translation,
                source: "personal",
                confidence: example.confidence,
                needsHumanReview: false,
              },
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

  /** 仅由揭示区显式动作触发；结果按请求开始时的真实 wordId 合并写回。 */
  async function generateEtymology() {
    const word = currentRef.current;
    const input = etymologyInputForWord(word);
    if (!input || etymologyRequestRef.current !== null) return;
    const wordId = input.wordId;
    etymologyRequestRef.current = wordId;
    setEtymologyLoadingWordId(wordId);
    setEtymologyError((currentError) =>
      currentError?.wordId === wordId ? null : currentError);
    try {
      const response = await fetch("/api/etymology", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          word: input.word,
          meaning: input.meaning,
          root: input.root ?? "",
          relation: input.relation,
        }),
        signal: AbortSignal.timeout(25_000),
      });
      const data = await response.json() as unknown;
      const error = data && typeof data === "object" && !Array.isArray(data)
        && typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : "AI 词根助记生成失败，请稍后重试";
      const content = normalizeEtymologyContent(data);
      if (!response.ok || !content) throw new Error(error);

      const entry = buildEtymologyCacheEntry(input, content, new Date());
      setEnrichments((items) => ({
        ...items,
        [wordId]: mergeWordEnrichment(items[wordId], {
          source: items[wordId]?.source ?? "redbook",
          etymology: entry,
        }),
      }));
      setEtymologyError(null);
      onNotify("AI 词根拆解与助记已生成并缓存", 2200);
    } catch (error) {
      const message = error instanceof DOMException && error.name === "TimeoutError"
        ? "AI 请求超时，本地词根与词族线索仍会保留"
        : error instanceof Error
          ? error.message
          : "AI 词根助记生成失败，本地线索仍会保留";
      setEtymologyError({ wordId, message });
      onNotify(message, 2600);
    } finally {
      if (etymologyRequestRef.current === wordId) {
        etymologyRequestRef.current = null;
        setEtymologyLoadingWordId(null);
      }
    }
  }

  function reportSenseMismatch(example: DisplaySenseExample) {
    const word = currentRef.current;
    if (word.id === undefined || !example || reviewingSense !== null) return;
    void requestExampleReview({
      word: word.word,
      wordId: word.id,
      meaning: example.meaning,
      example,
      reason: "meaning-mismatch",
    });
  }

  async function rewriteSenseExample(example: DisplaySenseExample) {
    const word = currentRef.current;
    const enrichment = word.id === undefined
      ? undefined
      : enrichmentsRef.current[word.id];
    if (word.id === undefined || !example || rewritingSense !== null) return;
    setRewritingSense(example.senseIndex);
    try {
      const response = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          word: word.word,
          meaning: example.meaning,
          senses: [example.meaning],
          familiarMeanings: [...currentFamiliarMeanings],
          // 其余义项例句 + 已见例句，一并提供给模型参考
          existingSentences: [
            ...new Set([
              ...(enrichment?.senseExamples
                ?.filter((item) => item.meaning !== example.meaning)
                .map((item) => item.sentence) ?? []),
              ...existingSentences,
            ]),
          ].slice(0, 10),
        }),
        signal: AbortSignal.timeout(30_000),
      });
      const data = await response.json() as WordEnrichment & { error?: string };
      const replacement = data.senseExamples?.[0];
      if (!response.ok || data.source !== "ai" || !replacement) {
        throw new Error(data.error ?? "单条例句重写失败");
      }
      // 只覆盖对应义项：其他义项（含预生成基础例句）保持不动
      upsertSenseExampleByMeaning(word.id, example.meaning, () => ({
        ...replacement,
        meaning: example.meaning,
      }));
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
    etymologyLoading: current.id !== undefined
      && etymologyLoadingWordId === current.id,
    etymologyError: current.id !== undefined
      && etymologyError?.wordId === current.id
      ? etymologyError.message
      : "",
    setAiOpen,
    setAiInput,
    setAiAnswer,
    setAiMode,
    submitCoach,
    askCoach,
    enrichCurrentWord,
    generateSenseFrequency,
    generateEtymology,
    reportSenseMismatch,
    rewriteSenseExample,
  } as const;
}
