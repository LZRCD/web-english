// lib/private-datasets.ts
// 三套私有预生成数据集共用的只读加载基础设施：
// manifest 校验、contentVersion 重算、shard 字节数 + SHA-256 校验、
// shard Promise 缓存与安全降级（任何失败返回 null，绝不显示损坏内容）。
export const PRIVATE_DATASET_MAX_SHARD_BYTES = 4 * 1024 * 1024;

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const CONTENT_VERSION_PATTERN = /^[0-9a-f]{16}$/;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function hasOnlyKeys(value: Record<string, unknown>, keys: string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

export function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

export function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

export function isNonEmptyString(value: unknown, max = Number.MAX_SAFE_INTEGER): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

export function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  return globalThis.crypto.subtle.digest("SHA-256", buffer).then(
    (digest) => [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(""),
    () => "",
  );
}

export function validateReleaseFields(manifest: Record<string, unknown>) {
  const prefixes = Object.keys(manifest.releases as Record<string, unknown>).sort();
  const hashes = manifest.shardHashes as Record<string, unknown>;
  const bytes = manifest.shardBytes as Record<string, unknown>;
  if (
    !isPlainObject(manifest.releases)
    || !isPlainObject(manifest.shardHashes)
    || !isPlainObject(manifest.shardBytes)
    || prefixes.length !== Object.keys(hashes).length
    || prefixes.length !== Object.keys(bytes).length
  ) {
    return false;
  }
  for (const prefix of prefixes) {
    const filename = (manifest.releases as Record<string, string>)[prefix];
    const hash = hashes[prefix];
    const byteCount = bytes[prefix];
    if (
      !/^[0-9a-z]{1,2}$/.test(prefix)
      || typeof filename !== "string"
      || filename !== `${prefix}.${String(hash).slice(0, 16)}.json`
      || typeof hash !== "string"
      || !HASH_PATTERN.test(hash)
      || !isPositiveInteger(byteCount)
      || byteCount > PRIVATE_DATASET_MAX_SHARD_BYTES
    ) {
      return false;
    }
  }
  return true;
}

export async function hashString(value: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(value).buffer);
}

export function buildContentVersion(core: Record<string, unknown>): Promise<string> {
  return hashString(JSON.stringify(core)).then((hash) => hash.slice(0, 16));
}

/** 单词的分片前缀（与生成器一致：首字母小写，非字母为 "0"）。 */
export function datasetWordPrefix(word: string) {
  const first = String(word).trim().toLowerCase()[0] ?? "";
  return /[a-z]/.test(first) ? first : "0";
}

type ManifestCache<TManifest> = {
  promise: Promise<TManifest | null> | undefined;
};

type ShardCache<TShard> = Map<string, Promise<TShard | null>>;

/**
 * 创建一个只读数据集加载器。validateManifest / validateShard 返回 null 表示拒绝；
 * resolveWord 从 shard 中提取目标词条目。
 */
export function createDatasetLoader<
  TManifest extends Record<string, unknown>,
  TShard extends Record<string, unknown>,
>({
  manifestUrl,
  shardUrlFor,
  validateManifest,
  validateShard,
}: {
  manifestUrl: string;
  shardUrlFor: (filename: string) => string;
  validateManifest: (value: unknown) => TManifest | null;
  validateShard: (value: unknown, prefix: string) => TShard | null;
}) {
  const manifestCache: ManifestCache<TManifest> = { promise: undefined };
  const shardCaches: ShardCache<TShard> = new Map();

  async function getManifest(): Promise<TManifest | null> {
    if (!manifestCache.promise) {
      manifestCache.promise = fetch(manifestUrl, { cache: "force-cache" })
        .then(async (response) => {
          if (!response.ok) return null;
          try {
            const parsed: unknown = await response.json();
            if (!isPlainObject(parsed)) return null;
            const manifest = validateManifest(parsed);
            if (!manifest) return null;
            const { contentVersion, ...core } = manifest as Record<string, unknown>;
            if (
              typeof contentVersion !== "string"
              || !CONTENT_VERSION_PATTERN.test(contentVersion)
              || await buildContentVersion(core) !== contentVersion
            ) {
              return null;
            }
            return manifest;
          } catch {
            return null;
          }
        })
        .catch(() => null);
    }
    return manifestCache.promise;
  }

  async function loadShard(manifest: TManifest, prefix: string): Promise<TShard | null> {
    const releases = manifest.releases as Record<string, string>;
    const filename = releases[prefix];
    if (!filename) return null;
    const contentVersion = manifest.contentVersion as string;
    const cacheKey = `${contentVersion}:${prefix}`;
    const cached = shardCaches.get(cacheKey);
    if (cached) return cached;
    const request = fetch(shardUrlFor(filename), { cache: "force-cache" })
      .then(async (response) => {
        if (!response.ok) return null;
        const buffer = await response.arrayBuffer().catch(() => null);
        if (!buffer) return null;
        const hashes = manifest.shardHashes as Record<string, string>;
        const bytes = manifest.shardBytes as Record<string, number>;
        if (
          buffer.byteLength !== bytes[prefix]
          || await sha256Hex(buffer) !== hashes[prefix]
        ) {
          return null;
        }
        try {
          const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
          return validateShard(JSON.parse(text), prefix);
        } catch {
          return null;
        }
      })
      .catch(() => null);
    shardCaches.set(cacheKey, request);
    return request;
  }

  async function loadShardForWord(
    manifest: TManifest,
    word: string,
  ): Promise<TShard | null> {
    const prefix = datasetWordPrefix(word);
    return loadShard(manifest, prefix);
  }

  return { getManifest, loadShardForWord };
}
