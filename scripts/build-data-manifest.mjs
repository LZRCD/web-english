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
const missingAssets = [];
for (const assetPath of assetPaths) {
  try {
    const buffer = await readFile(path.join(root, "public", assetPath));
    assets[assetPath] = { sha256: sha256(buffer), bytes: buffer.byteLength };
  } catch {
    missingAssets.push(assetPath);
  }
}
if (!checkOnly && missingAssets.length) {
  console.error(`缺少数据文件：${missingAssets.join(", ")}，请先运行数据构建脚本`);
  process.exitCode = 1;
  process.exit();
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

  // 干净检出时私有数据（如 redbook.json）可能未随仓库提供：
  // 允许缺失，只校验现存文件与已提交清单是否一致，避免 CI 因私有数据缺失而失败。
  const skipped = [];
  let consistent = true;
  for (const [assetPath, expectedAsset] of Object.entries(currentManifest.assets ?? {})) {
    try {
      const buffer = await readFile(path.join(root, "public", assetPath));
      if (sha256(buffer) !== expectedAsset.sha256) {
        consistent = false;
        console.error(`数据文件哈希不一致：${assetPath}`);
      }
    } catch {
      skipped.push(assetPath);
    }
  }
  const moduleVersion = currentModule.match(/DATA_CONTENT_VERSION = "([0-9a-f]+)"/)?.[1];
  if (moduleVersion !== currentManifest.contentVersion) {
    consistent = false;
    console.error("生成模块与数据版本清单的 contentVersion 不一致");
  }
  if (!consistent) {
    console.error("数据文件与版本清单不一致，请运行 npm run data:manifest 后再构建");
    process.exitCode = 1;
  } else {
    const skipNote = skipped.length
      ? `（跳过 ${skipped.length} 个未检出的私有数据文件：${skipped.join(", ")}）`
      : "";
    console.log(`数据版本校验通过：${currentManifest.contentVersion} / ${assetPaths.length} 个文件 ${skipNote}`);
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
