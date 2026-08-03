import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeDirectory = path.join(root, ".wordloop-runtime");
const pidPath = path.join(runtimeDirectory, "production-baseline.pid.json");
const nodeCommand = process.execPath;
const npmCli = process.env.npm_execpath
  ?? path.join(path.dirname(nodeCommand), "node_modules", "npm", "bin", "npm-cli.js");
const port = 3000;
let serverProcess;
let serverRecord;

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function run(command, args, environment = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, ...environment },
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(
        `${command} ${args.join(" ")} 失败：${signal ? `signal ${signal}` : `exit ${code}`}`,
      ));
    });
  });
}

function processExists(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
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

async function healthReady(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return true;
    } catch {
      // 服务启动期间按固定间隔重试，超过总超时后统一失败。
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function readServerRecord() {
  try {
    return JSON.parse(await readFile(pidPath, "utf8"));
  } catch {
    return null;
  }
}

async function removeStaleRecord() {
  await unlink(pidPath).catch(() => undefined);
}

async function startProductionServer() {
  await mkdir(runtimeDirectory, { recursive: true });
  const occupied = await portOpen();
  const previous = await readServerRecord();
  if (occupied) {
    const reusable = previous
      && previous.cwd === root
      && previous.mode === "production"
      && processExists(previous.pid);
    if (!reusable) {
      throw new Error(
        "固定端口 3000 已被未识别进程占用；为避免停止其他服务，生产基线已中止。",
      );
    }
    serverRecord = previous;
    console.log(`复用本项目生产服务：PID ${previous.pid}`);
    return;
  }
  if (previous) await removeStaleRecord();

  if (process.env.PERF_SKIP_BUILD !== "1") {
    await run(nodeCommand, [npmCli, "run", "build"]);
  }

  const suffix = timestamp();
  const stdoutPath = path.join(runtimeDirectory, `production-${suffix}.out.log`);
  const stderrPath = path.join(runtimeDirectory, `production-${suffix}.err.log`);
  const stdout = openSync(stdoutPath, "a");
  const stderr = openSync(stderrPath, "a");
  try {
    serverProcess = spawn(
      nodeCommand,
      [
        path.join(root, "scripts", "start-production.mjs"),
        "--hostname",
        "127.0.0.1",
        "--port",
        String(port),
      ],
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
  serverRecord = {
    pid: serverProcess.pid,
    cwd: root,
    mode: "production",
    port,
    startedAt: new Date().toISOString(),
    stdoutPath: path.relative(root, stdoutPath).replaceAll("\\", "/"),
    stderrPath: path.relative(root, stderrPath).replaceAll("\\", "/"),
  };
  await writeFile(pidPath, `${JSON.stringify(serverRecord, null, 2)}\n`, "utf8");
  serverProcess.once("exit", () => {
    serverProcess = undefined;
  });
  if (!await healthReady()) {
    throw new Error(`生产服务健康检查超时；日志：${serverRecord.stderrPath}`);
  }
  console.log(`生产服务已就绪：PID ${serverRecord.pid} · http://127.0.0.1:${port}`);
}

async function stopProductionServer() {
  const record = serverRecord ?? await readServerRecord();
  if (record?.cwd === root && processExists(record.pid)) {
    try {
      process.kill(record.pid, "SIGTERM");
    } catch {
      // 进程已自行退出时只清理 PID 记录。
    }
  }
  await removeStaleRecord();
  serverRecord = undefined;
  serverProcess = undefined;
}

async function runBaseline({ label, profile, rounds, compareTo }) {
  console.log(`\n运行 ${label}：${rounds} 轮 · ${profile}`);
  await run(
    nodeCommand,
    [path.join(root, "scripts", "performance-baseline.mjs")],
    {
      PERF_BASE_URL: `http://127.0.0.1:${port}`,
      PERF_SERVER_MODE: "production",
      PERF_RUN_LABEL: label,
      PERF_NETWORK_PROFILE: profile,
      PERF_ROUNDS: String(rounds),
      PERF_COMPARE_TO: compareTo ?? "",
    },
  );
}

async function main() {
  if (process.argv.includes("--help")) {
    console.log([
      "npm run perf:production",
      "",
      "在固定端口 3000 构建并启动生产服务，运行 30 轮正式基线，",
      "再分别复核高延迟、慢速网络和缓存命中；结束后关闭临时服务。",
      "",
      "环境变量：PERF_ROUNDS、PERF_CONDITION_ROUNDS、PERF_SKIP_CONDITIONS=1、PERF_SKIP_BUILD=1",
    ].join("\n"));
    return;
  }
  await startProductionServer();
  if (process.argv.includes("--e2e")) {
    await run(
      nodeCommand,
      [npmCli, "run", "test:e2e"],
      { E2E_BASE_URL: `http://127.0.0.1:${port}` },
    );
    return;
  }
  const outputDirectory = path.resolve(
    process.env.PERF_OUTPUT_DIR ?? path.join(root, "reports"),
  );
  const comparisonPath = process.env.PERF_COMPARE_TO
    ? path.resolve(process.env.PERF_COMPARE_TO)
    : path.join(outputDirectory, "performance-baseline-production.json");
  await runBaseline({
    label: "production",
    profile: "normal",
    rounds: Math.max(1, Number(process.env.PERF_ROUNDS) || 30),
    compareTo: existsSync(comparisonPath) ? comparisonPath : undefined,
  });

  if (process.env.PERF_SKIP_CONDITIONS !== "1") {
    const conditionRounds = Math.max(
      5,
      Number(process.env.PERF_CONDITION_ROUNDS) || 5,
    );
    const conditionProfiles = (
      process.env.PERF_CONDITION_PROFILES
        ?? "high-latency,slow-network,cache-hit"
    ).split(",").map((item) => item.trim()).filter(Boolean);
    for (const profile of conditionProfiles) {
      const conditionReport = path.join(
        outputDirectory,
        `performance-baseline-production-${profile}.json`,
      );
      await runBaseline({
        label: `production-${profile}`,
        profile,
        rounds: conditionRounds,
        compareTo: existsSync(conditionReport) ? conditionReport : undefined,
      });
    }
  }
}

const stopForSignal = () => {
  void stopProductionServer().finally(() => process.exit(130));
};
process.once("SIGINT", stopForSignal);
process.once("SIGTERM", stopForSignal);

try {
  await main();
} finally {
  await stopProductionServer();
}
