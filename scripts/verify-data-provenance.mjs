import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const provenancePath = path.join(root, "scripts", "data-provenance.json");
const reportPath = path.resolve(
  process.env.DATA_VERIFY_REPORT
    ?? path.join(root, "reports", "data-provenance-verification.json"),
);

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function sha256(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function firstExisting(paths) {
  return paths.find((filePath) => filePath && existsSync(filePath));
}

function displayPath(filePath) {
  const relative = path.relative(root, filePath);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.replaceAll("\\", "/");
  }
  const homeRelative = path.relative(os.homedir(), filePath);
  if (homeRelative && !homeRelative.startsWith("..") && !path.isAbsolute(homeRelative)) {
    return `<HOME>/${homeRelative.replaceAll("\\", "/")}`;
  }
  return path.basename(filePath);
}

async function findNamedFile(directory, filename, maximumDepth = 5, depth = 0) {
  if (!directory || depth > maximumDepth || !existsSync(directory)) return undefined;
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return undefined;
  }
  const direct = entries.find((entry) => entry.isFile() && entry.name === filename);
  if (direct) return path.join(directory, direct.name);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = await findNamedFile(
      path.join(directory, entry.name),
      filename,
      maximumDepth,
      depth + 1,
    );
    if (found) return found;
  }
  return undefined;
}

function whisperCacheRoot() {
  return path.resolve(
    process.env.HUGGINGFACE_HUB_CACHE
      ?? (process.env.HF_HOME
        ? path.join(process.env.HF_HOME, "hub")
        : path.join(os.homedir(), ".cache", "huggingface", "hub")),
  );
}

function whisperDefaultPath(model) {
  const cacheName = `models--${model.name.replace("/", "--")}`;
  return path.join(
    whisperCacheRoot(),
    cacheName,
    "snapshots",
    model.revision,
    model.file,
  );
}

function explicitWhisperPaths() {
  const raw = process.env.DATA_VERIFY_WHISPER_PATHS
    ?? process.env.WHISPER_MODEL_PATHS
    ?? "";
  return raw.split(path.delimiter).map((item) => item.trim()).filter(Boolean);
}

async function locateFfmpeg() {
  const explicit = argumentValue("--ffmpeg")
    ?? process.env.DATA_VERIFY_FFMPEG_PATH
    ?? process.env.FFMPEG_PATH;
  const pathCandidates = (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .map((directory) => path.join(directory, process.platform === "win32"
      ? "ffmpeg.exe"
      : "ffmpeg"));
  const direct = firstExisting([explicit, ...pathCandidates].map((item) =>
    item ? path.resolve(item) : undefined));
  if (direct) return direct;
  if (process.platform !== "win32") return undefined;
  return findNamedFile(
    path.join(
      process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"),
      "Microsoft",
      "WinGet",
      "Packages",
    ),
    "ffmpeg.exe",
    5,
  );
}

async function downloadEcdict(provenance) {
  const target = path.join(
    root,
    "tmp",
    "provenance",
    provenance.ecdict.commit,
    provenance.ecdict.sourceFile,
  );
  if (existsSync(target)) return target;
  const repository = new URL(provenance.ecdict.repository);
  const segments = repository.pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (repository.hostname !== "github.com" || segments.length < 2) {
    throw new Error("ECDICT repository 不是可识别的 GitHub 地址");
  }
  const url = `https://raw.githubusercontent.com/${segments[0]}/${segments[1]}/${provenance.ecdict.commit}/${provenance.ecdict.sourceFile}`;
  console.log(`下载固定 ECDICT 来源：${provenance.ecdict.commit}`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`ECDICT 下载失败：HTTP ${response.status}`);
  const body = new Uint8Array(await response.arrayBuffer());
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, body);
  return target;
}

async function verifyFile(label, filePath, expectedSha256, extra = {}) {
  if (!filePath || !existsSync(filePath)) {
    return {
      label,
      status: "missing",
      path: filePath ? displayPath(filePath) : null,
      expectedSha256,
      actualSha256: null,
      ...extra,
    };
  }
  const actualSha256 = await sha256(filePath);
  return {
    label,
    status: actualSha256 === expectedSha256 ? "matched" : "mismatch",
    path: displayPath(filePath),
    expectedSha256,
    actualSha256,
    bytes: (await stat(filePath)).size,
    ...extra,
  };
}

