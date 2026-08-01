export class ApiRequestError extends Error {
  readonly status: 400 | 403 | 413 | 429;

  constructor(
    message: string,
    status: 400 | 403 | 413 | 429,
  ) {
    super(message);
    this.status = status;
  }
}

export type ApiGuardPolicy = {
  name: string;
  requestsPerMinute: number;
  maxConcurrent: number;
};

type Lease = { release(): void };
type RateBucket = { startedAt: number; count: number; lastSeen: number };

const buckets = new Map<string, RateBucket>();
const activeRequests = new Map<string, number>();
const RATE_WINDOW_MS = 60_000;

function clientId(request: Request) {
  return request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-real-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim()
    ?? "local";
}

function allowedOrigins() {
  return new Set(
    (process.env.WORDLOOP_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

function validateSource(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin) {
    let originUrl: URL;
    try {
      originUrl = new URL(origin);
    } catch {
      throw new ApiRequestError("请求来源无效", 403);
    }
    if (
      originUrl.origin !== requestUrl.origin
      && !allowedOrigins().has(originUrl.origin)
    ) {
      throw new ApiRequestError("不允许跨来源调用本机接口", 403);
    }
  }
  if (
    process.env.WORDLOOP_LOCAL_ONLY === "1"
    && !["127.0.0.1", "localhost", "[::1]"].includes(requestUrl.hostname)
  ) {
    throw new ApiRequestError("接口仅允许本机访问", 403);
  }
}

function pruneBuckets(now: number) {
  if (buckets.size < 500) return;
  for (const [key, bucket] of buckets) {
    if (now - bucket.lastSeen > RATE_WINDOW_MS * 2) buckets.delete(key);
  }
}

export function beginApiRequest(
  request: Request,
  policy: ApiGuardPolicy,
): Lease {
  validateSource(request);
  const now = Date.now();
  pruneBuckets(now);
  const key = `${policy.name}:${clientId(request)}`;
  const previous = buckets.get(key);
  const bucket = !previous || now - previous.startedAt >= RATE_WINDOW_MS
    ? { startedAt: now, count: 0, lastSeen: now }
    : previous;
  bucket.lastSeen = now;
  bucket.count += 1;
  buckets.set(key, bucket);
  if (bucket.count > policy.requestsPerMinute) {
    throw new ApiRequestError("请求过于频繁，请稍后重试", 429);
  }

  const active = activeRequests.get(policy.name) ?? 0;
  if (active >= policy.maxConcurrent) {
    throw new ApiRequestError("当前请求较多，请稍后重试", 429);
  }
  activeRequests.set(policy.name, active + 1);
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      const next = Math.max(0, (activeRequests.get(policy.name) ?? 1) - 1);
      if (next) activeRequests.set(policy.name, next);
      else activeRequests.delete(policy.name);
    },
  };
}

export async function readJsonBody<T>(
  body: Request | Response,
  maxBytes: number,
): Promise<T> {
  const declaredLength = Number(body.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ApiRequestError(`请求正文不能超过 ${maxBytes} 字节`, 413);
  }
  if (!body.body) throw new ApiRequestError("请求正文为空", 400);

  const reader = body.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ApiRequestError(`请求正文不能超过 ${maxBytes} 字节`, 413);
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(merged)) as T;
  } catch {
    throw new ApiRequestError("请求内容不是有效 JSON", 400);
  }
}

export function boundedText(
  value: unknown,
  maxLength: number,
  collapseWhitespace = true,
) {
  if (typeof value !== "string") return "";
  const normalized = collapseWhitespace
    ? value.replace(/\s+/g, " ").trim()
    : value.trim();
  return normalized.slice(0, maxLength);
}
