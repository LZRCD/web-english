// lib/etymology-dataset.ts
// 词根拆解与助记预生成数据集的只读加载器：校验 manifest/shard 哈希、
// 校验 inputKey 与当前真实输入一致，任何失败安全降级为 undefined。
import {
  createDatasetLoader,
  hasOnlyKeys,
  isNonEmptyString,
  isPlainObject,
  validateReleaseFields,
} from "./private-datasets.ts";
import {
  buildEtymologyDatasetInputKey,
  isValidEtymologyDatasetEntry,
  type EtymologyDatasetEntry,
} from "./sense-datasets.ts";
import type { Word } from "./study.ts";

const DATASET = "etymology";
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
  entries: Array<{ wordId: number; record: EtymologyDatasetEntry }>;
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
    if (!isPlainObject(entry) || !hasOnlyKeys(entry, ["wordId", "record"])) return null;
    const wordId = Number(entry.wordId);
    if (!Number.isSafeInteger(wordId) || wordId <= 0 || seen.has(wordId)) return null;
    seen.add(wordId);
    if (!isValidEtymologyDatasetEntry(entry.record)) return null;
    if (entry.record.wordId !== wordId) return null;
    entries.push({ wordId, record: entry.record as EtymologyDatasetEntry });
  }
  return { schemaVersion: SCHEMA_VERSION, prefix, entries };
}

const loader = createDatasetLoader<Manifest, Shard>({
  manifestUrl: "/data/etymology/manifest.json",
  shardUrlFor: (filename) => `/data/etymology/${filename}`,
  validateManifest,
  validateShard,
});

/** 构建当前真实输入的词根助记输入身份（与生成器同实现）。 */
export function buildCurrentEtymologyDatasetInputKey(wordId: number, word: Word) {
  return buildEtymologyDatasetInputKey({
    schemaVersion: SCHEMA_VERSION,
    promptVersion: "etymology-prompt-v1",
    wordId,
    word: word.word,
    meaning: word.meaning,
    root: typeof word.root === "string" ? word.root : "",
    relation: word.relation ?? null,
  });
}

/**
 * 加载当前 wordId 的预生成词根拆解与助记。
 * inputKey 与当前真实输入不一致、缺失或损坏时返回 undefined。
 */
export async function loadEtymologyDataset(
  wordId: number,
  word: Word,
): Promise<EtymologyDatasetEntry | undefined> {
  if (!Number.isSafeInteger(wordId) || wordId <= 0) return undefined;
  const expectedKey = buildCurrentEtymologyDatasetInputKey(wordId, word);
  const manifest = await loader.getManifest();
  if (!manifest) return undefined;
  const shard = await loader.loadShardForWord(manifest, word.word);
  if (!shard) return undefined;
  const entry = shard.entries.find((item) => item.wordId === wordId);
  if (!entry) return undefined;
  if (entry.record.inputKey !== expectedKey) return undefined;
  return entry.record;
}
