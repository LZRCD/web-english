// scripts/build-datasets-report.mjs
// 生成 tracked 汇总报告（仅计数、比例、版本、哈希与错误分类；
// 不含任何批量私有释义、例句、真题或助记正文）。
import { readFile, writeFile } from "node:fs/promises";

const DATASETS = [
  { name: "sense-frequency", state: ".wordloop-data/sense-frequency/state.json" },
  { name: "sense-examples", state: ".wordloop-data/sense-examples/state.json" },
  { name: "etymology", state: ".wordloop-data/etymology/state.json" },
];

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function collect(dataset) {
  const manifest = await readJson(`public/data/${dataset.name}/manifest.json`);
  const state = await readJson(dataset.state);

  // 错误分类：从发布 shard 收集 reasonCode 前缀分布（不携带正文）
  const reasonCodes = new Map();
  if (manifest?.releases) {
    for (const filename of Object.values(manifest.releases)) {
      const shard = await readJson(`public/data/${dataset.name}/${filename}`);
      for (const entry of shard?.entries ?? []) {
        const records = dataset.name === "etymology"
          ? [entry.record]
          : entry.records ?? [];
        for (const record of records) {
          if (!record) continue;
          for (const reason of record.reasonCodes ?? []) {
            const normalized = String(reason).replace(/[:：].*$/, "");
            reasonCodes.set(normalized, (reasonCodes.get(normalized) ?? 0) + 1);
          }
        }
      }
    }
  }

  return {
    dataset: dataset.name,
    contentVersion: manifest?.contentVersion ?? null,
    schemaVersion: manifest?.schemaVersion ?? null,
    promptVersion: manifest?.promptVersion ?? null,
    methodVersion: manifest?.methodVersion ?? null,
    modelId: manifest?.modelId ?? null,
    provider: manifest?.provider ?? null,
    inputDataHash: manifest?.inputDataHash ?? null,
    generatedAt: manifest?.generatedAt ?? null,
    counts: manifest?.counts ?? null,
    run: state?.stats
      ? {
          startedAt: state.stats.startedAt,
          updatedAt: state.stats.updatedAt,
          finished: state.stats.finished,
          totalItems: state.stats.totalItems,
          completedItems: state.stats.completedItems,
          failedItems: state.stats.failedItems,
          modelCalls: state.stats.calls,
          promptTokens: state.stats.promptTokens,
          completionTokens: state.stats.completionTokens,
        }
      : null,
    stillFailed: state?.failed ? Object.keys(state.failed).length : null,
    reasonCodes: Object.fromEntries(
      [...reasonCodes.entries()].sort((a, b) => b[1] - a[1]),
    ),
    failureMessages: state?.failed
      ? Object.values(state.failed).slice(0, 20).map((item) => item.message)
      : [],
  };
}

async function main() {
  const reports = [];
  for (const dataset of DATASETS) {
    reports.push(await collect(dataset));
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    datasets: reports,
  };
  await writeFile(
    "reports/private-datasets-report.json",
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  );
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
