import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  BACKUP_FORMAT,
  createBackupDocument,
  parseBackupDocument,
} from "../lib/backup.ts";
import { applyRating } from "../lib/learning.ts";
import {
  parseRecoveryCopies,
  parseRecoveryCopy,
  removeRecoveryCopyFromRaw,
  serializeRecoveryCopies,
} from "../lib/recovery.ts";
import { normalizeSenseExamples } from "../lib/enrichment.ts";
import {
  parseStoredState,
  STORAGE_VERSION,
  type StoredState,
} from "../lib/study.ts";
import { matchesKnownStorageRevision } from "../lib/storage.ts";

function emptyState(): StoredState {
  return {
    schemaVersion: STORAGE_VERSION,
    reviews: [],
    wordProgress: {},
    favorites: [],
    mistakes: [],
    stubbornWords: {},
    positions: {},
    enrichments: {},
    lookupWords: [],
    familiarMeanings: {},
    started: false,
    dailyGoal: 20,
    adaptiveNewWords: true,
    minimumNewWords: 5,
    examDate: "",
    soundOn: true,
    studyMode: "ordered",
    studyScope: "selection",
    shuffleSeed: 1,
    selectedSection: "必考词",
    selectedUnit: 1,
    ratingUndoStack: [],
    quizAttempts: [],
  };
}

test("未读取过数据库时只允许初始化真正的空库", () => {
  assert.equal(matchesKnownStorageRevision(undefined, null), true);
  assert.equal(matchesKnownStorageRevision({ revision: 0 }, null), false);
  assert.equal(matchesKnownStorageRevision({}, null), false);
  assert.equal(matchesKnownStorageRevision({ revision: undefined }, null), false);
});

test("读取后仍可迁移缺 revision 的旧 settings 记录", () => {
  assert.equal(matchesKnownStorageRevision({}, 0), true);
  assert.equal(matchesKnownStorageRevision(undefined, 0), true);
  assert.equal(matchesKnownStorageRevision({ revision: 1 }, 0), false);
  assert.equal(matchesKnownStorageRevision({ revision: 3 }, 3), true);
});

test("状态解析拒绝非对象、非法版本和未来版本", () => {
  for (const raw of ["null", "[]", "42", '"state"']) {
    assert.throws(() => parseStoredState(raw), /状态数据格式无效/);
  }
  assert.throws(
    () => parseStoredState(JSON.stringify({ schemaVersion: "broken" })),
    /状态数据版本无效/,
  );
  assert.throws(
    () => parseStoredState(JSON.stringify({ schemaVersion: STORAGE_VERSION + 1 })),
    /来自更新版本/,
  );
});

test("内容补充必须为每个释义恰好返回一条例句", () => {
  const senses = ["辐射", "流露"];
  const normalized = normalizeSenseExamples([
    { meaning: "流露", sentence: "She radiates confidence.", translation: "她流露出自信。", confidence: 2 },
    { meaning: "辐射", sentence: "Stars radiate energy.", translation: "恒星辐射能量。", confidence: 0.6 },
  ], senses);
  assert.deepEqual(normalized.map((item) => item.meaning), senses);
  assert.deepEqual(normalized.map((item) => item.confidence), [0.6, 1]);
  assert.throws(
    () => normalizeSenseExamples(normalized.slice(0, 1), senses),
    /例句数量应为 2 条/,
  );
  assert.throws(
    () => normalizeSenseExamples([
      normalized[0],
      { ...normalized[1], meaning: "其他" },
    ], senses),
    /未一一对应/,
  );
});

test("音标质量清单覆盖全书并记录来源、版本与 IPA 体系", () => {
  const metadata = JSON.parse(readFileSync(
    new URL("../public/data/phonetic-metadata.json", import.meta.url),
    "utf8",
  ));
  assert.equal(metadata.coverage.total, 6550);
  assert.equal(metadata.coverage.covered, 6550);
  assert.equal(
    Object.keys(metadata.entries).length,
    metadata.coverage.uniqueEntries,
  );
  const entries = Object.values(metadata.entries as Record<string, {
    source: string;
    sourceVersion: string;
    confidence: string;
    ipaSystem: string;
    era: string;
    evidence: string;
  }>);
  assert.equal(
    entries.filter((entry) =>
      entry.source === "override").length,
    metadata.coverage.overrides,
  );
  for (const entry of entries) {
    assert.match(entry.sourceVersion, /^[a-f0-9]{64}$/);
    assert.ok(["high", "medium"].includes(entry.confidence));
    if (entry.source === "override") {
      assert.equal(entry.ipaSystem, "IPA");
      assert.equal(entry.era, "modern");
    } else {
      assert.equal(entry.ipaSystem, "ECDICT-mixed");
      assert.equal(entry.era, "unverified");
    }
    assert.ok(entry.evidence);
  }
});

