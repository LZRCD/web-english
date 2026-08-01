import { spawnSync } from "node:child_process";
import {
  link,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  applyAudioRemap,
  buildRuntimeAudioIndex,
} from "./audio-remap.mjs";

const root = process.cwd();
const sourceRoot = path.join(
  root,
  "资源",
  "红宝书",
  "27红宝书PDF（全套）",
  "27《红宝书》配套音频",
);
const publicRoot = path.join(root, "public", "audio", "redbook");
const indexPath = path.join(root, "public", "data", "audio-index.json");
const runtimeIndexPath = path.join(
  root,
  "public",
  "data",
  "audio-runtime-index.json",
);
const remapPath = path.join(root, "public", "data", "audio-remap.json");
const redbookPath = path.join(root, "public", "data", "redbook.json");
const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null";

function round(value) {
  return Math.round(value * 1000) / 1000;
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  }));
  return nested.flat();
}

async function resolveFfmpeg() {
  const candidates = [process.env.FFMPEG_PATH, "ffmpeg"].filter(Boolean);
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["-version"], { encoding: "utf8" });
    if (!result.error && result.status === 0) return candidate;
  }
  if (process.platform !== "win32" || !process.env.LOCALAPPDATA) {
    throw new Error("找不到 FFmpeg，请安装或设置 FFMPEG_PATH");
  }
  const packages = path.join(
    process.env.LOCALAPPDATA,
    "Microsoft",
    "WinGet",
    "Packages",
  );
  const matches = (await walk(packages)).filter((file) =>
    /Gyan\.FFmpeg.*[\\/]bin[\\/]ffmpeg\.exe$/i.test(file)
  );
  if (!matches.length) throw new Error("找不到 FFmpeg，请安装或设置 FFMPEG_PATH");
  return matches.sort().at(-1);
}

function describeAudio(sourcePath) {
  const filename = path.basename(sourcePath);
  const extension = path.extname(filename).toLowerCase();
  const unitMatch = filename.match(/(必考词|基础词)Unit\s*(\d+)/i);
  if (unitMatch) {
    const section = unitMatch[1];
    const unit = Number(unitMatch[2]);
    const prefix = section === "必考词" ? "required" : "basic";
    return {
      section,
      units: [String(unit)],
      publicName: `${prefix}-unit-${String(unit).padStart(2, "0")}${extension}`,
    };
  }
  const rangeMatch = filename.match(/超纲词([A-Z])(?:-([A-Z]))?/i);
  if (!rangeMatch) throw new Error(`无法识别音频文件：${filename}`);
  const start = rangeMatch[1].toUpperCase();
  const end = (rangeMatch[2] || start).toUpperCase();
  const units = [];
  for (
    let code = start.charCodeAt(0);
    code <= end.charCodeAt(0);
    code += 1
  ) {
    units.push(String.fromCharCode(code));
  }
  return {
    section: "超纲词",
    units,
    publicName: `extra-${start.toLowerCase()}-${end.toLowerCase()}${extension}`,
  };
}

function detectSilences(ffmpeg, sourcePath) {
  const result = spawnSync(
    ffmpeg,
    [
      "-hide_banner",
      "-nostats",
      "-i",
      sourcePath,
      "-af",
      "silencedetect=noise=-35dB:d=0.10",
      "-f",
      "null",
      nullDevice,
    ],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr || `FFmpeg 退出码 ${result.status}`);
  }
  return [...result.stderr.matchAll(
    /silence_end: ([0-9.]+) \| silence_duration: ([0-9.]+)/g,
  )].map((match) => {
    const end = Number(match[1]);
    const duration = Number(match[2]);
    return { start: end - duration, end, duration };
  });
}

