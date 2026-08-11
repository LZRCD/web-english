import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStudyWordSource,
  createStudySession,
} from "../lib/learning.ts";
import { normalizeStoredState, type Word } from "../lib/study.ts";
import {
  answerVocabTestQuestion,
  buildVocabTestLayers,
  collectUnknownVocabTestWordIds,
  createVocabTestSession,
  currentVocabTestQuestion,
  estimateVocabTest,
  estimateVocabTestSection,
  sampleVocabTestLayer,
  selectNextVocabTestLayer,
  VOCAB_TEST_LAYER_QUOTAS,
  VOCAB_TEST_SECTIONS,
  VOCAB_TEST_TARGETS,
  type VocabTestAnswer,
  type VocabTestSection,
  type VocabTestSession,
} from "../lib/vocab-test.ts";

function makeWords(
  section: VocabTestSection,
  count: number,
  startId: number,
): Word[] {
  return Array.from({ length: count }, (_, index) => ({
    id: startId + index,
    word: `${section}-${index + 1}`,
    meaning: `释义-${index + 1}`,
    section,
    unit: Math.floor(index / 100) + 1,
  }));
}

function normalWords() {
  return [
    ...makeWords("必考词", 1856, 10_000),
    ...makeWords("基础词", 3680, 20_000),
    ...makeWords("超纲词", 1014, 30_000),
  ];
}

function finishSession(
  initial: VocabTestSession,
  decide: (session: VocabTestSession) => boolean,
) {
  let session = initial;
  let guard = 0;
  while (!session.complete && guard < 100) {
    session = answerVocabTestQuestion(session, decide(session));
    guard += 1;
  }
  assert.equal(session.complete, true);
  return session;
}

test("三个分册按现有词序每 100 个主学习项分层且不修改输入", () => {
  const words = [
    ...makeWords("必考词", 201, 10_000),
    ...makeWords("基础词", 101, 20_000),
    ...makeWords("超纲词", 2, 30_000),
  ];
  const snapshot = structuredClone(words);
  const layers = buildVocabTestLayers(words);

  assert.deepEqual(layers.必考词.map((layer) => layer.words.length), [100, 100, 1]);
  assert.deepEqual(layers.基础词.map((layer) => layer.words.length), [100, 1]);
  assert.deepEqual(layers.超纲词.map((layer) => layer.words.length), [2]);
  assert.deepEqual(layers.必考词[1].words.map((word) => word.id),
    words.slice(100, 200).map((word) => word.id));
  assert.deepEqual(words, snapshot);
});

test("固定 seed 每层抽取三个不同 ID，不同 seed 仍保持抽样不变量", () => {
  const layer = buildVocabTestLayers(makeWords("必考词", 100, 10_000)).必考词[0];
  const first = sampleVocabTestLayer(layer, 42);
  const repeated = sampleVocabTestLayer(layer, 42);
  const another = sampleVocabTestLayer(layer, 43);

  assert.deepEqual(first, repeated);
  assert.notDeepEqual(first.map((item) => item.id), another.map((item) => item.id));
  for (const sample of [first, another]) {
    assert.equal(sample.length, 3);
    assert.equal(new Set(sample.map((item) => item.id)).size, 3);
    assert.ok(sample.every((item) => layer.words.some((word) => word.id === item.id)));
  }
});

test("正常规模按 18 / 33 / 9 形成 60 题且不会遍历全部层", () => {
  const session = finishSession(createVocabTestSession(normalWords(), 20260811), () => true);

  assert.equal(session.expectedQuestionCount, 60);
  assert.equal(session.answers.length, 60);
  assert.deepEqual(
    VOCAB_TEST_SECTIONS.map((section) =>
      session.sectionStates[section].visitedLayerIndexes.length * 3),
    [18, 33, 9],
  );
  for (const section of VOCAB_TEST_SECTIONS) {
    assert.equal(
      session.sectionStates[section].visitedLayerIndexes.length,
      VOCAB_TEST_LAYER_QUOTAS[section],
    );
    assert.ok(
      session.sectionStates[section].visitedLayerIndexes.length
      < session.layers[section].length,
    );
  }
});

test("同一测试不会重复访问层或重复学习项", () => {
  const session = finishSession(
    createVocabTestSession(normalWords(), 7),
    (current) => current.answers.length % 4 !== 0,
  );
  const wordIds = session.answers.map((answer) => answer.id);
  assert.equal(new Set(wordIds).size, wordIds.length);
  for (const section of VOCAB_TEST_SECTIONS) {
    const visited = session.sectionStates[section].visitedLayerIndexes;
    assert.equal(new Set(visited).size, visited.length);
  }
});

