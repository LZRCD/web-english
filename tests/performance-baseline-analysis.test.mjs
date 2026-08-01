import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRangeDecision,
  lookupTraceRatios,
} from "../scripts/performance-baseline-analysis.mjs";

function sample(traceId, metric, durationMs, options = {}) {
  return {
    traceId,
    metric,
    durationMs,
    outcome: options.outcome ?? "ok",
    runMode: "cold",
    benchmarkScenario: options.scenario ?? "206",
    tags: options.tags ?? {},
  };
}

test("Range trace 包含根索引、字母索引与片段阶段，但单列整分片回退", () => {
  const [ratio] = lookupTraceRatios([
    sample("lookup-1", "lookup.total", 100, {
      tags: { lookupMode: "first" },
    }),
    sample("lookup-1", "dictionary.range_index.download", 10),
    sample("lookup-1", "dictionary.range_index.parse", 2),
    sample("lookup-1", "dictionary.range_letter_index.download", 5),
    sample("lookup-1", "dictionary.range.request", 8),
    sample("lookup-1", "dictionary.range.parse", 1),
    sample("lookup-1", "dictionary.full_shard_fallback.download", 40),
  ]);

  assert.equal(ratio.lookupMode, "first");
  assert.equal(ratio.rangeIndexStrategy, "letter-split");
  assert.equal(ratio.rootIndexDurationMs, 12);
  assert.equal(ratio.letterIndexDurationMs, 5);
  assert.equal(ratio.rangeFragmentDurationMs, 9);
  assert.equal(ratio.rangeDurationMs, 26);
  assert.equal(ratio.fallbackDurationMs, 40);
  assert.equal(ratio.rangeRatio, 0.26);
  assert.equal(ratio.rangeChainRatio, 0.66);
});

test("Range 决策只采用首次查词，重复查词零占比不会稀释结论", () => {
  const ratios = [
    ...Array.from({ length: 30 }, (_, index) => ({
      traceId: `first-${index}`,
      lookupMode: "first",
      benchmarkScenario: "206",
      rangeRatio: 0.25,
    })),
    ...Array.from({ length: 30 }, (_, index) => ({
      traceId: `repeat-${index}`,
      lookupMode: "repeat",
      benchmarkScenario: "206",
      rangeRatio: 0,
    })),
  ];
  const decision = buildRangeDecision(ratios);

  assert.equal(decision.decision, "evaluate-split");
  assert.equal(decision.traceCount, 30);
  assert.equal(decision.allLookupTraceCount, 60);
  assert.equal(decision.ratioP50, 0.25);
});

test("已按首字母拆分时记录监控状态，不重复提出同一拆分", () => {
  const decision = buildRangeDecision(
    Array.from({ length: 30 }, (_, index) => ({
      traceId: `first-${index}`,
      lookupMode: "first",
      benchmarkScenario: "206",
      lookupDurationMs: 20,
      rangeDurationMs: 10,
      rangeRatio: 0.5,
      rangeIndexStrategy: "letter-split",
    })),
  );

  assert.equal(decision.decision, "split-applied-monitor");
  assert.equal(decision.rangeIndexStrategy, "letter-split");
  assert.equal(decision.lookupDurationP50, 20);
  assert.equal(decision.rangeDurationP50, 10);
});

test("Range 决策不足 30 条首次查词时拒绝下结论", () => {
  const decision = buildRangeDecision(
    Array.from({ length: 29 }, (_, index) => ({
      traceId: `first-${index}`,
      lookupMode: "first",
      benchmarkScenario: "206",
      rangeRatio: 0.5,
    })),
  );

  assert.equal(decision.decision, "insufficient-data");
  assert.equal(decision.traceCount, 29);
});
