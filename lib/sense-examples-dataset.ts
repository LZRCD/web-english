// lib/sense-examples-dataset.ts
// 释义例句预生成数据集的只读加载器：校验 manifest/shard 哈希、
// 校验 wordId/senseIndex/senseKey/inputKey 与当前真实输入一致，
// 任何失败安全降级为 undefined（不得显示损坏或过期内容）。
import {
  createDatasetLoader,
  hasOnlyKeys,
  isNonEmptyString,
  isPlainObject,
  validateReleaseFields,
} from "./private-datasets.ts";
import {
  buildWordDatasetInputKey,
  isValidSenseExampleEntry,
  senseIdentitiesForWord,
  type SenseExampleDatasetEntry,
} from "./sense-datasets.ts";
import type { Word } from "./study.ts";

const DATASET = "sense-examples";
const SCHEMA_VERSION = 1;

type Manifest = {
  dataset: typeof DATASET;
  schemaVersion: typeof SCHEMA_VERSION;
  promptVersion: string;
  methodVersion: string;
  modelId: string;
  provider: string;
  inputDataHash: string;
  generatedAt: string;
  source: "ai_offline";
  counts: Record<string, unknown>;
  releases: Record<string, string>;
  shardHashes: Record<string, string>;
  shardBytes: Record<string, number>;
  contentVersion: string;
};

type Shard = {
  schemaVersion: typeof SCHEMA_VERSION;
  prefix: string;
  entries: Array<{ wordId: number; records: SenseExampleDatasetEntry[] }>;
};

function validateManifest(value: unknown): Manifest | null {
  if (!isPlainObject(value)) return null;
  if (!hasOnlyKeys(value, [
    "dataset", "schemaVersion", "promptVersion", "methodVersion", "modelId",
    "provider", "inputDataHash", "generatedAt", "source", "counts",
    "releases", "shardHashes", "shardBytes", "contentVersion",
  ])) {
    return null;
  }
  if (
    value.dataset !== DATASET
    || value.schemaVersion !== SCHEMA_VERSION
    || !isNonEmptyString(value.promptVersion, 80)
    || !isNonEmptyString(value.methodVersion, 80)
    || !isNonEmptyString(value.modelId, 80)
    || !isNonEmptyString(value.provider, 40)
    || !isNonEmptyString(value.inputDataHash, 128)
    || !isNonEmptyString(value.generatedAt, 80)
    || value.source !== "ai_offline"
    || !isPlainObject(value.counts)
    || !isPlainObject(value.releases)
    || !isPlainObject(value.shardHashes)
    || !isPlainObject(value.shardBytes)
  ) {
    return null;
  }
  if (!validateReleaseFields(value as unknown as Record<string, unknown>)) return null;
  return value as unknown as Manifest;
}

function validateShard(value: unknown, prefix: string): Shard | null {
  if (
    !isPlainObject(value)
    || !hasOnlyKeys(value, ["schemaVersion", "prefix", "entries"])
    || value.schemaVersion !== SCHEMA_VERSION
    || value.prefix !== prefix
    || !Array.isArray(value.entries)
  ) {
    return null;
  }
  const seen = new Set<number>();
  const entries: Shard["entries"] = [];
  for (const entry of value.entries) {
    if (!isPlainObject(entry) || !hasOnlyKeys(entry, ["wordId", "records"])) return null;
    const wordId = Number(entry.wordId);
    if (!Number.isSafeInteger(wordId) || wordId <= 0 || seen.has(wordId)) return null;
    seen.add(wordId);
    if (!Array.isArray(entry.records)) return null;
    for (const record of entry.records) {
      if (!isValidSenseExampleEntry(record)) return null;
      if (record.wordId !== wordId) return null;
    }
    entries.push({ wordId, records: entry.records as SenseExampleDatasetEntry[] });
  }
  return { schemaVersion: SCHEMA_VERSION, prefix, entries };
}

const loader = createDatasetLoader<Manifest, Shard>({
  manifestUrl: "/data/sense-examples/manifest.json",
  shardUrlFor: (filename) => `/data/sense-examples/${filename}`,
  validateManifest,
  validateShard,
});

/**
 * 加载当前 wordId 的预生成释义例句。与运行时义项库存逐一校验
 * senseIndex/senseKey/inputKey；任何缺失、损坏、过期都返回 undefined。
 */
export async function loadSenseExamplesDataset(
  wordId: number,
  word: Word,
): Promise<SenseExampleDatasetEntry[] | undefined> {
  if (!Number.isSafeInteger(wordId) || wordId <= 0) return undefined;
  const identities = senseIdentitiesForWord(word, wordId);
  if (!identities.length) return undefined;
  const manifest = await loader.getManifest();
  if (!manifest) return undefined;
  const shard = await loader.loadShardForWord(manifest, word.word);
  if (!shard) return undefined;
  const entry = shard.entries.find((item) => item.wordId === wordId);
  if (!entry) return undefined;
  if (entry.records.length !== identities.length) return undefined;
  const expectedInputKey = buildWordDatasetInputKey({
    dataset: DATASET,
    schemaVersion: SCHEMA_VERSION,
    promptVersion: manifest.promptVersion,
    wordId,
    senses: identities.map((identity) => identity.text),
  });
  const sorted = [...entry.records].sort((first, second) =>
    first.senseIndex - second.senseIndex);
  for (let index = 0; index < identities.length; index += 1) {
    const identity = identities[index];
    const record = sorted[index];
    if (
      record.senseIndex !== identity.senseIndex
      || record.senseKey !== identity.senseKey
      || record.inputKey !== expectedInputKey
    ) {
      return undefined;
    }
  }
  return sorted;
}
