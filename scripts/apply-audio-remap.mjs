import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { applyAudioRemap, buildDurableRemap } from "./audio-remap.mjs";

const root = process.cwd();
const proposalPath = path.join(root, "tmp", "audio-remap-all-proposal.json");
const remapPath = path.join(root, "public", "data", "audio-remap.json");
const indexPath = path.join(root, "public", "data", "audio-index.json");

const proposal = JSON.parse(await readFile(proposalPath, "utf8"));
const remap = buildDurableRemap(proposal);
const index = JSON.parse(await readFile(indexPath, "utf8"));

applyAudioRemap(index, remap);

await Promise.all([
  writeFile(remapPath, `${JSON.stringify(remap, null, 2)}\n`, "utf8"),
  writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8"),
]);

console.log(JSON.stringify({
  checkedWordCount: index.metadata.asrValidation.checkedWordCount,
  verifiedOriginalCount: index.metadata.asrValidation.verifiedOriginalCount,
  lowConfidenceFallbackCount:
    index.metadata.asrValidation.lowConfidenceFallbackCount,
  totalFallbackWordCount: index.metadata.validation.fallbackWordCount,
}, null, 2));
