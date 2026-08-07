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

test("例句反向索引：词形双向展开，原形与变形互相可查", () => {
  const index = buildSentenceIndex({
    redbookWords,
    enrichments: {
      3: {
        source: "ai",
        senseExamples: [{
          meaning: "v. 反映",
          sentence: "The abundant harvest reflects the hard work.",
          translation: "丰收反映了辛勤劳动。",
        }],
      },
    },
  });
  // 例句含 reflects（变形），查询原形 reflect 可命中（索引侧展开收录）
  const forReflect = reusedSentencesFor(index, "reflect");
  assert.equal(forReflect.length, 1);
  assert.match(forReflect[0].sentence, /reflects the hard work/);
  // 例句含 harvest（原形），查询变形 harvested 仍可命中（查询侧展开）
  const forHarvested = reusedSentencesFor(index, "harvested");
  assert.equal(forHarvested.length, 1);
  assert.match(forHarvested[0].sentence, /harvest reflects/);
});

test("例句反向索引：来源词查询次数加权排序生效", () => {
  const index = buildSentenceIndex({
    redbookWords,
    enrichments: {
      1: {
        source: "ai",
        senseExamples: [{
          meaning: "adj. 丰富的",
          sentence: "The abundant harvest surprised everyone.",
          translation: "丰收让大家惊讶。",
        }],
      },
      3: {
        source: "ai",
        senseExamples: [{
          meaning: "v. 反映",
          sentence: "The report reflects a big harvest.",
          translation: "报告反映了大丰收。",
        }],
      },
    },
  });
  const lookupWords: import("../lib/study.ts").LookupWord[] = [{
    id: 9_000_000_001,
    linkedWordId: 3,
    query: "reflect",
    kind: "word",
    phonetic: "",
    part: "v.",
    meaning: "反映",
    note: "",
    source: "redbook",
    addedAt: "2026-08-01T00:00:00.000Z",
  }];
  const ranked = reusedSentencesFor(index, "harvest", {
    lookupStats: {
      reflect: {
        count: 5,
        firstAt: "2026-08-01T00:00:00.000Z",
        lastAt: "2026-08-05T00:00:00.000Z",
      },
    },
    lookupWords,
  });
  // 来源词 reflect 查过 5 次，其例句排最前
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].sourceWord, "reflect");
});

test("例句反向索引：不规则动词变形双向命中", () => {
  const index = buildSentenceIndex({
    redbookWords: [
      { id: 1, word: "go", meaning: "v. 去" },
      { id: 2, word: "buy", meaning: "v. 买" },
      { id: 3, word: "harvest", meaning: "n. 收获" },
    ],
    enrichments: {
      1: {
        source: "ai",
        senseExamples: [{
          meaning: "v. 去",
          sentence: "They went to the market yesterday.",
          translation: "他们昨天去了市场。",
        }],
      },
      2: {
        source: "ai",
        senseExamples: [{
          meaning: "v. 买",
          sentence: "She bought a book about harvest.",
          translation: "她买了一本关于丰收的书。",
        }],
      },
    },
  });
  // 例句含 went，查询原形 go 可命中（索引侧收录 override 原形）
  const forGo = reusedSentencesFor(index, "go");
  assert.equal(forGo.length, 1);
  assert.match(forGo[0].sentence, /went to the market/);
  // 例句含 bought，查询原形 buy 可命中
  const forBuy = reusedSentencesFor(index, "buy");
  assert.equal(forBuy.length, 1);
  assert.match(forBuy[0].sentence, /bought a book/);
  // 反向：查询变形 went / bought 也可命中例句
  assert.equal(reusedSentencesFor(index, "went").length, 1);
  assert.equal(reusedSentencesFor(index, "bought").length, 1);
});

test("例句反向索引：来源词薄弱度优先于查询次数加权", () => {
  const index = buildSentenceIndex({
    redbookWords,
    enrichments: {
      1: {
        source: "ai",
        senseExamples: [{
          meaning: "adj. 丰富的",
          sentence: "The abundant harvest surprised everyone.",
          translation: "丰收让大家惊讶。",
        }],
      },
      3: {
        source: "ai",
        senseExamples: [{
          meaning: "v. 反映",
          sentence: "The report reflects a big harvest.",
          translation: "报告反映了大丰收。",
        }],
      },
    },
  });
  const lookupWords: import("../lib/study.ts").LookupWord[] = [
    {
      id: 9_000_000_001,
      linkedWordId: 3,
      query: "reflect",
      kind: "word",
      phonetic: "",
      part: "v.",
      meaning: "反映",
      note: "",
      source: "redbook",
      addedAt: "2026-08-01T00:00:00.000Z",
    },
  ];
  const wordProgress = {
    1: {
      wordId: 1,
      lapseCount: 2,
      lastRating: 0,
      lastReviewedAt: "2026-08-02T00:00:00.000Z",
    },
  } as unknown as import("../lib/learning.ts").WordProgressMap;
  const ranked = reusedSentencesFor(index, "harvest", {
    lookupStats: {
      reflect: {
        count: 5,
        firstAt: "2026-08-01T00:00:00.000Z",
        lastAt: "2026-08-05T00:00:00.000Z",
      },
    },
    lookupWords,
    wordProgress,
  });
  // 来源词 reflect 查过 5 次，但来源词 abundant 更薄弱（lapse 2 次）→ 排最前
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].sourceWord, "abundant");
  assert.equal(ranked[1].sourceWord, "reflect");
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
