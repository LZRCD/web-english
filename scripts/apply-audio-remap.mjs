import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  applyAudioRemap,
  buildDurableRemap,
  buildRuntimeAudioIndex,
} from "./audio-remap.mjs";

const root = process.cwd();
const proposalPath = path.join(root, "tmp", "audio-remap-all-proposal.json");
const remapPath = path.join(root, "public", "data", "audio-remap.json");
const indexPath = path.join(root, "public", "data", "audio-index.json");
const runtimeIndexPath = path.join(
  root,
  "public",
  "data",
  "audio-runtime-index.json",
);

const proposal = JSON.parse(await readFile(proposalPath, "utf8"));
const remap = buildDurableRemap(proposal);
const index = JSON.parse(await readFile(indexPath, "utf8"));

async function validationReport(filePath) {
  if (!existsSync(filePath)) return null;
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  const parsed = JSON.parse(await readFile(filePath, "utf8"));
  return {
    path: path.relative(root, filePath).replaceAll("\\", "/"),
    model: parsed.metadata?.model ?? parsed.summary?.model ?? parsed.model ?? null,
    sha256: hash.digest("hex"),
  };
}

remap.metadata.validationReports = (await Promise.all([
  "tmp/full-audio-asr-report.json",
  "tmp/scattered-base-report.json",
  "tmp/affected-audio-base-report.json",
  "tmp/unit15-asr-report.json",
].map((filename) => validationReport(path.join(root, filename)))))
  .filter(Boolean);

applyAudioRemap(index, remap);

await Promise.all([
  writeFile(remapPath, `${JSON.stringify(remap, null, 2)}\n`, "utf8"),
  writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8"),
  writeFile(
    runtimeIndexPath,
    `${JSON.stringify(buildRuntimeAudioIndex(index))}\n`,
    "utf8",
  ),
]);

console.log(JSON.stringify({
  checkedWordCount: index.metadata.asrValidation.checkedWordCount,
  verifiedOriginalCount: index.metadata.asrValidation.verifiedOriginalCount,
  lowConfidenceFallbackCount:
    index.metadata.asrValidation.lowConfidenceFallbackCount,
  totalFallbackWordCount: index.metadata.validation.fallbackWordCount,
}, null, 2));
