export function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((first, second) => first - second);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

export function summarize(samples) {
  const groups = new Map();
  for (const sample of samples) {
    const variant = [
      ["runMode", sample.runMode],
      ["networkProfile", sample.benchmarkNetworkProfile],
      ["cacheState", sample.benchmarkCacheState],
      ...["lookupMode", "source", "status", "resourceCache"]
        .map((key) => [key, sample.tags?.[key]])
        .filter(([, value]) => value !== undefined),
    ];
    const keys = ["", ...variant.map(([key, value]) => `${key}=${value}`)];
    for (const variantKey of keys) {
      const key = `${sample.metric}\u0000${variantKey}`;
      groups.set(key, [...(groups.get(key) ?? []), sample]);
    }
  }
  return [...groups.entries()].map(([key, items]) => {
    const [metric, variantKey] = key.split("\u0000");
    const successful = items.filter((item) => item.outcome === "ok");
    const values = successful.map((item) => item.durationMs);
    return {
      metric,
      variantKey,
      count: successful.length,
      errorCount: items.filter((item) => item.outcome === "error").length,
      p50: percentile(values, 0.5),
      p95: percentile(values, 0.95),
    };
  }).sort((first, second) =>
    `${first.metric}:${first.variantKey}`.localeCompare(
      `${second.metric}:${second.variantKey}`,
    ));
}

function summaryIdentity(summary) {
  return `${summary.metric}\u0000${summary.variantKey ?? ""}`;
}

function percentageChange(current, previous) {
  return previous === 0 ? null : (current - previous) / previous;
}

function browserMajor(version) {
  const match = String(version ?? "").match(/\d+/);
  return match ? Number(match[0]) : null;
}

/** 只允许诊断版本、数据、网络与主要运行环境一致的报告互相比较。 */
export function baselineCompatibility(current, previous) {
  if (!previous) {
    return { comparable: false, reasons: ["找不到上一份同条件报告"] };
  }
  const reasons = [];
  const checks = [
    ["诊断 schema", current?.build?.diagnosticsSchemaVersion, previous?.build?.diagnosticsSchemaVersion],
    ["数据版本", current?.build?.dataVersion, previous?.build?.dataVersion],
    ["网络条件", current?.run?.networkProfile, previous?.run?.networkProfile],
    ["服务模式", current?.run?.serverMode, previous?.run?.serverMode],
    ["操作系统", current?.environment?.platform, previous?.environment?.platform],
    ["处理器架构", current?.environment?.arch, previous?.environment?.arch],
    ["浏览器通道", current?.environment?.browserChannel, previous?.environment?.browserChannel],
    [
      "浏览器主版本",
      browserMajor(current?.environment?.browserVersion),
      browserMajor(previous?.environment?.browserVersion),
    ],
  ];
  for (const [label, currentValue, previousValue] of checks) {
    if (
      currentValue === undefined
      || currentValue === null
      || currentValue === "unknown"
      || previousValue === undefined
      || previousValue === null
      || previousValue === "unknown"
    ) {
      reasons.push(`${label}缺失`);
    } else if (currentValue !== previousValue) {
      reasons.push(`${label}不一致（当前 ${currentValue}，对照 ${previousValue}）`);
    }
  }
  return { comparable: reasons.length === 0, reasons };
}

/** 校验页面样本的构建模式与外部基线运行器声明一致。 */
export function validateRuntimeModes(samples, serverMode) {
  if (!serverMode || serverMode === "unknown") {
    return {
      status: "not-checked",
      expected: serverMode ?? "unknown",
      actual: [],
      errors: [],
    };
  }
  const actual = [...new Set(samples.map((sample) => sample.runtimeMode ?? "unknown"))]
    .sort();
  const errors = actual.length === 1 && actual[0] === serverMode
    ? []
    : [`样本模式 ${actual.join(", ") || "缺失"} 与运行器模式 ${serverMode} 不一致`];
  return {
    status: errors.length ? "error" : "ok",
    expected: serverMode,
    actual,
    errors,
  };
}

