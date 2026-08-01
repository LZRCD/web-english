import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchDictionaryRangeWithFallback,
} from "../lib/dictionary-range.ts";
import {
  PERFORMANCE_DIAGNOSTICS_SCHEMA_VERSION,
  mergePerformanceDiagnosticStores,
  performanceRegressionWarnings,
  summarizePerformanceSamples,
  summarizePerformanceVariants,
  type PerformanceBaseline,
  type PerformanceSample,
} from "../lib/performance-diagnostics.ts";
import { APP_BUILD_ID } from "../lib/build-info.generated.ts";
import {
  DATA_CONTENT_VERSION,
  versionedDataUrl,
} from "../lib/data-version.ts";

function sample(
  metric: string,
  durationMs: number,
  outcome: PerformanceSample["outcome"] = "ok",
): PerformanceSample {
  return {
    id: `${metric}-${durationMs}-${outcome}`,
    metric,
    durationMs,
    recordedAt: "2026-08-01T00:00:00.000Z",
    dataVersion: DATA_CONTENT_VERSION,
    appBuildId: APP_BUILD_ID,
    diagnosticsSchemaVersion: PERFORMANCE_DIAGNOSTICS_SCHEMA_VERSION,
    runtimeMode: "test",
    browser: "node",
    runMode: "cold",
    outcome,
    tags: {},
  };
}

test("性能样本生成 P50/P95 并单独统计失败", () => {
  const samples = [
    ...Array.from({ length: 20 }, (_, index) =>
      sample("lookup.total", (index + 1) * 10)),
    sample("lookup.total", 999, "error"),
  ];
  const [summary] = summarizePerformanceSamples(samples);

  assert.equal(summary.metric, "lookup.total");
  assert.equal(summary.count, 20);
  assert.equal(summary.errorCount, 1);
  assert.equal(summary.p50, 100);
  assert.equal(summary.p95, 190);
  assert.equal(summary.last, 200);
});

test("运行时数据 URL 携带内容哈希版本", () => {
  assert.match(
    versionedDataUrl("/data/dictionary/i.json"),
    /^\/data\/dictionary\/i\.json\?v=[a-f0-9]{16}$/,
  );
  assert.equal(versionedDataUrl("/not-versioned.json"), "/not-versioned.json");
});

test("性能回归只告警样本充分且 P95 同时超过比例和绝对阈值", () => {
  const baseline: PerformanceBaseline = {
    id: "baseline",
    label: "基线",
    createdAt: "2026-08-01T00:00:00.000Z",
    dataVersion: DATA_CONTENT_VERSION,
    appBuildId: APP_BUILD_ID,
    diagnosticsSchemaVersion: PERFORMANCE_DIAGNOSTICS_SCHEMA_VERSION,
    environment: {
      appBuildId: APP_BUILD_ID,
      diagnosticsSchemaVersion: PERFORMANCE_DIAGNOSTICS_SCHEMA_VERSION,
      runtimeMode: "test",
      browser: "node",
    },
    summaries: [{
      metric: "lookup.total",
      variantKey: "",
      variant: {},
      count: 20,
      errorCount: 0,
      p50: 60,
      p95: 100,
      last: 80,
    }],
  };
  const current = [{
    metric: "lookup.total",
    variantKey: "",
    variant: {},
    count: 20,
    errorCount: 0,
    p50: 70,
    p95: 135,
    last: 90,
  }];

  assert.deepEqual(performanceRegressionWarnings(current, baseline), [{
    metric: "lookup.total",
    variant: {},
    previousP95: 100,
    currentP95: 135,
  }]);
});

test("性能基线按首次与重复查词变体独立汇总", () => {
  const samples = [
    ...Array.from({ length: 5 }, (_, index) => ({
      ...sample("lookup.total", 100 + index),
      tags: { lookupMode: "first" },
    })),
    ...Array.from({ length: 5 }, (_, index) => ({
      ...sample("lookup.total", 20 + index),
      tags: { lookupMode: "repeat" },
    })),
  ];
  const summaries = summarizePerformanceVariants(samples);

  assert.equal(
    summaries.find((item) => item.variantKey === "lookupMode=first")?.count,
    5,
  );
  assert.equal(
    summaries.find((item) => item.variantKey === "lookupMode=repeat")?.p95,
    24,
  );
});

test("跨标签页合并不会恢复清空前的性能样本", () => {
  const oldSample = sample("lookup.total", 120);
  const clearedAt = "2026-08-01T00:00:01.000Z";
  const newSample = {
    ...sample("lookup.total", 80),
    id: "new-sample",
    recordedAt: "2026-08-01T00:00:02.000Z",
  };
  const merged = mergePerformanceDiagnosticStores(
    { version: 2, samples: [oldSample], baselines: [] },
    { version: 2, samplesClearedAt: clearedAt, samples: [newSample], baselines: [] },
  );

  assert.equal(merged.samplesClearedAt, clearedAt);
  assert.deepEqual(merged.samples.map((item) => item.id), ["new-sample"]);
});

