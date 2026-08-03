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