test("数据构建报告绑定内容版本并保留 ASR 模型与验证报告证据", () => {
  const manifest = JSON.parse(readFileSync(
    new URL("../public/data/data-manifest.json", import.meta.url),
    "utf8",
  ));
  const report = JSON.parse(readFileSync(
    new URL("../reports/data-build-report.json", import.meta.url),
    "utf8",
  ));
  const provenanceRaw = readFileSync(
    new URL("../scripts/data-provenance.json", import.meta.url),
  );
  const provenance = JSON.parse(provenanceRaw.toString("utf8"));
  assert.equal(report.format, "wordloop-data-build-report-v2");
  assert.equal(report.contentVersion, manifest.contentVersion);
  assert.equal(
    report.provenance.sha256,
    createHash("sha256").update(provenanceRaw).digest("hex"),
  );
  assert.equal(report.provenance.liveVerification.complete, true);
  assert.deepEqual(
    report.tools.whisper.declaredModels.map((item: { name: string }) => item.name),
    ["openai/whisper-tiny.en", "openai/whisper-base.en"],
  );
  assert.ok(report.tools.whisper.validationReports.length >= 2);
  for (const evidence of report.tools.whisper.validationReports) {
    assert.match(
      evidence.sha256 ?? evidence.recordedSha256,
      /^[a-f0-9]{64}$/,
    );
  }
  assert.equal(report.tools.whisper.modelHashesComplete, true);
  assert.deepEqual(report.tools.whisper.modelSnapshots, provenance.whisper.models);
  for (const model of report.tools.whisper.modelSnapshots) {
    assert.match(model.revision, /^[a-f0-9]{40}$/);
    assert.match(model.sha256, /^[a-f0-9]{64}$/);
    assert.ok(model.bytes > 100_000_000);
  }
  assert.match(report.tools.ffmpeg, /^ffmpeg version 8\.1\.2/);
  assert.equal(
    report.tools.ffmpegEvidence.binarySha256,
    provenance.ffmpeg.binarySha256,
  );
  assert.equal(report.upstream.ecdict.commit, provenance.ecdict.commit);
  assert.equal(
    report.upstream.ecdict.source.recordedSha256,
    provenance.ecdict.sourceSha256,
  );
  assert.equal(report.upstream.ecdict.verification.matchedShards, 26);
});