test("同层至少两次认识向更高层移动，否则向更低层移动", () => {
  assert.ok(selectNextVocabTestLayer({
    layerCount: 10,
    currentLayerIndex: 4,
    majorityKnown: true,
    visitedLayerIndexes: [4],
  })! > 4);
  assert.ok(selectNextVocabTestLayer({
    layerCount: 10,
    currentLayerIndex: 4,
    majorityKnown: false,
    visitedLayerIndexes: [4],
  })! < 4);

  let knownSession = createVocabTestSession(makeWords("必考词", 1000, 10_000), 1);
  const knownStart = knownSession.currentLayerIndex!;
  knownSession = answerVocabTestQuestion(knownSession, true);
  knownSession = answerVocabTestQuestion(knownSession, true);
  knownSession = answerVocabTestQuestion(knownSession, false);
  assert.ok(knownSession.currentLayerIndex! > knownStart);

  let unknownSession = createVocabTestSession(makeWords("必考词", 1000, 10_000), 1);
  const unknownStart = unknownSession.currentLayerIndex!;
  unknownSession = answerVocabTestQuestion(unknownSession, false);
  unknownSession = answerVocabTestQuestion(unknownSession, false);
  unknownSession = answerVocabTestQuestion(unknownSession, true);
  assert.ok(unknownSession.currentLayerIndex! < unknownStart);
});

test("方向边界收敛后选择距离估算边界最近的未访问层", () => {
  const next = selectNextVocabTestLayer({
    layerCount: 6,
    currentLayerIndex: 5,
    majorityKnown: true,
    visitedLayerIndexes: [2, 4, 5],
    outcomes: [
      { layerIndex: 2, known: false },
      { layerIndex: 4, known: true },
      { layerIndex: 5, known: true },
    ],
  });
  assert.equal(next, 3);
  assert.ok(![2, 4, 5].includes(next!));
});

test("空分册、小分册和不足三词的末层安全降级", () => {
  const empty = createVocabTestSession([], 1);
  assert.equal(empty.complete, true);
  assert.equal(empty.expectedQuestionCount, 0);

  const twoWords = finishSession(
    createVocabTestSession(makeWords("必考词", 2, 10_000), 1),
    () => true,
  );
  assert.equal(twoWords.answers.length, 2);

  const partialLayer = finishSession(
    createVocabTestSession(makeWords("必考词", 101, 10_000), 1),
    () => true,
  );
  assert.equal(partialLayer.answers.length, 4);
  assert.equal(new Set(partialLayer.answers.map((answer) => answer.id)).size, 4);
});

test("分册估算和总估算始终限制在官方对照规模内", () => {
  const session = finishSession(
    createVocabTestSession(normalWords(), 99),
    (current) => current.answers.length % 5 !== 0,
  );
  const estimate = estimateVocabTest(session);

  for (const section of VOCAB_TEST_SECTIONS) {
    assert.ok(estimate.bySection[section] >= 0);
    assert.ok(estimate.bySection[section] <= VOCAB_TEST_TARGETS[section]);
  }
  assert.ok(estimate.total >= 0);
  assert.ok(estimate.total <= 6550);
  assert.equal(estimate.actualQuestionCount, 60);

  assert.equal(estimateVocabTestSection("必考词", 19, []), 0);
});

test("不认识 ID 去重且只收集实际作答为不认识的题目", () => {
  const base = {
    word: "alpha",
    section: "必考词" as const,
    layerIndex: 0,
  };
  const answers: VocabTestAnswer[] = [
    { ...base, id: 1, known: false },
    { ...base, id: 1, known: false },
    { ...base, id: 2, known: true },
    { ...base, id: 3, known: false },
  ];
  assert.deepEqual(collectUnknownVocabTestWordIds(answers), [1, 3]);
});

test("vocab-test 会话可恢复且学习来源不会回退为搜索专项", () => {
  const session = createStudySession(
    "vocab-test",
    "词汇量测试补漏",
    [1, 2],
    new Date("2026-08-11T08:00:00.000Z"),
  );
  const restored = normalizeStoredState({
    schemaVersion: 5,
    activeSession: session,
  }).activeSession;
  assert.equal(restored?.kind, "vocab-test");
  assert.deepEqual(restored?.wordIds, [1, 2]);

  const source = buildStudyWordSource({
    session,
    lookupPriority: false,
  });
  assert.equal(source.label, "词汇量测试补漏");
  assert.match(source.description, /刚完成词汇量测试.*不认识/);
  assert.doesNotMatch(source.label, /搜索/);
});

test("当前题始终来自会话已选访问层", () => {
  const session = createVocabTestSession(makeWords("必考词", 300, 10_000), 3);
  const question = currentVocabTestQuestion(session);
  assert.equal(question?.layerIndex, session.currentLayerIndex);
  assert.ok(session.sectionStates.必考词.visitedLayerIndexes.includes(question!.layerIndex));
});
