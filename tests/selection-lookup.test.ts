import assert from "node:assert/strict";
import test from "node:test";
import {
  lookupWordId,
  type LookupWord,
} from "../lib/study.ts";
import {
  buildWordTextIndex,
  learningWordId,
  lookupIdentity,
  resolveKnownLookupResult,
  upsertLookupWord,
  type LookupResult,
} from "../lib/selection-lookup.ts";

test("savedLookup 重建保留红宝书身份，再次保存不生成第二 identity", () => {
  const savedLookup: LookupWord = {
    id: 9_000_001_330,
    linkedWordId: 1330,
    query: "state",
    kind: "word",
    phonetic: "/steit/",
    phoneticSource: "redbook",
    part: "n. vt. adj.",
    meaning: "状况；陈述；国家的",
    note: "必考词 · Unit 19",
    source: "redbook",
    addedAt: "2026-08-01T00:00:00.000Z",
  };

  const resolved = resolveKnownLookupResult({
    query: "STATE",
    context: "Synthetic context only.",
    wordByText: buildWordTextIndex([]),
    lookupWords: [savedLookup],
    lookupCache: {},
    phoneticIndex: {},
  });

  assert.ok(resolved);
  assert.equal(resolved.cached, true);
  assert.equal(resolved.result.linkedWordId, 1330);
  assert.equal(lookupIdentity(resolved.result), "redbook:1330");

  const repeated = upsertLookupWord(
    [savedLookup],
    resolved.result,
    "2026-08-02T00:00:00.000Z",
  );
  assert.equal(repeated.length, 1);
  assert.equal(repeated[0].id, savedLookup.id);
  assert.equal(repeated[0].addedAt, savedLookup.addedAt);
  assert.equal(repeated[0].linkedWordId, savedLookup.linkedWordId);
  assert.equal(learningWordId(repeated[0]), savedLookup.linkedWordId);
});

test("普通 lookup 保留旧数据兼容与 id 碰撞规避", () => {
  const legacy: LookupWord = {
    id: lookupWordId("legacy"),
    query: "legacy",
    kind: "word",
    phonetic: "",
    part: "本地词典",
    meaning: "旧数据",
    note: "ECDICT 离线释义",
    source: "dictionary",
    addedAt: "2026-08-01T00:00:00.000Z",
  };
  const resolved = resolveKnownLookupResult({
    query: "LEGACY",
    context: "Synthetic context only.",
    wordByText: buildWordTextIndex([]),
    lookupWords: [legacy],
    lookupCache: {},
    phoneticIndex: {},
  });
  assert.ok(resolved);
  assert.equal(resolved.result.linkedWordId, undefined);
  assert.equal(lookupIdentity(resolved.result), "lookup:legacy");
  const repeated = upsertLookupWord([legacy], resolved.result);
  assert.equal(repeated.length, 1);
  assert.equal(repeated[0].id, legacy.id);
  assert.equal(repeated[0].addedAt, legacy.addedAt);

  const query = "collision-a";
  const candidate = lookupWordId(query);
  const colliding: LookupWord = {
    ...legacy,
    id: candidate,
    query: "collision-b",
  };
  const plainResult: LookupResult = {
    query,
    kind: "word",
    phonetic: "",
    part: "本地词典",
    meaning: "普通缓存",
    note: "ECDICT 离线释义",
    source: "dictionary",
  };
  const inserted = upsertLookupWord([colliding], plainResult);
  assert.equal(inserted.length, 2);
  assert.notEqual(inserted[0].id, candidate);
  assert.equal(inserted[0].linkedWordId, undefined);
  assert.equal(lookupIdentity(inserted[0]), "lookup:collision-a");
});
