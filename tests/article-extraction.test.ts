import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeArticleCandidates,
  filterArticleCandidates,
  projectArticleConfirmation,
  selectVisibleArticleCandidates,
  type ArticleCandidate,
} from "../lib/article-extraction.ts";
import { lookupWordId, type LookupWord, type Word } from "../lib/study.ts";
import { tokenizeEnglishArticle } from "../lib/word-utils.ts";
import type { LookupResult } from "../lib/selection-lookup.ts";
import type { WordProgress, WordProgressMap } from "../lib/learning.ts";

function lookupResult(query: string): LookupResult {
  return {
    query,
    kind: "word",
    phonetic: `/${query}/`,
    phoneticSource: "dictionary",
    part: "本地词典",
    meaning: `${query} 的释义`,
    note: "ECDICT 离线释义",
    source: "dictionary",
  };
}

function lookupWord(
  query: string,
  id = lookupWordId(query),
  addedAt = "2026-08-01T00:00:00.000Z",
): LookupWord {
  return { ...lookupResult(query), id, addedAt };
}

function progress(
  wordId: number,
  status: WordProgress["status"],
): WordProgress {
  return {
    wordId,
    status,
    firstLearnedAt: "2026-08-01T00:00:00.000Z",
    lastReviewedAt: "2026-08-01T00:00:00.000Z",
    nextDueAt: "2026-08-02T00:00:00.000Z",
    lastRating: 2,
    reviewCount: 1,
    successCount: 1,
    lapseCount: 0,
    consecutiveSuccesses: 1,
    intervalMs: 86_400_000,
    fsrsCard: {
      due: "2026-08-02T00:00:00.000Z",
      stability: 1,
      difficulty: 5,
      elapsedDays: 1,
      scheduledDays: 1,
      learningSteps: 0,
      reps: 1,
      lapses: 0,
      state: 2,
      lastReview: "2026-08-01T00:00:00.000Z",
    },
  };
}

function dictionaryCandidate(query: string): ArticleCandidate {
  return {
    token: query,
    word: query,
    source: "dictionary",
    status: "unlearned",
    lookupResult: lookupResult(query),
  };
}

test("文章 tokenizer 统一大小写与标点，去重并保留首次出现顺序", () => {
  assert.deepEqual(
    tokenizeEnglishArticle("Hello, WORLD!\nhello... can't stop."),
    {
      tokens: ["hello", "world", "can't", "stop"],
      totalUniqueCount: 4,
      truncatedCount: 0,
    },
  );
});

test("文章 tokenizer 归一弯撇号与不同连字符，只保留内部连接符", () => {
  assert.deepEqual(
    tokenizeEnglishArticle("‘Don’t’ — state–of‑the‑art -edge- rock'n'roll"),
    {
      tokens: ["don't", "state-of-the-art", "edge", "rock'n'roll"],
      totalUniqueCount: 4,
      truncatedCount: 0,
    },
  );
});

test("文章 tokenizer 空文本返回空结果，200 个上限报告真实截断数", () => {
  assert.deepEqual(tokenizeEnglishArticle("   中文，123。"), {
    tokens: [],
    totalUniqueCount: 0,
    truncatedCount: 0,
  });
  const uniqueWords = Array.from({ length: 203 }, (_, index) => {
    const first = String.fromCharCode(97 + Math.floor(index / 26));
    const second = String.fromCharCode(97 + index % 26);
    return `token${first}${second}`;
  });
  const result = tokenizeEnglishArticle(uniqueWords.join(" "));
  assert.equal(result.tokens.length, 200);
  assert.deepEqual(result.tokens.slice(0, 2), ["tokenaa", "tokenab"]);
  assert.equal(result.totalUniqueCount, 203);
  assert.equal(result.truncatedCount, 3);
});

