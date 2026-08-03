import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import {
  createBackupDocument,
  parseBackupDocument,
} from "../lib/backup.ts";
import {
  applyRating,
  type Rating,
  type WordProgressMap,
} from "../lib/learning.ts";
import {
  combineStoredState,
  splitStoredState,
} from "../lib/storage.ts";
import {
  parseStoredState,
  STORAGE_VERSION,
  type StoredState,
} from "../lib/study.ts";

const SOURCE_WORD_COUNT = 6550;
const MERGED_VARIANT_ID = 6177;
const LEARNING_WORD_IDS = Array.from(
  { length: SOURCE_WORD_COUNT },
  (_, index) => index + 1,
).filter((wordId) => wordId !== MERGED_VARIANT_ID);
const REVIEWS_PER_WORD = 4;
const EXPECTED_REVIEW_COUNT = LEARNING_WORD_IDS.length * REVIEWS_PER_WORD;

function sectionFor(wordId: number) {
  if (wordId <= 1856) return "必考词";
  if (wordId <= 5536) return "基础词";
  return "超纲词";
}

function buildLongTermState(): StoredState {
  const reviews: StoredState["reviews"] = [];
  const wordProgress: WordProgressMap = {};
  const baseTime = Date.UTC(2025, 0, 1, 0, 0, 0);
  const ratings: Rating[] = [2, 3, 2, 3];

  for (let round = 0; round < REVIEWS_PER_WORD; round += 1) {
    for (let index = 0; index < LEARNING_WORD_IDS.length; index += 1) {
      const wordId = LEARNING_WORD_IDS[index];
      const eventIndex = round * LEARNING_WORD_IDS.length + index;
      const reviewedAt = new Date(
        baseTime + eventIndex * 15 * 60 * 1000,
      ).toISOString();
      const result = applyRating(wordProgress[wordId], {
        wordId,
        word: `word-${wordId}`,
        rating: ratings[(round + wordId) % ratings.length],
        reviewedAt,
        reviewId: `stress:${round}:${wordId}`,
        sessionId: `stress:${round}`,
        recallMs: 700 + (wordId % 12_000),
        section: sectionFor(wordId),
        unit: Math.ceil(wordId / 100),
      });
      reviews.push(result.review);
      wordProgress[wordId] = result.progress;
    }
  }

  const favorites = LEARNING_WORD_IDS.slice(0, 1000).map((wordId, index) => ({
    wordId,
    addedAt: new Date(baseTime + index * 60_000).toISOString(),
  }));
  const mistakes = LEARNING_WORD_IDS.slice(1000, 1800).map((wordId, index) => ({
    wordId,
    addedAt: new Date(baseTime + index * 60_000).toISOString(),
    mistakeCount: 1 + (index % 8),
    lastRating: (index % 2) as 0 | 1,
    lastMistakeAt: new Date(baseTime + (index + 5000) * 60_000).toISOString(),
  }));
  const positions = Object.fromEntries(
    Array.from({ length: 200 }, (_, index) => [
      `selection:必考词:${index + 1}:ordered`,
      index * 3,
    ]),
  );
  const enrichments = Object.fromEntries(
    LEARNING_WORD_IDS.slice(0, 500).map((wordId) => [
      wordId,
      {
        sentence: `This is a deterministic example for word-${wordId}.`,
        translation: `这是 word-${wordId} 的确定性测试例句。`,
        collocations: [`word-${wordId} example`],
        source: "dictionary" as const,
        generatedAt: "2026-08-03T00:00:00.000Z",
      },
    ]),
  );
  const familiarMeanings = Object.fromEntries(
    LEARNING_WORD_IDS.slice(0, 1000).map((wordId) => [
      wordId,
      [`义项-${wordId}-1`, `义项-${wordId}-2`],
    ]),
  );
  const quizAttempts = Array.from({ length: 5000 }, (_, index) => ({
    id: `quiz:stress:${index}`,
    wordId: LEARNING_WORD_IDS[index % LEARNING_WORD_IDS.length],
    mode: "meaning-choice" as const,
    correct: index % 3 !== 0,
    recallMs: 900 + (index % 10_000),
    answeredAt: new Date(baseTime + index * 60_000).toISOString(),
    appliedToSchedule: index % 4 === 0,
  }));
  const ratingUndoStack = LEARNING_WORD_IDS.slice(0, 30).map((wordId, index) => ({
    reviewId: `stress:${REVIEWS_PER_WORD - 1}:${wordId}`,
    wordId,
    word: `word-${wordId}`,
    previousPosition: index,
    studyKey: "selection:必考词:1:ordered",
    selectedSection: "必考词",
    selectedUnit: 1,
    studyMode: "ordered" as const,
    studyScope: "selection" as const,
    shuffleSeed: 1,
  }));

  return {
    schemaVersion: STORAGE_VERSION,
    reviews,
    wordProgress,
    favorites,
    mistakes,
    stubbornWords: {},
    positions,
    activeSession: {
      id: "today:stress",
      kind: "today",
      title: "长期数据压力测试",
      wordIds: LEARNING_WORD_IDS.slice(0, 200),
      index: 73,
      createdAt: "2026-08-03T00:00:00.000Z",
    },
    quizAttempts,
    enrichments,
    lookupWords: [],
    familiarMeanings,
    started: true,
    dailyGoal: 30,
    adaptiveNewWords: true,
    minimumNewWords: 5,
    examDate: "2027-12-25",
    soundOn: true,
    studyMode: "ordered",
    studyScope: "selection",
    shuffleSeed: 1,
    selectedSection: "必考词",
    selectedUnit: 1,
    ratingUndoStack,
  };
}

