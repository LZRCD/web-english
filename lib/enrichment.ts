import type { WordEnrichment } from "./learning.ts";

export type NormalizedSenseExample = {
  meaning: string;
  sentence: string;
  translation: string;
  confidence: number;
};

/** 只覆盖响应中真实存在的字段，防止不同内容能力互相清空。 */
export function mergeWordEnrichment(
  current: WordEnrichment | undefined,
  incoming: WordEnrichment,
): WordEnrichment {
  const definedIncoming = Object.fromEntries(
    Object.entries(incoming).filter(([, value]) => value !== undefined),
  ) as WordEnrichment;
  return { ...current, ...definedIncoming };
}

/** 按请求顺序校验每条例句字段完整；释义文本允许模型改写，缺失时回退请求释义。 */
export function normalizeSenseExamples(
  value: unknown,
  requestedSenses: string[],
): NormalizedSenseExample[] {
  const senses = [...new Set(
    requestedSenses.map((sense) => sense.trim()).filter(Boolean),
  )];
  if (!senses.length || !Array.isArray(value)) {
    throw new Error("模型未按释义返回例句");
  }

  const examples = value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("模型返回的例句格式无效");
    }
    const record = item as Record<string, unknown>;
    const example = {
      meaning: typeof record.meaning === "string" ? record.meaning.trim() : "",
      sentence: typeof record.sentence === "string"
        ? record.sentence.trim().slice(0, 500)
        : "",
      translation: typeof record.translation === "string"
        ? record.translation.trim().slice(0, 300)
        : "",
      confidence: Number.isFinite(record.confidence)
        ? Math.max(0, Math.min(1, Number(record.confidence)))
        : 0.8,
    };
    if (!example.sentence || !example.translation) {
      throw new Error("模型返回的例句字段不完整");
    }
    return example;
  });

  if (examples.length !== senses.length) {
    throw new Error(`例句数量应为 ${senses.length} 条`);
  }
  return senses.map((sense, index) => ({
    ...examples[index],
    meaning: examples[index].meaning || sense,
  }));
}
