import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSenseKey,
  buildWordDatasetInputKey,
  senseIdentitiesForWord,
  isValidSenseFrequencyEntry,
  isValidSenseExampleEntry,
  isValidEtymologyDatasetEntry,
  type SenseFrequencyDatasetEntry,
  type SenseExampleDatasetEntry,
} from "../lib/sense-datasets.ts";
import { splitWordSenses } from "../lib/word-utils.ts";
import {
  datasetFrequencyToDisplay,
  mergeSenseExamples,
  personalSenseFrequencyValid,
} from "../lib/merged-senses.ts";
import {
  checkSentenceStructure,
  createDedupeIndex,
  nearDuplicateRatio,
  sentenceContainsWord,
} from "../scripts/lib/example-quality.mjs";
import {
  forwardForms,
  tokenMatchesWord,
} from "../scripts/lib/corpus-search.mjs";
import type { Word } from "../lib/study.ts";
import type { WordEnrichment, SenseFrequencyEntry } from "../lib/learning.ts";

const WORD: Word = {
  id: 1,
  word: "radiate",
  meaning: "vt. vi. 散发,流露;发出 (光、辐射等) vi. 呈辐射状发散 (或伸展)",
};

test("义项库存：senseIdentity 与运行时 splitWordSenses 逐字一致", () => {
  const identities = senseIdentitiesForWord(WORD, 1);
  const runtime = splitWordSenses(WORD);
  assert.equal(identities.length, runtime.length);
  identities.forEach((identity, index) => {
    assert.equal(identity.senseIndex, index);
    assert.equal(identity.text, runtime[index]);
  });
});

test("senseKey 由当前真实输入确定性生成，任一成分变化都会失效", () => {
  const key = buildSenseKey(1, 0, "散发,流露");
  assert.equal(buildSenseKey(1, 0, "散发,流露"), key);
  assert.notEqual(buildSenseKey(2, 0, "散发,流露"), key);
  assert.notEqual(buildSenseKey(1, 1, "散发,流露"), key);
  assert.notEqual(buildSenseKey(1, 0, "散发、流露"), key);
});

test("词级输入身份对同一真实输入稳定，释义变化即失效", () => {
  const base = {
    dataset: "sense-examples",
    schemaVersion: 1,
    promptVersion: "sense-examples-prompt-v1",
    wordId: 1,
    senses: ["散发,流露", "发出 (光、辐射等)"],
  };
  const key = buildWordDatasetInputKey(base);
  assert.equal(buildWordDatasetInputKey(structuredClone(base)), key);
  assert.notEqual(
    buildWordDatasetInputKey({ ...base, senses: [...base.senses].reverse() }),
    key,
  );
});

test("义项考频条目校验：拒绝伪人工核验、无依据等级与结构缺失", () => {
  const valid: SenseFrequencyDatasetEntry = {
    wordId: 1,
    senseIndex: 0,
    senseKey: buildSenseKey(1, 0, "散发,流露"),
    level: "high",
    basis: "corpus_supported",
    confidence: 0.8,
    paperCount: 9,
    occurrenceCount: 11,
    years: [2010],
    paperTypes: ["english-one"],
    evidence: [{
      paperId: "2010-english-one",
      year: 2010,
      paperType: "english-one",
      section: "reading",
      contextHash: "ab12cd34ef56",
    }],
    methodVersion: "sense-frequency-method-v1",
    modelId: "deepseek-v4-flash",
    humanReviewed: false,
    reasonCodes: ["corpus_supported"],
    note: "本地真题语料支持",
  };
  assert.equal(isValidSenseFrequencyEntry(valid), true);
  assert.equal(isValidSenseFrequencyEntry({ ...valid, humanReviewed: true }), false);
  assert.equal(isValidSenseFrequencyEntry({
    ...valid, level: "high", basis: "needs_review",
  }), false);
  assert.equal(isValidSenseFrequencyEntry({
    ...valid, basis: "corpus_supported", evidence: [],
  }), false);
  assert.equal(isValidSenseFrequencyEntry({
    ...valid, level: null, basis: "corpus_supported",
  }), false);
});

