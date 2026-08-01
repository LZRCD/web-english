import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicData = path.join(root, "public", "data");
const manifestPath = path.join(publicData, "data-manifest.json");
const generatedModulePath = path.join(root, "lib", "data-versions.generated.ts");
const checkOnly = process.argv.includes("--check");

const assetPaths = [
  "/data/redbook.json",
  "/data/redbook-analysis.json",
  "/data/phonetic-index.json",
  "/data/phonetic-metadata.json",
  "/data/audio-runtime-index.json",
  "/data/dictionary/metadata.json",
  "/data/dictionary/ranges.json",
  ..."abcdefghijklmnopqrstuvwxyz"
    .split("")
    .map((letter) => `/data/dictionary/ranges/${letter}.json`),
  ..."abcdefghijklmnopqrstuvwxyz"
    .split("")
    .map((letter) => `/data/dictionary/${letter}.json`),
];

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

const assets = {};
for (const assetPath of assetPaths) {
  const buffer = await readFile(path.join(root, "public", assetPath));
  assets[assetPath] = { sha256: sha256(buffer), bytes: buffer.byteLength };
}
const contentVersion = sha256(Buffer.from(JSON.stringify(assets))).slice(0, 16);
const dictionaryRangeIndex = JSON.parse(await readFile(
  path.join(publicData, "dictionary", "ranges.json"),
  "utf8",
));

const generatedModule = `/** 由 scripts/build-data-manifest.mjs 自动生成，请勿手改。 */
export const DATA_CONTENT_VERSION = ${JSON.stringify(contentVersion)};
export const DATA_ASSET_HASHES: Readonly<Record<string, string>> = ${JSON.stringify(
  Object.fromEntries(
    Object.entries(assets).map(([assetPath, asset]) => [assetPath, asset.sha256]),
  ),
  null,
  2,
)};
/** 根索引很小，随构建内嵌以避免首次查词前额外串行请求。 */
export const DICTIONARY_RANGE_INDEX = ${JSON.stringify(dictionaryRangeIndex, null, 2)};
`;

if (checkOnly) {
  let currentManifest;
  let currentModule = "";
  try {
    currentManifest = JSON.parse(await readFile(manifestPath, "utf8"));
    currentModule = await readFile(generatedModulePath, "utf8");
  } catch {
    console.error("数据版本清单缺失，请先运行 npm run data:manifest");
    process.exitCode = 1;
    process.exit();
  }
  if (
    currentManifest.version !== 1
    || currentManifest.contentVersion !== contentVersion
    || JSON.stringify(currentManifest.assets) !== JSON.stringify(assets)
    || currentModule.replaceAll("\r\n", "\n") !== generatedModule
  ) {
    console.error("数据文件与版本清单不一致，请运行 npm run data:manifest 后再构建");
    process.exitCode = 1;
  } else {
    console.log(`数据版本校验通过：${contentVersion} / ${assetPaths.length} 个文件`);
  }
} else {
  const manifest = {
    version: 1,
    contentVersion,
    generatedAt: new Date().toISOString(),
    assets,
  };
  await Promise.all([
    writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
    writeFile(generatedModulePath, generatedModule, "utf8"),
  ]);
  console.log(`数据版本清单完成：${contentVersion} / ${assetPaths.length} 个文件`);
}
