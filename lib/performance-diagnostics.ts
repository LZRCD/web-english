/**
 * 本地性能诊断：仅写入当前浏览器，不上传查询词、上下文或学习数据。
 * span 先进入内存，空闲或页面隐藏时批量落盘，避免计时期间同步序列化。
 */

import { APP_BUILD_ID } from "./build-info.generated.ts";
import { DATA_CONTENT_VERSION } from "./data-versions.generated.ts";

export const PERFORMANCE_DIAGNOSTICS_KEY = "wordloop-performance-v1";
export const PERFORMANCE_DIAGNOSTICS_EVENT = "wordloop-performance-updated";
export const PERFORMANCE_DIAGNOSTICS_SCHEMA_VERSION = 2;

const STORE_VERSION = 2;
const MAX_SAMPLES_PER_GROUP = 80;
const MAX_BASELINES = 20;
const MAX_RETAINED_DATA_VERSIONS = 3;
const FLUSH_SAMPLE_THRESHOLD = 12;
const FLUSH_DELAY_MS = 750;
const WARM_SESSION_KEY = "wordloop-performance-session-v1";
const BASELINE_VARIANT_KEYS = [
  "runMode",
  "lookupMode",
  "source",
  "status",
  "resourceCache",
] as const;

export type PerformanceRunMode = "cold" | "warm" | "unknown";
export type PerformanceOutcome = "ok" | "error" | "aborted";
export type PerformanceTagValue = string | number | boolean;
export type PerformanceTags = Record<string, PerformanceTagValue | undefined>;

export type PerformanceEnvironment = {
  appBuildId: string;
  diagnosticsSchemaVersion: number;
  runtimeMode: "development" | "production" | "test" | "unknown";
  browser: string;
  hardwareConcurrency?: number;
  deviceMemoryGb?: number;
};

export type PerformanceSample = {
  id: string;
  traceId?: string;
  metric: string;
  durationMs: number;
  recordedAt: string;
  dataVersion: string;
  appBuildId: string;
  diagnosticsSchemaVersion: number;
  runtimeMode: PerformanceEnvironment["runtimeMode"];
  browser: string;
  runMode: PerformanceRunMode;
  outcome: PerformanceOutcome;
  tags: Record<string, PerformanceTagValue>;
};

export type PerformanceSummary = {
  metric: string;
  variantKey: string;
  variant: Record<string, PerformanceTagValue>;
  count: number;
  errorCount: number;
  p50: number;
  p95: number;
  last: number;
};

export type PerformanceBaseline = {
  id: string;
  label: string;
  createdAt: string;
  dataVersion: string;
  appBuildId: string;
  diagnosticsSchemaVersion: number;
  environment: PerformanceEnvironment;
  summaries: PerformanceSummary[];
};

export type PerformanceDiagnostics = {
  version: number;
  samplesClearedAt?: string;
  samples: PerformanceSample[];
  baselines: PerformanceBaseline[];
};

export type PerformanceTimer = {
  end(tags?: PerformanceTags, outcome?: PerformanceOutcome): PerformanceSample;
};

let memoryStore: PerformanceDiagnostics = {
  version: STORE_VERSION,
  samples: [],
  baselines: [],
};
let cachedRunMode: PerformanceRunMode | undefined;
let memoryHydrated = false;
let lifecycleBound = false;
let dirty = false;
let pendingSampleCount = 0;
let scheduledFlush: { kind: "idle" | "timeout"; id: number } | undefined;

function browserStorageAvailable() {
  return typeof window !== "undefined" && "localStorage" in window;
}

function runtimeMode(): PerformanceEnvironment["runtimeMode"] {
  if (typeof process === "undefined") return "unknown";
  const mode = process.env.NODE_ENV;
  return mode === "development" || mode === "production" || mode === "test"
    ? mode
    : "unknown";
}