test("候选解析优先红宝书再已保存 lookup，ECDICT 只处理剩余 token", async () => {
  const redbookWords: Word[] = [
    { id: 1, word: "Abandon", meaning: "v. 放弃" },
  ];
  const saved = lookupWord("contextualized", 9_000_123);
  const queried: string[] = [];
  const result = await analyzeArticleCandidates({
    tokens: ["abandon", "contextualized", "elucidator"],
    redbookWords,
    lookupWords: [saved, { ...lookupWord("abandon"), meaning: "不应命中" }],
    wordProgress: {},
    queryDictionary: async (query) => {
      queried.push(query);
      return lookupResult(query);
    },
  });

  assert.deepEqual(result.candidates.map((item) => item.source), [
    "redbook",
    "lookup",
    "dictionary",
  ]);
  assert.deepEqual(result.candidates.map((item) => item.learningWordId), [
    1,
    9_000_123,
    undefined,
  ]);
  assert.equal(result.candidates[1]?.lookupWord, saved);
  assert.deepEqual(queried, ["elucidator"]);
});

test("ECDICT 峰值并发不超过 4，乱序完成仍恢复文章顺序", async () => {
  const tokens = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];
  let active = 0;
  let peak = 0;
  const result = await analyzeArticleCandidates({
    tokens,
    redbookWords: [],
    lookupWords: [],
    wordProgress: {},
    queryDictionary: async (query) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(
        resolve,
        (tokens.length - tokens.indexOf(query)) * 2,
      ));
      active -= 1;
      return lookupResult(query);
    },
  });

  assert.ok(peak <= 4);
  assert.deepEqual(result.candidates.map((item) => item.token), tokens);
});

test("未命中与词典查询失败分别统计，其他成功候选继续保留", async () => {
  const result = await analyzeArticleCandidates({
    tokens: ["found", "missing", "broken", "foundlater"],
    redbookWords: [],
    lookupWords: [],
    wordProgress: {},
    queryDictionary: async (query) => {
      if (query === "missing") return null;
      if (query === "broken") throw new Error("range unavailable");
      return lookupResult(query);
    },
  });

  assert.deepEqual(result.candidates.map((item) => item.token), [
    "found",
    "foundlater",
  ]);
  assert.equal(result.unmatchedCount, 1);
  assert.equal(result.failedCount, 1);
});

test("候选使用真实学习 ID 完成四分类和数量统计", async () => {
  const redbookWords: Word[] = [
    { id: 1, word: "alpha", meaning: "甲" },
    { id: 2, word: "bravo", meaning: "乙" },
    { id: 3, word: "charlie", meaning: "丙" },
  ];
  const saved = lookupWord("delta", 9_000_222);
  const wordProgress: WordProgressMap = {
    1: progress(1, "learning"),
    2: progress(2, "reviewing"),
    3: progress(3, "mastered"),
  };
  const result = await analyzeArticleCandidates({
    tokens: ["unseen", "alpha", "bravo", "charlie", "delta"],
    redbookWords,
    lookupWords: [saved],
    wordProgress,
    queryDictionary: async (query) => lookupResult(query),
  });

  assert.deepEqual(result.candidates.map((item) => item.status), [
    "unlearned",
    "learning",
    "reviewing",
    "mastered",
    "unlearned",
  ]);
  assert.deepEqual(result.statusCounts, {
    unlearned: 2,
    learning: 1,
    reviewing: 1,
    mastered: 1,
  });
});

test("mastered 默认隐藏且可展开，状态筛选不改顺序或其他选择", () => {
  const candidates: ArticleCandidate[] = [
    { ...dictionaryCandidate("first"), status: "learning" },
    { ...dictionaryCandidate("second"), status: "mastered" },
    dictionaryCandidate("third"),
  ];
  const hidden = filterArticleCandidates(candidates, {
    status: "all",
    showMastered: false,
  });
  const expanded = filterArticleCandidates(candidates, {
    status: "all",
    showMastered: true,
  });
  const learningOnly = filterArticleCandidates(candidates, {
    status: "learning",
    showMastered: true,
  });
  const selected = selectVisibleArticleCandidates(
    new Set(["second"]),
    hidden,
  );

  assert.deepEqual(hidden.map((item) => item.token), ["first", "third"]);
  assert.deepEqual(expanded.map((item) => item.token), [
    "first",
    "second",
    "third",
  ]);
  assert.deepEqual(learningOnly.map((item) => item.token), ["first"]);
  assert.deepEqual([...selected], ["second", "first", "third"]);
});

