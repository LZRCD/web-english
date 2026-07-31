import {
  parseStoredState,
  type StoredState,
  type WordEnrichment,
} from "./study.ts";
import type { SerializedFsrsCard } from "./learning.ts";

export const DATABASE_NAME = "wordloop-local";
export const DATABASE_VERSION = 2;
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
} as const;

const CURRENT_STATE_ID = "current";
const STATE_STORE_NAMES = [
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

type StateSettings = Pick<
  StoredState,
  | "schemaVersion"
  | "activeSession"
  | "lookupWords"
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
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
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
  return parseStoredState(JSON.stringify({
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
  }));
}

/** 增量写入：逐条 upsert 后删除快照中不存在的旧记录 */
async function putStore<T>(
  store: IDBObjectStore,
  values: T[],
  keyPath: string,
) {
  // 逐条 upsert（利用主键），不再 clear 全量重写
  for (const value of values) store.put(value);

  // 删除快照中不存在的旧记录（如移出收藏的词）。
  // 用 getAllKeys 一次性取出现有主键并求差，避免游标逐条扫描大表。
  const snapshotKeys = new Set(
    values.map((value) => {
      const key = (value as Record<string, unknown>)[keyPath];
      return String(key);
    }),
  );
  const existingKeys = await requestResult(store.getAllKeys());
  for (const key of existingKeys) {
    if (!snapshotKeys.has(String(key))) store.delete(key);
  }
}

async function writeSnapshot(snapshot: IndexedStateSnapshot) {
  const database = await openWordLoopDatabase();
  try {
    // 读取当前 revision，并与本标签页最后一次加载/保存的版本比较。
    const baseRevision = knownRevision;
    const readTx = database.transaction(STORES.settings, "readonly");
    const currentSettings = await requestResult(
      readTx.objectStore(STORES.settings).get(CURRENT_STATE_ID),
    ) as StateSettings | undefined;
    // 未成功读取过数据库时，只允许创建真正的空数据库，不能覆盖缺 revision 的旧记录。
    if (!matchesKnownStorageRevision(currentSettings, baseRevision)) {
      throw new Error(`${CONCURRENT_WRITE_CODE}: 另一标签页已修改数据`);
    }

    const expectedRevision = baseRevision ?? 0;
    const newRevision = expectedRevision + 1;
    snapshot.settings.revision = newRevision;

    const transaction = database.transaction([...STATE_STORE_NAMES], "readwrite");
    const completed = transactionCompleted(transaction);

    // 写事务获得锁后再次检查，覆盖“读取后、写入前”发生的竞争。
    const settingsStore = transaction.objectStore(STORES.settings);
    const recheck = await requestResult(settingsStore.get(CURRENT_STATE_ID)) as StateSettings | undefined;
    if (!matchesKnownStorageRevision(recheck, baseRevision)) {
      transaction.abort();
      await completed.catch(() => undefined);
      throw new Error(`${CONCURRENT_WRITE_CODE}: 另一标签页已修改数据`);
    }

    await putStore(settingsStore, [snapshot.settings], "id");
    await putStore(transaction.objectStore(STORES.reviews), snapshot.reviews, "id");
    await putStore(transaction.objectStore(STORES.wordProgress), snapshot.wordProgress, "wordId");
    await putStore(transaction.objectStore(STORES.favorites), snapshot.favorites, "wordId");
    await putStore(transaction.objectStore(STORES.mistakes), snapshot.mistakes, "wordId");
    await putStore(transaction.objectStore(STORES.positions), snapshot.positions, "key");
    await putStore(transaction.objectStore(STORES.enrichments), snapshot.enrichments, "wordId");
    await putStore(transaction.objectStore(STORES.fsrsCards), snapshot.fsrsCards, "wordId");
    await putStore(transaction.objectStore(STORES.stubbornWords), snapshot.stubbornWords, "wordId");
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
  const snapshot = splitStoredState(state);
  pendingWrite = pendingWrite
    .catch(() => undefined)
    .then(() => writeSnapshot(snapshot))
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
export async function readStoredState(): Promise<StoredStateRead> {
  const database = await openWordLoopDatabase();
  try {
    const transaction = database.transaction([...STATE_STORE_NAMES], "readonly");
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
    });
    return { state, revision };
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

export async function loadStoredState() {
  const result = await readStoredState();
  adoptStoredRevision(result.revision);
  return result.state;
}
