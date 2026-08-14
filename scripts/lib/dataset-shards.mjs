// scripts/lib/dataset-shards.mjs
// 三套私有数据共用的 content-addressed shard 与 manifest 工具：
// 稳定 JSON、SHA-256、contentVersion、原子发布、无引用旧 shard 清理。
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** 稳定序列化：无缩进、键顺序确定，任何环境字节一致。 */
export function stableJson(value) {
  return JSON.stringify(value);
}

/** 数据集内容版本：对 manifest 核心字段（不含 contentVersion）做哈希。 */
export function buildContentVersion(core) {
  return sha256(stableJson(core)).slice(0, 16);
}

/**
 * 把记录按前缀分片并生成 content-addressed 文件名。
 * prefixOf: (record) => string（如单词首字母）。
 * 返回 { shards: [{ prefix, filename, hash, bytes, entries }], byPrefix }。
 */
export function shardRecords(records, prefixOf, { schemaVersion }) {
  const byPrefix = new Map();
  for (const record of records) {
    const prefix = prefixOf(record);
    if (!prefix) throw new Error(`记录缺少分片前缀：${JSON.stringify(record).slice(0, 120)}`);
    const list = byPrefix.get(prefix) ?? [];
    list.push(record);
    byPrefix.set(prefix, list);
  }
  const shards = [];
  for (const [prefix, entries] of [...byPrefix.entries()].sort()) {
    const content = `${stableJson({ schemaVersion, prefix, entries })}\n`;
    const hash = sha256(content);
    shards.push({
      prefix,
      filename: `${prefix}.${hash.slice(0, 16)}.json`,
      hash,
      bytes: Buffer.byteLength(content, "utf8"),
      entries,
      content,
    });
  }
  return { shards, byPrefix };
}

export async function writeShards(dir, shards) {
  await mkdir(dir, { recursive: true });
  for (const shard of shards) {
    await writeFile(path.join(dir, shard.filename), shard.content, "utf8");
  }
}

/** 重读磁盘并按字节数与 SHA-256 校验每个 shard。 */
export async function verifyShards(dir, shards) {
  const problems = [];
  for (const shard of shards) {
    const buffer = await readFile(path.join(dir, shard.filename)).catch(() => null);
    if (!buffer) {
      problems.push(`${shard.prefix}: 文件缺失`);
      continue;
    }
    if (buffer.byteLength !== shard.bytes) {
      problems.push(`${shard.prefix}: 字节数 ${buffer.byteLength} != ${shard.bytes}`);
      continue;
    }
    if (sha256(buffer) !== shard.hash) {
      problems.push(`${shard.prefix}: SHA-256 不一致`);
    }
  }
  return problems;
}

/** 原子发布 manifest：先写临时文件再 rename，旧 manifest 只在成功后替换。 */
export async function writeManifestAtomically(releaseDir, manifest) {
  await mkdir(releaseDir, { recursive: true });
  const finalPath = path.join(releaseDir, "manifest.json");
  const tmpPath = path.join(releaseDir, `manifest.${manifest.contentVersion}.tmp`);
  await writeFile(tmpPath, `${stableJson(manifest)}\n`, "utf8");
  await rename(tmpPath, finalPath);
}

/** 删除 release 目录中不再被 manifest 引用的旧 shard 文件。 */
export async function cleanUnreferencedShards(releaseDir, manifest) {
  const referenced = new Set(Object.values(manifest.releases ?? {}));
  const { readdir } = await import("node:fs/promises");
  let names;
  try {
    names = await readdir(releaseDir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.endsWith(".json") || name === "manifest.json") continue;
    if (!referenced.has(name)) {
      await rm(path.join(releaseDir, name), { force: true });
    }
  }
}
