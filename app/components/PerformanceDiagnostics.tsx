"use client";

import { useEffect, useMemo, useState } from "react";
import {
  clearPerformanceSamples,
  PERFORMANCE_DIAGNOSTICS_EVENT,
  performanceRegressionWarnings,
  readPerformanceDiagnostics,
  savePerformanceBaseline,
  summarizePerformanceSamples,
  summarizePerformanceVariants,
  type PerformanceDiagnostics as DiagnosticsData,
} from "../../lib/performance-diagnostics";
import { DATA_CONTENT_VERSION } from "../../lib/data-version";
import { APP_BUILD_ID } from "../../lib/build-info.generated";
import {
  readStorageDiagnostics,
  type StorageDiagnostics,
} from "../../lib/storage-diagnostics";
import { readAudioPreloadDiagnostics } from "../../lib/word-audio";

const PRIMARY_METRICS = [
  ["state.restore.total", "状态恢复"],
  ["redbook.load.total", "红宝书加载"],
  ["lookup.total", "查词结果显示"],
  ["audio.play.start", "音频开始发声"],
] as const;

function formatMs(value: number) {
  if (!Number.isFinite(value)) return "—";
  return value >= 1000
    ? `${(value / 1000).toFixed(2)} s`
    : `${Math.round(value)} ms`;
}

