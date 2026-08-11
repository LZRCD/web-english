/** 首页与应用级共享常量与类型：从 page.tsx 抽出，集中管理。 */
import type { Word } from "../lib/study";

export type RedbookStatus = "loading" | "ready" | "error";
export type ActivityRange = 140 | 182 | 365;

export type RedbookData = {
  metadata: {
    title: string;
    total: number;
    sectionCounts: Record<string, number>;
    learningItemCount?: number;
  };
  words: Word[];
};

export type RedbookAnalysisData = {
  metadata: {
    auditedEntries: number;
    learningItemCount: number;
  };
  entries: Record<string, {
    correctedWord?: string;
    relation?: Word["relation"];
  }>;
};

export type ReinforcementRating = 0 | 1;

export const SECTION_META = [
  { name: "必考词", detail: "26 个单元", total: 1856, color: "mint", marker: "必" },
  { name: "基础词", detail: "31 个单元", total: 3680, color: "blue", marker: "基" },
  { name: "超纲词", detail: "按首字母编排", total: 1014, color: "peach", marker: "超" },
];

export const RATING_LABELS = ["忘记", "模糊", "认识", "熟练"];

export const RATING_DESCRIPTIONS = [
  "查看前完全没想起，或回忆错误",
  "查看前有印象，但关键内容不完整",
  "查看前正确想起，过程略有迟疑",
  "查看前立即、准确、轻松想起",
];

export const SECTION_PRIORITY: Record<string, number> = {
  必考词: 0,
  基础词: 1,
  超纲词: 2,
};

export const ACTIVITY_RANGE_LABELS: Record<ActivityRange, string> = {
  140: "20 周",
  182: "半年",
  365: "一年",
};

export const REDBOOK_PLACEHOLDER: Word = {
  word: "红宝书",
  meaning: "正在载入本地词库",
  section: "2027 考研英语",
};