test("Range 索引绑定当前分片哈希且所有字节范围有效", () => {
  const dictionaryUrl = new URL("../public/data/dictionary/", import.meta.url);
  const rootRaw = readFileSync(new URL("ranges.json", dictionaryUrl));
  const index = JSON.parse(rootRaw.toString("utf8"));
  assert.equal(index.version, 4);
  assert.ok(rootRaw.byteLength < 8 * 1024);
  const sizes: number[] = [];
  for (const letter of "abcdefghijklmnopqrstuvwxyz") {
    const raw = readFileSync(new URL(`${letter}.json`, dictionaryUrl));
    const hash = createHash("sha256").update(raw).digest("hex");
    const releaseName = `${letter}.${hash.slice(0, 16)}`;
    assert.equal(index.shardHashes[letter], hash);
    assert.equal(index.releaseFiles[letter], releaseName);
    assert.deepEqual(
      readFileSync(new URL(`${releaseName}.json`, dictionaryUrl)),
      raw,
    );
    const letterRaw = readFileSync(
      new URL(`ranges/${letter}.json`, dictionaryUrl),
    );
    const letterHash = createHash("sha256").update(letterRaw).digest("hex");
    const letterReleaseName = `${letter}.${letterHash.slice(0, 16)}`;
    assert.equal(index.rangeIndexHashes[letter], letterHash);
    assert.equal(index.rangeIndexFiles[letter], letterReleaseName);
    assert.ok(letterRaw.byteLength < 64 * 1024);
    assert.deepEqual(
      readFileSync(
        new URL(`ranges/${letterReleaseName}.json`, dictionaryUrl),
      ),
      letterRaw,
    );
    const letterIndex = JSON.parse(letterRaw.toString("utf8")) as {
      version: number;
      letter: string;
      ranges: Record<string, Array<[string, number, number]>>;
    };
    assert.equal(letterIndex.version, 1);
    assert.equal(letterIndex.letter, letter);
    for (const [prefix, ranges] of Object.entries(letterIndex.ranges)) {
      assert.ok(prefix.startsWith(letter));
      for (const [file, start, end] of ranges) {
        assert.equal(file, letter);
        assert.ok(start >= 1 && end >= start && end < raw.byteLength - 1);
        const fragment = raw.subarray(start, end + 1).toString("utf8");
        assert.doesNotThrow(() => JSON.parse(`{${fragment}}`));
        sizes.push(end - start + 1);
      }
    }
  }
  assert.equal(sizes.length, 11_831);
  assert.ok(sizes.every((size) => size > 0));
  assert.ok(Math.max(...sizes) < 1024 * 1024);
});

test("备份解析校验日期、文档版本和状态版本一致性", () => {
  const state = emptyState();
  assert.equal(
    parseBackupDocument(JSON.stringify(createBackupDocument(state))).schemaVersion,
    STORAGE_VERSION,
  );
  assert.throws(
    () => parseBackupDocument(JSON.stringify({
      format: BACKUP_FORMAT,
      schemaVersion: STORAGE_VERSION,
      exportedAt: "not-a-date",
      state,
    })),
    /导出日期无效/,
  );
  assert.throws(
    () => parseBackupDocument(JSON.stringify({
      format: BACKUP_FORMAT,
      schemaVersion: STORAGE_VERSION - 1,
      exportedAt: new Date().toISOString(),
      state,
    })),
    /版本信息不一致/,
  );
  assert.throws(
    () => parseBackupDocument(JSON.stringify({
      format: BACKUP_FORMAT,
      schemaVersion: STORAGE_VERSION + 1,
      exportedAt: new Date().toISOString(),
      state: { ...state, schemaVersion: STORAGE_VERSION + 1 },
    })),
    /来自更新版本/,
  );
});

test("恢复集合兼容旧单份数据并保留多份副本", () => {
  const firstRaw = JSON.stringify(emptyState());
  const secondRaw = JSON.stringify({ ...emptyState(), dailyGoal: 30 });
  const legacy = parseRecoveryCopies(firstRaw);
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].state?.dailyGoal, 20);

  const serialized = serializeRecoveryCopies([
    parseRecoveryCopy(firstRaw, "first", "2026-07-28T08:00:00.000Z"),
    parseRecoveryCopy(secondRaw, "second", "2026-07-29T08:00:00.000Z"),
  ]);
  const restored = parseRecoveryCopies(serialized);
  assert.deepEqual(restored.map((copy) => copy.id), ["first", "second"]);
  assert.deepEqual(
    restored.map((copy) => copy.state?.dailyGoal),
    [20, 30],
  );
});

test("恢复集合按 ID 只删除目标副本，并保留同原文的其他副本", () => {
  const sharedRaw = JSON.stringify(emptyState());
  const otherRaw = JSON.stringify({ ...emptyState(), dailyGoal: 30 });
  const storedRaw = serializeRecoveryCopies([
    parseRecoveryCopy(sharedRaw, "shared-first", "2026-07-28T08:00:00.000Z"),
    parseRecoveryCopy(sharedRaw, "shared-second", "2026-07-28T09:00:00.000Z"),
    parseRecoveryCopy(otherRaw, "other", "2026-07-29T08:00:00.000Z"),
  ]);

  const result = removeRecoveryCopyFromRaw(storedRaw, {
    id: "shared-second",
    raw: sharedRaw,
  });

  assert.equal(result.removed?.id, "shared-second");
  assert.ok(result.nextRaw);
  assert.deepEqual(
    parseRecoveryCopies(result.nextRaw).map((copy) => copy.id),
    ["shared-first", "other"],
  );
});