function downloadDiagnostics(diagnostics: DiagnosticsData) {
  const raw = JSON.stringify(diagnostics, null, 2);
  const url = URL.createObjectURL(new Blob([`${raw}\n`], {
    type: "application/json;charset=utf-8",
  }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `wordloop-performance-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function formatBytes(value: number | undefined) {
  if (value === undefined) return "不可用";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export default function PerformanceDiagnostics({ undoCount = 0 }: {
  undoCount?: number;
}) {
  const [diagnostics, setDiagnostics] = useState<DiagnosticsData>(() =>
    readPerformanceDiagnostics());
  const [storage, setStorage] = useState<StorageDiagnostics>();

  useEffect(() => {
    const refresh = () => {
      setDiagnostics(readPerformanceDiagnostics());
      void readStorageDiagnostics().then(setStorage);
    };
    refresh();
    window.addEventListener(PERFORMANCE_DIAGNOSTICS_EVENT, refresh);
    return () => window.removeEventListener(PERFORMANCE_DIAGNOSTICS_EVENT, refresh);
  }, []);

  const currentSamples = useMemo(
    () => diagnostics.samples.filter((sample) =>
      sample.dataVersion === DATA_CONTENT_VERSION
      && sample.appBuildId === APP_BUILD_ID),
    [diagnostics.samples],
  );

  const summaries = useMemo(
    () => summarizePerformanceSamples(currentSamples),
    [currentSamples],
  );
  const summaryByMetric = useMemo(
    () => new Map(summaries.map((summary) => [summary.metric, summary])),
    [summaries],
  );
  const latestBaseline = diagnostics.baselines.at(-1);
  const newSamples = latestBaseline
    ? currentSamples.filter((sample) =>
        sample.recordedAt > latestBaseline.createdAt)
    : currentSamples;
  const warnings = performanceRegressionWarnings(
    summarizePerformanceVariants(newSamples),
    latestBaseline,
  );
  const rangeSamples = currentSamples.filter((sample) =>
    sample.metric === "dictionary.range.request");
  const audioPreload = readAudioPreloadDiagnostics();
  const variants = useMemo(() => {
    const definitions = [
      ["状态恢复 · 首个标签", "state.restore.total", "runMode", "cold"],
      ["状态恢复 · 同标签重载", "state.restore.total", "runMode", "warm"],
      ["红宝书 · 首个标签", "redbook.load.total", "runMode", "cold"],
      ["红宝书 · 同标签重载", "redbook.load.total", "runMode", "warm"],
      ["红宝书 · 网络", "redbook.data.download", "resourceCache", "network"],
      ["红宝书 · 浏览器缓存", "redbook.data.download", "resourceCache", "memory-or-disk"],
      ["查词 · 首次", "lookup.total", "lookupMode", "first"],
      ["查词 · 重复", "lookup.total", "lookupMode", "repeat"],
      ["音频 · 原声", "audio.play.start", "source", "recorded"],
      ["音频 · TTS", "audio.play.start", "source", "tts"],
      ["Range · 206", "dictionary.range.request", "status", 206],
      ["Range · 200", "dictionary.range.request", "status", 200],
    ] as const;
    return definitions.map(([label, metric, tag, value]) => {
      const items = currentSamples.filter((sample) =>
        sample.metric === metric
        && (tag === "runMode" ? sample.runMode : sample.tags[tag]) === value);
      return {
        label,
        summary: summarizePerformanceSamples(items)[0],
      };
    });
  }, [currentSamples]);

  return (
    <section className="performance-diagnostics" aria-labelledby="performance-diagnostics-title">
      <div className="diagnostics-heading">
        <span>
          <strong id="performance-diagnostics-title">本地性能诊断</strong>
          <small>
            仅保存在当前浏览器；构建 {APP_BUILD_ID}；数据 {DATA_CONTENT_VERSION}；建议每项采集 30–50 次
          </small>
          <small>界面“首个标签/重载”描述应用启动；真正冷缓存由 perf:baseline 用新浏览器上下文定义</small>
        </span>
        <div>
          <button
            type="button"
            disabled={currentSamples.length === 0}
            onClick={() => savePerformanceBaseline()}
          >
            保存当前基线
          </button>
          <button
            type="button"
            className="quiet"
            disabled={diagnostics.samples.length === 0}
            onClick={() => downloadDiagnostics(diagnostics)}
          >
            导出 JSON
          </button>
          <button
            type="button"
            className="quiet"
            disabled={diagnostics.samples.length === 0}
            onClick={() => {
              if (window.confirm("清空本机性能样本？已保存的基线会保留。")) {
                clearPerformanceSamples();
              }
            }}
          >
            清空样本
          </button>
        </div>
      </div>

      <div className="diagnostics-table" role="table" aria-label="性能分位数">
        <div className="diagnostics-row diagnostics-row--head" role="row">
          <span role="columnheader">链路</span>
          <span role="columnheader">样本</span>
          <span role="columnheader">P50</span>
          <span role="columnheader">P95</span>
          <span role="columnheader">最近</span>
        </div>
        {PRIMARY_METRICS.map(([metric, label]) => {
          const summary = summaryByMetric.get(metric);
          return (
            <div className="diagnostics-row" role="row" key={metric}>
              <strong role="cell">{label}</strong>
              <span role="cell" className={summary && summary.count >= 30 ? "sample-ready" : ""}>
                {summary?.count ?? 0}/30
                {summary?.errorCount ? ` · ${summary.errorCount} 失败` : ""}
              </span>
              <span role="cell">{summary ? formatMs(summary.p50) : "—"}</span>
              <span role="cell">{summary ? formatMs(summary.p95) : "—"}</span>
              <span role="cell">{summary ? formatMs(summary.last) : "—"}</span>
            </div>
          );
        })}
      </div>

      <div className="diagnostics-breakdown">
        {variants.map(({ label, summary }) => (
          <span key={label}>
            <strong>{label}</strong>
            <small>
              {summary
                ? `${summary.count} 次 · P50 ${formatMs(summary.p50)} · P95 ${formatMs(summary.p95)}`
                : "尚无样本"}
            </small>
          </span>
        ))}
      </div>

      <div className="diagnostics-breakdown" aria-label="本地存储占用">
        <span>
          <strong>站点总占用</strong>
          <small>{formatBytes(storage?.siteUsageBytes)} / {formatBytes(storage?.siteQuotaBytes)}</small>
        </span>
        <span>
          <strong>查词缓存</strong>
          <small>{formatBytes(storage?.lookupCacheBytes)}</small>
        </span>
        <span>
          <strong>恢复副本</strong>
          <small>{formatBytes(storage?.recoveryBytes)}</small>
        </span>
        <span>
          <strong>性能记录</strong>
          <small>{formatBytes(storage?.performanceBytes)}</small>
        </span>
        <span>
          <strong>Cache Storage</strong>
          <small>{formatBytes(storage?.cacheStorageBytes)}</small>
        </span>
        <span>
          <strong>音频预载池</strong>
          <small>
            {audioPreload.elementCount}/{audioPreload.elementLimit} 个元素 · 下一词{
              audioPreload.nextStatus === "ready"
                ? "已就绪"
                : audioPreload.nextStatus === "loading"
                  ? "加载中"
                  : "未预载"
            }
          </small>
        </span>
        <span>
          <strong>可撤销评分</strong>
          <small>{undoCount} 步 / 30</small>
        </span>
      </div>

      {rangeSamples.some((sample) => sample.outcome === "error") && (
        <p className="diagnostics-note">
          Range 异常 {rangeSamples.filter((sample) => sample.outcome === "error").length} 次；已自动尝试整分片回退。
        </p>
      )}

      {latestBaseline && (
        <p className="diagnostics-note">
          最近基线：{latestBaseline.label} · {new Date(latestBaseline.createdAt).toLocaleString("zh-CN")}
          {` · 构建 ${latestBaseline.appBuildId ?? "旧版"} · 数据 ${latestBaseline.dataVersion ?? "旧版"} · ${latestBaseline.summaries.length} 项指标/变体`}
        </p>
      )}
      {warnings.length > 0 && (
        <p className="diagnostics-warning" role="status">
          性能提醒：{warnings.length} 项指标的 P95 比最近基线增加至少 20% 且超过 20ms；当前只告警，不阻断构建。
        </p>
      )}
    </section>
  );
}
