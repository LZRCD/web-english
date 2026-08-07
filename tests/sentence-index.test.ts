import assert from "node:assert/strict";
import test from "node:test";
import type { Word } from "../lib/study.ts";
import type { WordEnrichment } from "../lib/learning.ts";
import {
  buildSentenceIndex,
  reusedSentencesFor,
} from "../lib/sentence-index.ts";

const redbookWords: Word[] = [
  { id: 1, word: "abundant", meaning: "adj. 丰富的" },
  { id: 2, word: "harvest", meaning: "n. 收获" },
  { id: 3, word: "reflect", meaning: "v. 反映" },
];

const enrichments: Record<number, WordEnrichment> = {
  1: {
    source: "ai",
    senseExamples: [
      {
        meaning: "adj. 丰富的",
        sentence: "The abundant harvest surprised the whole village.",
        translation: "丰收让整个村庄都感到惊讶。",
        confidence: 0.9,
      },
    ],
  },
};

test("例句反向索引：例句中的词能被查到（含变形匹配）", () => {
  const index = buildSentenceIndex({ redbookWords, enrichments });
  // harvest 原形命中
  const forHarvest = reusedSentencesFor(index, "harvest");
  assert.equal(forHarvest.length, 1);
  assert.match(forHarvest[0].sentence, /abundant harvest/);
  assert.equal(forHarvest[0].sourceWord, "abundant");
  // village 不在词库，不收录
  assert.equal(reusedSentencesFor(index, "village").length, 0);
  // 来源词自身不收录（abundant 的例句不反向标注 abundant）
  assert.equal(reusedSentencesFor(index, "abundant").length, 0);
});

test("例句反向索引：查询词的变形可命中原形", () => {
  const index = buildSentenceIndex({ redbookWords, enrichments });
  // harvested 变形命中 harvest
  const harvests = redbookWords;
  void harvests;
  const forHarvested = reusedSentencesFor(index, "harvested");
  assert.equal(forHarvested.length, 1);
});

test("例句反向索引：语义二审 failed 的例句不参与复用，passed 例句正常收录", () => {
  const reviewedEnrichments: Record<number, WordEnrichment> = {
    1: {
      source: "ai",
      senseExamples: [
        {
          meaning: "adj. 丰富的",
          sentence: "The abundant harvest surprised the whole village.",
          translation: "丰收让整个村庄都感到惊讶。",
          review: { status: "failed", reviewedAt: "2026-08-01T00:00:00.000Z" },
        },
        {
          meaning: "adj. 丰富的",
          sentence: "The harvest festival reflects local culture.",
          translation: "丰收节反映了当地文化。",
          review: { status: "passed", reviewedAt: "2026-08-01T00:00:00.000Z" },
        },
      ],
    },
  };
  const index = buildSentenceIndex({
    redbookWords,
    enrichments: reviewedEnrichments,
  });
  // failed 例句被过滤：harvest 只命中 passed 例句，不再命中 failed 例句
  const forHarvest = reusedSentencesFor(index, "harvest");
  assert.equal(forHarvest.length, 1);
  assert.match(forHarvest[0].sentence, /festival reflects/);
  assert.doesNotMatch(forHarvest[0].sentence, /whole village/);
  // passed 例句里的 reflects（reflect 变形）仍可复用
  const forReflect = reusedSentencesFor(index, "reflects");
  assert.equal(forReflect.length, 1);
  assert.match(forReflect[0].sentence, /reflects local culture/);
});
