import { resolve } from "node:path";
import process from "node:process";
import { writeDictionaryRangeIndex } from "./dictionary-range-index.mjs";

const dictionaryDirectory = resolve(
  process.argv[2] ?? "public/data/dictionary",
);
const { outputPath, prefixCount, rangeCount } =
  writeDictionaryRangeIndex(dictionaryDirectory);

console.log(
  `ECDICT Range 索引完成：${prefixCount} 个前缀 / ${rangeCount} 个范围 -> ${outputPath}`,
);
