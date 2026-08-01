import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  createState,
  RADIATE_ENRICHMENT,
  STORAGE_KEY,
} from "../tests/e2e/fixtures.mjs";
import {
  buildRangeDecision,
  compareBaselineReports,
  lookupTraceRatios,
  summarize,
} from "./performance-baseline-analysis.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseURL = process.env.PERF_BASE_URL ?? "http://127.0.0.1:3000";
const rounds = Math.min(50, Math.max(1, Number(process.env.PERF_ROUNDS) || 30));
const channel = process.env.PERF_BROWSER_CHANNEL ?? "chrome";
const outputDirectory = path.resolve(
  process.env.PERF_OUTPUT_DIR ?? path.join(root, "reports"),
);
const runLabel = process.env.PERF_RUN_LABEL?.trim() || "baseline";
const serverMode = process.env.PERF_SERVER_MODE?.trim() || "unknown";
const networkProfile = process.env.PERF_NETWORK_PROFILE?.trim() || "normal";
const comparisonInput = process.env.PERF_COMPARE_TO
  ? path.resolve(process.env.PERF_COMPARE_TO)
  : null;
const networkProfiles = {
  normal: {
    description: "不施加网络限制",
    latencyMs: 0,
    downloadBytesPerSecond: -1,
    uploadBytesPerSecond: -1,
    prewarmHttpCache: false,
  },
  "high-latency": {
    description: "250ms 往返延迟，不限制吞吐量",
    latencyMs: 250,
    downloadBytesPerSecond: -1,
    uploadBytesPerSecond: -1,
    prewarmHttpCache: false,
  },
  "slow-network": {
    description: "150ms 延迟，下载 10Mbps、上传 2Mbps",
    latencyMs: 150,
    downloadBytesPerSecond: 1_250_000,
    uploadBytesPerSecond: 250_000,
    prewarmHttpCache: false,
  },
  "cache-hit": {
    description: "预热应用、音频与目标词典资源后复核",
    latencyMs: 0,
    downloadBytesPerSecond: -1,
    uploadBytesPerSecond: -1,
    prewarmHttpCache: true,
  },
};
const selectedNetworkProfile = networkProfiles[networkProfile];
if (!selectedNetworkProfile) {
  throw new Error(
    `未知 PERF_NETWORK_PROFILE=${networkProfile}；可用值：${Object.keys(networkProfiles).join(", ")}`,
  );
}
const shardBody = await readFile(
  path.join(root, "public", "data", "dictionary", "e.json"),
  "utf8",
);
const rangeRoot = JSON.parse(await readFile(
  path.join(root, "public", "data", "dictionary", "ranges.json"),
  "utf8",
));
const rangeLetter = JSON.parse(await readFile(
  path.join(root, "public", "data", "dictionary", "ranges", "e.json"),
  "utf8",
));
const scenarios = ["206", "200", "corrupt", "network"];

async function seedContext(context) {
  await context.addInitScript(({ state, storageKey }) => {
    if (!["http:", "https:"].includes(location.protocol)) return;
    if (localStorage.getItem("wordloop-perf-seeded") === "1") return;
    localStorage.setItem(storageKey, JSON.stringify(state));
    localStorage.setItem("wordloop-perf-seeded", "1");
  }, {
    state: createState({ enrichments: RADIATE_ENRICHMENT }),
    storageKey: STORAGE_KEY,
  });
}

async function selectElucidator(page) {
  const sentence = page.getByText(
    "A careful elucidator radiated light onto the old diagram.",
    { exact: true },
  );
  await sentence.evaluate((element) => {
    const textNode = element.firstChild;
    const text = textNode?.textContent ?? "";
    const start = text.indexOf("elucidator");
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, start + "elucidator".length);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
}

async function applyNetworkProfile(context, page) {
  const session = await context.newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: selectedNetworkProfile.latencyMs,
    downloadThroughput: selectedNetworkProfile.downloadBytesPerSecond,
    uploadThroughput: selectedNetworkProfile.uploadBytesPerSecond,
    connectionType: networkProfile === "slow-network" ? "cellular4g" : "other",
  });
  return session;
}

