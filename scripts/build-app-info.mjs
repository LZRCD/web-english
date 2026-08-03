import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(
  path.join(root, "package.json"),
  "utf8",
));
const modeIndex = process.argv.indexOf("--mode");
const requestedMode = modeIndex >= 0 ? process.argv[modeIndex + 1] : process.env.NODE_ENV;
const runtimeMode = ["development", "production", "test"].includes(requestedMode)
  ? requestedMode
  : "unknown";

let commit = "unknown";
try {
  commit = execFileSync(
    "git",
    ["rev-parse", "--short=12", "HEAD"],
    { cwd: root, encoding: "utf8" },
  ).trim();
} catch {
  // 源码归档没有 .git 时仍允许构建，并明确标记版本未知。
}

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(fullPath));
    else files.push(fullPath);
  }
  return files;
}

const generatedFiles = new Set([
  path.join(root, "lib", "build-info.generated.ts"),
  path.join(root, "lib", "data-versions.generated.ts"),
]);
const topLevelSources = [
  "package.json",
  "package-lock.json",
  "next.config.ts",
  "vite.config.ts",
  "tsconfig.json",
  "postcss.config.mjs",
].map((filename) => path.join(root, filename));
const files = [
  ...await sourceFiles(path.join(root, "app")),
  ...await sourceFiles(path.join(root, "lib")),
  ...topLevelSources,
].filter((filePath) => !generatedFiles.has(filePath)).sort();
const sourceHash = createHash("sha256");
for (const filePath of files) {
  sourceHash.update(path.relative(root, filePath).replaceAll("\\", "/"));
  sourceHash.update("\0");
  sourceHash.update(await readFile(filePath));
  sourceHash.update("\0");
}
const sourceFingerprint = sourceHash.digest("hex");
const buildId = `${packageJson.version}+${commit}.${sourceFingerprint.slice(0, 12)}`;
const output = `/** 由 scripts/build-app-info.mjs 自动生成，请勿手改。 */
export const APP_VERSION = ${JSON.stringify(packageJson.version)};
export const APP_GIT_COMMIT = ${JSON.stringify(commit)};
export const APP_SOURCE_HASH = ${JSON.stringify(sourceFingerprint)};
export const APP_BUILD_ID = ${JSON.stringify(buildId)};
export const APP_RUNTIME_MODE: "development" | "production" | "test" | "unknown" = ${JSON.stringify(runtimeMode)};
`;

await writeFile(
  path.join(root, "lib", "build-info.generated.ts"),
  output,
  "utf8",
);
console.log(`应用构建版本：${buildId} · ${runtimeMode}`);