function chooseSegments(silences, wordCount) {
  let firstCandidate;
  let bestCandidate;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const acceptedSilenceDuration of [1, 0.9, 0.8, 0.5, 0.2, 0.15]) {
    const accepted = silences.filter(
      (silence) => silence.duration >= acceptedSilenceDuration,
    );
    const voiced = accepted.slice(0, -1).map((left, index) => {
      const right = accepted[index + 1];
      const midpointStart = (left.start + left.end) / 2;
      const midpointEnd = (right.start + right.end) / 2;
      return {
        start: Math.max(midpointStart, left.end - 0.25),
        end: Math.min(midpointEnd, right.start + 0.25),
        rawDuration: midpointEnd - midpointStart,
      };
    });
    if (voiced.length >= wordCount) {
      const candidate = {
        acceptedSilenceDuration,
        discardedIntroSegments: voiced.length - wordCount,
        segments: voiced.slice(-wordCount),
      };
      firstCandidate ??= candidate;
      const usable = candidate.segments.filter((segment) =>
        segment.rawDuration <= 10
      );
      const durations = usable.map((segment) => segment.end - segment.start);
      const minimum = Math.min(...durations);
      const maximum = Math.max(...durations);
      const score = maximum + Math.max(0, 0.6 - minimum) * 10;
      if (score < bestScore) {
        bestCandidate = candidate;
        bestScore = score;
      }
      if (
        minimum >= 0.6
        && maximum <= 3.8
      ) return candidate;
    }
  }
  return bestCandidate ?? firstCandidate;
}