async function prewarmResources(page) {
  await page.goto(baseURL, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "显示单词释义" }).waitFor();
  const range = rangeLetter.ranges?.elu?.[0];
  const letterFile = rangeRoot.rangeIndexFiles?.e;
  const shardFile = rangeRoot.releaseFiles?.e;
  if (!range || !letterFile || !shardFile) {
    throw new Error("无法定位 elucidator 的缓存预热资源");
  }
  await page.evaluate(async ({ letterUrl, shardUrl, start, end }) => {
    await Promise.all([
      fetch(letterUrl).then((response) => response.arrayBuffer()),
      fetch(shardUrl, {
        headers: { Range: `bytes=${start}-${end}` },
      }).then((response) => response.arrayBuffer()),
    ]);
  }, {
    letterUrl: `/data/dictionary/ranges/${letterFile}.json`,
    shardUrl: `/data/dictionary/${shardFile}.json`,
    start: range[1],
    end: range[2],
  });
  // 首页会自动预加载当前词音频；留出短暂时间让缓存写入完成。
  await page.waitForTimeout(500);
}

function cacheStateFor(sample) {
  if (selectedNetworkProfile.prewarmHttpCache) return "prewarmed-http-cache";
  return sample.runMode === "warm" ? "same-context-cache" : "cold-context";
}

function safeName(value) {
  return String(value).replace(/[^a-z0-9_.-]/gi, "-");
}

async function writeReportFiles(report) {
  await mkdir(outputDirectory, { recursive: true });
  const safeBuild = safeName(report.build.appBuildId);
  const safeRunLabel = safeName(report.run?.label ?? "baseline");
  const reportTimestamp = String(report.generatedAt)
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  const datedPath = path.join(
    outputDirectory,
    `performance-baseline-${safeBuild}-${safeRunLabel}-${reportTimestamp}.json`,
  );
  const latestPath = path.join(
    outputDirectory,
    safeRunLabel === "baseline"
      ? "performance-baseline.json"
      : `performance-baseline-${safeRunLabel}.json`,
  );
  const raw = `${JSON.stringify(report, null, 2)}\n`;
  await Promise.all([
    writeFile(datedPath, raw, "utf8"),
    writeFile(latestPath, raw, "utf8"),
  ]);
  return latestPath;
}

