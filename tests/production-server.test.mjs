import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  loadLocalEnvironment,
  parseSingleRange,
  resolveStaticPath,
} from "../scripts/start-production.mjs";

test("本地生产服务加载 .env.local", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wordloop-env-"));
  const envPath = path.join(directory, ".env.local");
  const key = "WORDLOOP_LOCAL_ENV_TEST";
  delete process.env[key];
  try {
    await writeFile(envPath, `${key}=ready\n`, "utf8");
    assert.equal(loadLocalEnvironment(envPath), true);
    assert.equal(process.env[key], "ready");
  } finally {
    delete process.env[key];
    await rm(directory, { recursive: true, force: true });
  }
});

test("生产静态服务解析普通、开放和后缀 Range", () => {
  assert.deepEqual(parseSingleRange("bytes=10-19", 100), { start: 10, end: 19 });
  assert.deepEqual(parseSingleRange("bytes=90-", 100), { start: 90, end: 99 });
  assert.deepEqual(parseSingleRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.equal(parseSingleRange("bytes=100-110", 100), null);
  assert.equal(parseSingleRange("bytes=0-1,4-5", 100), null);
});

test("生产静态服务阻止目录穿越并兼容 Windows 路径", () => {
  const client = path.resolve("dist", "client");
  assert.equal(
    resolveStaticPath(client, "/assets/index.js"),
    path.join(client, "assets", "index.js"),
  );
  assert.equal(resolveStaticPath(client, "/../server/index.js"), null);
  assert.equal(resolveStaticPath(client, "/assets\\index.js"), null);
});