test("释义例句条目校验：model_passed 必须有复核置信度，禁止伪人工核验", () => {
  const valid: SenseExampleDatasetEntry = {
    wordId: 1,
    senseIndex: 0,
    senseKey: buildSenseKey(1, 0, "散发,流露"),
    sentence: "The old stove radiated a gentle heat that filled the room.",
    translation: "旧炉子散发出的温和热量充满了房间。",
    source: "ai_original",
    generationConfidence: 0.8,
    reviewStatus: "model_passed",
    reviewConfidence: 0.9,
    reasonCodes: [],
    inputKey: "input-key",
    promptVersion: "sense-examples-prompt-v1",
    modelId: "deepseek-v4-flash",
    humanReviewed: false,
    generatedAt: "2026-08-14T00:00:00.000Z",
  };
  assert.equal(isValidSenseExampleEntry(valid), true);
  assert.equal(isValidSenseExampleEntry({ ...valid, humanReviewed: true }), false);
  assert.equal(isValidSenseExampleEntry({
    ...valid, reviewConfidence: null,
  }), false);
  assert.equal(isValidSenseExampleEntry({
    ...valid, reviewStatus: "needs_review", reviewConfidence: null,
  }), true);
});

test("词根助记条目校验：诚实模式允许 root=null 与空 affixes", () => {
  const mnemonicOnly = {
    wordId: 1,
    inputKey: "k",
    mode: "mnemonic_only",
    breakdown: "联想拆分：radi-（光线联想）+-ate（动词联想），非真实词根。",
    root: null,
    affixes: [],
    mnemonic: "AI 联想：光线向四周散开。",
    reasonCodes: [],
    promptVersion: "etymology-prompt-v1",
    modelId: "deepseek-v4-flash",
    humanReviewed: false,
    generatedAt: "2026-08-14T00:00:00.000Z",
  };
  assert.equal(isValidEtymologyDatasetEntry(mnemonicOnly), true);
  assert.equal(isValidEtymologyDatasetEntry({
    ...mnemonicOnly, mode: "verified_morphology",
  }), false);
  assert.equal(isValidEtymologyDatasetEntry({ ...mnemonicOnly, humanReviewed: true }), false);
});

test("个人考频缓存有效性：必须与当前义项列表逐字一致", () => {
  const entries: SenseFrequencyEntry[] = [
    { meaning: "散发,流露", level: "high" },
    { meaning: "发出 (光、辐射等)", level: "medium" },
  ];
  assert.equal(personalSenseFrequencyValid(entries, ["散发,流露", "发出 (光、辐射等)"]), true);
  assert.equal(personalSenseFrequencyValid(entries, ["散发,流露"]), false);
  assert.equal(personalSenseFrequencyValid(undefined, []), false);
});

test("基础考频映射为展示条目：无等级记录不产生虚假徽标", () => {
  const dataset: SenseFrequencyDatasetEntry[] = [
    {
      wordId: 1, senseIndex: 0,
      senseKey: buildSenseKey(1, 0, "散发,流露"),
      level: "high", basis: "corpus_supported", confidence: 0.8,
      paperCount: 9, occurrenceCount: 11, years: [2010], paperTypes: ["english-one"],
      evidence: [{
        paperId: "2010-english-one", year: 2010, paperType: "english-one",
        section: "reading", contextHash: "h",
      }],
      methodVersion: "v1", modelId: "m", humanReviewed: false,
      reasonCodes: [], note: "n",
    },
    {
      wordId: 1, senseIndex: 1,
      senseKey: buildSenseKey(1, 1, "发出 (光、辐射等)"),
      level: null, basis: "needs_review", confidence: null,
      paperCount: 0, occurrenceCount: 0, years: [], paperTypes: [],
      evidence: [], methodVersion: "v1", modelId: "m", humanReviewed: false,
      reasonCodes: ["unstable_judgments"], note: "待人工复核",
    },
  ];
  const display = datasetFrequencyToDisplay(dataset, ["散发,流露", "发出 (光、辐射等)"]);
  assert.ok(display);
  assert.equal(display.length, 1);
  assert.equal(display[0].meaning, "散发,流露");
  assert.equal(display[0].level, "high");
});

