export type KaoyanPaperType = "old" | "english-one" | "english-two";
export type KaoyanSection = "reading" | "new-type" | "translation";

export type KaoyanExample = {
  id: string;
  wordId: number;
  word: string;
  matchedText: string;
  sentence: string;
  year: number;
  paperType: KaoyanPaperType;
  paperId: string;
  section: KaoyanSection;
  sourceUrl: string;
};

type KaoyanManifest = {
  schemaVersion: 1;
  contentVersion: string;
  corpusSource: string;
  corpusFetchedAt: string;
  corpusManifestSha256: string;
  sourceFiles: Array<{ paperId: string; sha256: string; bytes: number }>;
  releaseFiles: Record<string, string>;
  shardHashes: Record<string, string>;
  shardBytes: Record<string, number>;
  paperCount: number;
  sourceSentenceCount: number;
  exampleCount: number;
  coveredWordCount: number;
  uncoveredWordCount: number;
  statistics: {
    candidateSentenceCount: number;
    validSentenceCount: number;
    filteredReasons: Record<string, number>;
    byPaperType: Record<string, number>;
    byYear: Record<string, number>;
  };
};

type KaoyanShard = {
  schemaVersion: 1;
  prefix: string;
  examplesByWordId: Record<string, KaoyanExample[]>;
};

const MANIFEST_URL = "/data/kaoyan-examples/manifest.json";
const SOURCE_URL_PREFIX = "https://english-exam.lazynote.cn/kaoyan/paper/";
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const PAPER_TYPES = new Set<KaoyanPaperType>(["old", "english-one", "english-two"]);
const SECTIONS = new Set<KaoyanSection>(["reading", "new-type", "translation"]);
const SHARD_LIMIT = 512 * 1024;