async function loadComparisonReport() {
  if (!comparisonInput) return null;
  try {
    return JSON.parse(await readFile(comparisonInput, "utf8"));
  } catch (error) {
    throw new Error(
      `无法读取 PERF_COMPARE_TO=${comparisonInput}：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function formatChange(value, ratio) {
  const milliseconds = `${value >= 0 ? "+" : ""}${value.toFixed(1)}ms`;
  const percentage = ratio === null
    ? "n/a"
    : `${ratio >= 0 ? "+" : ""}${(ratio * 100).toFixed(1)}%`;
  return `${milliseconds} (${percentage})`;
}

function printComparison(comparison) {
  if (!comparison) return;
  console.log(
    `跨版本对照：${comparison.matchedSummaryCount} 组指标，${comparison.warningCount} 组超过告警门槛`,
  );
  const highlighted = comparison.changes.filter((item) =>
    [
      "state.restore.total:runMode=cold",
      "state.restore.total:runMode=warm",
      "lookup.total:lookupMode=first",
      "lookup.total:lookupMode=repeat",
      "audio.play.start:source=recorded",
      "audio.preload.ready:runMode=cold",
      "audio.preload.ready:runMode=warm",
    ].includes(`${item.metric}:${item.variantKey}`));
  for (const item of highlighted) {
    console.log(
      `  ${item.metric} [${item.variantKey}] · P50 ${formatChange(item.p50ChangeMs, item.p50ChangeRatio)} · P95 ${formatChange(item.p95ChangeMs, item.p95ChangeRatio)} · 告警=${item.exceedsWarningThreshold ? "是" : "否"}`,
    );
  }
}

if (process.argv.includes("--reanalyze")) {
  const inputIndex = process.argv.indexOf("--input");
  const inputPath = path.resolve(
    inputIndex >= 0 && process.argv[inputIndex + 1]
      ? process.argv[inputIndex + 1]
      : path.join(outputDirectory, "performance-baseline.json"),
  );
  const report = JSON.parse(await readFile(inputPath, "utf8"));
  const traceRatios = lookupTraceRatios(report.samples ?? []);
  report.summaries = summarize(report.samples ?? []);
  report.lookupTraceRatios = traceRatios;
  report.rangeDecision = buildRangeDecision(traceRatios);
  report.reanalyzedAt = new Date().toISOString();
  const previous = await loadComparisonReport();
  report.comparison = previous
    ? compareBaselineReports(report, previous)
    : report.comparison ?? null;
  const latestPath = await writeReportFiles(report);
  printComparison(report.comparison);
  console.log(`性能基线重算完成：${traceRatios.length} 条查词 trace -> ${latestPath}`);
  process.exit(0);
}

const healthController = new AbortController();
const healthTimeout = setTimeout(() => healthController.abort(), 5_000);
try {
  const response = await fetch(baseURL, { signal: healthController.signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
} catch (error) {
  throw new Error(
    `性能基线需要固定端口 3000 上已有可用服务（${baseURL}）：${
      error instanceof Error ? error.message : String(error)
    }`,
  );
} finally {
  clearTimeout(healthTimeout);
}

const browser = await chromium.launch({ channel, headless: true });
const browserVersion = browser.version();
const allSamples = [];
try {
  for (let round = 0; round < rounds; round += 1) {
    const scenario = scenarios[round % scenarios.length];
    const context = await browser.newContext();
    await seedContext(context);
    const page = await context.newPage();
    await applyNetworkProfile(context, page);
    if (selectedNetworkProfile.prewarmHttpCache) await prewarmResources(page);
    let interrupted = false;
    if (scenario !== "206") {
      await page.route("**/data/dictionary/e*.json*", async (route) => {
        const range = route.request().headers().range;
        if (scenario === "network" && range && !interrupted) {
          interrupted = true;
          await route.abort("connectionreset");
          return;
        }
        if (scenario === "corrupt" && range) {
          const match = range.match(/bytes=(\d+)-(\d+)/);
          const requestedBytes = Number(match?.[2]) - Number(match?.[1]) + 1;
          await route.fulfill({
            status: 206,
            contentType: "application/json",
            headers: {
              "Content-Range": `bytes ${match?.[1] ?? 0}-${match?.[2] ?? 0}/${Buffer.byteLength(shardBody)}`,
            },
            body: '"elucidator":['.padEnd(requestedBytes, " "),
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: shardBody,
        });
      });
    }

    const benchmarkStartedAt = new Date().toISOString();
    await page.goto(baseURL, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "显示单词释义" }).waitFor();
    await page.getByRole("button", { name: "显示单词释义" }).click();
    await selectElucidator(page);
    const popup = page.getByRole("dialog", { name: "划词查询：elucidator" });
    await popup.getByRole("button", { name: "翻译" }).click();
    await popup.getByText("已加入划词集").waitFor();
    await popup.getByRole("button", { name: "关闭划词查询" }).click();
    await selectElucidator(page);
    await popup.getByText("已加入划词集").waitFor();

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "显示单词释义" }).waitFor();
    await page.getByRole("button", { name: /播放 radiate 的发音/ }).click();
    // 性能样本通过 requestIdleCallback 批量落盘；等待其 2 秒兜底超时。
    await page.waitForTimeout(2_200);
    const diagnostics = await page.evaluate(() => JSON.parse(
      localStorage.getItem("wordloop-performance-v1")
        ?? '{"samples":[],"baselines":[]}',
    ));
    allSamples.push(...(diagnostics.samples ?? [])
      .filter((sample) => !sample.recordedAt || sample.recordedAt >= benchmarkStartedAt)
      .map((sample) => ({
        ...sample,
        benchmarkRound: round + 1,
        benchmarkScenario: scenario,
        benchmarkNetworkProfile: networkProfile,
        benchmarkCacheState: cacheStateFor(sample),
      })));
    await context.close();
    process.stdout.write(
      `\r性能基线 ${round + 1}/${rounds} · ${networkProfile} · Range ${scenario}   `,
    );
  }
} finally {
  await browser.close();
}
process.stdout.write("\n");

const traceRatios = lookupTraceRatios(allSamples);
const report = {
  format: "wordloop-performance-baseline-v1",
  generatedAt: new Date().toISOString(),
  baseURL,
  rounds,
  run: {
    label: runLabel,
    serverMode,
    networkProfile,
    cachePrewarmed: selectedNetworkProfile.prewarmHttpCache,
  },
  environment: {
    browserChannel: channel,
    browserVersion,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpu: os.cpus()[0]?.model ?? "unknown",
    logicalCpuCount: os.cpus().length,
    memoryBytes: os.totalmem(),
    network: selectedNetworkProfile,
  },
  build: {
    appBuildId: allSamples.at(-1)?.appBuildId ?? "unknown",
    dataVersion: allSamples.at(-1)?.dataVersion ?? "unknown",
    diagnosticsSchemaVersion:
      allSamples.at(-1)?.diagnosticsSchemaVersion ?? "unknown",
  },
  summaries: summarize(allSamples),
  lookupTraceRatios: traceRatios,
  rangeDecision: buildRangeDecision(traceRatios),
  samples: allSamples,
};

const previous = await loadComparisonReport();
report.comparison = previous
  ? compareBaselineReports(report, previous)
  : null;

const latestPath = await writeReportFiles(report);
printComparison(report.comparison);
console.log(`性能基线完成：${allSamples.length} 个样本 -> ${latestPath}`);
