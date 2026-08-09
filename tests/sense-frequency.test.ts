import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSenseFrequency } from "../lib/sense-frequency.ts";

const SENSES = ["n. 地址；演讲", "v. 处理，对付", "v. 向…讲话；演讲"];

test("接受 json_object 模式的 { senses: [...] } 结构", () => {
  const result = normalizeSenseFrequency(
    {
      senses: [
        { meaning: "n. 地址；演讲", level: "high", note: "真题常考熟词僻义" },
        { meaning: "v. 处理，对付", level: "high", note: "阅读中常见" },
        { meaning: "v. 向…讲话；演讲", level: "medium" },
      ],
    },
    SENSES,
  );
  assert.equal(result.length, 3);
  assert.deepEqual(
    result.map((entry) => entry.level),
    ["high", "high", "medium"],
  );
  assert.equal(result[0].note, "真题常考熟词僻义");
});

test("接受顶层数组结构", () => {
  const result = normalizeSenseFrequency(
    [
      { meaning: "n. 地址；演讲", level: "high" },
      { meaning: "v. 处理，对付", level: "medium" },
      { meaning: "v. 向…讲话；演讲", level: "low" },
    ],
    SENSES,
  );
  assert.equal(result.length, 3);
  assert.equal(result[2].level, "low");
});

test("对象结构缺少 senses 字段时抛错", () => {
  assert.throws(
    () => normalizeSenseFrequency({ other: [] }, SENSES),
    /模型未按义项返回考频/,
  );
});

test("条目数不匹配时抛错", () => {
  assert.throws(
    () => normalizeSenseFrequency(
      { senses: [{ meaning: "n. 地址；演讲", level: "high" }] },
      SENSES,
    ),
    /条目数应为 3 条/,
  );
});

test("meaning 与请求未逐字一致时抛错", () => {
  assert.throws(
    () => normalizeSenseFrequency(
      {
        senses: [
          { meaning: "n. 地址、演讲", level: "high" },
          { meaning: "v. 处理，对付", level: "medium" },
          { meaning: "v. 向…讲话；演讲", level: "low" },
        ],
      },
      SENSES,
    ),
    /未一一对应/,
  );
});

test("level 非法时抛错", () => {
  assert.throws(
    () => normalizeSenseFrequency(
      {
        senses: [
          { meaning: "n. 地址；演讲", level: "high" },
          { meaning: "v. 处理，对付", level: "urgent" },
          { meaning: "v. 向…讲话；演讲", level: "low" },
        ],
      },
      SENSES,
    ),
    /字段不完整/,
  );
});

test("重复义项时抛错", () => {
  assert.throws(
    () => normalizeSenseFrequency(
      {
        senses: [
          { meaning: "n. 地址；演讲", level: "high" },
          { meaning: "n. 地址；演讲", level: "medium" },
          { meaning: "v. 向…讲话；演讲", level: "low" },
        ],
      },
      SENSES,
    ),
    /未一一对应/,
  );
});
