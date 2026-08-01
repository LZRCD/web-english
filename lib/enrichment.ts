export type NormalizedSenseExample = {
  meaning: string;
  sentence: string;
  translation: string;
  confidence: number;
};

/** 严格校验每个目标释义恰好对应一条例句，并按请求顺序返回。 */
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
    if (!example.meaning || !example.sentence || !example.translation) {
      throw new Error("模型返回的例句字段不完整");
    }
    return example;
  });

  if (examples.length !== senses.length) {
    throw new Error(`例句数量应为 ${senses.length} 条`);
  }
  const byMeaning = new Map<string, NormalizedSenseExample>();
  for (const example of examples) {
    if (!senses.includes(example.meaning) || byMeaning.has(example.meaning)) {
      throw new Error("例句与目标释义未一一对应");
    }
    byMeaning.set(example.meaning, example);
  }
  return senses.map((sense) => byMeaning.get(sense)!);
}
