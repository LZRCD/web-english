import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const redbookPath = resolve("public/data/redbook.json");
const dictionaryDirectory = resolve("public/data/dictionary");
const outputPath = resolve("public/data/phonetic-index.json");

if (!existsSync(redbookPath)) {
  throw new Error(`找不到红宝书词库：${redbookPath}`);
}

const redbook = JSON.parse(readFileSync(redbookPath, "utf8"));
const words = Array.isArray(redbook.words) ? redbook.words : [];
if (!words.length) {
  throw new Error("红宝书词库为空");
}

/** 与 lib/word-utils.ts formatDictionaryPhonetic 保持一致：补全斜线包裹 */
function formatPhonetic(value) {
  const phonetic = (value ?? "").trim();
  if (!phonetic) return "";
  return /^[/[].*[/\]]$/.test(phonetic) ? phonetic : `/${phonetic}/`;
}

// 只读取需要的分片，避免全量 55MB 常驻内存
const shards = Object.create(null);
for (const letter of "abcdefghijklmnopqrstuvwxyz") {
  const shardPath = resolve(dictionaryDirectory, `${letter}.json`);
  if (!existsSync(shardPath)) continue;
  shards[letter] = JSON.parse(readFileSync(shardPath, "utf8"));
}

const index = Object.create(null);
let covered = 0;
const missing = [];
for (const word of words) {
  const text = (word.word ?? "").trim().toLowerCase();
  if (!text || !/^[a-z]/.test(text)) continue;
  const shard = shards[text[0]];
  const entry = shard?.[text];
  const phonetic = formatPhonetic(entry?.[1]);
  if (phonetic) {
    index[text] = phonetic;
    covered += 1;
  } else {
    missing.push(word.word);
  }
}

writeFileSync(outputPath, JSON.stringify(index), "utf8");

const missingSample = missing.slice(0, 10).join("、");
console.log(
  `音标索引完成：${covered}/${words.length} 词已覆盖 -> ${outputPath}`,
);
if (missing.length) {
  console.log(`未覆盖 ${missing.length} 词：${missingSample}${missing.length > 10 ? "…" : ""}`);
}