export function readPerformanceEnvironment(): PerformanceEnvironment {
  const browser = typeof navigator === "undefined"
    ? "node"
    : navigator.userAgent;
  const deviceMemory = typeof navigator !== "undefined"
    ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory
    : undefined;
  return {
    appBuildId: APP_BUILD_ID,
    diagnosticsSchemaVersion: PERFORMANCE_DIAGNOSTICS_SCHEMA_VERSION,
    runtimeMode: runtimeMode(),
    browser,
    hardwareConcurrency: typeof navigator === "undefined"
      ? undefined
      : navigator.hardwareConcurrency,
    deviceMemoryGb: Number.isFinite(deviceMemory) ? deviceMemory : undefined,
  };
}

function cleanTags(tags: PerformanceTags = {}) {
  return Object.fromEntries(
    Object.entries(tags).filter(
      (entry): entry is [string, PerformanceTagValue] =>
        entry[1] !== undefined,
    ),
  );
}

function newId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createPerformanceTrace(prefix = "trace") {
  return `${prefix}-${newId()}`;
}

function now() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function normalizeSample(value: unknown): PerformanceSample | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const sample = value as Partial<PerformanceSample>;
  if (typeof sample.metric !== "string" || !Number.isFinite(sample.durationMs)) {
    return null;
  }
  return {
    id: typeof sample.id === "string" ? sample.id : newId(),
    traceId: typeof sample.traceId === "string" ? sample.traceId : undefined,
    metric: sample.metric,
    durationMs: Number(sample.durationMs),
    recordedAt: typeof sample.recordedAt === "string"
      ? sample.recordedAt
      : new Date().toISOString(),
    dataVersion: typeof sample.dataVersion === "string"
      ? sample.dataVersion
      : "unknown",
    appBuildId: typeof sample.appBuildId === "string"
      ? sample.appBuildId
      : "legacy",
    diagnosticsSchemaVersion: Number.isInteger(sample.diagnosticsSchemaVersion)
      ? Number(sample.diagnosticsSchemaVersion)
      : 1,
    runtimeMode: sample.runtimeMode === "development"
      || sample.runtimeMode === "production"
      || sample.runtimeMode === "test"
      ? sample.runtimeMode
      : "unknown",
    browser: typeof sample.browser === "string" ? sample.browser : "unknown",
    runMode: sample.runMode === "cold" || sample.runMode === "warm"
      ? sample.runMode
      : "unknown",
    outcome: sample.outcome === "error" || sample.outcome === "aborted"
      ? sample.outcome
      : "ok",
    tags: cleanTags(sample.tags),
  };
}

function normalizeSummary(value: unknown): PerformanceSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const summary = value as Partial<PerformanceSummary>;
  if (typeof summary.metric !== "string") return null;
  const variant = summary.variant && typeof summary.variant === "object"
    ? cleanTags(summary.variant)
    : {};
  return {
    metric: summary.metric,
    variant,
    variantKey: typeof summary.variantKey === "string"
      ? summary.variantKey
      : serializeVariant(variant),
    count: Number(summary.count) || 0,
    errorCount: Number(summary.errorCount) || 0,
    p50: Number(summary.p50) || 0,
    p95: Number(summary.p95) || 0,
    last: Number(summary.last) || 0,
  };
}

function normalizeBaseline(value: unknown): PerformanceBaseline | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const baseline = value as Partial<PerformanceBaseline>;
  if (typeof baseline.id !== "string" || !Array.isArray(baseline.summaries)) {
    return null;
  }
  const environment = baseline.environment && typeof baseline.environment === "object"
    ? baseline.environment as PerformanceEnvironment
    : readPerformanceEnvironment();
  return {
    id: baseline.id,
    label: typeof baseline.label === "string" ? baseline.label : "旧基线",
    createdAt: typeof baseline.createdAt === "string"
      ? baseline.createdAt
      : new Date().toISOString(),
    dataVersion: typeof baseline.dataVersion === "string"
      ? baseline.dataVersion
      : "unknown",
    appBuildId: typeof baseline.appBuildId === "string"
      ? baseline.appBuildId
      : "legacy",
    diagnosticsSchemaVersion: Number.isInteger(baseline.diagnosticsSchemaVersion)
      ? Number(baseline.diagnosticsSchemaVersion)
      : 1,
    environment,
    summaries: baseline.summaries
      .map(normalizeSummary)
      .filter((item): item is PerformanceSummary => item !== null),
  };
}