test("例句按义项合并：个人重写覆盖对应义项，其余基础例句完整保留", () => {
  const senseTexts = ["散发,流露", "发出 (光、辐射等)", "呈辐射状发散 (或伸展)"];
  const dataset: SenseExampleDatasetEntry[] = senseTexts.map((text, index) => ({
    wordId: 1,
    senseIndex: index,
    senseKey: buildSenseKey(1, index, text),
    sentence: `dataset sentence ${index}`,
    translation: `数据集译文 ${index}`,
    source: "ai_original",
    generationConfidence: 0.8,
    reviewStatus: "model_passed",
    reviewConfidence: 0.9,
    reasonCodes: [],
    inputKey: "k",
    promptVersion: "v1",
    modelId: "m",
    humanReviewed: false,
    generatedAt: "2026-08-14T00:00:00.000Z",
  }));
  const personal: WordEnrichment = {
    source: "ai",
    senseExamples: [{
      meaning: "发出 (光、辐射等)",
      sentence: "personal rewritten sentence",
      translation: "个人重写译文",
      confidence: 0.9,
    }],
  };
  const merged = mergeSenseExamples({ senseTexts, enrichment: personal, dataset });
  assert.equal(merged.length, 3);
  assert.equal(merged[0]?.sentence, "dataset sentence 0");
  assert.equal(merged[0]?.source, "dataset");
  assert.equal(merged[1]?.sentence, "personal rewritten sentence");
  assert.equal(merged[1]?.source, "personal");
  assert.equal(merged[2]?.sentence, "dataset sentence 2");
});

test("例句按义项合并：二审失败的个人例句保留显示并带复核徽标（不静默消失）", () => {
  const senseTexts = ["散发,流露"];
  const dataset: SenseExampleDatasetEntry[] = [{
    wordId: 1,
    senseIndex: 0,
    senseKey: buildSenseKey(1, 0, senseTexts[0]),
    sentence: "dataset passed sentence",
    translation: "数据集译文",
    source: "ai_original",
    generationConfidence: 0.8,
    reviewStatus: "model_passed",
    reviewConfidence: 0.9,
    reasonCodes: [],
    inputKey: "k",
    promptVersion: "v1",
    modelId: "m",
    humanReviewed: false,
    generatedAt: "2026-08-14T00:00:00.000Z",
  }];
  const personal: WordEnrichment = {
    source: "ai",
    senseExamples: [{
      meaning: senseTexts[0],
      sentence: "failed personal sentence",
      translation: "失败译文",
      review: { status: "failed", reviewedAt: "2026-08-14T00:00:00.000Z" },
    }],
  };
  const merged = mergeSenseExamples({ senseTexts, enrichment: personal, dataset });
  assert.equal(merged[0]?.sentence, "failed personal sentence");
  assert.equal(merged[0]?.source, "personal");
  assert.equal(merged[0]?.personalReview?.status, "failed");
  // 无个人例句的义项才回退基础例句
  const mergedWithoutPersonal = mergeSenseExamples({
    senseTexts,
    enrichment: undefined,
    dataset,
  });
  assert.equal(mergedWithoutPersonal[0]?.sentence, "dataset passed sentence");
});

test("例句确定性质检：目标词形、结构、模板与近似重复", () => {
  assert.equal(sentenceContainsWord("The old stove radiated a gentle heat yesterday.", "radiate"), true);
  assert.equal(sentenceContainsWord("The old stove produced gentle heat yesterday.", "radiate"), false);
  assert.equal(sentenceContainsWord("The bride looked radiant at the evening ceremony.", "radiant"), true);
  assert.deepEqual(
    checkSentenceStructure("The old stove radiated a gentle heat yesterday.", "译文"),
    [],
  );
  assert.ok(
    checkSentenceStructure("radiated gentle heat", "译文")
      .includes("missing_terminal_punctuation"),
  );
  assert.ok(
    checkSentenceStructure("The word radiate means to send out light.", "译文")
      .includes("meta_language_template"),
  );
  const ratio = nearDuplicateRatio(
    "The old stove radiated a gentle heat that filled the room.",
    "The old stove radiated a gentle heat that filled the hall.",
  );
  assert.equal(ratio.nearDuplicate, true);
});

test("全库查重索引：完全相同与高重叠句被检出", () => {
  const index = createDedupeIndex([
    "Researchers found that steady attention often produces stronger understanding.",
  ]);
  const same = index.findNearDuplicate(
    "Researchers found that steady attention often produces stronger understanding.",
  );
  assert.equal(same.nearDuplicate, true);
  const different = index.findNearDuplicate(
    "The committee revised its notes before publishing the final report yesterday.",
  );
  assert.equal(different.nearDuplicate, false);
});

test("词形匹配：屈折与不规则形态双向命中", () => {
  assert.deepEqual(forwardForms("study").sort(), [
    "studied", "studies", "studying", "studys", "study", "studyed",
  ].sort());
  assert.equal(tokenMatchesWord("studies", "study"), true);
  assert.equal(tokenMatchesWord("went", "go"), true);
  assert.equal(tokenMatchesWord("goes", "go"), true);
  assert.equal(tokenMatchesWord("going", "go"), true);
  assert.equal(tokenMatchesWord("gos", "go"), true);
});
