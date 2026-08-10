import { splitMeaning, type Word } from "./study.ts";

/** 清洗选中文本，去首尾标点和多余空格 */
export function cleanSelectedText(value: string) {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s"'""''()[\]{}.,，。;；:：!?！？]+/, "")
    .replace(/[\s"'""''()[\]{}.,，。;；:：!?！？]+$/, "")
    .slice(0, 160);
}

/** 按分号/逗号拆分义项，保留括号内的嵌套内容不拆分 */
export function splitSenseItems(value: string) {
  const items: string[] = [];
  let current = "";
  let depth = 0;
  for (const character of value) {
    if ("([{（【".includes(character)) depth += 1;
    if (")]}）】".includes(character)) depth = Math.max(0, depth - 1);
    if (depth === 0 && /[;；,，]/.test(character)) {
      if (current.trim()) items.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  if (current.trim()) items.push(current.trim());
  return items;
}

/** 拆分单词的展示义项：按词性分段后再按逗号/分号拆分并去重，与卡片展示一致 */
export function splitWordSenses(word: Pick<Word, "meaning" | "part">): string[] {
  const parsed = splitMeaning(word.meaning);
  const senses = word.part
    ? [{ part: word.part, meaning: parsed.meaning }]
    : parsed.senses;
  return [...new Set(senses.flatMap((sense) => splitSenseItems(sense.meaning)))];
}

/** 遮掩单词中间字母为 ·，用于强化拼写提示 */
export function maskWord(value: string) {
  return value.replace(/\b([a-z])([a-z]*)\b/gi, (_, first: string, rest: string) =>
    `${first}${"·".repeat(rest.length)}`);
}

/** 在句子中将目标单词替换为填空线，用于完形填空练习 */
export function clozeSentence(sentence: string, word: string) {
  const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const cloze = sentence.replace(new RegExp(escapedWord, "gi"), "＿＿＿＿");
  return cloze === sentence ? "" : cloze;
}

/** 格式化回忆耗时 */
export function formatRecallTime(recallMs: number) {
  const seconds = recallMs / 1000;
  return seconds < 10 ? `${seconds.toFixed(1)} 秒` : `${Math.round(seconds)} 秒`;
}

/** 格式化词典音标：补全斜线包裹 */
export function formatDictionaryPhonetic(value: string) {
  const phonetic = value.trim();
  if (!phonetic) return "";
  return /^[/[].*[/\]]$/.test(phonetic) ? phonetic : `/${phonetic}/`;
}

/** 生成单词唯一键，用于排序和去重 */
export function wordKey(word: Word) {
  return word.id !== undefined
    ? `redbook-${word.id}`
    : `${word.section ?? "redbook"}-${word.unit ?? "all"}-${word.word}`;
}

/** FNV-1a 哈希种子评分，用于确定性乱序 */
export function seededScore(value: string, seed: number) {
  let hash = seed | 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

/** 基于种子的确定性洗牌 */
export function shuffleWithSeed(words: Word[], seed: number) {
  return [...words].sort(
    (first, second) =>
      seededScore(wordKey(first), seed) - seededScore(wordKey(second), seed),
  );
}

/** 生成本地 AI 教练回复（云端不可用时的降级方案） */
export function buildLocalCoach(word: Word, prompt: string) {
  const relationHint = word.relation
    ? `词族提示：${word.relation.label}。${word.relation.note}`
    : "";
  if (prompt.includes("近义") || prompt.includes("区别")) {
    return `${relationHint}辨析 ${word.word}：它强调"${word.meaning.split("；")[0]}"。记忆时先抓住核心场景，再比较近义词，不要孤立背中文。`;
  }
  if (prompt.includes("题") || prompt.includes("测")) {
    return `${relationHint}主动回忆：先遮住释义，用 ${word.word} 造一个与你今天经历有关的英文句子。再回答：它在红宝书中的核心含义"${word.meaning.split("；")[0]}"是什么？`;
  }
  if (prompt.includes("例句") || prompt.includes("语境")) {
    return `${relationHint}给你一个学习语境：When you review ${word.word} in several meaningful situations, the memory becomes easier to retrieve. 先读懂整句，再回想 ${word.word} 的核心含义。`;
  }
  return `${relationHint}把 ${word.word} 记成一幅动作画面：${word.root ?? "先抓住词形和核心词义"}。核心不是死记"${word.meaning}"，而是主动造一个与你有关的句子。`;
}
