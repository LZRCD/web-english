// tests/combined-part.test.ts
// E2 引擎落地回归：splitWordSensesWithParts 的组合词性并集规则。
// 规则：跨词性按 text 去重（首个出现保留）；part 取所有持有该文本的词性并集；
// {vi, vt} 并集规范化为 "vi. vt."；其它组合保持原顺序；文本集合/顺序与 splitWordSenses 一致。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  splitWordSenses,
  splitWordSensesWithParts,
} from "../lib/word-utils.ts";

test("同段 vi. vt. 合并为一条规范化 vi. vt. 义项", () => {
  assert.deepEqual(splitWordSensesWithParts({ meaning: "vi. vt. 选择,挑选" }), [
    { part: "vi. vt.", text: "选择" },
    { part: "vi. vt.", text: "挑选" },
  ]);
});

test("同段 vt. vi. 顺序归一化为 vi. vt.（顺序对语义无影响）", () => {
  assert.deepEqual(splitWordSensesWithParts({ meaning: "vt. vi. 放弃;抛弃" }), [
    { part: "vi. vt.", text: "放弃" },
    { part: "vi. vt.", text: "抛弃" },
  ]);
});

test("跨段同文本（n. + vt.）不并集：保持首词性（E2 边界：仅 {vi,vt} 并集）", () => {
  assert.deepEqual(splitWordSensesWithParts({ meaning: "n. 地址 vt. 地址" }), [
    { part: "n.", text: "地址" },
  ]);
});

test("非 {vi, vt} 组合段不做并集：跨段同文本保持首词性（如 adv. prep.）", () => {
  const senses = splitWordSensesWithParts({
    meaning: "adv. prep. 穿过,从一边到另一边;在 对面 prep. 遍及",
  });
  // text 去重后：穿过/从一边到另一边/在 对面/遍及（顺序与旧 splitWordSenses 一致）
  assert.deepEqual(senses.map((s) => s.text), ["穿过", "从一边到另一边", "在 对面", "遍及"]);
  // 前三条文本同时被 adv. 与 prep. 持有 → 非 {vi,vt} → 保持首词性 adv.
  assert.equal(senses[0].part, "adv.");
  assert.equal(senses[1].part, "adv.");
  assert.equal(senses[2].part, "adv.");
  // 遍及 仅由 prep. 持有
  assert.equal(senses[3].part, "prep.");
});

test("文本集合与顺序与 splitWordSenses 完全一致", () => {
  const meanings = [
    "vi. vt. 选择,挑选",
    "vt. vi. 放弃;抛弃",
    "vi. vt. (使) 蒸发,(使) 挥发 vi. 逐渐消失",
    "n. 地址 vt. 地址",
    "adv. prep. 穿过,从一边到另一边;在 对面 prep. 遍及",
    "int. vi. vt. 冲,闯",
  ];
  for (const meaning of meanings) {
    const withParts = splitWordSensesWithParts({ meaning }).map((s) => s.text);
    const plain = splitWordSenses({ meaning });
    assert.deepEqual(withParts, plain, `texts 不一致: ${meaning}`);
  }
});

test("三连 int. vi. vt. 不合并（含非 {vi,vt} 词性 → 保持首词性）", () => {
  assert.deepEqual(splitWordSensesWithParts({ meaning: "int. vi. vt. 冲,闯" }), [
    { part: "int.", text: "冲" },
    { part: "int.", text: "闯" },
  ]);
});