test("数月级大体量状态可完整解析、分域拆装和备份", { timeout: 60_000 }, () => {
  const fixtureStartedAt = performance.now();
  const source = buildLongTermState();
  const fixtureMs = performance.now() - fixtureStartedAt;

  assert.equal(Object.keys(source.wordProgress).length, 6549);
  assert.equal(source.reviews.length, EXPECTED_REVIEW_COUNT);

  const raw = JSON.stringify(source);
  const rawBytes = new TextEncoder().encode(raw).byteLength;
  assert.ok(rawBytes > 6 * 1024 * 1024, `压力数据应超过 6 MiB，实际 ${rawBytes} 字节`);

  const parseStartedAt = performance.now();
  const normalized = parseStoredState(raw);
  const parseMs = performance.now() - parseStartedAt;

  assert.equal(normalized.schemaVersion, STORAGE_VERSION);
  assert.equal(normalized.reviews.length, EXPECTED_REVIEW_COUNT);
  assert.equal(Object.keys(normalized.wordProgress).length, 6549);
  assert.equal(normalized.favorites.length, 1000);
  assert.equal(normalized.mistakes.length, 800);
  assert.equal(normalized.quizAttempts.length, 5000);
  assert.equal(normalized.ratingUndoStack.length, 30);
  assert.equal(normalized.activeSession?.index, 73);
  assert.equal(normalized.reviews[0].id, "stress:0:1");
  assert.equal(normalized.reviews.at(-1)?.id, "stress:3:6550");

  const splitStartedAt = performance.now();
  const snapshot = splitStoredState(normalized);
  const restored = combineStoredState(snapshot);
  const splitAndCombineMs = performance.now() - splitStartedAt;

  assert.equal(snapshot.reviews.length, EXPECTED_REVIEW_COUNT);
  assert.equal(snapshot.wordProgress.length, 6549);
  assert.equal(snapshot.fsrsCards.length, 6549);
  assert.equal(snapshot.quizAttempts.length, 5000);
  assert.equal(restored.reviews.length, EXPECTED_REVIEW_COUNT);
  assert.equal(Object.keys(restored.wordProgress).length, 6549);
  assert.equal(restored.wordProgress[1].reviewCount, REVIEWS_PER_WORD);
  assert.equal(restored.wordProgress[6550].reviewCount, REVIEWS_PER_WORD);
  assert.deepEqual(restored.positions, normalized.positions);

  const backupRaw = JSON.stringify(createBackupDocument(
    restored,
    "2026-08-03T12:00:00.000Z",
  ));
  const backup = parseBackupDocument(backupRaw);
  assert.equal(backup.state.reviews.length, EXPECTED_REVIEW_COUNT);
  assert.equal(Object.keys(backup.state.wordProgress).length, 6549);

  console.log(JSON.stringify({
    wordCount: 6549,
    reviewCount: EXPECTED_REVIEW_COUNT,
    rawBytes,
    fixtureMs: Math.round(fixtureMs),
    parseMs: Math.round(parseMs),
    splitAndCombineMs: Math.round(splitAndCombineMs),
  }));
});
