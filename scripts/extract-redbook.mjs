import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resourceRoot = path.join(projectRoot, "资源");
const listRoot = path.join(resourceRoot, "红宝书", "27红宝书词汇表（正序+乱序+默写）");

const englishPdf = path.join(listRoot, "2027考研英语红宝书（正序版）英文词表.pdf");
const meaningPdf = path.join(listRoot, "2027考研英语红宝书（正序版）中文词表.pdf");
const structurePdf = path.join(resourceRoot, "27红宝书单词正序版.pdf");
const outputFile = path.join(projectRoot, "public", "data", "redbook.json");

function extractText(file) {
  return execFileSync(
    "pdftotext",
    ["-raw", "-enc", "UTF-8", file, "-"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  ).normalize("NFKC");
}

function isPageFurniture(line) {
  return (
    !line ||
    line === "Word Meaning" ||
    line.startsWith("2027考研英语红宝书") ||
    line.startsWith("共 6550 词") ||
    line.includes("扫描二维码") ||
    line.includes("对答案 / 听单词")
  );
}

function parseSequentialEntries(text) {
  const entries = [];
  let current = null;
  let expected = 1;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\f/g, "").trim();
    if (isPageFurniture(line)) continue;

    const numbered = line.match(/^(\d+)\s*(.*)$/);
    if (numbered && Number(numbered[1]) === expected) {
      if (current) entries.push(current);
      current = { index: expected, content: numbered[2].trim() };
      expected += 1;
      continue;
    }

    if (current && line) {
      current.content = `${current.content} ${line}`.replace(/\s+/g, " ").trim();
    }
  }

  if (current) entries.push(current);
  return entries;
}

function normalizeWord(word) {
  return word
    .toLowerCase()
    .replace(/\(([^)]+)\)/g, "$1")
    .replace(/[^\p{L}\p{N}/-]/gu, "");
}

function parseStructure(text) {
  const lookup = new Map();
  let section = "必考词";
  let unit = 1;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\f/g, "").trim();
    if (!line) continue;

    if (line.includes("红宝书必考词")) {
      section = "必考词";
      unit = 1;
      continue;
    }
    if (line.includes("红宝书基础词")) {
      section = "基础词";
      unit = 1;
      continue;
    }
    if (line.includes("红宝书超纲词")) {
      section = "超纲词";
      unit = "A";
      continue;
    }

    const unitMatch = line.match(/^Unit\s+(\d+)/i);
    if (unitMatch) {
      unit = Number(unitMatch[1]);
      continue;
    }

    const wordMatch = line.match(/^\d+\.\s*(\S.+?)\s*$/);
    if (!wordMatch) continue;
    const word = wordMatch[1].trim();
    const normalized = normalizeWord(word);
    const resolvedUnit = section === "超纲词"
      ? (word.match(/[A-Za-z]/)?.[0] ?? "A").toUpperCase()
      : unit;
    if (!lookup.has(normalized)) {
      lookup.set(normalized, { section, unit: resolvedUnit });
    }
  }

  return lookup;
}

const englishEntries = parseSequentialEntries(extractText(englishPdf));
const meaningEntries = parseSequentialEntries(extractText(meaningPdf));
const structure = parseStructure(extractText(structurePdf));

if (englishEntries.length !== 6550 || meaningEntries.length !== 6550) {
  throw new Error(
    `词表解析数量异常：英文 ${englishEntries.length}，中文 ${meaningEntries.length}，预期均为 6550。`,
  );
}

let previousLocation = { section: "必考词", unit: 1 };
let inferredLocations = 0;

const words = englishEntries.map((entry, offset) => {
  const word = entry.content.replace(/\s+/g, " ").trim();
  const location = structure.get(normalizeWord(word));
  if (location) {
    previousLocation = location;
  } else {
    inferredLocations += 1;
  }

  const meaning = meaningEntries[offset].content
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:，。；：])/g, "$1")
    .trim();

  return {
    id: entry.index,
    word,
    meaning,
    section: previousLocation.section,
    unit: previousLocation.unit,
    sourcePage: Math.ceil(entry.index / 40),
  };
});

const sectionCounts = words.reduce((counts, item) => {
  counts[item.section] = (counts[item.section] ?? 0) + 1;
  return counts;
}, {});

mkdirSync(path.dirname(outputFile), { recursive: true });
writeFileSync(
  outputFile,
  JSON.stringify(
    {
      metadata: {
        title: "2027考研英语红宝书",
        total: words.length,
        generatedAt: new Date().toISOString(),
        sectionCounts,
        inferredLocations,
      },
      words,
    },
    null,
    2,
  ),
  "utf8",
);

console.log(`已生成 ${words.length} 个词条：${outputFile}`);
console.log(`分组统计：${JSON.stringify(sectionCounts)}`);
console.log(`沿用相邻词单元位置：${inferredLocations} 个`);
