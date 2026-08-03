const LOOKUP_CACHE_PREFIX = "wordloop-selection-lookups-v1:";
const RECOVERY_PREFIX = "wordloop-unsaved-recovery";

export type StorageDiagnostics = {
  siteUsageBytes?: number;
  siteQuotaBytes?: number;
  localStorageBytes: number;
  lookupCacheBytes: number;
  recoveryBytes: number;
  performanceBytes: number;
  cacheStorageBytes: number;
};

function utf8Bytes(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

export function cleanupOldLookupCaches(currentKey: string) {
  if (typeof localStorage === "undefined") return 0;
  const staleKeys: string[] = [];
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(LOOKUP_CACHE_PREFIX) && key !== currentKey) {
        staleKeys.push(key);
      }
    }
    for (const key of staleKeys) localStorage.removeItem(key);
  } catch {
    return 0;
  }
  return staleKeys.length;
}

export async function readStorageDiagnostics(): Promise<StorageDiagnostics> {
  let localStorageBytes = 0;
  let lookupCacheBytes = 0;
  let recoveryBytes = 0;
  let performanceBytes = 0;
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index) ?? "";
      const value = localStorage.getItem(key) ?? "";
      const bytes = utf8Bytes(key) + utf8Bytes(value);
      localStorageBytes += bytes;
      if (key.startsWith(LOOKUP_CACHE_PREFIX)) lookupCacheBytes += bytes;
      if (key.startsWith(RECOVERY_PREFIX)) recoveryBytes += bytes;
      if (key === "wordloop-performance-v1") performanceBytes += bytes;
    }
  } catch {
    // 存储被禁用时返回可获得的零值。
  }

  let cacheStorageBytes = 0;
  try {
    if ("caches" in globalThis) {
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          const response = await cache.match(request);
          const length = Number(response?.headers.get("content-length"));
          if (Number.isFinite(length) && length > 0) cacheStorageBytes += length;
        }
      }
    }
  } catch {
    // Cache Storage 不可用不影响其他诊断项。
  }

  let siteUsageBytes: number | undefined;
  let siteQuotaBytes: number | undefined;
  try {
    const estimate = await navigator.storage?.estimate();
    siteUsageBytes = estimate?.usage;
    siteQuotaBytes = estimate?.quota;
  } catch {
    // 浏览器未开放配额估算时不显示总量。
  }
  return {
    siteUsageBytes,
    siteQuotaBytes,
    localStorageBytes,
    lookupCacheBytes,
    recoveryBytes,
    performanceBytes,
    cacheStorageBytes,
  };
}