test("恢复集合在 ID 失效时按原文兜底，但只删除首个匹配项", () => {
  const sharedRaw = JSON.stringify(emptyState());
  const storedRaw = serializeRecoveryCopies([
    parseRecoveryCopy(sharedRaw, "first", "2026-07-28T08:00:00.000Z"),
    parseRecoveryCopy(sharedRaw, "second", "2026-07-28T09:00:00.000Z"),
  ]);

  const result = removeRecoveryCopyFromRaw(storedRaw, {
    id: "stale-id",
    raw: sharedRaw,
  });

  assert.equal(result.removed?.id, "first");
  assert.ok(result.nextRaw);
  assert.deepEqual(
    parseRecoveryCopies(result.nextRaw).map((copy) => copy.id),
    ["second"],
  );
});

test("恢复副本删除结果区分删空与未命中", () => {
  const legacyRaw = JSON.stringify(emptyState());
  const removed = removeRecoveryCopyFromRaw(legacyRaw, { raw: legacyRaw });
  assert.equal(removed.removed?.raw, legacyRaw);
  assert.deepEqual(removed.remaining, []);
  assert.equal(removed.nextRaw, null);

  const storedRaw = serializeRecoveryCopies([
    parseRecoveryCopy(legacyRaw, "kept", "2026-07-28T08:00:00.000Z"),
  ]);
  const untouched = removeRecoveryCopyFromRaw(storedRaw, { id: "missing" });
  assert.equal(untouched.removed, null);
  assert.equal(untouched.nextRaw, storedRaw);
  assert.deepEqual(untouched.remaining.map((copy) => copy.id), ["kept"]);
});

test("重复评分 ID 与 IndexedDB 一致地保留最后一条", () => {
  const reviewedAt = "2026-07-28T08:00:00.000Z";
  const state = parseStoredState(JSON.stringify({
    ...emptyState(),
    reviews: [
      {
        id: "duplicate",
        wordId: 1,
        word: "abandon",
        rating: 0,
        kind: "new",
        reviewedAt,
        dueAt: "2026-07-28T08:10:00.000Z",
        intervalMs: 600_000,
        section: "必考词",
        unit: 1,
      },
      {
        id: "duplicate",
        wordId: 1,
        word: "abandon",
        rating: 3,
        kind: "review",
        reviewedAt: "2026-07-28T09:00:00.000Z",
        dueAt: "2026-08-09T09:00:00.000Z",
        intervalMs: 1_036_800_000,
        section: "必考词",
        unit: 1,
      },
    ],
  }));

  assert.equal(state.reviews.length, 1);
  assert.equal(state.reviews[0].rating, 3);
});

test("评分按发生时间恢复顺序，而不是沿用 IndexedDB 主键顺序", () => {
  const state = parseStoredState(JSON.stringify({
    ...emptyState(),
    reviews: [
      {
        id: "a-newer",
        wordId: 2,
        word: "ability",
        rating: 2,
        kind: "review",
        reviewedAt: "2026-07-28T09:00:00.000Z",
        dueAt: "2026-08-01T09:00:00.000Z",
        intervalMs: 345_600_000,
        section: "必考词",
        unit: 1,
      },
      {
        id: "z-older",
        wordId: 1,
        word: "abandon",
        rating: 1,
        kind: "new",
        reviewedAt: "2026-07-28T08:00:00.000Z",
        dueAt: "2026-07-29T08:00:00.000Z",
        intervalMs: 86_400_000,
        section: "必考词",
        unit: 1,
      },
    ],
  }));

  assert.deepEqual(state.reviews.map((review) => review.id), ["z-older", "a-newer"]);
});

