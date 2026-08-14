// lib/merged-senses.ts
// 个人缓存与预生成基础例句的按义项合并展示模型。
// 优先级：个人重写（当前输入有效、非二审失败）→ 模型复核通过的基础例句
// → 待人工复核的基础例句。个人只重写一个义项时其余基础例句全部保留。
import type { SenseExample, SenseFrequencyEntry, WordEnrichment } from "./learning.ts";
import type { SenseExampleDatasetEntry, SenseFrequencyDatasetEntry } from "./sense-datasets.ts";

export type DisplaySenseExample = {
  senseIndex: number;
  meaning: string;
  sentence: string;
  translation: string;
  source: "personal" | "dataset";
  /** 个人例句的语义二审状态 */
  personalReview?: SenseExample["review"];
  /** 基础例句的复核状态 */
  datasetReviewStatus?: "model_passed" | "needs_review";
  confidence?: number;
  /** 基础例句是否待真实人工复核 */
  needsHumanReview: boolean;
};

export function validPersonalSenseExamples(
  enrichment: WordEnrichment | undefined,
): SenseExample[] {
  if (!enrichment?.senseExamples) return [];
  return enrichment.senseExamples.filter(
    (example) => example.review?.status !== "failed",
  );
}

/** 可安全复用的个人例句（强化/参考上下文）：二审失败的不复用。 */
export function usablePersonalSenseExamples(
  enrichment: WordEnrichment | undefined,
): SenseExample[] {
  return validPersonalSenseExamples(enrichment);
}

/**
 * 按当前真实义项列表合并个人与基础例句。
 * 个人例句（含二审失败、待二审）始终显示并保留复核状态徽标；
 * 基础例句只填充没有个人例句的义项。未合并出例句的义项返回 undefined 占位，
 * 绝不截断义项数量。
 */
export function mergeSenseExamples(input: {
  senseTexts: string[];
  enrichment: WordEnrichment | undefined;
  dataset: SenseExampleDatasetEntry[] | undefined;
}): Array<DisplaySenseExample | undefined> {
  const personalByMeaning = new Map<string, SenseExample>();
  for (const example of input.enrichment?.senseExamples ?? []) {
    if (!personalByMeaning.has(example.meaning)) {
      personalByMeaning.set(example.meaning, example);
    }
  }
  const datasetByIndex = new Map<number, SenseExampleDatasetEntry>();
  for (const record of input.dataset ?? []) {
    datasetByIndex.set(record.senseIndex, record);
  }
  return input.senseTexts.map((meaning, senseIndex) => {
    const personal = personalByMeaning.get(meaning);
    if (personal) {
      return {
        senseIndex,
        meaning,
        sentence: personal.sentence,
        translation: personal.translation,
        source: "personal",
        personalReview: personal.review,
        confidence: personal.confidence,
        needsHumanReview: false,
      };
    }
    const dataset = datasetByIndex.get(senseIndex);
    if (dataset) {
      return {
        senseIndex,
        meaning,
        sentence: dataset.sentence,
        translation: dataset.translation,
        source: "dataset",
        datasetReviewStatus: dataset.reviewStatus,
        confidence: dataset.reviewStatus === "model_passed"
          ? dataset.reviewConfidence ?? dataset.generationConfidence
          : dataset.generationConfidence,
        needsHumanReview: dataset.reviewStatus === "needs_review",
      };
    }
    return undefined;
  });
}

/** 仅模型复核通过、可安全复用的基础例句（强化/猜词等语境）。 */
export function passedDatasetExamples(
  dataset: SenseExampleDatasetEntry[] | undefined,
) {
  return (dataset ?? []).filter(
    (record) => record.reviewStatus === "model_passed",
  );
}

/** 个人义项考频缓存是否与当前真实义项列表逐字一致（否则视为过期）。 */
export function personalSenseFrequencyValid(
  entries: SenseFrequencyEntry[] | undefined,
  senseTexts: string[],
) {
  if (!entries || entries.length !== senseTexts.length) return false;
  return entries.every((entry, index) => entry.meaning === senseTexts[index]);
}

/** 把基础考频记录映射为展示条目（meaning 用当前真实义项文本，不存整套释义）。 */
export function datasetFrequencyToDisplay(
  dataset: SenseFrequencyDatasetEntry[] | undefined,
  senseTexts: string[],
): SenseFrequencyEntry[] | undefined {
  if (!dataset) return undefined;
  const entries: SenseFrequencyEntry[] = [];
  for (const record of dataset) {
    if (record.level === null || record.senseIndex < 0 || record.senseIndex >= senseTexts.length) {
      continue;
    }
    entries.push({
      meaning: senseTexts[record.senseIndex],
      level: record.level,
      ...(record.note ? { note: record.note } : {}),
    });
  }
  return entries.length ? entries : undefined;
}