async function ensurePublicAudioLink(sourcePath, publicPath) {
  await mkdir(path.dirname(publicPath), { recursive: true });
  try {
    const [source, target] = await Promise.all([stat(sourcePath), stat(publicPath)]);
    if (source.size !== target.size) {
      throw new Error(`音频入口与原文件大小不一致：${publicPath}`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await link(sourcePath, publicPath);
  }
}

const ffmpeg = await resolveFfmpeg();
const redbook = JSON.parse(await readFile(redbookPath, "utf8"));
const sourcePaths = (await walk(sourceRoot))
  .filter((file) => /\.(?:mp3|mp4)$/i.test(file))
  .sort((left, right) => left.localeCompare(right, "zh-CN", { numeric: true }));

if (sourcePaths.length !== 66) {
  throw new Error(`应有 66 个音频文件，实际找到 ${sourcePaths.length} 个`);
}

const entries = {};
const files = [];
for (const [filePosition, sourcePath] of sourcePaths.entries()) {
  const description = describeAudio(sourcePath);
  const words = redbook.words.filter((word) =>
    word.section === description.section
    && description.units.includes(String(word.unit))
  );
  const publicPath = path.join(publicRoot, description.publicName);
  const publicFile = `/audio/redbook/${description.publicName}`;
  const silences = detectSilences(ffmpeg, sourcePath);
  const selection = chooseSegments(silences, words.length);
  if (!selection) {
    files.push({
      source: path.relative(root, sourcePath).replaceAll("\\", "/"),
      file: publicFile,
      section: description.section,
      units: description.units,
      wordCount: words.length,
      indexedWordCount: 0,
      confidence: "low",
      needsReview: true,
      issue: "可用语音段少于词数，保留 TTS 回退",
    });
    console.log(`[${filePosition + 1}/66] 需复核 ${path.basename(sourcePath)}`);
    continue;
  }

  const isAsrAlignedUnit15 = publicFile === "/audio/redbook/required-unit-15.mp3"
    && selection.segments.length === words.length;
  const alignedSegments = isAsrAlignedUnit15
    ? selection.segments.slice(6)
    : selection.segments;
  const durations = alignedSegments.map((segment) => segment.end - segment.start);
  const abnormalIndices = alignedSegments
    .map((segment, index) => segment.rawDuration > 10 ? index : -1)
    .filter((index) => index >= 0);
  const confirmedInterstitial = path.extname(sourcePath).toLowerCase() === ".mp4"
    && abnormalIndices.length === 2
    && abnormalIndices.every((index) =>
      selection.segments[index].rawDuration <= 20
    );
  const usableDurations = durations.filter((_, index) =>
    !confirmedInterstitial || !abnormalIndices.includes(index)
  );
  const minimum = Math.min(...usableDurations);
  const maximum = Math.max(...usableDurations);
  const average = usableDurations.reduce((total, duration) => total + duration, 0)
    / usableDurations.length;
  const needsReview = minimum < 0.6
    || maximum > 3.8
    || average < 0.8
    || average > 2.5;
  const shouldIndex = !needsReview;
  const requiresManualReview = needsReview;
  const confidence = needsReview
    ? "low"
    : selection.acceptedSilenceDuration === 1 && selection.discardedIntroSegments <= 8
      ? "high"
      : "medium";
  const indexedConfidence = isAsrAlignedUnit15 ? "medium" : confidence;

  if (shouldIndex) {
    await ensurePublicAudioLink(sourcePath, publicPath);
    alignedSegments.forEach((segment, index) => {
      if (confirmedInterstitial && abnormalIndices.includes(index)) return;
      const word = words[index];
      entries[String(word.id)] = {
        file: publicFile,
        start: round(segment.start),
        end: round(segment.end),
        confidence: indexedConfidence,
      };
    });
  }
  files.push({
    source: path.relative(root, sourcePath).replaceAll("\\", "/"),
    file: publicFile,
    section: description.section,
    units: description.units,
    wordCount: words.length,
    indexedWordCount: shouldIndex
      ? alignedSegments.length - (confirmedInterstitial ? abnormalIndices.length : 0)
      : 0,
    confidence: indexedConfidence,
    needsReview: requiresManualReview,
    alignment: isAsrAlignedUnit15
      ? "whisper-asr-verified-six-intro-segments-removed"
      : undefined,
    acceptedSilenceDuration: selection.acceptedSilenceDuration,
    discardedIntroSegments: selection.discardedIntroSegments,
    minimumSegmentSeconds: round(minimum),
    maximumSegmentSeconds: round(maximum),
    averageSegmentSeconds: round(average),
    firstWord: words[0]?.word,
    lastWord: words.at(-1)?.word,
    lastIndexedWord: isAsrAlignedUnit15
      ? words[alignedSegments.length - 1]?.word
      : words.at(-1)?.word,
    excludedWords: isAsrAlignedUnit15
      ? words.slice(alignedSegments.length).map((word) => ({
          id: word.id,
          word: word.word,
          reason: "Whisper 整段识别确认原音频未收录该词，使用 TTS 回退",
        }))
      : confirmedInterstitial
      ? abnormalIndices.map((index) => ({
          id: words[index].id,
          word: words[index].word,
          reason: "原 MP4 此处为防倒卖声明，使用 TTS 回退",
        }))
      : [],
  });
  console.log(
    `[${filePosition + 1}/66] ${requiresManualReview ? "需复核" : "通过"} `
    + `${path.basename(sourcePath)}：${words.length} 词`,
  );
}

const indexedWordCount = Object.keys(entries).length;
const needsReview = files.filter((file) => file.needsReview);
const output = {
  metadata: {
    version: 4,
    scope: "2027 红宝书全套配套音频",
    sourceFileCount: sourcePaths.length,
    sourceWordCount: redbook.words.length,
    indexedWordCount,
    silenceDetect: {
      noise: "-35dB",
      minimumDuration: 0.1,
      acceptedSilenceDurationCandidates: [1, 0.9, 0.8, 0.5, 0.2, 0.15],
      strategy: "常规文件按静音切分；Unit 15 由 Whisper 整段识别确认并移除 6 段片头，79 个实录词与词表顺序对齐",
    },
    validation: {
      passedFileCount: files.length - needsReview.length,
      needsReviewFileCount: needsReview.length,
      fallbackWordCount: redbook.words.length - indexedWordCount,
      schema: "audio-validation-v1",
    },
    files,
  },
  entries,
};

try {
  const remap = JSON.parse(await readFile(remapPath, "utf8"));
  applyAudioRemap(output, remap);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

await Promise.all([
  writeFile(indexPath, `${JSON.stringify(output, null, 2)}\n`, "utf8"),
  writeFile(
    runtimeIndexPath,
    `${JSON.stringify(buildRuntimeAudioIndex(output))}\n`,
    "utf8",
  ),
]);
console.log(JSON.stringify({
  sourceFileCount: sourcePaths.length,
  indexedWordCount: output.metadata.indexedWordCount,
  passedFileCount: output.metadata.validation.passedFileCount,
  needsReviewFileCount: needsReview.length,
  fallbackWordCount: output.metadata.validation.fallbackWordCount,
}, null, 2));
