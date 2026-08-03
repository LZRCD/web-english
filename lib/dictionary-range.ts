import {
  startPerformanceTimer,
  type PerformanceTags,
} from "./performance-diagnostics.ts";

export type DictionaryEntry = [
  displayWord: string,
  phonetic: string,
  translation: string,
];
export type DictionaryShard = Record<string, DictionaryEntry>;
export type DictionaryRange = [file: string, start: number, end: number];
export type DictionaryRangeIndex = {
  version: number;
  prefixLength: number;
  shardHashes: Record<string, string>;
  releaseFiles: Record<string, string>;
  rangeIndexHashes: Record<string, string>;
  rangeIndexFiles: Record<string, string>;
};
export type DictionaryLetterRangeIndex = {
  version: number;
  letter: string;
  ranges: Record<string, DictionaryRange[]>;
};

export type DictionaryRangeResult = {
  shard: DictionaryShard;
  mode: "partial-206" | "full-200" | "full-fallback";
  status: number;
  bytes: number;
};

type FetchRangeOptions = {
  url: string;
  start: number;
  end: number;
  tags?: PerformanceTags;
  fetcher?: typeof fetch;
  rangeTimeoutMs?: number;
  fallbackTimeoutMs?: number;
};

const DEFAULT_RANGE_TIMEOUT_MS = 8_000;
const DEFAULT_FALLBACK_TIMEOUT_MS = 12_000;

class DictionaryRangeError extends Error {
  readonly reason: string;

  constructor(message: string, reason: string) {
    super(message);
    this.reason = reason;
  }
}

function timeoutSignal(timeoutMs: number) {
  return AbortSignal.timeout(Math.max(1, timeoutMs));
}

function parseContentRange(value: string | null) {
  const match = value?.match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
  if (!match) return null;
  return {
    start: Number(match[1]),
    end: Number(match[2]),
    total: match[3] === "*" ? undefined : Number(match[3]),
  };
}

/** Range 索引必须由当前内容清单中的同一组分片生成。 */
export function isDictionaryRangeIndexCompatible(
  index: DictionaryRangeIndex,
  assetHashes: Readonly<Record<string, string>>,
) {
  if (
    index.version !== 4
    || !index.shardHashes
    || !index.releaseFiles
    || !index.rangeIndexHashes
    || !index.rangeIndexFiles
  ) {
    return false;
  }
  const shards = Object.entries(index.shardHashes);
  if (shards.length !== 26) return false;
  return shards.every(([file, hash]) =>
    assetHashes[`/data/dictionary/${file}.json`] === hash
    && index.releaseFiles[file] === `${file}.${hash.slice(0, 16)}`
    && assetHashes[`/data/dictionary/ranges/${file}.json`]
      === index.rangeIndexHashes[file]
    && index.rangeIndexFiles[file]
      === `${file}.${index.rangeIndexHashes[file]?.slice(0, 16)}`);
}

export function isDictionaryLetterRangeIndexCompatible(
  index: DictionaryLetterRangeIndex,
  letter: string,
) {
  if (index.version !== 1 || index.letter !== letter || !index.ranges) {
    return false;
  }
  return Object.entries(index.ranges).every(([prefix, ranges]) =>
    prefix.startsWith(letter)
    && Array.isArray(ranges)
    && ranges.length > 0
    && ranges.every((range) =>
      Array.isArray(range)
      && range.length === 3
      && range[0] === letter
      && Number.isSafeInteger(range[1])
      && Number.isSafeInteger(range[2])
      && range[1] >= 1
      && range[2] >= range[1]));
}

/**
 * 读取一个词典字节范围。服务器忽略 Range 返回 200 时直接解析整分片；
 * 206 片段损坏或网络中断会抛错，由调用方回退整分片请求。
 */
