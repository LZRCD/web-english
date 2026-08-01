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
const shardBody = await readFile(
  path.join(root, "public", "data", "dictionary", "e.json"),
  "utf8",
);
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

async function writeReportFiles(report) {
  await mkdir(outputDirectory, { recursive: true });
  const safeBuild = String(report.build.appBuildId).replace(/[^a-z0-9_.-]/gi, "-");
  const reportDate = String(report.generatedAt).slice(0, 10);
  const datedPath = path.join(
    outputDirectory,
    `performance-baseline-${safeBuild}-${reportDate}.json`,
  );
  const latestPath = path.join(outputDirectory, "performance-baseline.json");
  const raw = `${JSON.stringify(report, null, 2)}\n`;
  await Promise.all([
    writeFile(datedPath, raw, "utf8"),
    writeFile(latestPath, raw, "utf8"),
  ]);
  return latestPath;
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
  const latestPath = await writeReportFiles(report);
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
    // 性能样本通过 requestIdleCallback 批量落盘；等待其 2 秒兜底超时。
    await page.waitForTimeout(2_200);
    const diagnostics = await page.evaluate(() => JSON.parse(
      localStorage.getItem("wordloop-performance-v1")
        ?? '{"samples":[],"baselines":[]}',
    ));
    allSamples.push(...(diagnostics.samples ?? []).map((sample) => ({
      ...sample,
      benchmarkRound: round + 1,
      benchmarkScenario: scenario,
    })));
    await context.close();
    process.stdout.write(
      `\r性能基线 ${round + 1}/${rounds} · Range ${scenario}   `,
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
  environment: {
    browserChannel: channel,
    browserVersion,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpu: os.cpus()[0]?.model ?? "unknown",
    logicalCpuCount: os.cpus().length,
    memoryBytes: os.totalmem(),
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

const latestPath = await writeReportFiles(report);
console.log(`性能基线完成：${allSamples.length} 个样本 -> ${latestPath}`);
