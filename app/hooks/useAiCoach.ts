import {
  Dispatch,
  FormEvent,
  SetStateAction,
  useCallback,
  useRef,
  useState,
} from "react";
import type { WordEnrichment } from "../../lib/learning";
import type { Word } from "../../lib/study";
import { buildLocalCoach } from "../../lib/word-utils";

type UseAiCoachOptions = {
  current: Word;
  enrichments: Record<number, WordEnrichment>;
  setEnrichments: Dispatch<SetStateAction<Record<number, WordEnrichment>>>;
  unfamiliarMeanings: string[];
  currentFamiliarMeanings: Set<string>;
  onNotify: (message: string, duration?: number) => void;
};

const DEFAULT_ANSWER = "我会用语境、联想和小测验帮你真正记住这个词。";

/** AI 记忆教练状态 + API 调用 */
export function useAiCoach({
  current,
  enrichments: _enrichments,
  setEnrichments,
  unfamiliarMeanings,
  currentFamiliarMeanings,
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

  // 保持 current 引用最新，避免闭包陷阱
  const currentRef = useRef(current);
  currentRef.current = current;

  async function askCoach(prompt: string) {
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
          familiarMeanings: [...currentFamiliarMeanings],
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
    } catch (error) {
      onNotify(
        error instanceof Error ? error.message : "内容补充失败",
        2400,
      );
    } finally {
      setEnrichmentLoading(false);
    }
  }

  const submitCoach = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      askCoach(aiInput);
    },
    [aiInput, aiLoading],
  );

  return {
    aiOpen,
    aiInput,
    aiAnswer,
    aiLoading,
    aiMode,
    enrichmentLoading,
    setAiOpen,
    setAiInput,
    setAiAnswer,
    setAiMode,
    submitCoach,
    askCoach,
    enrichCurrentWord,
  } as const;
}