function normalizeStore(value: unknown): PerformanceDiagnostics {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { version: STORE_VERSION, samples: [], baselines: [] };
  }
  const candidate = value as Partial<PerformanceDiagnostics>;
  return pruneStore({
    version: STORE_VERSION,
    samplesClearedAt: typeof candidate.samplesClearedAt === "string"
      ? candidate.samplesClearedAt
      : undefined,
    samples: Array.isArray(candidate.samples)
      ? candidate.samples
          .map(normalizeSample)
          .filter((item): item is PerformanceSample => item !== null)
      : [],
    baselines: Array.isArray(candidate.baselines)
      ? candidate.baselines
          .map(normalizeBaseline)
          .filter((item): item is PerformanceBaseline => item !== null)
      : [],
  });
}

function pruneStore(store: PerformanceDiagnostics): PerformanceDiagnostics {
  const samples = store.samples.filter((sample) =>
    !store.samplesClearedAt || sample.recordedAt > store.samplesClearedAt
  );
  const versions = [...new Map(
    [...samples]
      .sort((first, second) => second.recordedAt.localeCompare(first.recordedAt))
      .map((sample) => [sample.dataVersion, true]),
  ).keys()].slice(0, MAX_RETAINED_DATA_VERSIONS);
  if (!versions.includes(DATA_CONTENT_VERSION)) versions.unshift(DATA_CONTENT_VERSION);
  const allowedVersions = new Set(versions.slice(0, MAX_RETAINED_DATA_VERSIONS));
  const groups = new Map<string, PerformanceSample[]>();
  for (const sample of samples) {
    if (!allowedVersions.has(sample.dataVersion)) continue;
    const key = `${sample.dataVersion}\u0000${sample.appBuildId}\u0000${sample.metric}`;
    groups.set(key, [...(groups.get(key) ?? []), sample]);
  }
  return {
    version: STORE_VERSION,
    samplesClearedAt: store.samplesClearedAt,
    samples: [...groups.values()]
      .flatMap((samples) => samples
        .sort((first, second) => first.recordedAt.localeCompare(second.recordedAt))
        .slice(-MAX_SAMPLES_PER_GROUP))
      .sort((first, second) => first.recordedAt.localeCompare(second.recordedAt)),
    baselines: store.baselines
      .sort((first, second) => first.createdAt.localeCompare(second.createdAt))
      .slice(-MAX_BASELINES),
  };
}

export function mergePerformanceDiagnosticStores(
  first: PerformanceDiagnostics,
  second: PerformanceDiagnostics,
) {
  const samplesClearedAt = [first.samplesClearedAt, second.samplesClearedAt]
    .filter((value): value is string => typeof value === "string")
    .sort()
    .at(-1);
  return pruneStore({
    version: STORE_VERSION,
    samplesClearedAt,
    samples: [...new Map(
      [...first.samples, ...second.samples].map((sample) => [sample.id, sample]),
    ).values()],
    baselines: [...new Map(
      [...first.baselines, ...second.baselines]
        .map((baseline) => [baseline.id, baseline]),
    ).values()],
  });
}

function readPersistedStore() {
  if (!browserStorageAvailable()) return memoryStore;
  try {
    const raw = window.localStorage.getItem(PERFORMANCE_DIAGNOSTICS_KEY);
    return raw ? normalizeStore(JSON.parse(raw)) : normalizeStore(null);
  } catch {
    return normalizeStore(null);
  }
}

function emitUpdate() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PERFORMANCE_DIAGNOSTICS_EVENT));
}

function cancelScheduledFlush() {
  if (!scheduledFlush || typeof window === "undefined") return;
  const browserWindow = window as Window & {
    cancelIdleCallback?: (id: number) => void;
  };
  if (
    scheduledFlush.kind === "idle"
    && typeof browserWindow.cancelIdleCallback === "function"
  ) {
    browserWindow.cancelIdleCallback(scheduledFlush.id);
  } else {
    window.clearTimeout(scheduledFlush.id);
  }
  scheduledFlush = undefined;
}

