import {
  normalizeStoredState,
  type StoredState,
  type WordEnrichment,
} from "./study.ts";
import type { SerializedFsrsCard } from "./learning.ts";
import {
  startPerformanceTimer,
  type PerformanceTags,
} from "./performance-diagnostics.ts";

export const DATABASE_NAME = "wordloop-local";
export const DATABASE_VERSION = 3;
const CHANNEL_NAME = "wordloop-state-changes";
const CONCURRENT_WRITE_CODE = "CONCURRENT_WRITE";
const STORAGE_SOURCE_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

let knownRevision: number | null = null;

type StorageRevisionRecord = {
  revision?: unknown;
};

/**
 * 判断数据库中的 settings 是否仍是当前标签页已知的版本。
 * knownRevision 为 null 表示尚未成功读取数据库，此时只允许初始化真正的空库。
 */
export function matchesKnownStorageRevision(
  settings: StorageRevisionRecord | undefined,
  expectedRevision: number | null,
) {
  if (expectedRevision === null) return settings === undefined;
  if (settings === undefined) return expectedRevision === 0;

  const revision = Number.isSafeInteger(settings.revision)
    && Number(settings.revision) >= 0
    ? Number(settings.revision)
    : 0;
  return revision === expectedRevision;
}

export const STORES = {
  settings: "settings",
  reviews: "reviews",
  wordProgress: "word-progress",
  favorites: "favorites",
  mistakes: "mistakes",
  positions: "positions",
  enrichments: "enrichments",
  backups: "backups",
  fsrsCards: "fsrs-cards",
  stubbornWords: "stubborn-words",
  quizAttempts: "quiz-attempts",
  stateDomains: "state-domains",
} as const;

const CURRENT_STATE_ID = "current";
const LEGACY_STATE_STORE_NAMES = [
  STORES.settings,
  STORES.reviews,
  STORES.wordProgress,
  STORES.favorites,
  STORES.mistakes,
  STORES.positions,
  STORES.enrichments,
  STORES.fsrsCards,
  STORES.stubbornWords,
] as const;

type StateDomainRecord = {
  key: string;
  revision?: number;
  value: unknown;
};

type StateSettings = Pick<
  StoredState,
  | "schemaVersion"
  | "activeSession"
  | "lookupWords"
  | "lookupStats"
  | "familiarMeanings"
  | "started"
  | "dailyGoal"
  | "adaptiveNewWords"
  | "minimumNewWords"
  | "examDate"
  | "soundOn"
  | "studyMode"
  | "studyScope"
  | "shuffleSeed"
  | "selectedSection"
  | "selectedUnit"
  | "ratingUndoStack"
  | "activeQuiz"
> & {
  id: typeof CURRENT_STATE_ID;
  /** 单调递增计数器，跨标签页冲突检测 */
  revision: number;
};

type PositionRecord = {
  key: string;
  index: number;
};

type EnrichmentRecord = WordEnrichment & {
  wordId: number;
};

type WordProgressRecord = Omit<
  StoredState["wordProgress"][number],
  "fsrsCard"
>;

type FsrsCardRecord = SerializedFsrsCard & {
  wordId: number;
};

export type IndexedStateSnapshot = {
  settings: StateSettings;
  reviews: StoredState["reviews"];
  wordProgress: WordProgressRecord[];
  favorites: StoredState["favorites"];
  mistakes: StoredState["mistakes"];
  positions: PositionRecord[];
  enrichments: EnrichmentRecord[];
  fsrsCards: FsrsCardRecord[];
  stubbornWords: StoredState["stubbornWords"][number][];
  quizAttempts: StoredState["quizAttempts"];
};

function createStore(
  database: IDBDatabase,
  name: string,
  keyPath: string,
) {
  if (!database.objectStoreNames.contains(name)) {
    database.createObjectStore(name, { keyPath });
  }
}

