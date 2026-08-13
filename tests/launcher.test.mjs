import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

test("Windows 启动器兼容 UTF-8 中文 PowerShell 脚本", async () => {
  const cmd = await readFile(new URL("启动词环网站.cmd", projectRoot), "utf8");
  const script = await readFile(
    new URL("scripts/launch-wordloop.ps1", projectRoot),
  );

  assert.match(cmd, /where pwsh\.exe/);
  assert.match(cmd, /pwsh\.exe -NoProfile/);
  assert.deepEqual([...script.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
});

test("开发服务固定使用 3000 且端口检测失败时拒绝继续", async () => {
  const viteConfig = await readFile(new URL("vite.config.ts", projectRoot), "utf8");
  const manager = await readFile(
    new URL("scripts/manage-dev-server.ps1", projectRoot),
    "utf8",
  );
  const portListenerFunction = manager.match(
    /function Get-PortListener \{([\s\S]*?)\n\}/,
  )?.[0];

  assert.match(viteConfig, /strictPort:\s*true/);
  assert.ok(portListenerFunction, "应能定位 Get-PortListener 函数");
  assert.match(portListenerFunction, /-ErrorAction\s+Stop/);
  assert.doesNotMatch(
    portListenerFunction,
    /-ErrorAction\s+SilentlyContinue/,
  );
});
