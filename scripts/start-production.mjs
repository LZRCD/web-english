import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import process from "node:process";
import { pipeline } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  nodeToWebRequest,
  sendWebResponse,
} from "vinext/server/prod-server";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".m4a": "audio/mp4",
  ".mjs": "application/javascript; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".wav": "audio/wav",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/** 本地生产服务启动前加载私密配置；已存在的进程环境变量保持最高优先级。 */
export function loadLocalEnvironment(
  envPath = path.join(root, ".env.local"),
) {
  if (!existsSync(envPath)) return false;
  process.loadEnvFile(envPath);
  return true;
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/** 只接受单个字节范围；无效范围返回 null。 */
export function parseSingleRange(value, size) {
  if (typeof value !== "string" || value.includes(",")) return null;
  const match = value.match(/^bytes=(\d*)-(\d*)$/i);
  if (!match || (!match[1] && !match[2]) || size <= 0) return null;
  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null;
    if (start < 0 || start >= size || end < start) return null;
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

export function resolveStaticPath(clientDirectory, pathname) {
  if (pathname === "/" || pathname.startsWith("/.vite/")) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return null;
  const resolvedRoot = path.resolve(clientDirectory);
  const resolved = path.resolve(resolvedRoot, `.${decoded}`);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    return null;
  }
  return resolved;
}

async function fileInfo(filePath) {
  try {
    const info = await stat(filePath);
    return info.isFile() ? info : null;
  } catch {
    return null;
  }
}

async function serveStatic(req, res, clientDirectory, pathname) {
  const filePath = resolveStaticPath(clientDirectory, pathname);
  if (!filePath) return false;
  const info = await fileInfo(filePath);
  if (!info) return false;

  const extension = path.extname(filePath).toLowerCase();
  const contentType = contentTypes[extension] ?? "application/octet-stream";
  const immutable = pathname.startsWith("/assets/")
    || /\.[a-f0-9]{16}\.[^.]+$/i.test(pathname);
  const etag = `W/"${info.size}-${Math.floor(info.mtimeMs / 1000)}"`;
  const commonHeaders = {
    "Accept-Ranges": "bytes",
    "Cache-Control": immutable
      ? "public, max-age=31536000, immutable"
      : "public, max-age=3600",
    "Content-Type": contentType,
    ETag: etag,
  };

  if (req.headers["if-none-match"] === etag && !req.headers.range) {
    res.writeHead(304, commonHeaders);
    res.end();
    return true;
  }

  const requestedRange = req.headers.range;
  if (requestedRange) {
    const range = parseSingleRange(requestedRange, info.size);
    if (!range) {
      res.writeHead(416, {
        ...commonHeaders,
        "Content-Range": `bytes */${info.size}`,
      });
      res.end();
      return true;
    }
    const contentLength = range.end - range.start + 1;
    res.writeHead(206, {
      ...commonHeaders,
      "Content-Length": String(contentLength),
      "Content-Range": `bytes ${range.start}-${range.end}/${info.size}`,
    });
    if (req.method === "HEAD") {
      res.end();
      return true;
    }
    pipeline(
      createReadStream(filePath, { start: range.start, end: range.end }),
      res,
      () => undefined,
    );
    return true;
  }

  res.writeHead(200, {
    ...commonHeaders,
    "Content-Length": String(info.size),
  });
  if (req.method === "HEAD") res.end();
  else pipeline(createReadStream(filePath), res, () => undefined);
  return true;
}

function executionContext() {
  return {
    waitUntil(promise) {
      Promise.resolve(promise).catch(() => undefined);
    },
    passThroughOnException() {},
  };
}

async function loadHandler(outDirectory) {
  const entryPath = path.join(outDirectory, "server", "index.js");
  const entryInfo = await fileInfo(entryPath);
  if (!entryInfo) throw new Error(`找不到生产构建入口：${entryPath}`);
  const entry = (await import(
    `${pathToFileURL(entryPath).href}?t=${entryInfo.mtimeMs}`
  )).default;
  if (typeof entry === "function") return entry;
  if (entry && typeof entry.fetch === "function") {
    return (request) => entry.fetch(request, undefined, executionContext());
  }
  throw new Error("vinext 生产入口没有可调用的 fetch handler");
}

export async function startProductionServer({
  hostname = argumentValue("--hostname") ?? "127.0.0.1",
  port = Number(argumentValue("--port") ?? process.env.PORT ?? 3000),
  outDirectory = path.resolve(process.env.VINEXT_OUT_DIR ?? path.join(root, "dist")),
} = {}) {
  loadLocalEnvironment();
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`无效端口：${port}`);
  }
  const clientDirectory = path.join(outDirectory, "client");
  const handler = await loadHandler(outDirectory);
  const server = createServer((req, res) => {
    void (async () => {
      const rawUrl = req.url ?? "/";
      const pathname = rawUrl.split("?", 1)[0].replaceAll("\\", "/");
      if (await serveStatic(req, res, clientDirectory, pathname)) return;
      const response = await handler(nodeToWebRequest(req, rawUrl));
      const staticSignal = response.headers.get("x-vinext-static-file");
      if (staticSignal) {
        response.body?.cancel().catch(() => undefined);
        if (await serveStatic(req, res, clientDirectory, staticSignal)) return;
      }
      await sendWebResponse(response, req, res, true);
    })().catch((error) => {
      console.error("[wordloop] 生产服务错误：", error);
      if (!res.headersSent) res.writeHead(500);
      if (!res.writableEnded) res.end("Internal Server Error");
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, hostname, resolve);
  });
  console.log(`[wordloop] 生产服务：http://${hostname}:${port}`);
  return server;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const server = await startProductionServer();
  const close = () => server.close(() => {
    process.exitCode = 0;
  });
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}