export function openWordLoopDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    let settled = false;
    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(request.error);
    };
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(new Error("本地数据库升级被其他页面阻塞"));
    };
    request.onupgradeneeded = () => {
      const database = request.result;
      createStore(database, STORES.settings, "id");
      createStore(database, STORES.reviews, "id");
      createStore(database, STORES.wordProgress, "wordId");
      createStore(database, STORES.favorites, "wordId");
      createStore(database, STORES.mistakes, "wordId");
      createStore(database, STORES.positions, "key");
      createStore(database, STORES.enrichments, "wordId");
      createStore(database, STORES.backups, "id");
      createStore(database, STORES.fsrsCards, "wordId");
      createStore(database, STORES.stubbornWords, "wordId");
      createStore(database, STORES.stateDomains, "key");
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

export function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function transactionCompleted(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export function splitStoredState(state: StoredState): IndexedStateSnapshot {
  return {
    settings: {
      id: CURRENT_STATE_ID,
      revision: 0, // 占位值，writeSnapshot 中会读取当前 revision 并递增
      schemaVersion: state.schemaVersion,
      activeSession: state.activeSession,
      lookupWords: state.lookupWords,
      lookupStats: state.lookupStats,
      familiarMeanings: state.familiarMeanings,
      started: state.started,
      dailyGoal: state.dailyGoal,
      adaptiveNewWords: state.adaptiveNewWords,
      minimumNewWords: state.minimumNewWords,
      examDate: state.examDate,
      soundOn: state.soundOn,
      studyMode: state.studyMode,
      studyScope: state.studyScope,
      shuffleSeed: state.shuffleSeed,
      selectedSection: state.selectedSection,
      selectedUnit: state.selectedUnit,
      activeQuiz: state.activeQuiz,
      ratingUndoStack: state.ratingUndoStack,
    },
    reviews: state.reviews.map((review) => ({ ...review })),
    wordProgress: Object.values(state.wordProgress).map(({ fsrsCard: _fsrsCard, ...progress }) => {
      void _fsrsCard;
      return progress;
    }),
    favorites: state.favorites.map((favorite) => ({ ...favorite })),
    mistakes: state.mistakes.map((mistake) => ({ ...mistake })),
    positions: Object.entries(state.positions).map(([key, index]) => ({ key, index })),
    enrichments: Object.entries(state.enrichments).map(([wordId, enrichment]) => ({
      wordId: Number(wordId),
      ...enrichment,
    })),
    fsrsCards: Object.values(state.wordProgress).map((progress) => ({
      wordId: progress.wordId,
      ...progress.fsrsCard,
    })),
    stubbornWords: Object.values(state.stubbornWords)
      .map((record) => ({ ...record })),
    quizAttempts: state.quizAttempts.map((attempt) => ({ ...attempt })),
  };
}

export function combineStoredState(snapshot: IndexedStateSnapshot) {
  const {
    id: _id,
    ...settings
  } = snapshot.settings;
  void _id;
  const fsrsCards = new Map(
    snapshot.fsrsCards.map(({ wordId, ...card }) => [wordId, card]),
  );
  return normalizeStoredState({
    ...settings,
    reviews: snapshot.reviews,
    wordProgress: Object.fromEntries(
      snapshot.wordProgress.map((progress) => [
        progress.wordId,
        {
          ...progress,
          fsrsCard: fsrsCards.get(progress.wordId),
        },
      ]),
    ),
    favorites: snapshot.favorites,
    mistakes: snapshot.mistakes,
    positions: Object.fromEntries(
      snapshot.positions.map((position) => [position.key, position.index]),
    ),
    enrichments: Object.fromEntries(
      snapshot.enrichments.map(({ wordId, ...enrichment }) => [wordId, enrichment]),
    ),
    stubbornWords: Object.fromEntries(
      snapshot.stubbornWords.map((record) => [record.wordId, record]),
    ),
    quizAttempts: snapshot.quizAttempts,
  });
}

function buildStateDomainRecords(
  state: StoredState,
  revision: number,
): StateDomainRecord[] {
  const snapshot = splitStoredState(state);
  const { id: _id, revision: _revision, ...settings } = snapshot.settings;
  void _id;
  void _revision;
  return [
    { key: STORES.settings, revision, value: settings },
    { key: STORES.reviews, value: snapshot.reviews },
    { key: STORES.wordProgress, value: snapshot.wordProgress },
    { key: STORES.favorites, value: snapshot.favorites },
    { key: STORES.mistakes, value: snapshot.mistakes },
    { key: STORES.positions, value: snapshot.positions },
    { key: STORES.enrichments, value: snapshot.enrichments },
    { key: STORES.fsrsCards, value: snapshot.fsrsCards },
    { key: STORES.stubbornWords, value: snapshot.stubbornWords },
    { key: STORES.quizAttempts, value: snapshot.quizAttempts },
  ];
}

function combineStateDomainRecords(records: StateDomainRecord[]) {
  const domains = new Map(records.map((record) => [record.key, record]));
  const settingsRecord = domains.get(STORES.settings);
  if (!settingsRecord) return null;
  const revision = Number.isSafeInteger(settingsRecord.revision)
    && Number(settingsRecord.revision) >= 0
    ? Number(settingsRecord.revision)
    : 0;
  const settings = settingsRecord.value;
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error("本地设置数据格式无效");
  }
  const domainValue = <T,>(key: string, fallback: T): T =>
    (domains.get(key)?.value as T | undefined) ?? fallback;
  return {
    revision,
    state: combineStoredState({
      settings: {
        id: CURRENT_STATE_ID,
        revision,
        ...(settings as Omit<StateSettings, "id" | "revision">),
      },
      reviews: domainValue(STORES.reviews, []),
      wordProgress: domainValue(STORES.wordProgress, []),
      favorites: domainValue(STORES.favorites, []),
      mistakes: domainValue(STORES.mistakes, []),
      positions: domainValue(STORES.positions, []),
      enrichments: domainValue(STORES.enrichments, []),
      fsrsCards: domainValue(STORES.fsrsCards, []),
      stubbornWords: domainValue(STORES.stubbornWords, []),
      quizAttempts: domainValue(STORES.quizAttempts, []),
    }),
  };
}

async function readStateDomains(
  database: IDBDatabase,
  diagnosticTags?: PerformanceTags,
) {
  const readTimer = diagnosticTags
    ? startPerformanceTimer("state.restore.indexeddb_domains", diagnosticTags)
    : undefined;
  const transaction = database.transaction(STORES.stateDomains, "readonly");
  const completed = transactionCompleted(transaction);
  try {
    const records = await requestResult(
      transaction.objectStore(STORES.stateDomains).getAll(),
    ) as StateDomainRecord[];
    await completed;
    readTimer?.end({ recordCount: records.length });
    const normalizeTimer = diagnosticTags
      ? startPerformanceTimer("state.restore.normalize", diagnosticTags)
      : undefined;
    try {
      const state = combineStateDomainRecords(records);
      normalizeTimer?.end({ recordCount: records.length });
      return state;
    } catch (error) {
      normalizeTimer?.end({}, "error");
      throw error;
    }
  } catch (error) {
    readTimer?.end({}, "error");
    throw error;
  }
}

/** 首次读取 v2 旧分表后写入新的分域块，后续启动无需逐条扫描。 */
async function cacheLegacyState(
  database: IDBDatabase,
  state: StoredState,
  revision: number,
  diagnosticTags?: PerformanceTags,
) {
  const timer = diagnosticTags
    ? startPerformanceTimer("state.restore.migration_write", diagnosticTags)
    : undefined;
  const transaction = database.transaction(STORES.stateDomains, "readwrite");
  const completed = transactionCompleted(transaction);
  const store = transaction.objectStore(STORES.stateDomains);
  try {
    const current = await requestResult(
      store.get(STORES.settings),
    ) as StateDomainRecord | undefined;
    if (!current) {
      for (const record of buildStateDomainRecords(state, revision)) {
        store.put(record);
      }
    }
    await completed;
    timer?.end({ migrated: !current });
  } catch (error) {
    timer?.end({}, "error");
    throw error;
  }
}

async function writeSnapshot(state: StoredState) {
  const database = await openWordLoopDatabase();
  try {
    const baseRevision = knownRevision;
    const transaction = database.transaction(STORES.stateDomains, "readwrite");
    const completed = transactionCompleted(transaction);
    const store = transaction.objectStore(STORES.stateDomains);
    const currentSettings = await requestResult(
      store.get(STORES.settings),
    ) as StateDomainRecord | undefined;
    if (!matchesKnownStorageRevision(currentSettings, baseRevision)) {
      transaction.abort();
      await completed.catch(() => undefined);
      throw new Error(`${CONCURRENT_WRITE_CODE}: 另一标签页已修改数据`);
    }
    const newRevision = (baseRevision ?? 0) + 1;
    for (const record of buildStateDomainRecords(state, newRevision)) {
      store.put(record);
    }
    await completed;
    knownRevision = newRevision;

    // 通知其他标签页
    try {
      const bc = new BroadcastChannel(CHANNEL_NAME);
      bc.postMessage({
        revision: newRevision,
        sourceId: STORAGE_SOURCE_ID,
        timestamp: Date.now(),
      });
      bc.close();
    } catch {
      // BroadcastChannel 不可用时静默跳过
    }
  } finally {
    database.close();
  }
}

let lastWriteError: unknown = null;
let lastSuccessfulWrite = 0;

export function getLastStorageError() {
  return lastWriteError;
}

export function getLastSuccessfulWriteTime() {
  return lastSuccessfulWrite;
}

/** 监听其他标签页的数据变更，返回清理函数 */
export function onRemoteChange(callback: () => void) {
  try {
    const bc = new BroadcastChannel(CHANNEL_NAME);
    bc.onmessage = (event) => {
      if (event.data?.sourceId !== STORAGE_SOURCE_ID) callback();
    };
    return () => bc.close();
  } catch {
    return () => {};
  }
}

let pendingWrite = Promise.resolve();

function enqueueSnapshot(state: StoredState) {
  pendingWrite = pendingWrite
    .catch(() => undefined)
    .then(() => writeSnapshot(state))
    .then(() => {
      lastWriteError = null;
      lastSuccessfulWrite = Date.now();
    })
    .catch((error) => {
      lastWriteError = error;
      throw error;
    });
  return pendingWrite;
}

export function saveStoredState(state: StoredState) {
  return enqueueSnapshot(state);
}

/** 排在已有写入之后并立即确认持久化，供导入/恢复等权威写入使用。 */
export function saveStoredStateImmediate(state: StoredState) {
  return enqueueSnapshot(state);
}

export function isStorageConflictError(error: unknown) {
  return error instanceof Error && error.message.startsWith(CONCURRENT_WRITE_CODE);
}

export type StoredStateRead = {
  state: StoredState | null;
  revision: number;
};

/** 读取一致快照但不接管 revision；跨标签同步确认未发生本地编辑后再接管。 */
export async function readStoredState(
  diagnosticTags?: PerformanceTags,
): Promise<StoredStateRead> {
  const database = await openWordLoopDatabase();
  try {
    const current = await readStateDomains(database, diagnosticTags);
    if (current) return current;

    const legacyTimer = diagnosticTags
      ? startPerformanceTimer("state.restore.legacy_read", diagnosticTags)
      : undefined;
    const transaction = database.transaction(
      [...LEGACY_STATE_STORE_NAMES],
      "readonly",
    );
    const completed = transactionCompleted(transaction);
    const [
      settings,
      reviews,
      wordProgress,
      favorites,
      mistakes,
      positions,
      enrichments,
      fsrsCards,
      stubbornWords,
    ] = await Promise.all([
      requestResult(transaction.objectStore(STORES.settings).get(CURRENT_STATE_ID)),
      requestResult(transaction.objectStore(STORES.reviews).getAll()),
      requestResult(transaction.objectStore(STORES.wordProgress).getAll()),
      requestResult(transaction.objectStore(STORES.favorites).getAll()),
      requestResult(transaction.objectStore(STORES.mistakes).getAll()),
      requestResult(transaction.objectStore(STORES.positions).getAll()),
      requestResult(transaction.objectStore(STORES.enrichments).getAll()),
      requestResult(transaction.objectStore(STORES.fsrsCards).getAll()),
      requestResult(transaction.objectStore(STORES.stubbornWords).getAll()),
    ]);
    await completed;
    legacyTimer?.end({ empty: !settings });
    if (!settings) return { state: null, revision: 0 };
    const revision = Number.isSafeInteger((settings as StateSettings).revision)
      ? (settings as StateSettings).revision
      : 0;
    const state = combineStoredState({
      settings: settings as StateSettings,
      reviews: reviews as IndexedStateSnapshot["reviews"],
      wordProgress: wordProgress as IndexedStateSnapshot["wordProgress"],
      favorites: favorites as IndexedStateSnapshot["favorites"],
      mistakes: mistakes as IndexedStateSnapshot["mistakes"],
      positions: positions as IndexedStateSnapshot["positions"],
      enrichments: enrichments as IndexedStateSnapshot["enrichments"],
      fsrsCards: fsrsCards as IndexedStateSnapshot["fsrsCards"],
      stubbornWords: stubbornWords as IndexedStateSnapshot["stubbornWords"],
      quizAttempts: [],
    });
    await cacheLegacyState(database, state, revision, diagnosticTags);
    return (await readStateDomains(database, diagnosticTags)) ?? { state, revision };
  } finally {
    database.close();
  }
}

export function adoptStoredRevision(revision: number) {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error("本地数据库版本无效");
  }
  knownRevision = revision;
}

export async function loadStoredState(
  diagnosticTags: PerformanceTags = { startup: true },
) {
  const timer = startPerformanceTimer("state.restore.indexeddb_read", {
    ...diagnosticTags,
    startup: true,
  });
  try {
    const result = await readStoredState({
      ...diagnosticTags,
      startup: true,
    });
    adoptStoredRevision(result.revision);
    timer.end({ found: result.state !== null });
    return result.state;
  } catch (error) {
    timer.end({}, "error");
    throw error;
  }
}