function persistMergedStore() {
  if (!dirty) return;
  memoryStore = mergePerformanceDiagnosticStores(readPersistedStore(), memoryStore);
  if (browserStorageAvailable()) {
    try {
      window.localStorage.setItem(
        PERFORMANCE_DIAGNOSTICS_KEY,
        JSON.stringify(memoryStore),
      );
    } catch {
      // 配额耗尽或 localStorage 被禁用时继续保留当前页面内存样本。
      return;
    }
  }
  dirty = false;
  pendingSampleCount = 0;
  emitUpdate();
}

export async function flushPerformanceDiagnostics() {
  cancelScheduledFlush();
  if (!dirty) return;
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    try {
      await navigator.locks.request(
        "wordloop-performance-write",
        { mode: "exclusive" },
        () => persistMergedStore(),
      );
      return;
    } catch {
      // 浏览器不支持或拒绝锁时使用读合并写兜底。
    }
  }
  persistMergedStore();
}

function bindLifecycle() {
  if (lifecycleBound || typeof window === "undefined") return;
  lifecycleBound = true;
  window.addEventListener("pagehide", persistMergedStore);
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") persistMergedStore();
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== PERFORMANCE_DIAGNOSTICS_KEY || !event.newValue) return;
    try {
      memoryStore = mergePerformanceDiagnosticStores(
        memoryStore,
        normalizeStore(JSON.parse(event.newValue)),
      );
      emitUpdate();
    } catch {}
  });
}

function readStore() {
  if (!memoryHydrated) {
    memoryStore = readPersistedStore();
    memoryHydrated = true;
    bindLifecycle();
  }
  return memoryStore;
}

function scheduleFlush() {
  if (typeof window === "undefined" || scheduledFlush) return;
  if (pendingSampleCount >= FLUSH_SAMPLE_THRESHOLD) {
    void flushPerformanceDiagnostics();
    return;
  }
  const browserWindow = window as Window & {
    requestIdleCallback?: (
      callback: IdleRequestCallback,
      options?: IdleRequestOptions,
    ) => number;
  };
  if (typeof browserWindow.requestIdleCallback === "function") {
    const id = browserWindow.requestIdleCallback(() => {
      scheduledFlush = undefined;
      void flushPerformanceDiagnostics();
    }, { timeout: 2_000 });
    scheduledFlush = { kind: "idle", id };
  } else {
    const id = browserWindow.setTimeout(() => {
      scheduledFlush = undefined;
      void flushPerformanceDiagnostics();
    }, FLUSH_DELAY_MS);
    scheduledFlush = { kind: "timeout", id };
  }
}

function writeStoreImmediately(store: PerformanceDiagnostics) {
  cancelScheduledFlush();
  memoryStore = pruneStore(store);
  memoryHydrated = true;
  dirty = true;
  persistMergedStore();
}

export function getPerformanceRunMode(): PerformanceRunMode {
  if (cachedRunMode) return cachedRunMode;
  if (typeof window === "undefined" || !("sessionStorage" in window)) {
    cachedRunMode = "unknown";
    return cachedRunMode;
  }
  try {
    cachedRunMode = window.sessionStorage.getItem(WARM_SESSION_KEY)
      ? "warm"
      : "cold";
    window.sessionStorage.setItem(WARM_SESSION_KEY, new Date().toISOString());
  } catch {
    cachedRunMode = "unknown";
  }
  return cachedRunMode;
}

export function recordPerformanceSample(
  metric: string,
  durationMs: number,
  tags: PerformanceTags = {},
  outcome: PerformanceOutcome = "ok",
) {
  const environment = readPerformanceEnvironment();
  const cleanedTags = cleanTags(tags);
  const traceId = typeof cleanedTags.traceId === "string"
    ? cleanedTags.traceId
    : undefined;
  delete cleanedTags.traceId;
  const sample: PerformanceSample = {
    id: newId(),
    traceId,
    metric,
    durationMs: Math.max(0, Math.round(durationMs * 100) / 100),
    recordedAt: new Date().toISOString(),
    dataVersion: DATA_CONTENT_VERSION,
    appBuildId: environment.appBuildId,
    diagnosticsSchemaVersion: environment.diagnosticsSchemaVersion,
    runtimeMode: environment.runtimeMode,
    browser: environment.browser,
    runMode: getPerformanceRunMode(),
    outcome,
    tags: cleanedTags,
  };
  const store = readStore();
  memoryStore = pruneStore({ ...store, samples: [...store.samples, sample] });
  dirty = true;
  pendingSampleCount += 1;
  scheduleFlush();
  return sample;
}

