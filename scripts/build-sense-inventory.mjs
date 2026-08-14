// scripts/build-sense-inventory.mjs
// 统一义项库存构建与校验：--check 校验库存与当前真实输入一致。
import { mkdir, writeFile } from "node:fs/promises";
import {
  buildInventory,
  compactInventory,
  INVENTORY_PATH,
  verifyInventory,
} from "./lib/sense-inventory.mjs";

function parseArgs(argv) {
  const flags = new Set(argv.slice(2));
  return {
    check: flags.has("--check"),
    plan: flags.has("--plan"),
  };
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.check) {
    const result = await verifyInventory(INVENTORY_PATH);
    console.log(JSON.stringify({
      check: "sense-inventory",
      valid: result.valid,
      reason: result.reason,
      counts: result.current?.counts,
      inputDataHash: result.current?.inputDataHash,
    }, null, 2));
    process.exit(result.valid ? 0 : 1);
  }

  const inventory = await buildInventory();
  if (options.plan) {
    console.log(JSON.stringify({
      plan: "sense-inventory",
      counts: inventory.counts,
      inputDataHash: inventory.inputDataHash,
      redbookHash: inventory.redbookHash,
      analysisHash: inventory.analysisHash,
      splitterHash: inventory.splitterHash,
    }, null, 2));
    return;
  }

  await mkdir(".wordloop-data", { recursive: true });
  await writeFile(
    INVENTORY_PATH,
    `${JSON.stringify({ ...compactInventory(inventory), words: inventory.words })}\n`,
    "utf8",
  );
  console.log(JSON.stringify({
    built: "sense-inventory",
    path: INVENTORY_PATH,
    counts: inventory.counts,
    inputDataHash: inventory.inputDataHash,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
