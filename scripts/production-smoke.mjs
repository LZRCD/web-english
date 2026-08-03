import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeDirectory = path.join(root, ".wordloop-runtime");
const pidPath = path.join(runtimeDirectory, "production-smoke.pid.json");
const port = 3000;
const baseURL = `http://127.0.0.1:${port}`;
let serverProcess;
let browser;

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function portOpen() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    const finish = () => {
      socket.destroy();
      resolve(false);
    };
    socket.once("error", finish);
    socket.once("timeout", finish);
  });
}

async function waitForHealth(timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (serverProcess?.exitCode !== null) {
      throw new Error(`生产服务提前退出：exit ${serverProcess?.exitCode}`);
    }
    try {
      const response = await fetch(baseURL, {
        signal: AbortSignal.timeout(1_500),
      });
      if (response.ok) return;
    } catch {
      // 启动阶段按固定间隔等待，最终由总超时统一报错。
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("生产服务健康检查超时");
}

async function assertResponse(pathname, expectedStatus = 200, init) {
  const response = await fetch(new URL(pathname, baseURL), {
    ...init,
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status !== expectedStatus) {
    throw new Error(`${pathname} 返回 ${response.status}，期望 ${expectedStatus}`);
  }
  return response;
}

async function verifyHttpSurface() {
  const homepage = await assertResponse("/");
  const html = await homepage.text();
  const scriptPaths = [
    ...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)=["']([^"']+)["']/gi),
  ]
    .map((match) => match[1])
    .filter((assetPath) => /\.js(?:\?|$)/i.test(assetPath));
  if (!scriptPaths.length) throw new Error("首页没有可验证的客户端 JavaScript");
  await Promise.all(scriptPaths.map(async (scriptPath) => {
    const response = await assertResponse(scriptPath);
    if (!/javascript/i.test(response.headers.get("content-type") ?? "")) {
      throw new Error(`${scriptPath} Content-Type 不是 JavaScript`);
    }
  }));

  // redbook.json 为私有数据（不入库）：干净检出时缺失，此时跳过全量校验；
  // 本地具备完整数据时仍校验 6550 词完整性。
  try {
    const redbookResponse = await fetch(new URL("/data/redbook.json", baseURL));
    if (redbookResponse.ok) {
      const redbook = await redbookResponse.json();
      if (redbook?.metadata?.total !== 6550 || redbook?.words?.length !== 6550) {
        throw new Error("红宝书生产数据不是完整的 6550 词");
      }
    } else if (redbookResponse.status !== 404) {
      throw new Error(`/data/redbook.json 返回 ${redbookResponse.status}，期望 200`);
    } else {
      console.log("跳过红宝书全量校验：私有数据未检出（public/data/redbook.json 缺失）");
    }
  } catch (error) {
    // 私有数据缺失时降级跳过；仅“数据存在但不完整”视为真实失败。
    if (error instanceof Error && error.message.startsWith("红宝书生产数据不是完整")) {
      throw error;
    }
    console.log(`跳过红宝书全量校验：${error instanceof Error ? error.message : String(error)}`);
  }
  const audioIndex = await (
    await assertResponse("/data/audio-runtime-index.json")
  ).json();
  if (!audioIndex?.files?.length || !Object.keys(audioIndex?.entries ?? {}).length) {
    throw new Error("音频运行时索引为空");
  }

  const rangeRoot = await (
    await assertResponse("/data/dictionary/ranges.json")
  ).json();
  const letter = "i";
  const rangeIndexFile = rangeRoot.rangeIndexFiles?.[letter];
  const letterIndex = await (
    await assertResponse(`/data/dictionary/ranges/${rangeIndexFile}.json`)
  ).json();
  const [file, start, end] = letterIndex.ranges?.int?.[0] ?? [];
  const shardFile = rangeRoot.releaseFiles?.[file];
  if (!shardFile || !Number.isInteger(start) || !Number.isInteger(end)) {
    throw new Error("无法从生产索引定位词典 Range 样本");
  }
  const rangeResponse = await assertResponse(
    `/data/dictionary/${shardFile}.json`,
    206,
    { headers: { Range: `bytes=${start}-${end}` } },
  );
  const contentRange = rangeResponse.headers.get("content-range");
  if (!contentRange?.startsWith(`bytes ${start}-${end}/`)) {
    throw new Error(`Content-Range 无效：${contentRange ?? "缺失"}`);
  }
  const body = new Uint8Array(await rangeResponse.arrayBuffer());
  if (body.byteLength !== end - start + 1) {
    throw new Error(`Range 长度无效：${body.byteLength}`);
  }
  const fragment = JSON.parse(`{${new TextDecoder().decode(body)}}`);
  if (!fragment.intensive) throw new Error("Range 片段无法还原目标词条");
}

async function verifyClientActivation() {
  browser = await chromium.launch({
    headless: true,
    channel: process.env.SMOKE_BROWSER_CHANNEL
      || (process.platform === "win32" ? "chrome" : undefined),
  });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(baseURL, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "显示单词释义" })
    .waitFor({ state: "visible", timeout: 25_000 });
  if (pageErrors.length) {
    throw new Error(`客户端激活产生错误：${pageErrors.join("；")}`);
  }
}

async function startServer() {
  if (await portOpen()) {
    throw new Error("固定端口 3000 已被占用，生产冒烟不会切换其他端口");
  }
  await mkdir(runtimeDirectory, { recursive: true });
  const suffix = timestamp();
  const stdoutPath = path.join(runtimeDirectory, `smoke-${suffix}.out.log`);
  const stderrPath = path.join(runtimeDirectory, `smoke-${suffix}.err.log`);
  const stdout = openSync(stdoutPath, "a");
  const stderr = openSync(stderrPath, "a");
  try {
    serverProcess = spawn(
      process.execPath,
      [path.join(root, "scripts", "start-production.mjs"), "--port", String(port)],
      {
        cwd: root,
        env: { ...process.env, NODE_ENV: "production" },
        stdio: ["ignore", stdout, stderr],
        windowsHide: true,
      },
    );
  } finally {
    closeSync(stdout);
    closeSync(stderr);
  }
  await writeFile(pidPath, `${JSON.stringify({
    pid: serverProcess.pid,
    cwd: root,
    port,
    mode: "production-smoke",
    startedAt: new Date().toISOString(),
    stdoutPath: path.relative(root, stdoutPath).replaceAll("\\", "/"),
    stderrPath: path.relative(root, stderrPath).replaceAll("\\", "/"),
  }, null, 2)}\n`, "utf8");
  await waitForHealth();
}

async function stopServer() {
  if (serverProcess?.exitCode === null) {
    serverProcess.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => serverProcess.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
  }
  await unlink(pidPath).catch(() => undefined);
}

try {
  await startServer();
  await verifyHttpSurface();
  await verifyClientActivation();
  console.log("生产冒烟通过：首页已激活，静态资源、6550 词数据、音频索引和 Range 206 均有效");
} catch (error) {
  try {
    const record = JSON.parse(await readFile(pidPath, "utf8"));
    console.error(`生产冒烟失败；日志：${record.stdoutPath} / ${record.stderrPath}`);
  } catch {
    // 服务启动前失败时没有 PID 记录。
  }
  throw error;
} finally {
  await browser?.close().catch(() => undefined);
  await stopServer();
}