function validateProvenance(provenance) {
  const errors = [];
  if (!/^[a-f0-9]{40}$/.test(provenance.ecdict?.commit ?? "")) {
    errors.push("ECDICT commit 必须是完整 40 位 SHA");
  }
  for (const [label, value] of [
    ["ECDICT source", provenance.ecdict?.sourceSha256],
    ["FFmpeg binary", provenance.ffmpeg?.binarySha256],
    ...((provenance.whisper?.models ?? []).map((model) => [model.name, model.sha256])),
  ]) {
    if (!/^[a-f0-9]{64}$/.test(value ?? "")) errors.push(`${label} 缺少有效 SHA-256`);
  }
  for (const model of provenance.whisper?.models ?? []) {
    if (!/^[a-f0-9]{40}$/.test(model.revision ?? "")) {
      errors.push(`${model.name} revision 必须是完整 40 位 SHA`);
    }
  }
  if (errors.length) throw new Error(errors.join("；"));
}

async function main() {
  const provenance = JSON.parse(await readFile(provenancePath, "utf8"));
  validateProvenance(provenance);

  let ecdictPath = firstExisting([
    argumentValue("--ecdict"),
    process.env.DATA_VERIFY_ECDICT_SOURCE,
    process.env.ECDICT_SOURCE,
    path.join(root, "tmp", "ecdict.csv"),
    path.join(root, "tmp", "ecdict-upstream", provenance.ecdict.sourceFile),
    path.join(root, "tmp", "provenance", provenance.ecdict.commit, provenance.ecdict.sourceFile),
  ].map((item) => item ? path.resolve(item) : undefined));
  if (!ecdictPath && process.argv.includes("--download-ecdict")) {
    ecdictPath = await downloadEcdict(provenance);
  }

  const declaredWhisperPaths = explicitWhisperPaths();
  const modelResults = await Promise.all(
    provenance.whisper.models.map((model, index) => verifyFile(
      model.name,
      firstExisting([
        declaredWhisperPaths[index],
        whisperDefaultPath(model),
      ].map((item) => item ? path.resolve(item) : undefined)),
      model.sha256,
      { revision: model.revision, sourceFile: model.file },
    )),
  );
  const ffmpegPath = await locateFfmpeg();
  const results = [
    await verifyFile(
      "ECDICT",
      ecdictPath,
      provenance.ecdict.sourceSha256,
      { commit: provenance.ecdict.commit, sourceFile: provenance.ecdict.sourceFile },
    ),
    ...modelResults,
    await verifyFile(
      "FFmpeg",
      ffmpegPath,
      provenance.ffmpeg.binarySha256,
      { version: provenance.ffmpeg.version },
    ),
  ];
  const settledResults = results.map((result) => ({
    ...result,
    bytes: result.bytes ?? null,
  }));
  const complete = settledResults.every((item) => item.status === "matched");
  const report = {
    format: "wordloop-data-provenance-verification-v1",
    verifiedAt: new Date().toISOString(),
    provenanceVersion: provenance.version,
    provenanceFileSha256: await sha256(provenancePath),
    complete,
    results: settledResults,
  };
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  for (const item of settledResults) {
    const marker = item.status === "matched" ? "✓" : item.status === "missing" ? "?" : "✗";
    console.log(`${marker} ${item.label}: ${item.status} · ${item.path ?? "未找到"}`);
  }
  console.log(`来源校验报告：${displayPath(reportPath)}`);
  if (!complete) {
    throw new Error(
      "来源现场校验未完成；可传入 --ecdict/--ffmpeg，或设置 DATA_VERIFY_WHISPER_PATHS。ECDICT 缺失时可追加 --download-ecdict。",
    );
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}

export {
  displayPath,
  firstExisting,
  sha256,
  validateProvenance,
};