/** 以相同 metric + variant 比较两份基线，直接给出绝对值、百分比和告警结论。 */
export function compareBaselineReports(current, previous, options = {}) {
  const relativeThreshold = Number(options.relativeThreshold ?? 0.2);
  const absoluteThresholdMs = Number(options.absoluteThresholdMs ?? 20);
  const minimumSampleCount = Number(options.minimumSampleCount ?? 5);
  const compatibility = baselineCompatibility(current, previous);
  const previousByIdentity = new Map(
    (compatibility.comparable ? previous?.summaries ?? [] : [])
      .map((summary) => [summaryIdentity(summary), summary]),
  );
  const changes = (current?.summaries ?? []).flatMap((summary) => {
    const prior = previousByIdentity.get(summaryIdentity(summary));
    if (!prior) return [];
    const p50ChangeMs = summary.p50 - prior.p50;
    const p95ChangeMs = summary.p95 - prior.p95;
    const p50ChangeRatio = percentageChange(summary.p50, prior.p50);
    const p95ChangeRatio = percentageChange(summary.p95, prior.p95);
    const enoughSamples = summary.count >= minimumSampleCount
      && prior.count >= minimumSampleCount;
    const exceedsWarningThreshold = enoughSamples
      && p95ChangeMs >= absoluteThresholdMs
      && p95ChangeRatio !== null
      && p95ChangeRatio >= relativeThreshold;
    return [{
      metric: summary.metric,
      variantKey: summary.variantKey,
      previousCount: prior.count,
      currentCount: summary.count,
      previousP50: prior.p50,
      currentP50: summary.p50,
      p50ChangeMs,
      p50ChangeRatio,
      previousP95: prior.p95,
      currentP95: summary.p95,
      p95ChangeMs,
      p95ChangeRatio,
      enoughSamples,
      exceedsWarningThreshold,
    }];
  }).sort((first, second) =>
    Number(second.exceedsWarningThreshold) - Number(first.exceedsWarningThreshold)
    || second.p95ChangeMs - first.p95ChangeMs
    || `${first.metric}:${first.variantKey}`.localeCompare(
      `${second.metric}:${second.variantKey}`,
    ));
  const warnings = changes.filter((item) => item.exceedsWarningThreshold);
  return {
    status: compatibility.comparable ? "compared" : "no-compatible-baseline",
    previous: {
      generatedAt: previous?.generatedAt ?? null,
      appBuildId: previous?.build?.appBuildId ?? "unknown",
      dataVersion: previous?.build?.dataVersion ?? "unknown",
      diagnosticsSchemaVersion:
        previous?.build?.diagnosticsSchemaVersion ?? "unknown",
      runLabel: previous?.run?.label ?? "legacy",
    },
    current: {
      generatedAt: current?.generatedAt ?? null,
      appBuildId: current?.build?.appBuildId ?? "unknown",
      dataVersion: current?.build?.dataVersion ?? "unknown",
      diagnosticsSchemaVersion:
        current?.build?.diagnosticsSchemaVersion ?? "unknown",
      runLabel: current?.run?.label ?? "legacy",
    },
    comparable: compatibility.comparable,
    reason: compatibility.comparable
      ? null
      : `无可比基线：${compatibility.reasons.join("；")}`,
    incompatibilities: compatibility.reasons,
    sameDataVersion: previous?.build?.dataVersion === current?.build?.dataVersion,
    thresholds: {
      relative: relativeThreshold,
      absoluteMs: absoluteThresholdMs,
      minimumSampleCount,
    },
    matchedSummaryCount: changes.length,
    warningCount: warnings.length,
    warnings,
    changes,
  };
}