test("Range 206 片段可直接解析", async () => {
  let requestedRange = "";
  const body = '"intensive":["intensive","in\'tensiv","密集的"]';
  const end = 9 + new TextEncoder().encode(body).byteLength;
  const result = await fetchDictionaryRangeWithFallback({
    url: "https://example.test/i.json",
    start: 10,
    end,
    fetcher: async (_input, init) => {
      requestedRange = new Headers(init?.headers).get("Range") ?? "";
      return new Response(
        body,
        {
          status: 206,
          headers: { "Content-Range": `bytes 10-${end}/200` },
        },
      );
    },
  });

  assert.equal(requestedRange, `bytes=10-${end}`);
  assert.equal(result.mode, "partial-206");
  assert.equal(result.shard.intensive[0], "intensive");
});

test("服务器忽略 Range 返回 200 时直接采用整分片", async () => {
  let requestCount = 0;
  const result = await fetchDictionaryRangeWithFallback({
    url: "https://example.test/i.json",
    start: 10,
    end: 80,
    fetcher: async () => {
      requestCount += 1;
      return new Response(JSON.stringify({
        intensive: ["intensive", "in'tensiv", "密集的"],
      }), { status: 200 });
    },
  });

  assert.equal(requestCount, 1);
  assert.equal(result.mode, "full-200");
  assert.equal(result.shard.intensive[2], "密集的");
});

test("Range 网络中断时自动请求整分片", async () => {
  let requestCount = 0;
  const result = await fetchDictionaryRangeWithFallback({
    url: "https://example.test/i.json",
    start: 10,
    end: 80,
    fetcher: async () => {
      requestCount += 1;
      if (requestCount === 1) throw new TypeError("network interrupted");
      return new Response(JSON.stringify({
        intensive: ["intensive", "in'tensiv", "密集的"],
      }), { status: 200 });
    },
  });

  assert.equal(requestCount, 2);
  assert.equal(result.mode, "full-fallback");
  assert.equal(result.shard.intensive[0], "intensive");
});

test("Range 片段损坏时自动请求整分片", async () => {
  let requestCount = 0;
  const result = await fetchDictionaryRangeWithFallback({
    url: "https://example.test/i.json",
    start: 10,
    end: 22,
    fetcher: async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return new Response('"intensive":[', {
          status: 206,
          headers: { "Content-Range": "bytes 10-22/200" },
        });
      }
      return new Response(JSON.stringify({
        intensive: ["intensive", "in'tensiv", "密集的"],
      }), { status: 200 });
    },
  });

  assert.equal(requestCount, 2);
  assert.equal(result.mode, "full-fallback");
  assert.equal(result.shard.intensive[2], "密集的");
});

test("Range 206 缺少 Content-Range 时自动回退整分片", async () => {
  let requestCount = 0;
  const result = await fetchDictionaryRangeWithFallback({
    url: "https://example.test/i.json",
    start: 10,
    end: 58,
    fetcher: async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return new Response(
          '"intensive":["intensive","in\'tensiv","密集的"]',
          { status: 206 },
        );
      }
      return new Response(JSON.stringify({
        intensive: ["intensive", "in'tensiv", "密集的"],
      }), { status: 200 });
    },
  });

  assert.equal(requestCount, 2);
  assert.equal(result.mode, "full-fallback");
});

test("Range 响应字节区间不匹配时自动回退整分片", async () => {
  let requestCount = 0;
  const result = await fetchDictionaryRangeWithFallback({
    url: "https://example.test/i.json",
    start: 10,
    end: 58,
    fetcher: async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return new Response(
          '"intensive":["intensive","in\'tensiv","密集的"]',
          {
            status: 206,
            headers: { "Content-Range": "bytes 11-59/200" },
          },
        );
      }
      return new Response(JSON.stringify({
        intensive: ["intensive", "in'tensiv", "密集的"],
      }), { status: 200 });
    },
  });

  assert.equal(requestCount, 2);
  assert.equal(result.mode, "full-fallback");
});

test("Range 总长度小于请求终点时自动回退整分片", async () => {
  let requestCount = 0;
  const result = await fetchDictionaryRangeWithFallback({
    url: "https://example.test/i.json",
    start: 10,
    end: 58,
    fetcher: async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return new Response(
          '"intensive":["intensive","in\'tensiv","密集的"]',
          {
            status: 206,
            headers: { "Content-Range": "bytes 10-58/58" },
          },
        );
      }
      return new Response(JSON.stringify({
        intensive: ["intensive", "in'tensiv", "密集的"],
      }), { status: 200 });
    },
  });

  assert.equal(requestCount, 2);
  assert.equal(result.mode, "full-fallback");
});

test("Range 请求超时后自动回退整分片", async () => {
  let requestCount = 0;
  const result = await fetchDictionaryRangeWithFallback({
    url: "https://example.test/i.json",
    start: 10,
    end: 58,
    rangeTimeoutMs: 5,
    fetcher: async (_input, init) => {
      requestCount += 1;
      if (requestCount === 1) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason), { once: true });
        });
      }
      return new Response(JSON.stringify({
        intensive: ["intensive", "in'tensiv", "密集的"],
      }), { status: 200 });
    },
  });

  assert.equal(requestCount, 2);
  assert.equal(result.mode, "full-fallback");
});
