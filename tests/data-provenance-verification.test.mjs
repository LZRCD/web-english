import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  displayPath,
  firstExisting,
  validateProvenance,
} from "../scripts/verify-data-provenance.mjs";

const valid = {
  ecdict: {
    commit: "a".repeat(40),
    sourceSha256: "b".repeat(64),
  },
  ffmpeg: {
    binarySha256: "c".repeat(64),
  },
  whisper: {
    models: [{
      name: "openai/whisper-tiny.en",
      revision: "d".repeat(40),
      sha256: "e".repeat(64),
    }],
  },
};

test("provenance 要求来源 commit、revision 和 SHA-256 使用完整哈希", () => {
  assert.doesNotThrow(() => validateProvenance(valid));
  assert.throws(
    () => validateProvenance({
      ...valid,
      ecdict: { ...valid.ecdict, commit: "short" },
    }),
    /40 位 SHA/,
  );
});

test("来源定位只选择实际存在的候选文件", () => {
  const currentFile = fileURLToPath(import.meta.url);
  assert.equal(firstExisting(["missing-file", currentFile]), currentFile);
});

test("报告路径不会泄露用户主目录绝对路径", () => {
  const shown = displayPath(fileURLToPath(import.meta.url));
  assert.equal(shown.includes("tests/data-provenance-verification.test.mjs"), true);
});
