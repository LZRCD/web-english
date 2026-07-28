import {
  parseStoredState,
  type StoredState,
  type WordEnrichment,
} from "./study.ts";
import type { SerializedFsrsCard } from "./learning.ts";

export const DATABASE_NAME = "wordloop-local";
export const DATABASE_VERSION = 2;

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
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("本地数据库升级被其他页面阻塞"));
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
    request.onsuccess = () => resolve(request.result);
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

function putAll<T>(store: IDBObjectStore, values: T[]) {
  store.clear();
  for (const value of values) store.put(value);
}

async function writeSnapshot(snapshot: IndexedStateSnapshot) {
  const database = await openWordLoopDatabase();
  try {
    const transaction = database.transaction([...STATE_STORE_NAMES], "readwrite");
    const completed = transactionCompleted(transaction);
    putAll(transaction.objectStore(STORES.settings), [snapshot.settings]);
    putAll(transaction.objectStore(STORES.reviews), snapshot.reviews);
    putAll(transaction.objectStore(STORES.wordProgress), snapshot.wordProgress);
    putAll(transaction.objectStore(STORES.favorites), snapshot.favorites);
    putAll(transaction.objectStore(STORES.mistakes), snapshot.mistakes);
    putAll(transaction.objectStore(STORES.positions), snapshot.positions);
    putAll(transaction.objectStore(STORES.enrichments), snapshot.enrichments);
    putAll(transaction.objectStore(STORES.fsrsCards), snapshot.fsrsCards);
    putAll(transaction.objectStore(STORES.stubbornWords), snapshot.stubbornWords);
    await completed;
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

let pendingWrite = Promise.resolve();

export function saveStoredState(state: StoredState) {
  const snapshot = splitStoredState(state);
  pendingWrite = pendingWrite
    .catch((error) => {
      lastWriteError = error;
    })
    .then(() => writeSnapshot(snapshot))
    .then(() => {
      lastWriteError = null;
      lastSuccessfulWrite = Date.now();
    });
  return pendingWrite;
}

/** 直接写入 IndexedDB，不经过防抖队列。用于导入等需要立即确认持久化的场景。 */
export function saveStoredStateImmediate(state: StoredState) {
  const snapshot = splitStoredState(state);
  pendingWrite = writeSnapshot(snapshot).then(() => {
    lastWriteError = null;
    lastSuccessfulWrite = Date.now();
  });
  return pendingWrite;
}

export async function loadStoredState() {
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
    if (!settings) return null;
    return combineStoredState({
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
  } finally {
    database.close();
  }
}
