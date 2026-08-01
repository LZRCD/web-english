import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDirectory = path.join(root, "public", "data");
const reportPath = path.join(root, "reports", "data-build-report.json");
const provenancePath = path.join(root, "scripts", "data-provenance.json");

async function sha256(filePath) {
  if (!existsSync(filePath)) return null;
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function fileEvidence(filePath) {
  const hash = await sha256(filePath);
  const relativePath = path.relative(root, filePath);
  const reportPath = path.isAbsolute(relativePath) || relativePath.startsWith("..")
    ? path.join("external", path.basename(filePath))
    : relativePath;
  return {
    path: reportPath.replaceAll("\\", "/"),
    available: hash !== null,
    sha256: hash,
  };
}

async function jsonIfAvailable(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function modelDeclarations(audioIndex, audioRemap) {
  const declarations = new Map();
  const add = (name, evidence) => {
    if (typeof name !== "string" || !name.trim()) return;
    const normalized = name.trim();
    declarations.set(normalized, [
      ...new Set([...(declarations.get(normalized) ?? []), evidence]),
    ]);
  };

  if (process.env.WHISPER_MODEL_NAME) {
    add(process.env.WHISPER_MODEL_NAME, "环境变量 WHISPER_MODEL_NAME");
  }
  const validationPaths = [...new Set([
    audioRemap?.metadata?.sourceReport,
    ...(audioRemap?.metadata?.validationReports ?? [])
      .map((item) => item?.path),
    "tmp/full-audio-asr-report.json",
    "tmp/scattered-base-report.json",
    "tmp/affected-audio-base-report.json",
    "tmp/unit15-asr-report.json",
  ].filter((item) => typeof item === "string"))]
    .map((item) => path.resolve(root, item));
  const validationReports = [];
  const embeddedReports = new Map(
    (audioRemap?.metadata?.validationReports ?? [])
      .filter((item) => typeof item?.path === "string")
      .map((item) => [path.resolve(root, item.path), item]),
  );
  for (const filePath of validationPaths) {
    const parsed = await jsonIfAvailable(filePath);
    const embedded = embeddedReports.get(filePath);
    if (!parsed && !embedded) continue;
    const model = parsed?.metadata?.model
      ?? parsed?.summary?.model
      ?? parsed?.model
      ?? embedded?.model;
    const evidence = await fileEvidence(filePath);
    validationReports.push({
      ...evidence,
      recordedSha256: embedded?.sha256 ?? null,
      model: model ?? null,
    });
    add(model, evidence.path);
  }

  for (const scriptName of ["validate-audio-index.py", "validate-unit15-audio.py"]) {
    const scriptPath = path.join(root, "scripts", scriptName);
    const source = await readFile(scriptPath, "utf8");
    for (const match of source.matchAll(/openai\/whisper-[a-z0-9._-]+/gi)) {
      add(match[0], path.relative(root, scriptPath).replaceAll("\\", "/"));
    }
  }
  for (const alignment of audioIndex.metadata?.files ?? []) {
    if (typeof alignment.alignment !== "string") continue;
    if (alignment.alignment.includes("tiny")) {
      add("openai/whisper-tiny.en", "public/data/audio-index.json");
    }
    if (alignment.alignment.includes("base")) {
      add("openai/whisper-base.en", "public/data/audio-index.json");
    }
  }
  return {
    declaredModels: [...declarations].map(([name, evidence]) => ({ name, evidence })),
    validationReports,
  };
}

function commandVersion(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (result.error) return null;
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  return output ? output.split(/\r?\n/, 1)[0].trim() : null;
}

function reportTimestamp() {
  const epoch = Number(process.env.SOURCE_DATE_EPOCH);
  return Number.isFinite(epoch) && epoch >= 0
    ? new Date(epoch * 1000).toISOString()
    : new Date().toISOString();
}

const [
  manifest,
  redbook,
  audioIndex,
  audioRemap,
  phoneticMetadata,
  rangeIndex,
  dictionaryMetadata,
  provenance,
] = await Promise.all([
  readFile(path.join(dataDirectory, "data-manifest.json"), "utf8").then(JSON.parse),
  readFile(path.join(dataDirectory, "redbook.json"), "utf8").then(JSON.parse),
  readFile(path.join(dataDirectory, "audio-index.json"), "utf8").then(JSON.parse),
  readFile(path.join(dataDirectory, "audio-remap.json"), "utf8").then(JSON.parse),
  readFile(path.join(dataDirectory, "phonetic-metadata.json"), "utf8").then(JSON.parse),
  readFile(path.join(dataDirectory, "dictionary", "ranges.json"), "utf8").then(JSON.parse),
  readFile(path.join(dataDirectory, "dictionary", "metadata.json"), "utf8").then(JSON.parse),
  readFile(provenancePath, "utf8").then(JSON.parse),
]);

const redbookSourcePaths = [
  path.join(root, "资源", "红宝书", "27红宝书词汇表（正序+乱序+默写）", "2027考研英语红宝书（正序版）英文词表.pdf"),
  path.join(root, "资源", "红宝书", "27红宝书词汇表（正序+乱序+默写）", "2027考研英语红宝书（正序版）中文词表.pdf"),
  path.join(root, "资源", "27红宝书单词正序版.pdf"),
];
const rangeLetterIndexes = await Promise.all(
  [..."abcdefghijklmnopqrstuvwxyz"].map(async (letter) => {
    const raw = await readFile(
      path.join(dataDirectory, "dictionary", "ranges", `${letter}.json`),
    );
    return { letter, bytes: raw.byteLength, index: JSON.parse(raw.toString("utf8")) };
  }),
);
const audioSourcePaths = [...new Set(
  (audioIndex.metadata?.files ?? [])
    .map((item) => item.source)
    .filter((item) => typeof item === "string")
    .map((item) => path.resolve(root, item)),
)];
const ecdictSourcePath = path.resolve(
  process.env.ECDICT_SOURCE ?? path.join(root, "tmp", "ecdict.csv"),
);
const whisperModelPaths = (process.env.WHISPER_MODEL_PATHS ?? "")
  .split(path.delimiter)
  .map((item) => item.trim())
  .filter(Boolean)
  .map((item) => path.resolve(item));

const rangeSizes = rangeLetterIndexes
  .flatMap((item) => Object.values(item.index.ranges ?? {}))
  .flat()
  .map((range) => Number(range[2]) - Number(range[1]) + 1)
  .filter((size) => Number.isFinite(size) && size >= 0);
const audioEvidence = process.env.DATA_REPORT_SKIP_AUDIO_HASH === "1"
  ? audioSourcePaths.map((filePath) => ({
      path: path.relative(root, filePath).replaceAll("\\", "/"),
      available: existsSync(filePath),
      sha256: null,
      skipped: true,
    }))
  : await Promise.all(audioSourcePaths.map(fileEvidence));
const alignmentModels = [...new Set(
  (audioIndex.metadata?.files ?? [])
    .map((item) => item.alignment)
    .filter((item) => typeof item === "string" && item),
)];
const whisperEvidence = await modelDeclarations(audioIndex, audioRemap);
const recordedWhisperModels = provenance.whisper?.models ?? [];
const whisperModelFiles = await Promise.all(
  whisperModelPaths.map(async (filePath, index) => {
    const evidence = await fileEvidence(filePath);
    const recorded = recordedWhisperModels[index];
    return {
      ...evidence,
      model: recorded?.name ?? null,
      revision: recorded?.revision ?? null,
      recordedSha256: recorded?.sha256 ?? null,
      matchesRecorded: recorded?.sha256
        ? evidence.sha256 === recorded.sha256
        : null,
    };
  }),
);
const ecdictSourceEvidence = await fileEvidence(ecdictSourcePath);
const ffmpegPath = process.env.FFMPEG_PATH
  ? path.resolve(process.env.FFMPEG_PATH)
  : null;
const ffmpegFileEvidence = ffmpegPath
  ? await fileEvidence(ffmpegPath)
  : null;
const ffmpegVersion = commandVersion(ffmpegPath ?? "ffmpeg", ["-version"]);
const provenanceEvidence = await fileEvidence(provenancePath);
const liveProvenanceVerification = {
  ecdictSource: ecdictSourceEvidence.sha256
    === provenance.ecdict?.sourceSha256,
  ffmpegBinary: ffmpegFileEvidence?.sha256
    === provenance.ffmpeg?.binarySha256,
  whisperModels: whisperModelFiles.length === recordedWhisperModels.length
    && whisperModelFiles.every((item) => item.matchesRecorded),
};

const report = {
  format: "wordloop-data-build-report-v2",
  generatedAt: reportTimestamp(),
  sourceDateEpoch: process.env.SOURCE_DATE_EPOCH ?? null,
  contentVersion: manifest.contentVersion,
  provenance: {
    ...provenanceEvidence,
    version: provenance.version,
    verifiedAt: provenance.verifiedAt,
    liveVerification: {
      ...liveProvenanceVerification,
      complete: Object.values(liveProvenanceVerification).every(Boolean),
    },
  },
  reproducibility: {
    contentFilesContainRealtimeBuildTimestamp: false,
    manifestTimestampExcludedFromContentVersion: true,
    sourceDateEpochSupported: true,
  },
  upstream: {
    ecdict: {
      repository: "https://github.com/skywind3000/ECDICT",
      commit: process.env.ECDICT_UPSTREAM_COMMIT
        ?? dictionaryMetadata.upstreamCommit
        ?? provenance.ecdict?.commit
        ?? null,
      source: {
        ...ecdictSourceEvidence,
        recordedSha256: dictionaryMetadata.sourceSha256
          ?? provenance.ecdict?.sourceSha256
          ?? null,
        matchesRecorded: ecdictSourceEvidence.sha256
          ? ecdictSourceEvidence.sha256 === (
              dictionaryMetadata.sourceSha256
                ?? provenance.ecdict?.sourceSha256
            )
          : null,
      },
      verification: provenance.ecdict?.verification ?? null,
    },
    redbook: {
      edition: redbook.metadata?.title ?? "2027考研英语红宝书",
      sources: await Promise.all(redbookSourcePaths.map(fileEvidence)),
    },
    audio: {
      scope: audioIndex.metadata?.scope ?? "unknown",
      sourceFileCount: audioSourcePaths.length,
      sources: audioEvidence,
    },
  },
  tools: {
    node: process.version,
    ffmpeg: ffmpegVersion ?? provenance.ffmpeg?.version ?? null,
    ffmpegEvidence: {
      binarySha256: ffmpegFileEvidence?.sha256
        ?? provenance.ffmpeg?.binarySha256
        ?? null,
      recordedSha256: provenance.ffmpeg?.binarySha256 ?? null,
      matchesRecorded: ffmpegFileEvidence?.sha256
        ? ffmpegFileEvidence.sha256 === provenance.ffmpeg?.binarySha256
        : null,
      bytes: provenance.ffmpeg?.bytes ?? null,
      verification: provenance.ffmpeg?.verification ?? null,
    },
    pdftotext: commandVersion("pdftotext", ["-v"]),
    whisper: {
      alignments: alignmentModels,
      declaredModels: whisperEvidence.declaredModels,
      modelRevision: process.env.WHISPER_MODEL_REVISION ?? null,
      modelSnapshots: recordedWhisperModels,
      verification: provenance.whisper?.verification ?? null,
      validationReports: whisperEvidence.validationReports,
      modelFiles: whisperModelFiles,
      modelHashesComplete: whisperEvidence.declaredModels.length > 0
        && whisperEvidence.declaredModels.every((declaration) =>
          recordedWhisperModels.some((model) =>
            model.name === declaration.name
            && /^[a-f0-9]{40}$/.test(model.revision)
            && /^[a-f0-9]{64}$/.test(model.sha256))),
    },
  },
  coverage: {
    redbookEntries: redbook.metadata?.total ?? redbook.words?.length ?? 0,
    audioIndexedWords: audioIndex.metadata?.indexedWordCount ?? 0,
    audioFallbackWords: audioIndex.metadata?.validation?.fallbackWordCount ?? 0,
    phonetics: phoneticMetadata.coverage,
  },
  rangeIndex: {
    version: rangeIndex.version,
    prefixLength: rangeIndex.prefixLength,
    rootBytes: Buffer.byteLength(JSON.stringify(rangeIndex)),
    letterIndexCount: rangeLetterIndexes.length,
    averageLetterIndexBytes: Math.round(
      rangeLetterIndexes.reduce((sum, item) => sum + item.bytes, 0)
        / rangeLetterIndexes.length,
    ),
    maximumLetterIndexBytes: Math.max(
      ...rangeLetterIndexes.map((item) => item.bytes),
    ),
    rangeCount: rangeSizes.length,
    averageFragmentBytes: rangeSizes.length
      ? Math.round(rangeSizes.reduce((sum, size) => sum + size, 0) / rangeSizes.length)
      : 0,
    maximumFragmentBytes: Math.max(0, ...rangeSizes),
    shardHashes: rangeIndex.shardHashes,
    rangeIndexHashes: rangeIndex.rangeIndexHashes,
  },
  assets: manifest.assets,
};

await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`数据构建报告完成：${reportPath}`);