test("确认投影只保存选中的新 ECDICT，批内冲突仍分配不同真实 ID", () => {
  const collidingId = lookupWordId("collision-alpha");
  const existing = lookupWord(
    "occupied",
    collidingId,
    "2026-07-31T00:00:00.000Z",
  );
  const candidates: ArticleCandidate[] = [
    dictionaryCandidate("collision-alpha"),
    dictionaryCandidate("collision-beta"),
    dictionaryCandidate("excluded"),
  ];
  const projection = projectArticleConfirmation({
    candidates,
    selectedTokens: new Set(["collision-alpha", "collision-beta"]),
    lookupWords: [existing],
    confirmedAt: "2026-08-11T08:00:00.000Z",
  });

  assert.equal(projection.changed, true);
  assert.equal(projection.lookupWords.length, 3);
  assert.equal(projection.lookupWords.some((item) => item.query === "excluded"), false);
  assert.equal(new Set(projection.wordIds).size, 2);
  assert.notEqual(projection.wordIds[0], collidingId);
  assert.notEqual(projection.wordIds[0], projection.wordIds[1]);
  assert.deepEqual(
    projection.lookupWords
      .filter((item) => item.query.startsWith("collision-"))
      .map((item) => item.addedAt),
    ["2026-08-11T08:00:00.000Z", "2026-08-11T08:00:00.000Z"],
  );
});

test("确认投影保留既有 lookup 身份时间，会话 ID 去重且保持文章顺序", () => {
  const existing = lookupWord(
    "existing",
    9_000_321,
    "2026-07-01T00:00:00.000Z",
  );
  const candidates: ArticleCandidate[] = [
    {
      token: "redbook-first",
      word: "redbook-first",
      source: "redbook",
      status: "unlearned",
      learningWordId: 1,
    },
    {
      token: "existing",
      word: "existing",
      source: "lookup",
      status: "unlearned",
      learningWordId: existing.id,
      lookupWord: existing,
    },
    { ...dictionaryCandidate("same-identity"), learningWordId: undefined },
    {
      token: "redbook-duplicate",
      word: "redbook-duplicate",
      source: "redbook",
      status: "unlearned",
      learningWordId: 1,
    },
  ];
  const preexistingIdentity = lookupWord(
    "same-identity",
    9_000_654,
    "2026-06-01T00:00:00.000Z",
  );
  const projection = projectArticleConfirmation({
    candidates,
    selectedTokens: new Set(candidates.map((item) => item.token)),
    lookupWords: [existing, preexistingIdentity],
    confirmedAt: "2026-08-11T08:00:00.000Z",
  });

  const preserved = projection.lookupWords.find(
    (item) => item.query === "same-identity",
  );
  assert.equal(preserved?.id, preexistingIdentity.id);
  assert.equal(preserved?.addedAt, preexistingIdentity.addedAt);
  assert.deepEqual(projection.wordIds, [1, existing.id, preexistingIdentity.id]);
});

test("空选择不产生 lookupWords 变化或空会话 ID", () => {
  const existing = [lookupWord("existing")];
  const projection = projectArticleConfirmation({
    candidates: [dictionaryCandidate("new-word")],
    selectedTokens: new Set(),
    lookupWords: existing,
    confirmedAt: "2026-08-11T08:00:00.000Z",
  });

  assert.equal(projection.changed, false);
  assert.equal(projection.lookupWords, existing);
  assert.deepEqual(projection.wordIds, []);
});
