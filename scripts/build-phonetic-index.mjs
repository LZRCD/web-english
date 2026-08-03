import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const redbookPath = resolve("public/data/redbook.json");
const dictionaryDirectory = resolve("public/data/dictionary");
const overridesPath = resolve("scripts/phonetic-overrides.json");
const outputPath = resolve("public/data/phonetic-index.json");
const metadataOutputPath = resolve("public/data/phonetic-metadata.json");

if (!existsSync(redbookPath)) {
  throw new Error(`找不到红宝书词库：${redbookPath}`);
}

const redbook = JSON.parse(readFileSync(redbookPath, "utf8"));
const words = Array.isArray(redbook.words) ? redbook.words : [];
if (!words.length) {
  throw new Error("红宝书词库为空");
}
const overrides = existsSync(overridesPath)
  ? JSON.parse(readFileSync(overridesPath, "utf8"))
  : {};

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
const qualityEntries = Object.create(null);
let covered = 0;
let dictionaryCount = 0;
let overrideCount = 0;
const missing = [];
const overrideHash = createHash("sha256")
  .update(existsSync(overridesPath) ? readFileSync(overridesPath) : "")
  .digest("hex");
const shardHashes = Object.fromEntries(
  Object.entries(shards).map(([letter]) => {
    const raw = readFileSync(resolve(dictionaryDirectory, `${letter}.json`));
    return [letter, createHash("sha256").update(raw).digest("hex")];
  }),
);
for (const word of words) {
  const text = (word.word ?? "").trim().toLowerCase();
  if (!text || !/^[a-z]/.test(text)) continue;
  const shard = shards[text[0]];
  const entry = shard?.[text];
  const dictionaryPhonetic = formatPhonetic(entry?.[1]);
  const overridePhonetic = formatPhonetic(overrides[text]);
  const phonetic = dictionaryPhonetic || overridePhonetic;
  if (phonetic) {
    index[text] = phonetic;
    const source = dictionaryPhonetic ? "dictionary" : "override";
    if (source === "dictionary") dictionaryCount += 1;
    else overrideCount += 1;
    qualityEntries[text] = {
      source,
      sourceVersion: source === "dictionary"
        ? shardHashes[text[0]]
        : overrideHash,
      confidence: source === "override" ? "high" : "medium",
      ipaSystem: source === "override" ? "IPA" : "ECDICT-mixed",
      variety: "mixed",
      era: source === "override" ? "modern" : "unverified",
      evidence: source === "override"
        ? `scripts/phonetic-overrides.json#${text}`
        : `ECDICT ${text[0]}.json`,
    };
    covered += 1;
  } else {
    missing.push(word.word);
  }
}

writeFileSync(outputPath, JSON.stringify(index), "utf8");
writeFileSync(metadataOutputPath, JSON.stringify({
  version: 1,
  coverage: {
    total: words.length,
    covered,
    uniqueEntries: Object.keys(qualityEntries).length,
    missing: missing.length,
    dictionary: dictionaryCount,
    overrides: overrideCount,
    strictIpaVerified: overrideCount,
    notationUnverified: dictionaryCount,
  },
  sources: {
    dictionary: {
      name: "ECDICT",
      upstream: "https://github.com/skywind3000/ECDICT",
      shardHashes,
    },
    overrides: {
      path: "scripts/phonetic-overrides.json",
      sha256: overrideHash,
    },
  },
  entries: qualityEntries,
}), "utf8");

const missingSample = missing.slice(0, 10).join("、");
console.log(
  `音标索引完成：${covered}/${words.length} 词已覆盖 -> ${outputPath}`,
);
if (missing.length) {
  console.log(`未覆盖 ${missing.length} 词：${missingSample}${missing.length > 10 ? "…" : ""}`);
}