export async function fetchDictionaryRange({
  url,
  start,
  end,
  tags = {},
  fetcher = fetch,
  rangeTimeoutMs = DEFAULT_RANGE_TIMEOUT_MS,
}: FetchRangeOptions): Promise<DictionaryRangeResult> {
  const requestTimer = startPerformanceTimer("dictionary.range.request", tags);
  let response: Response;
  let text: string;
  try {
    response = await fetcher(url, {
      headers: { Range: `bytes=${start}-${end}` },
      signal: timeoutSignal(rangeTimeoutMs),
    });
    text = await response.text();
  } catch (error) {
    requestTimer.end({ status: 0, rangeMode: "network-error" }, "error");
    throw error;
  }

  const bytes = new TextEncoder().encode(text).byteLength;
  const mode = response.status === 206 ? "partial-206" : "full-200";
  const contentRange = response.status === 206
    ? parseContentRange(response.headers.get("Content-Range"))
    : null;
  const expectedBytes = end - start + 1;
  const supportedStatus = response.status === 200 || response.status === 206;
  const rangeValid = response.status !== 206 || Boolean(
    contentRange
    && contentRange.start === start
    && contentRange.end === end
    && (contentRange.total === undefined || contentRange.total > end)
    && bytes === expectedBytes,
  );
  requestTimer.end(
    {
      status: response.status,
      bytes,
      rangeMode: mode,
      contentRangeValid: rangeValid,
    },
    response.ok && supportedStatus && rangeValid ? "ok" : "error",
  );
  if (!response.ok) throw new Error(`词典 Range 请求失败：${response.status}`);
  if (!supportedStatus) {
    throw new DictionaryRangeError(
      `词典 Range 返回非预期状态：${response.status}`,
      "unexpected-status",
    );
  }
  if (!rangeValid) {
    throw new DictionaryRangeError(
      "词典 Range 响应范围无效",
      "content-range-invalid",
    );
  }

  const parseTimer = startPerformanceTimer("dictionary.range.parse", {
    ...tags,
    status: response.status,
    bytes,
    rangeMode: mode,
  });
  try {
    const shard = JSON.parse(
      response.status === 206 ? `{${text}}` : text,
    ) as DictionaryShard;
    if (!shard || typeof shard !== "object" || Array.isArray(shard)) {
      throw new Error("词典 Range 返回结构无效");
    }
    parseTimer.end();
    return { shard, mode, status: response.status, bytes };
  } catch (error) {
    parseTimer.end({}, "error");
    throw error;
  }
}

function fallbackReason(error: unknown) {
  if (error instanceof DictionaryRangeError) return error.reason;
  if (error instanceof SyntaxError) return "fragment-corrupt";
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return "range-timeout";
  }
  if (error instanceof TypeError) return "network-error";
  return "range-unavailable";
}

/** Range 请求异常时再取整分片，保证片段损坏或网络中断不会卡死查词。 */
export async function fetchDictionaryRangeWithFallback(
  options: FetchRangeOptions,
): Promise<DictionaryRangeResult> {
  try {
    return await fetchDictionaryRange(options);
  } catch (rangeError) {
    const reason = fallbackReason(rangeError);
    const fetcher = options.fetcher ?? fetch;
    const requestTimer = startPerformanceTimer(
      "dictionary.full_shard_fallback.download",
      { ...options.tags, fallbackReason: reason },
    );
    let response: Response;
    let text: string;
    try {
      response = await fetcher(options.url, {
        signal: timeoutSignal(
          options.fallbackTimeoutMs ?? DEFAULT_FALLBACK_TIMEOUT_MS,
        ),
      });
      text = await response.text();
    } catch (error) {
      requestTimer.end({ status: 0 }, "error");
      throw error;
    }
    const bytes = new TextEncoder().encode(text).byteLength;
    requestTimer.end(
      { status: response.status, bytes },
      response.ok ? "ok" : "error",
    );
    if (!response.ok) {
      throw new Error(`词典整分片回退失败：${response.status}`);
    }
    const parseTimer = startPerformanceTimer(
      "dictionary.full_shard_fallback.parse",
      { ...options.tags, fallbackReason: reason, bytes },
    );
    try {
      const shard = JSON.parse(text) as DictionaryShard;
      if (!shard || typeof shard !== "object" || Array.isArray(shard)) {
        throw new Error("词典整分片返回结构无效");
      }
      parseTimer.end();
      return {
        shard,
        mode: "full-fallback",
        status: response.status,
        bytes,
      };
    } catch (error) {
      parseTimer.end({}, "error");
      throw error;
    }
  }
}
