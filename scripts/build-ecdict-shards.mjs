import { createReadStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

const sourcePath = resolve(process.argv[2] ?? "tmp/ecdict.csv");
const outputDirectory = resolve(process.argv[3] ?? "public/data/dictionary");

if (!existsSync(sourcePath)) {
  throw new Error(`找不到 ECDICT CSV：${sourcePath}`);
}

function parseCsvLine(line) {
  const fields = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === "\"") {
      if (quoted && line[index + 1] === "\"") {
        value += "\"";
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      fields.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  fields.push(value);
  return fields;
}

function clean(value) {
  return value
    .replace(/\r/g, "")
    .replace(/\u0000/g, "")
    .trim();
}

const shards = Object.fromEntries(
  "abcdefghijklmnopqrstuvwxyz".split("").map((letter) => [letter, Object.create(null)]),
);
let headers;
let kept = 0;

const lines = createInterface({
  input: createReadStream(sourcePath, { encoding: "utf8" }),
  crlfDelay: Infinity,
});

for await (const line of lines) {
  const fields = parseCsvLine(line.replace(/^\uFEFF/, ""));
  if (!headers) {
    headers = new Map(fields.map((field, index) => [field.trim(), index]));
    continue;
  }
  const word = clean(fields[headers.get("word")] ?? "");
  const translation = clean(fields[headers.get("translation")] ?? "");
  if (!word || !translation || !/^[A-Za-z]/.test(word) || word.length > 160) continue;
  const key = word.toLowerCase();
  const shardName = key[0];
  const shard = shards[shardName];
  if (!shard || shard[key]) continue;
  shard[key] = [
    word,
    clean(fields[headers.get("phonetic")] ?? ""),
    translation,
  ];
  kept += 1;
}

mkdirSync(outputDirectory, { recursive: true });
for (const [letter, entries] of Object.entries(shards)) {
  writeFileSync(
    resolve(outputDirectory, `${letter}.json`),
    JSON.stringify(entries),
    "utf8",
  );
}

const metadata = {
  name: "ECDICT",
  upstream: "https://github.com/skywind3000/ECDICT",
  license: "MIT",
  generatedAt: new Date().toISOString(),
  entries: kept,
  fields: ["word", "phonetic", "translation"],
  shards: Object.fromEntries(
    Object.entries(shards).map(([letter, entries]) => [letter, Object.keys(entries).length]),
  ),
};
writeFileSync(
  resolve(outputDirectory, "metadata.json"),
  JSON.stringify(metadata, null, 2),
  "utf8",
);

console.log(`ECDICT 分片完成：${kept} 条 -> ${outputDirectory}`);