let manifestPromise: Promise<KaoyanManifest | null> | undefined;
const shardPromises = new Map<string, Promise<KaoyanShard | null>>();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isNonEmptyString(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

function paperIdentity(paperId: string) {
  const old = /^(199[8-9]|200[0-9])$/.exec(paperId);
  if (old) return { year: Number(old[1]), paperType: "old" as const };
  const current = /^(20(?:1[0-9]|2[0-6]))-english-(one|two)$/.exec(paperId);
  if (!current) return undefined;
  return {
    year: Number(current[1]),
    paperType: `english-${current[2]}` as "english-one" | "english-two",
  };
}

function validateManifest(value: unknown): KaoyanManifest | null {
  if (!isPlainObject(value)) return null;
  const requiredKeys = [
    "schemaVersion", "contentVersion", "corpusSource", "corpusFetchedAt",
    "corpusManifestSha256", "sourceFiles", "releaseFiles", "shardHashes",
    "shardBytes", "paperCount", "sourceSentenceCount", "exampleCount",
    "coveredWordCount", "uncoveredWordCount", "statistics",
  ];
  if (!hasOnlyKeys(value, requiredKeys)) return null;
  if (
    value.schemaVersion !== 1
    || typeof value.contentVersion !== "string"
    || !/^[0-9a-f]{16}$/.test(value.contentVersion)
    || value.corpusSource !== "https://english-exam.lazynote.cn/kaoyan/"
    || !isNonEmptyString(value.corpusFetchedAt, 80)
    || typeof value.corpusManifestSha256 !== "string"
    || !HASH_PATTERN.test(value.corpusManifestSha256)
    || !Array.isArray(value.sourceFiles)
    || !isPlainObject(value.releaseFiles)
    || !isPlainObject(value.shardHashes)
    || !isPlainObject(value.shardBytes)
    || !isNonNegativeInteger(value.paperCount)
    || value.paperCount !== value.sourceFiles.length
    || !isNonNegativeInteger(value.sourceSentenceCount)
    || !isNonNegativeInteger(value.exampleCount)
    || !isNonNegativeInteger(value.coveredWordCount)
    || !isNonNegativeInteger(value.uncoveredWordCount)
    || !isPlainObject(value.statistics)
  ) return null;
  const statistics = value.statistics;
  if (
    !hasOnlyKeys(statistics, [
      "candidateSentenceCount", "validSentenceCount", "filteredReasons",
      "byPaperType", "byYear",
    ])
    || !isNonNegativeInteger(statistics.candidateSentenceCount)
    || !isNonNegativeInteger(statistics.validSentenceCount)
    || statistics.validSentenceCount !== value.sourceSentenceCount
    || statistics.candidateSentenceCount < statistics.validSentenceCount
    || !isPlainObject(statistics.filteredReasons)
    || !isPlainObject(statistics.byPaperType)
    || !isPlainObject(statistics.byYear)
    || [...Object.values(statistics.filteredReasons),
      ...Object.values(statistics.byPaperType),
      ...Object.values(statistics.byYear)].some((count) => !isNonNegativeInteger(count))
    || Object.values(statistics.byPaperType).reduce<number>(
      (sum, count) => sum + Number(count),
      0,
    ) !== value.exampleCount
    || Object.values(statistics.byYear).reduce<number>(
      (sum, count) => sum + Number(count),
      0,
    ) !== value.exampleCount
  ) return null;
  const paperIds = new Set<string>();
  for (const item of value.sourceFiles) {
    if (
      !isPlainObject(item)
      || !hasOnlyKeys(item, ["paperId", "sha256", "bytes"])
      || !isNonEmptyString(item.paperId, 40)
      || !paperIdentity(item.paperId)
      || typeof item.sha256 !== "string"
      || !HASH_PATTERN.test(item.sha256)
      || !isPositiveInteger(item.bytes)
      || paperIds.has(item.paperId)
    ) return null;
    paperIds.add(item.paperId);
  }
  const prefixes = Object.keys(value.releaseFiles).sort();
  if (
    prefixes.length !== Object.keys(value.shardHashes).length
    || prefixes.length !== Object.keys(value.shardBytes).length
  ) return null;
  for (const prefix of prefixes) {
    const filename = value.releaseFiles[prefix];
    const hash = value.shardHashes[prefix];
    const bytes = value.shardBytes[prefix];
    if (
      !/^[a-z]{1,2}$/.test(prefix)
      || typeof filename !== "string"
      || filename !== `${prefix}.${String(hash).slice(0, 16)}.json`
      || typeof hash !== "string"
      || !HASH_PATTERN.test(hash)
      || !isPositiveInteger(bytes)
      || bytes > SHARD_LIMIT
    ) return null;
  }
  return value as unknown as KaoyanManifest;
}

function validExample(value: unknown, expectedWordId: number): value is KaoyanExample {
  if (!isPlainObject(value) || !hasOnlyKeys(value, [
    "id", "wordId", "word", "matchedText", "sentence", "year", "paperType",
    "paperId", "section", "sourceUrl",
  ])) return false;
  const identity = typeof value.paperId === "string" ? paperIdentity(value.paperId) : undefined;
  const tokenCount = typeof value.sentence === "string"
    ? value.sentence.match(/[A-Za-z]+(?:['’\-‐‑‒–—][A-Za-z]+)*/g)?.length ?? 0
    : 0;
  return typeof value.id === "string"
    && /^[0-9a-f]{24}$/.test(value.id)
    && value.wordId === expectedWordId
    && isPositiveInteger(value.wordId)
    && isNonEmptyString(value.word, 160)
    && isNonEmptyString(value.matchedText, 160)
    && isNonEmptyString(value.sentence, 500)
    && tokenCount >= 6
    && tokenCount <= 40
    && /[.!?]["'”’\)\]}]*$/.test(value.sentence)
    && isNonNegativeInteger(value.year)
    && value.year >= 1998
    && value.year <= 2026
    && PAPER_TYPES.has(value.paperType as KaoyanPaperType)
    && SECTIONS.has(value.section as KaoyanSection)
    && Boolean(identity)
    && identity?.year === value.year
    && identity.paperType === value.paperType
    && value.sourceUrl === `${SOURCE_URL_PREFIX}${value.paperId}/`;
}

function validateShard(value: unknown, prefix: string): KaoyanShard | null {
  if (
    !isPlainObject(value)
    || !hasOnlyKeys(value, ["schemaVersion", "prefix", "examplesByWordId"])
    || value.schemaVersion !== 1
    || value.prefix !== prefix
    || !isPlainObject(value.examplesByWordId)
  ) return null;
  for (const [key, examples] of Object.entries(value.examplesByWordId)) {
    const wordId = Number(key);
    if (!/^\d+$/.test(key) || !isPositiveInteger(wordId) || !Array.isArray(examples)) return null;
    if (examples.length < 1 || examples.length > 3) return null;
    const ids = new Set<string>();
    for (const item of examples) {
      if (!validExample(item, wordId) || ids.has(item.id)) return null;
      ids.add(item.id);
    }
  }
  return value as unknown as KaoyanShard;
}

async function responseBuffer(response: Response) {
  if (!response.ok) return null;
  try {
    return await response.arrayBuffer();
  } catch {
    return null;
  }
}

async function getManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch(MANIFEST_URL, { cache: "force-cache" })
      .then(async (response) => {
        if (!response.ok) return null;
        try {
          const manifest = validateManifest(await response.json());
          if (!manifest) return null;
          const core = {
            schemaVersion: manifest.schemaVersion,
            corpusSource: manifest.corpusSource,
            corpusFetchedAt: manifest.corpusFetchedAt,
            corpusManifestSha256: manifest.corpusManifestSha256,
            sourceFiles: manifest.sourceFiles,
            releaseFiles: manifest.releaseFiles,
            shardHashes: manifest.shardHashes,
            shardBytes: manifest.shardBytes,
            paperCount: manifest.paperCount,
            sourceSentenceCount: manifest.sourceSentenceCount,
            exampleCount: manifest.exampleCount,
            coveredWordCount: manifest.coveredWordCount,
            uncoveredWordCount: manifest.uncoveredWordCount,
            statistics: manifest.statistics,
          };
          const version = (await bufferSha256(new TextEncoder().encode(
            JSON.stringify(core),
          ).buffer)).slice(0, 16);
          return version === manifest.contentVersion ? manifest : null;
        } catch {
          return null;
        }
      })
      .catch(() => null);
  }
  return manifestPromise;
}

async function bufferSha256(buffer: ArrayBuffer) {
  try {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return "";
  }
}

async function loadShard(manifest: KaoyanManifest, prefix: string) {
  const filename = manifest.releaseFiles[prefix];
  if (!filename) return null;
  const cacheKey = `${manifest.contentVersion}:${prefix}`;
  const cached = shardPromises.get(cacheKey);
  if (cached) return cached;
  const request = fetch(`/data/kaoyan-examples/${filename}`, { cache: "force-cache" })
    .then(async (response) => {
      const buffer = await responseBuffer(response);
      if (
        !buffer
        || buffer.byteLength !== manifest.shardBytes[prefix]
        || await bufferSha256(buffer) !== manifest.shardHashes[prefix]
      ) return null;
      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
        return validateShard(JSON.parse(text), prefix);
      } catch {
        return null;
      }
    })
    .catch(() => null);
  shardPromises.set(cacheKey, request);
  return request;
}

function wordPrefixes(word: string) {
  const letters = word.toLowerCase().match(/[a-z]/g)?.join("") ?? "";
  if (!letters) return [];
  const first = letters[0];
  const second = letters.padEnd(2, first).slice(0, 2);
  return second === first ? [first] : [second, first];
}

/** 只读加载当前真实 wordId 的本地真题例句；任何缺失或校验失败都静默降级为空列表。 */
export async function loadKaoyanExamples(wordId: number, word: string): Promise<KaoyanExample[]> {
  if (!isPositiveInteger(wordId) || !word.trim()) return [];
  const manifest = await getManifest();
  if (!manifest) return [];
  const prefix = wordPrefixes(word).find((candidate) => manifest.releaseFiles[candidate]);
  if (!prefix) return [];
  const shard = await loadShard(manifest, prefix);
  if (!shard) return [];
  const examples = shard.examplesByWordId[String(wordId)] ?? [];
  const normalizedWord = word.trim().toLowerCase();
  if (examples.some((item) => item.word.trim().toLowerCase() !== normalizedWord)) return [];
  return examples;
}