test("单个损坏 FSRS 卡只重建对应单词，健康进度不受影响", () => {
  const first = applyRating(undefined, {
    wordId: 1,
    word: "abandon",
    rating: 2,
    reviewedAt: "2026-07-28T08:00:00.000Z",
    section: "必考词",
    unit: 1,
  });
  const second = applyRating(undefined, {
    wordId: 2,
    word: "ability",
    rating: 1,
    reviewedAt: "2026-07-28T08:01:00.000Z",
    section: "必考词",
    unit: 1,
  });
  const state = parseStoredState(JSON.stringify({
    ...emptyState(),
    reviews: [first.review, second.review],
    wordProgress: {
      1: first.progress,
      2: {
        ...second.progress,
        fsrsCard: {
          ...second.progress.fsrsCard,
          stability: -1,
        },
      },
      3: {
        ...second.progress,
        wordId: 3,
        fsrsCard: undefined,
      },
    },
  }));

  assert.deepEqual(state.wordProgress[1].fsrsCard, first.progress.fsrsCard);
  assert.ok(state.wordProgress[2].fsrsCard.stability >= 0);
  assert.equal(state.wordProgress[3], undefined);
});

test("健康进度存在时，缺失或整体损坏的其他词仍从评分重建", () => {
  const first = applyRating(undefined, {
    wordId: 1,
    word: "abandon",
    rating: 2,
    reviewedAt: "2026-07-28T08:00:00.000Z",
    section: "必考词",
    unit: 1,
  });
  const second = applyRating(undefined, {
    wordId: 2,
    word: "ability",
    rating: 1,
    reviewedAt: "2026-07-28T08:01:00.000Z",
    section: "必考词",
    unit: 1,
  });
  const third = applyRating(undefined, {
    wordId: 3,
    word: "aboard",
    rating: 3,
    reviewedAt: "2026-07-28T08:02:00.000Z",
    section: "必考词",
    unit: 1,
  });
  const state = parseStoredState(JSON.stringify({
    ...emptyState(),
    reviews: [first.review, second.review, third.review],
    wordProgress: {
      1: first.progress,
      2: {
        ...second.progress,
        lastReviewedAt: "invalid",
      },
    },
  }));

  assert.deepEqual(state.wordProgress[1].fsrsCard, first.progress.fsrsCard);
  assert.ok(state.wordProgress[2]?.fsrsCard);
  assert.ok(state.wordProgress[3]?.fsrsCard);
});

test("合法但落后于最新评分的 FSRS 进度会按该词历史重建", () => {
  const first = applyRating(undefined, {
    wordId: 1,
    word: "abandon",
    rating: 1,
    reviewedAt: "2026-07-28T08:00:00.000Z",
    section: "必考词",
    unit: 1,
  });
  const latest = applyRating(first.progress, {
    wordId: 1,
    word: "abandon",
    rating: 3,
    reviewedAt: "2026-07-29T09:00:00.000Z",
    section: "必考词",
    unit: 1,
  });
  const state = parseStoredState(JSON.stringify({
    ...emptyState(),
    reviews: [first.review, latest.review],
    wordProgress: {
      1: first.progress,
    },
  }));

  assert.equal(state.wordProgress[1].lastReviewedAt, latest.progress.lastReviewedAt);
  assert.equal(state.wordProgress[1].reviewCount, 2);
});

test("红宝书同形词按 linkedWordId 分开保存，重复关联只保留一条", () => {
  const state = parseStoredState(JSON.stringify({
    ...emptyState(),
    lookupWords: [
      {
        id: 1_000_001,
        linkedWordId: 20,
        query: "march",
        kind: "word",
        phonetic: "",
        part: "v.",
        meaning: "行进",
        note: "",
        source: "redbook",
        addedAt: "2026-07-28T08:00:00.000Z",
      },
      {
        id: 1_000_001,
        linkedWordId: 3000,
        query: "March",
        kind: "word",
        phonetic: "",
        part: "n.",
        meaning: "三月",
        note: "",
        source: "redbook",
        addedAt: "2026-07-28T08:01:00.000Z",
      },
      {
        id: 1_000_002,
        linkedWordId: 3000,
        query: "March",
        kind: "word",
        phonetic: "",
        part: "n.",
        meaning: "重复",
        note: "",
        source: "redbook",
        addedAt: "2026-07-28T08:02:00.000Z",
      },
    ],
  }));

  assert.equal(state.lookupWords.length, 2);
  assert.deepEqual(
    state.lookupWords.map((word) => word.linkedWordId),
    [20, 3000],
  );
});