export function lookupTraceRatios(samples) {
  const byTrace = new Map();
  for (const sample of samples) {
    if (!sample.traceId) continue;
    byTrace.set(sample.traceId, [...(byTrace.get(sample.traceId) ?? []), sample]);
  }
  return [...byTrace.entries()].flatMap(([traceId, items]) => {
    const total = items.find((item) =>
      item.metric === "lookup.total" && item.outcome === "ok");
    if (!total?.durationMs) return [];
    const rootIndexDurationMs = items
      .filter((item) => item.metric.startsWith("dictionary.range_index."))
      .reduce((sum, item) => sum + item.durationMs, 0);
    const letterIndexDurationMs = items
      .filter((item) =>
        item.metric.startsWith("dictionary.range_letter_index."))
      .reduce((sum, item) => sum + item.durationMs, 0);
    const rangeFragmentDurationMs = items
      .filter((item) =>
        item.metric.startsWith("dictionary.range."))
      .reduce((sum, item) => sum + item.durationMs, 0);
    const rangeDurationMs = rootIndexDurationMs
      + letterIndexDurationMs
      + rangeFragmentDurationMs;
    const fallbackDurationMs = items
      .filter((item) => item.metric.startsWith("dictionary.full_shard_fallback."))
      .reduce((sum, item) => sum + item.durationMs, 0);
    return [{
      traceId,
      lookupMode: total.tags?.lookupMode ?? "unknown",
      benchmarkScenario: total.benchmarkScenario ?? "unknown",
      lookupDurationMs: total.durationMs,
      rangeIndexStrategy: letterIndexDurationMs > 0
        ? "letter-split"
        : "monolithic",
      rootIndexDurationMs,
      letterIndexDurationMs,
      rangeFragmentDurationMs,
      rangeDurationMs,
      fallbackDurationMs,
      rangeRatio: rangeDurationMs / total.durationMs,
      rangeChainRatio: (rangeDurationMs + fallbackDurationMs) / total.durationMs,
    }];
  });
}

export function buildRangeDecision(traceRatios) {
  const eligible = traceRatios.filter((item) => item.lookupMode === "first");
  const ratioValues = eligible.map((item) => item.rangeRatio);
  const splitApplied = eligible.some((item) =>
    item.rangeIndexStrategy === "letter-split");
  const decision = eligible.length < 30
    ? {
        decision: "insufficient-data",
        reason: `只有 ${eligible.length} 条首次查词 trace，至少需要 30 条`,
      }
    : splitApplied
      ? {
          decision: "split-applied-monitor",
          reason: "已按首字母拆分；继续按绝对耗时监控，不重复触发同一拆分",
        }
      : percentile(ratioValues, 0.5) > 0.2
      ? {
          decision: "evaluate-split",
          reason: "首次查词的 Range 阶段耗时占比 P50 超过 20%",
        }
      : {
          decision: "keep-current-index",
          reason: "首次查词的 Range 阶段耗时占比 P50 未超过 20%",
        };
  const scenarios = Object.fromEntries(
    [...new Set(eligible.map((item) => item.benchmarkScenario))]
      .sort()
      .map((scenario) => {
        const values = eligible
          .filter((item) => item.benchmarkScenario === scenario)
          .map((item) => item.rangeRatio);
        return [scenario, {
          traceCount: values.length,
          ratioP50: percentile(values, 0.5),
          ratioP95: percentile(values, 0.95),
        }];
      }),
  );
  return {
    ...decision,
    rangeIndexStrategy: splitApplied ? "letter-split" : "monolithic",
    traceCount: eligible.length,
    allLookupTraceCount: traceRatios.length,
    lookupDurationP50: percentile(
      eligible.map((item) => item.lookupDurationMs).filter(Number.isFinite),
      0.5,
    ),
    rangeDurationP50: percentile(
      eligible.map((item) => item.rangeDurationMs).filter(Number.isFinite),
      0.5,
    ),
    ratioP50: percentile(ratioValues, 0.5),
    ratioP95: percentile(ratioValues, 0.95),
    scenarios,
  };
}
