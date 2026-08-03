import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { buildRuntimeAudioIndex } from "./audio-remap.mjs";

const root = process.cwd();
const sourcePath = path.join(root, "public", "data", "audio-index.json");
const targetPath = path.join(
  root,
  "public",
  "data",
  "audio-runtime-index.json",
);

const index = JSON.parse(await readFile(sourcePath, "utf8"));
const runtimeIndex = buildRuntimeAudioIndex(index);
await writeFile(targetPath, `${JSON.stringify(runtimeIndex)}\n`, "utf8");

console.log(JSON.stringify({
  fileCount: runtimeIndex.files.length,
  indexedWordCount: Object.keys(runtimeIndex.entries).length,
}, null, 2));