export function startPerformanceTimer(
  metric: string,
  initialTags: PerformanceTags = {},
): PerformanceTimer {
  const startedAt = now();
  let finished: PerformanceSample | undefined;
  return {
    end(tags = {}, outcome = "ok") {
      finished ??= recordPerformanceSample(
        metric,
        now() - startedAt,
        { ...initialTags, ...tags },
        outcome,
      );
      return finished;
    },
  };
}

function percentile(values: number[], ratio: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((first, second) => first - second);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function sampleVariantValue(sample: PerformanceSample, key: string) {
  return key === "runMode" ? sample.runMode : sample.tags[key];
}

function serializeVariant(variant: Record<string, PerformanceTagValue>) {
  return Object.entries(variant)
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join("&");
}

export function summarizePerformanceSamples(
  samples: PerformanceSample[],
  variantKeys: readonly string[] = [],
): PerformanceSummary[] {
  const groups = new Map<
    string,
    { metric: string; variant: Record<string, PerformanceTagValue>; items: PerformanceSample[] }
  >();
  for (const sample of samples) {
    const variant = Object.fromEntries(
      variantKeys.flatMap((key) => {
        const value = sampleVariantValue(sample, key);
        return value === undefined ? [] : [[key, value]];
      }),
    );
    const variantKey = serializeVariant(variant);
    const groupKey = `${sample.metric}\u0000${variantKey}`;
    const group = groups.get(groupKey) ?? { metric: sample.metric, variant, items: [] };
    group.items.push(sample);
    groups.set(groupKey, group);
  }
  return [...groups.values()].map(({ metric, variant, items }) => {
    const successful = items.filter((item) => item.outcome === "ok");
    const values = successful.map((item) => item.durationMs);
    return {
      metric,
      variant,
      variantKey: serializeVariant(variant),
      count: successful.length,
      errorCount: items.filter((item) => item.outcome === "error").length,
      p50: percentile(values, 0.5),
      p95: percentile(values, 0.95),
      last: successful.at(-1)?.durationMs ?? 0,
    };
  }).sort((first, second) =>
    `${first.metric}\u0000${first.variantKey}`
      .localeCompare(`${second.metric}\u0000${second.variantKey}`));
}

export function summarizePerformanceVariants(samples: PerformanceSample[]) {
  const summaries = summarizePerformanceSamples(samples);
  for (const key of BASELINE_VARIANT_KEYS) {
    const withVariant = samples.filter((sample) =>
      sampleVariantValue(sample, key) !== undefined);
    summaries.push(...summarizePerformanceSamples(withVariant, [key]));
  }
  return [...new Map(
    summaries.map((summary) => [
      `${summary.metric}\u0000${summary.variantKey}`,
      summary,
    ]),
  ).values()];
}

export function readPerformanceDiagnostics(): PerformanceDiagnostics {
  const store = readStore();
  return {
    version: store.version,
    samplesClearedAt: store.samplesClearedAt,
    samples: [...store.samples],
    baselines: [...store.baselines],
  };
}

export function savePerformanceBaseline(label?: string) {
  const store = readStore();
  const baseline: PerformanceBaseline = {
    id: newId(),
    label: label?.trim() || `基线 ${store.baselines.length + 1}`,
    createdAt: new Date().toISOString(),
    dataVersion: DATA_CONTENT_VERSION,
    appBuildId: APP_BUILD_ID,
    diagnosticsSchemaVersion: PERFORMANCE_DIAGNOSTICS_SCHEMA_VERSION,
    environment: readPerformanceEnvironment(),
    summaries: summarizePerformanceVariants(
      store.samples.filter((sample) =>
        sample.dataVersion === DATA_CONTENT_VERSION
        && sample.appBuildId === APP_BUILD_ID),
    ),
  };
  writeStoreImmediately({
    ...store,
    baselines: [...store.baselines, baseline].slice(-MAX_BASELINES),
  });
  return baseline;
}

export function clearPerformanceSamples() {
  const store = readStore();
  writeStoreImmediately({
    ...store,
    samplesClearedAt: new Date().toISOString(),
    samples: [],
  });
}

function summaryIdentity(summary: PerformanceSummary) {
  return `${summary.metric}\u0000${summary.variantKey}`;
}

export function performanceRegressionWarnings(
  summaries: PerformanceSummary[],
  baseline?: PerformanceBaseline,
) {
  if (
    !baseline
    || baseline.dataVersion !== DATA_CONTENT_VERSION
    || baseline.diagnosticsSchemaVersion !== PERFORMANCE_DIAGNOSTICS_SCHEMA_VERSION
  ) return [];
  const baselineByMetric = new Map(
    baseline.summaries.map((summary) => [summaryIdentity(summary), summary]),
  );
  return summaries.flatMap((summary) => {
    const previous = baselineByMetric.get(summaryIdentity(summary));
    if (
      !previous
      || previous.count < 5
      || summary.count < 5
      || summary.p95 <= previous.p95 * 1.2
      || summary.p95 - previous.p95 < 20
    ) {
      return [];
    }
    return [{
      metric: summary.metric,
      variant: summary.variant,
      previousP95: previous.p95,
      currentP95: summary.p95,
    }];
  });
}

export function resourceTransferDetails(url: string) {
  if (typeof performance === "undefined" || typeof location === "undefined") {
    return undefined;
  }
  const absoluteUrl = new URL(url, location.href);
  absoluteUrl.hash = "";
  const entries = performance.getEntriesByType(
    "resource",
  ) as PerformanceResourceTiming[];
  const entry = entries.findLast((item) => {
    const entryUrl = new URL(item.name);
    entryUrl.hash = "";
    return entryUrl.href === absoluteUrl.href;
  });
  if (!entry) return undefined;
  const cacheHit = entry.transferSize === 0 && entry.decodedBodySize > 0;
  const resourceCache = cacheHit
    ? "memory-or-disk"
    : entry.transferSize > 0 && entry.encodedBodySize === 0
      ? "revalidated-304"
      : entry.transferSize > 0
        ? "network"
        : "unknown";
  return {
    transferBytes: entry.transferSize,
    encodedBytes: entry.encodedBodySize,
    decodedBytes: entry.decodedBodySize,
    cacheHit,
    resourceCache,
    protocol: entry.nextHopProtocol || "unknown",
  };
}

export async function fetchJsonWithDiagnostics<T>(
  url: string,
  metric: string,
  init?: RequestInit,
  tags: PerformanceTags = {},
): Promise<{ data: T; response: Response; bytes: number; cacheHit?: boolean }> {
  const download = startPerformanceTimer(`${metric}.download`, tags);
  let response: Response;
  let text: string;
  try {
    response = await fetch(url, init);
    text = await response.text();
  } catch (error) {
    download.end({ status: 0 }, error instanceof DOMException && error.name === "AbortError"
      ? "aborted"
      : "error");
    throw error;
  }
  const bytes = new TextEncoder().encode(text).byteLength;
  const transfer = resourceTransferDetails(url);
  const cacheHit = transfer?.cacheHit;
  download.end({
    status: response.status,
    bytes,
    cacheHit,
    resourceCache: transfer?.resourceCache,
    protocol: transfer?.protocol,
  }, response.ok ? "ok" : "error");
  if (!response.ok) throw new Error(`请求失败：${response.status}`);

  const parse = startPerformanceTimer(`${metric}.parse`, {
    ...tags,
    status: response.status,
    bytes,
  });
  try {
    const data = JSON.parse(text) as T;
    parse.end();
    return { data, response, bytes, cacheHit };
  } catch (error) {
    parse.end({}, "error");
    throw error;
  }
}
