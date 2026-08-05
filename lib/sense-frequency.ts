import type { SenseFrequencyEntry } from "./learning.ts";

/**
 * 严格校验模型返回的义项考频：每个目标义项恰好一个条目，
 * meaning 与请求逐字一致，level 在合法范围内。
 */
export function normalizeSenseFrequency(
  value: unknown,
  requestedSenses: string[],
): SenseFrequencyEntry[] {
  const senses = [...new Set(
    requestedSenses.map((sense) => sense.trim()).filter(Boolean),
  )];
  if (!senses.length || !Array.isArray(value)) {
    throw new Error("模型未按义项返回考频");
  }
  const entries = value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("模型返回的考频格式无效");
    }
    const record = item as Record<string, unknown>;
    const meaning = typeof record.meaning === "string"
      ? record.meaning.trim()
      : "";
    const rawLevel = record.level;
    const level: SenseFrequencyEntry["level"] | undefined =
      rawLevel === "high" || rawLevel === "medium" || rawLevel === "low"
        ? rawLevel
        : undefined;
    const note = typeof record.note === "string"
      ? record.note.trim().slice(0, 80)
      : "";
    if (!meaning || !level) {
      throw new Error("模型返回的考频字段不完整");
    }
    return {
      meaning,
      level,
      ...(note ? { note } : {}),
    };
  });
  if (entries.length !== senses.length) {
    throw new Error(`考频条目数应为 ${senses.length} 条`);
  }
  const byMeaning = new Map<string, SenseFrequencyEntry>();
  for (const entry of entries) {
    if (!senses.includes(entry.meaning) || byMeaning.has(entry.meaning)) {
      throw new Error("考频与目标义项未一一对应");
    }
    byMeaning.set(entry.meaning, entry);
  }
  return senses.map((sense) => byMeaning.get(sense)!);
}
