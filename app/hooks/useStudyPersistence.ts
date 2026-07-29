"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  createBackupDocument,
  getAutomaticBackup,
  listAutomaticBackups,
  parseBackupDocument,
  saveAutomaticBackup,
  type AutomaticBackup,
} from "../../lib/backup";
import {
  parseRecoveryCopies,
  parseRecoveryCopy,
  removeRecoveryCopyFromRaw,
  serializeRecoveryCopies,
  type RecoveryCopy,
} from "../../lib/recovery";
import {
  adoptStoredRevision,
  isStorageConflictError,
  loadStoredState,
  onRemoteChange,
  readStoredState,
  saveStoredState,
  saveStoredStateImmediate,
} from "../../lib/storage";
import {
  parseStoredState,
  STORAGE_KEY,
  type StoredState,
} from "../../lib/study";

const RECOVERY_STATE_KEY = "wordloop-unsaved-recovery";
const RECOVERY_COPY_PREFIX = `${RECOVERY_STATE_KEY}:`;
const AUTOMATIC_BACKUP_DATE_KEY = "wordloop-last-auto-backup";
const FALLBACK_REVISION_KEY = "wordloop-state-fallback-revision";
const FALLBACK_WRITE_LOCK = "wordloop-state-fallback-write";
const FALLBACK_CONFLICT_CODE = "FALLBACK_CONCURRENT_WRITE";

export type SaveStatus = "idle" | "saving" | "saved" | "fallback" | "error";
export type PersistenceLoadStatus = "loading" | "ready" | "error";

type UseStudyPersistenceOptions = {
  state: StoredState;
  todayKey: string;
  onApplyState: (state: StoredState) => void;
  onNotify: (message: string, duration?: number) => void;
};

function readLocalStorage(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function removeLocalStorage(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {}
}

function writeLocalStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function recoveryCopyStorageKey(id: string) {
  return `${RECOVERY_COPY_PREFIX}${id}`;
}

function readRecoveryCopiesFromStorage() {
  const copies: RecoveryCopy[] = [];
  const legacy = readLocalStorage(RECOVERY_STATE_KEY);
  if (legacy) copies.push(...parseRecoveryCopies(legacy));
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(RECOVERY_COPY_PREFIX)) continue;
      const raw = readLocalStorage(key);
      if (raw) copies.push(...parseRecoveryCopies(raw));
    }
  } catch {}
  return Array.from(
    new Map(copies.map((copy) => [copy.raw, copy])).values(),
  ).sort((first, second) =>
    new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime());
}

function migrateLegacyRecoveryCopies() {
  const legacy = readLocalStorage(RECOVERY_STATE_KEY);
  if (!legacy) return readRecoveryCopiesFromStorage();
  const copies = parseRecoveryCopies(legacy);
  let migrated = true;
  for (const copy of copies) {
    if (!writeLocalStorage(
      recoveryCopyStorageKey(copy.id),
      serializeRecoveryCopies([copy]),
    )) {
      migrated = false;
    }
  }
  if (migrated) removeLocalStorage(RECOVERY_STATE_KEY);
  return readRecoveryCopiesFromStorage();
}

async function persistIndexedState(
  state: StoredState,
  immediate = false,
): Promise<boolean> {
  if (!("indexedDB" in window)) return false;
  try {
    await (immediate
      ? saveStoredStateImmediate(state)
      : saveStoredState(state));
    return true;
  } catch (error) {
    if (isStorageConflictError(error)) throw error;
    return false;
  }
}

function isFallbackConflictError(error: unknown) {
  return error instanceof Error
    && error.message.startsWith(FALLBACK_CONFLICT_CODE);
}

function isPersistenceConflictError(error: unknown) {
  return isStorageConflictError(error) || isFallbackConflictError(error);
}

function fallbackRevision(raw: string | null) {
  if (raw === null) return 0;
  const value = Number(readLocalStorage(FALLBACK_REVISION_KEY));
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function downloadJson(raw: string, filename: string) {
  const blob = new Blob([raw.endsWith("\n") ? raw : `${raw}\n`], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function useStudyPersistence({
  state,
  todayKey,
  onApplyState,
  onNotify,
}: UseStudyPersistenceOptions) {
  const [hydrated, setHydrated] = useState(false);
  const [loadStatus, setLoadStatus] =
    useState<PersistenceLoadStatus>("loading");
  const [operationInProgress, setOperationInProgress] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [lastSaveTime, setLastSaveTime] = useState(0);
  const [automaticBackups, setAutomaticBackups] = useState<AutomaticBackup[]>([]);
  const [recoveryCopies, setRecoveryCopies] = useState<RecoveryCopy[]>([]);
  const stateRef = useRef(state);
  const applyStateRef = useRef(onApplyState);
  const notifyRef = useRef(onNotify);
  const hydratedRef = useRef(false);
  const suppressLocalDirtyRef = useRef(false);
  const suppressNextSaveRef = useRef(true);
  const pendingLocalChangesRef = useRef(false);
  const storageBlockedRef = useRef(false);
  const loadStatusRef = useRef<PersistenceLoadStatus>("loading");
  const operationInProgressRef = useRef(false);
  const usingFallbackRef = useRef(false);
  const fallbackRawRef = useRef<string | null>(null);
  const fallbackRevisionRef = useRef(0);
  const preservedFallbackRawRef = useRef<string | null>(null);
  const saveSequenceRef = useRef(0);
  const localStateVersionRef = useRef(0);
  const remoteReadSequenceRef = useRef(0);
  const recoveryCopiesRef = useRef<RecoveryCopy[]>([]);
  const automaticBackupDateRef = useRef("");

  useLayoutEffect(() => {
    stateRef.current = state;
    localStateVersionRef.current += 1;
    if (!hydratedRef.current) return;
    if (suppressLocalDirtyRef.current) {
      suppressLocalDirtyRef.current = false;
      return;
    }
    pendingLocalChangesRef.current = true;
    saveSequenceRef.current += 1;
  }, [state]);

  useLayoutEffect(() => {
    applyStateRef.current = onApplyState;
  }, [onApplyState]);

  useLayoutEffect(() => {
    notifyRef.current = onNotify;
  }, [onNotify]);

  const notify = useCallback((message: string, duration = 3000) => {
    notifyRef.current(message, duration);
  }, []);

  const applyPersistedState = useCallback((nextState: StoredState) => {
    suppressLocalDirtyRef.current = true;
    applyStateRef.current(nextState);
  }, []);

  const updateLoadStatus = useCallback((status: PersistenceLoadStatus) => {
    loadStatusRef.current = status;
    setLoadStatus(status);
  }, []);

  const adoptFallback = useCallback((raw: string | null) => {
    fallbackRawRef.current = raw;
    fallbackRevisionRef.current = fallbackRevision(raw);
    usingFallbackRef.current = raw !== null || !("indexedDB" in window);
  }, []);

  const clearCanonicalFallback = useCallback(async () => {
    const expectedRaw = fallbackRawRef.current;
    const expectedRevision = fallbackRevisionRef.current;
    const clear = () => {
      if (
        expectedRaw === null
        || preservedFallbackRawRef.current === expectedRaw
      ) {
        return false;
      }
      const currentRaw = readLocalStorage(STORAGE_KEY);
      if (
        currentRaw !== expectedRaw
        || fallbackRevision(currentRaw) !== expectedRevision
      ) {
        return false;
      }
      removeLocalStorage(STORAGE_KEY);
      if (readLocalStorage(STORAGE_KEY) !== null) return false;
      removeLocalStorage(FALLBACK_REVISION_KEY);
      fallbackRawRef.current = null;
      fallbackRevisionRef.current = 0;
      usingFallbackRef.current = false;
      return true;
    };

    if (navigator.locks?.request) {
      try {
        return await navigator.locks.request(
          FALLBACK_WRITE_LOCK,
          { mode: "exclusive" },
          clear,
        );
      } catch {
        return false;
      }
    }
    try {
      return clear();
    } catch {
      return false;
    }
  }, []);

  const writeFallbackState = useCallback(async (nextState: StoredState) => {
    const nextRaw = JSON.stringify(nextState);
    const write = () => {
      const currentRaw = readLocalStorage(STORAGE_KEY);
      const currentRevision = fallbackRevision(currentRaw);
      if (
        currentRaw !== fallbackRawRef.current
        || currentRevision !== fallbackRevisionRef.current
      ) {
        throw new Error(`${FALLBACK_CONFLICT_CODE}: 另一标签页已修改备用存储`);
      }

      const nextRevision = currentRevision + 1;
      try {
        localStorage.setItem(STORAGE_KEY, nextRaw);
        localStorage.setItem(FALLBACK_REVISION_KEY, String(nextRevision));
      } catch (error) {
        try {
          if (currentRaw === null) localStorage.removeItem(STORAGE_KEY);
          else localStorage.setItem(STORAGE_KEY, currentRaw);
          if (currentRaw === null) {
            localStorage.removeItem(FALLBACK_REVISION_KEY);
          } else {
            localStorage.setItem(
              FALLBACK_REVISION_KEY,
              String(currentRevision),
            );
          }
        } catch {}
        throw error;
      }

      fallbackRawRef.current = nextRaw;
      fallbackRevisionRef.current = nextRevision;
      usingFallbackRef.current = true;
      return "fallback" as const;
    };

    if (navigator.locks?.request) {
      return navigator.locks.request(
        FALLBACK_WRITE_LOCK,
        { mode: "exclusive" },
        write,
      );
    }
    return write();
  }, []);

  const persistStateSnapshot = useCallback(async (
    nextState: StoredState,
    immediate = false,
  ): Promise<Exclude<SaveStatus, "idle" | "saving" | "error">> => {
    if (await persistIndexedState(nextState, immediate)) {
      usingFallbackRef.current = false;
      await clearCanonicalFallback();
      return "saved";
    }
    return writeFallbackState(nextState);
  }, [clearCanonicalFallback, writeFallbackState]);

  const updateRecoveryCopies = useCallback((copies: RecoveryCopy[]) => {
    recoveryCopiesRef.current = copies;
    setRecoveryCopies(copies);
  }, []);

  const stashRawRecoveryCopy = useCallback((raw: string) => {
    const storedCopies = readRecoveryCopiesFromStorage();
    const existingCopy = storedCopies.find((item) => item.raw === raw);
    if (existingCopy) {
      updateRecoveryCopies(storedCopies);
      return true;
    }
    const copy = recoveryCopiesRef.current.find((item) => item.raw === raw)
      ?? parseRecoveryCopy(raw);
    const written = writeLocalStorage(
      recoveryCopyStorageKey(copy.id),
      serializeRecoveryCopies([copy]),
    );
    const copies = readRecoveryCopiesFromStorage();
    updateRecoveryCopies(copies);
    return written;
  }, [updateRecoveryCopies]);

  const stashRecoveryCopy = useCallback((nextState: StoredState) =>
    stashRawRecoveryCopy(JSON.stringify(nextState)), [stashRawRecoveryCopy]);

  const restashPreservedFallback = useCallback(() => {
    const raw = preservedFallbackRawRef.current;
    if (raw === null) return true;
    if (!stashRawRecoveryCopy(raw)) return false;
    preservedFallbackRawRef.current = null;
    return true;
  }, [stashRawRecoveryCopy]);

  const clearRecoveryCopy = useCallback((id: string) => {
    const selected = recoveryCopiesRef.current.find((copy) => copy.id === id);
    if (!selected) return false;
    try {
      const keys: string[] = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key?.startsWith(RECOVERY_COPY_PREFIX)) keys.push(key);
      }
      for (const key of keys) {
        const value = readLocalStorage(key);
        if (!value) continue;
        const result = removeRecoveryCopyFromRaw(value, {
          id: selected.id,
        });
        if (!result.removed) continue;
        if (result.nextRaw === null) localStorage.removeItem(key);
        else localStorage.setItem(key, result.nextRaw);
        updateRecoveryCopies(readRecoveryCopiesFromStorage());
        return true;
      }
      const legacy = readLocalStorage(RECOVERY_STATE_KEY);
      if (legacy) {
        const result = removeRecoveryCopyFromRaw(legacy, {
          id: selected.id,
          raw: selected.raw,
        });
        if (result.removed) {
          if (result.nextRaw === null) {
            localStorage.removeItem(RECOVERY_STATE_KEY);
          } else {
            localStorage.setItem(RECOVERY_STATE_KEY, result.nextRaw);
          }
          updateRecoveryCopies(readRecoveryCopiesFromStorage());
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }, [updateRecoveryCopies]);

  const beginAuthoritativeWrite = useCallback((allowLoadError = false) => {
    if (
      loadStatusRef.current === "loading"
      || (!allowLoadError && loadStatusRef.current !== "ready")
      || (!allowLoadError && storageBlockedRef.current)
      || operationInProgressRef.current
    ) {
      return false;
    }
    operationInProgressRef.current = true;
    setOperationInProgress(true);
    saveSequenceRef.current += 1;
    storageBlockedRef.current = true;
    pendingLocalChangesRef.current = true;
    return true;
  }, []);

  const finishAuthoritativeWrite = useCallback((keepBlocked = false) => {
    operationInProgressRef.current = false;
    setOperationInProgress(false);
    if (!keepBlocked) storageBlockedRef.current = false;
  }, []);

  const protectStateSnapshot = useCallback(async (
    snapshot: StoredState,
    reason: "before-import" | "manual",
  ) => {
    if ("indexedDB" in window) {
      try {
        const items = await saveAutomaticBackup(snapshot, reason);
        setAutomaticBackups(items);
        return true;
      } catch {}
    }
    return stashRecoveryCopy(snapshot);
  }, [stashRecoveryCopy]);

  const protectNewerState = useCallback(async (
    protectedVersion: number,
    reason: "before-import" | "manual",
  ) => {
    let version = protectedVersion;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (localStateVersionRef.current === version) return true;
      const snapshot = stateRef.current;
      const snapshotVersion = localStateVersionRef.current;
      if (!await protectStateSnapshot(snapshot, reason)) return false;
      version = snapshotVersion;
    }
    return localStateVersionRef.current === version;
  }, [protectStateSnapshot]);

  useEffect(() => {
    let active = true;
    void (async () => {
      let storedState: StoredState | null = null;
      let nextLoadStatus: PersistenceLoadStatus = "ready";
      let nextSaveStatus: SaveStatus = "idle";
      let notice = "";
      const storedRecoveryCopies = migrateLegacyRecoveryCopies();
      if (storedRecoveryCopies.length) {
        updateRecoveryCopies(storedRecoveryCopies);
      }

      let fallbackState: StoredState | null = null;
      let fallbackRaw = readLocalStorage(STORAGE_KEY);
      adoptFallback(fallbackRaw);
      if (fallbackRaw) {
        try {
          fallbackState = parseStoredState(fallbackRaw);
        } catch {
          const stashed = stashRawRecoveryCopy(fallbackRaw);
          if (stashed && await clearCanonicalFallback()) {
            fallbackRaw = null;
          } else if (!stashed) {
            preservedFallbackRawRef.current = fallbackRaw;
            storageBlockedRef.current = true;
            nextLoadStatus = "error";
          }
          nextSaveStatus = stashed ? "saved" : "error";
          notice = stashed
            ? "兼容存储副本格式异常，原始内容已保留为恢复副本"
            : "兼容存储副本格式异常且无法建立恢复副本，已暂停写入";
        }
      }

      if ("indexedDB" in window) {
        try {
          const indexedState = await loadStoredState();
          storedState = indexedState;
          usingFallbackRef.current = false;
          if (fallbackState) {
            if (indexedState) {
              const stashed = fallbackRaw
                ? stashRawRecoveryCopy(fallbackRaw)
                : stashRecoveryCopy(fallbackState);
              if (stashed) {
                usingFallbackRef.current = false;
                await clearCanonicalFallback();
                nextSaveStatus = "saved";
                notice = "检测到未合并的兼容存储副本，已保留在设置页供恢复";
              } else {
                preservedFallbackRawRef.current = fallbackRaw;
                storageBlockedRef.current = true;
                nextLoadStatus = "error";
                nextSaveStatus = "error";
                notice = "兼容存储副本未覆盖数据库，但无法建立持久恢复副本";
              }
            } else {
              storedState = fallbackState;
              nextSaveStatus = await persistStateSnapshot(fallbackState, true);
            }
          }
        } catch (error) {
          if (fallbackState && isFallbackConflictError(error)) {
            const stashed = fallbackRaw
              ? stashRawRecoveryCopy(fallbackRaw)
              : stashRecoveryCopy(fallbackState);
            const latestRaw = readLocalStorage(STORAGE_KEY);
            try {
              storedState = latestRaw ? parseStoredState(latestRaw) : null;
              adoptFallback(latestRaw);
              storageBlockedRef.current = !stashed;
              nextLoadStatus = stashed ? "ready" : "error";
              nextSaveStatus = stashed ? "fallback" : "error";
              notice = stashed
                ? "另一标签页刚更新了备用存储；旧副本已保留并载入最新状态"
                : "备用存储发生并发更新且旧副本无法安全保存";
            } catch {
              if (latestRaw) stashRawRecoveryCopy(latestRaw);
              storageBlockedRef.current = true;
              nextLoadStatus = "error";
              nextSaveStatus = "error";
              notice = "并发写入后的备用数据格式异常，已暂停写入";
            }
          } else if (fallbackState && isStorageConflictError(error)) {
            const stashed = fallbackRaw
              ? stashRawRecoveryCopy(fallbackRaw)
              : stashRecoveryCopy(fallbackState);
            if (stashed) await clearCanonicalFallback();
            try {
              storedState = await loadStoredState();
              storageBlockedRef.current = !stashed;
              nextLoadStatus = stashed ? "ready" : "error";
              nextSaveStatus = stashed ? "saved" : "error";
              notice = stashed
                ? "数据库刚被其他标签页更新；兼容副本未覆盖它，并已保留供恢复"
                : "数据库刚被其他标签页更新，但兼容副本无法安全保存";
            } catch {
              storedState = null;
              storageBlockedRef.current = true;
              nextLoadStatus = "error";
              nextSaveStatus = "error";
              notice = "检测到并发更新且重新读取失败，已暂停写入";
            }
          } else if (fallbackState) {
            storedState = fallbackState;
            usingFallbackRef.current = true;
            nextSaveStatus = "fallback";
            notice = "本地数据库暂不可用，已载入兼容存储副本";
          } else {
            storageBlockedRef.current = true;
            nextLoadStatus = "error";
            nextSaveStatus = "error";
            notice = "本地学习数据读取失败，已暂停写入以避免覆盖原记录";
          }
        }
      } else if (fallbackState) {
        storedState = fallbackState;
        usingFallbackRef.current = true;
        nextSaveStatus = "fallback";
      } else if (fallbackRaw) {
        storageBlockedRef.current = true;
        nextLoadStatus = "error";
        nextSaveStatus = "error";
      } else {
        usingFallbackRef.current = true;
      }

      if (!active) return;
      hydratedRef.current = true;
      if (storedState) applyPersistedState(storedState);
      suppressNextSaveRef.current = true;
      updateLoadStatus(nextLoadStatus);
      setSaveStatus(nextSaveStatus);
      if (nextSaveStatus === "saved") setLastSaveTime(Date.now());
      if (notice) notify(notice);
      setHydrated(true);
    })();
    return () => {
      active = false;
    };
  }, [
    adoptFallback,
    applyPersistedState,
    clearCanonicalFallback,
    notify,
    persistStateSnapshot,
    stashRawRecoveryCopy,
    stashRecoveryCopy,
    updateLoadStatus,
    updateRecoveryCopies,
  ]);

  useEffect(() => {
    let active = true;
    const syncPromotedFallback = async () => {
      if (!("indexedDB" in window)) {
        storageBlockedRef.current = true;
        updateLoadStatus("error");
        setSaveStatus("error");
        notify("备用存储已被其他标签页移除，但本地数据库不可用", 5000);
        return;
      }

      const versionAtReadStart = localStateVersionRef.current;
      const remoteReadSequence = ++remoteReadSequenceRef.current;
      try {
        const { state: remoteState, revision } = await readStoredState();
        if (
          !active
          || remoteReadSequence !== remoteReadSequenceRef.current
        ) {
          return;
        }
        if (
          pendingLocalChangesRef.current
          || operationInProgressRef.current
          || versionAtReadStart !== localStateVersionRef.current
        ) {
          storageBlockedRef.current = true;
          setSaveStatus("error");
          notify("读取提升后的数据库期间产生了本地修改，已保留本页内容", 5000);
          return;
        }
        if (!remoteState) {
          storageBlockedRef.current = true;
          updateLoadStatus("error");
          setSaveStatus("error");
          notify("备用存储已移除，但数据库中没有可接管的状态", 5000);
          return;
        }
        adoptStoredRevision(revision);
        adoptFallback(null);
        suppressNextSaveRef.current = true;
        pendingLocalChangesRef.current = false;
        applyPersistedState(remoteState);
        updateLoadStatus("ready");
        setSaveStatus("saved");
        setLastSaveTime(Date.now());
        notify("备用数据已提升到数据库，已同步最新状态");
      } catch {
        if (!active) return;
        storageBlockedRef.current = true;
        updateLoadStatus("error");
        setSaveStatus("error");
        notify("备用存储已移除，但读取提升后的数据库失败", 5000);
      }
    };

    const syncLocalStorage = (event: StorageEvent) => {
      if (
        event.key === RECOVERY_STATE_KEY
        || event.key?.startsWith(RECOVERY_COPY_PREFIX)
      ) {
        updateRecoveryCopies(readRecoveryCopiesFromStorage());
        return;
      }
      if (event.key !== STORAGE_KEY) return;

      if (!usingFallbackRef.current) {
        if (event.newValue) {
          const stashed = stashRawRecoveryCopy(event.newValue);
          notify(
            stashed
              ? "检测到另一标签页的兼容存储副本，已保留在设置页"
              : "检测到另一标签页的兼容存储副本，但无法建立恢复副本",
            4000,
          );
        }
        return;
      }
      if (
        pendingLocalChangesRef.current
        || storageBlockedRef.current
        || operationInProgressRef.current
      ) {
        const stashed = stashRecoveryCopy(stateRef.current);
        storageBlockedRef.current = true;
        updateLoadStatus("error");
        setSaveStatus("error");
        notify(
          stashed
            ? "另一标签页更新了备用存储；当前修改已保留为恢复副本"
            : "另一标签页更新了备用存储，但当前修改无法建立恢复副本",
          5000,
        );
        return;
      }
      if (event.newValue === null) {
        void syncPromotedFallback();
        return;
      }
      try {
        const remoteState = parseStoredState(event.newValue);
        adoptFallback(event.newValue);
        suppressNextSaveRef.current = true;
        applyPersistedState(remoteState);
        setSaveStatus("fallback");
        setLastSaveTime(Date.now());
        notify("数据已在其他标签页更新，已同步最新状态");
      } catch {
        const stashed = stashRawRecoveryCopy(event.newValue);
        storageBlockedRef.current = true;
        updateLoadStatus("error");
        setSaveStatus("error");
        notify(
          stashed
            ? "另一标签页写入了异常备用数据，已保留原文并暂停自动保存"
            : "另一标签页写入了异常备用数据，且无法建立恢复副本",
          5000,
        );
      }
    };
    window.addEventListener("storage", syncLocalStorage);
    return () => {
      active = false;
      window.removeEventListener("storage", syncLocalStorage);
    };
  }, [
    adoptFallback,
    applyPersistedState,
    notify,
    stashRawRecoveryCopy,
    stashRecoveryCopy,
    updateLoadStatus,
    updateRecoveryCopies,
  ]);

  useEffect(() => {
    if (!hydrated) return;
    if (suppressNextSaveRef.current) {
      suppressNextSaveRef.current = false;
      return;
    }
    pendingLocalChangesRef.current = true;
    if (
      storageBlockedRef.current
      || operationInProgressRef.current
      || loadStatusRef.current !== "ready"
    ) {
      return;
    }

    const sequence = ++saveSequenceRef.current;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (
        cancelled
        || sequence !== saveSequenceRef.current
        || storageBlockedRef.current
      ) {
        return;
      }
      setSaveStatus("saving");
      try {
        const status = await persistStateSnapshot(state);
        if (cancelled || sequence !== saveSequenceRef.current) return;
        setSaveStatus(status);
        setLastSaveTime(Date.now());
        pendingLocalChangesRef.current = false;
        updateLoadStatus("ready");
      } catch (error) {
        if (cancelled || sequence !== saveSequenceRef.current) return;
        storageBlockedRef.current = true;
        setSaveStatus("error");
        stashRecoveryCopy(state);
        notify(
          isPersistenceConflictError(error)
            ? "另一标签页已有更新；当前修改未覆盖它，请导出备份后重试或刷新"
            : "本地存储写入失败，请立即导出备份后重试",
          5000,
        );
      }
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [hydrated, notify, persistStateSnapshot, stashRecoveryCopy, state, updateLoadStatus]);

  useEffect(() => {
    if (!hydrated || !("indexedDB" in window)) return;
    let active = true;
    listAutomaticBackups()
      .then((items) => {
        if (active) setAutomaticBackups(items);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated || !("indexedDB" in window)) return;
    return onRemoteChange(() => {
      if (
        pendingLocalChangesRef.current
        || storageBlockedRef.current
        || operationInProgressRef.current
      ) {
        notify("另一标签页已有更新；当前页面仍有未保存修改，暂未自动覆盖", 4000);
        return;
      }
      const versionAtReadStart = localStateVersionRef.current;
      const remoteReadSequence = ++remoteReadSequenceRef.current;
      readStoredState().then(async ({ state: remoteState, revision }) => {
        if (
          remoteReadSequence !== remoteReadSequenceRef.current
          || pendingLocalChangesRef.current
          || storageBlockedRef.current
          || versionAtReadStart !== localStateVersionRef.current
        ) {
          notify("读取远端更新期间产生了本地修改，已保留本页内容", 4000);
          return;
        }
        if (remoteState) {
          adoptStoredRevision(revision);
          if (usingFallbackRef.current && fallbackRawRef.current) {
            if (!stashRecoveryCopy(stateRef.current)) {
              storageBlockedRef.current = true;
              setSaveStatus("error");
              notify("无法保留备用存储中的本页状态，已暂停远端同步", 5000);
              return;
            }
          }
          usingFallbackRef.current = false;
          await clearCanonicalFallback();
          suppressNextSaveRef.current = true;
          pendingLocalChangesRef.current = false;
          applyPersistedState(remoteState);
          updateLoadStatus("ready");
          setSaveStatus("saved");
          setLastSaveTime(Date.now());
          notify("数据已在其他标签页更新，已同步最新状态");
        }
      }).catch(() => {});
    });
  }, [
    applyPersistedState,
    clearCanonicalFallback,
    hydrated,
    notify,
    stashRecoveryCopy,
    updateLoadStatus,
  ]);

  useEffect(() => {
    if (
      !hydrated
      || loadStatus !== "ready"
      || operationInProgress
      || storageBlockedRef.current
      || !("indexedDB" in window)
    ) {
      return;
    }
    if (
      automaticBackupDateRef.current !== todayKey
      && readLocalStorage(AUTOMATIC_BACKUP_DATE_KEY) !== todayKey
    ) {
      automaticBackupDateRef.current = todayKey;
      writeLocalStorage(AUTOMATIC_BACKUP_DATE_KEY, todayKey);
      saveAutomaticBackup(state, "daily")
        .then(setAutomaticBackups)
        .catch(() => {
          automaticBackupDateRef.current = "";
          removeLocalStorage(AUTOMATIC_BACKUP_DATE_KEY);
        });
    }
  }, [hydrated, loadStatus, operationInProgress, state, todayKey]);

  const retrySave = useCallback(async () => {
    const mustReconcile = storageBlockedRef.current
      || loadStatusRef.current === "error";
    if (!beginAuthoritativeWrite(true)) return;
    let keepBlocked = true;
    setSaveStatus("saving");
    try {
      if (mustReconcile) {
        if (!restashPreservedFallback()) {
          throw new Error("原始兼容副本仍无法安全保存，请先导出恢复副本");
        }
        let checkFallback = !("indexedDB" in window)
          || usingFallbackRef.current;
        if ("indexedDB" in window) {
          let latestRead: Awaited<ReturnType<typeof readStoredState>> | null =
            null;
          try {
            latestRead = await readStoredState();
          } catch (error) {
            if (!usingFallbackRef.current) throw error;
            checkFallback = true;
          }
          if (latestRead) {
            adoptStoredRevision(latestRead.revision);
            if (latestRead.state) {
              if (
                pendingLocalChangesRef.current
                && !stashRecoveryCopy(stateRef.current)
              ) {
                throw new Error("无法保留本页修改，已取消读取远端数据");
              }
              usingFallbackRef.current = false;
              await clearCanonicalFallback();
              suppressNextSaveRef.current = true;
              pendingLocalChangesRef.current = false;
              applyPersistedState(latestRead.state);
              updateLoadStatus("ready");
              setSaveStatus("saved");
              setLastSaveTime(Date.now());
              notify("已读取其他标签页的最新数据；本页修改保留在恢复副本中");
              keepBlocked = false;
              return;
            }
          }
        }
        if (checkFallback) {
          const latestRaw = readLocalStorage(STORAGE_KEY);
          if (latestRaw !== fallbackRawRef.current && latestRaw !== null) {
            const latestState = parseStoredState(latestRaw);
            if (pendingLocalChangesRef.current) {
              if (!stashRecoveryCopy(stateRef.current)) {
                throw new Error("无法保留本页修改，已取消读取远端数据");
              }
            }
            adoptFallback(latestRaw);
            suppressNextSaveRef.current = true;
            pendingLocalChangesRef.current = false;
            applyPersistedState(latestState);
            updateLoadStatus("ready");
            setSaveStatus("fallback");
            setLastSaveTime(Date.now());
            notify("已读取其他标签页的最新备用数据；本页修改保留在恢复副本中");
            keepBlocked = false;
            return;
          }
        }
      }

      let status: "saved" | "fallback" = "saved";
      let savedLatest = false;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const version = localStateVersionRef.current;
        status = await persistStateSnapshot(stateRef.current, true);
        if (version === localStateVersionRef.current) {
          savedLatest = true;
          break;
        }
      }
      if (!savedLatest) {
        throw new Error("重试期间学习状态持续变化，请稍后再试");
      }
      setSaveStatus(status);
      setLastSaveTime(Date.now());
      pendingLocalChangesRef.current = false;
      updateLoadStatus("ready");
      keepBlocked = false;
      notify(status === "saved" ? "本地数据已重新保存" : "已保存到浏览器备用存储");
    } catch (error) {
      pendingLocalChangesRef.current = true;
      stashRecoveryCopy(stateRef.current);
      setSaveStatus("error");
      notify(
        isPersistenceConflictError(error)
          ? "另一标签页仍有更新，请导出备份并刷新后再试"
          : "重试失败，请立即导出备份",
      );
    } finally {
      finishAuthoritativeWrite(keepBlocked);
    }
  }, [
    adoptFallback,
    applyPersistedState,
    beginAuthoritativeWrite,
    clearCanonicalFallback,
    finishAuthoritativeWrite,
    notify,
    persistStateSnapshot,
    restashPreservedFallback,
    stashRecoveryCopy,
    updateLoadStatus,
  ]);

  const exportBackup = useCallback(() => {
    const document = createBackupDocument(stateRef.current);
    downloadJson(
      JSON.stringify(document, null, 2),
      `wordloop-backup-${todayKey}.json`,
    );
    notify("词环备份已导出", 1800);
  }, [notify, todayKey]);

  const exportRecoveryCopy = useCallback((id: string) => {
    const recoveryCopy = recoveryCopiesRef.current.find((copy) => copy.id === id);
    if (!recoveryCopy) return;
    const raw = recoveryCopy.state
      ? JSON.stringify(createBackupDocument(recoveryCopy.state), null, 2)
      : recoveryCopy.raw;
    downloadJson(raw, `wordloop-recovery-${todayKey}-${id.slice(-8)}.json`);
    notify("恢复副本已导出", 1800);
  }, [notify, todayKey]);

  const importBackup = useCallback(async (file: File) => {
    try {
      const document = parseBackupDocument(await file.text());
      const importedState = parseStoredState(JSON.stringify(document.state));
      const recoveryImport = loadStatusRef.current === "error"
        || storageBlockedRef.current;
      const confirmed = window.confirm(
        `备份时间：${new Date(document.exportedAt).toLocaleString("zh-CN")}\n`
        + `评分记录：${importedState.reviews.length} 条\n`
        + `已学习：${Object.keys(importedState.wordProgress).length} 词\n`
        + `收藏：${importedState.favorites.length} 词\n\n`
        + (recoveryImport
          ? "当前数据库无法读取；备份将先写入浏览器兼容存储，不会覆盖不可读数据库。\n\n"
          : "")
        + "导入会完整替换当前学习状态，是否继续？",
      );
      if (!confirmed) return;
      if (!beginAuthoritativeWrite(recoveryImport)) return;
      let keepBlocked = true;
      const currentState = stateRef.current;
      const protectedVersion = localStateVersionRef.current;
      try {
        if (recoveryImport) {
          if (!restashPreservedFallback()) {
            throw new Error("原始兼容副本无法安全保存，已取消强制导入");
          }
          if (
            fallbackRawRef.current
            && !stashRawRecoveryCopy(fallbackRawRef.current)
          ) {
            throw new Error("现有兼容副本无法安全保存，已取消强制导入");
          }
        } else {
          if (!await protectStateSnapshot(currentState, "before-import")) {
            throw new Error("无法建立导入前恢复副本，已取消导入");
          }
          if (!await protectNewerState(protectedVersion, "before-import")) {
            throw new Error("导入期间的新修改无法备份，已取消导入");
          }
        }
        const status = recoveryImport
          ? await writeFallbackState(importedState)
          : await persistStateSnapshot(importedState, true);
        const protectedAfterCommit = recoveryImport
          || await protectNewerState(protectedVersion, "before-import");
        if (!protectedAfterCommit) {
          pendingLocalChangesRef.current = true;
          setSaveStatus("error");
          notify(
            "备份已写入，但写入瞬间的页面修改未能另存；页面已保留，请立即导出",
            5000,
          );
          return;
        }
        suppressNextSaveRef.current = true;
        pendingLocalChangesRef.current = false;
        applyPersistedState(importedState);
        setSaveStatus(status);
        setLastSaveTime(Date.now());
        updateLoadStatus("ready");
        keepBlocked = false;
        notify(`已导入 ${importedState.reviews.length} 条评分记录，数据已保存`, 4000);
      } catch (error) {
        pendingLocalChangesRef.current = true;
        stashRecoveryCopy(stateRef.current);
        setSaveStatus("error");
        notify(error instanceof Error ? error.message : "备份导入失败", 4000);
      } finally {
        finishAuthoritativeWrite(keepBlocked);
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "备份文件解析失败", 4000);
    }
  }, [
    applyPersistedState,
    beginAuthoritativeWrite,
    finishAuthoritativeWrite,
    notify,
    persistStateSnapshot,
    protectNewerState,
    protectStateSnapshot,
    restashPreservedFallback,
    stashRawRecoveryCopy,
    stashRecoveryCopy,
    updateLoadStatus,
    writeFallbackState,
  ]);

  const restoreBackup = useCallback(async (id: string) => {
    try {
      const backup = await getAutomaticBackup(id);
      if (!backup) throw new Error("找不到这份自动备份");
      const restoredState = parseStoredState(JSON.stringify(backup.document.state));
      if (!window.confirm(`恢复 ${new Date(backup.createdAt).toLocaleString("zh-CN")} 的自动备份？`)) {
        return;
      }
      if (!beginAuthoritativeWrite()) return;
      let keepBlocked = true;
      const currentState = stateRef.current;
      const protectedVersion = localStateVersionRef.current;
      try {
        if (!await protectStateSnapshot(currentState, "manual")) {
          throw new Error("无法建立恢复前快照，已取消恢复");
        }
        if (!await protectNewerState(protectedVersion, "manual")) {
          throw new Error("恢复期间的新修改无法备份，已取消恢复");
        }
        const status = await persistStateSnapshot(restoredState, true);
        const protectedAfterCommit = await protectNewerState(
          protectedVersion,
          "manual",
        );
        if (!protectedAfterCommit) {
          pendingLocalChangesRef.current = true;
          setSaveStatus("error");
          notify(
            "自动备份已写入，但页面新修改未能另存；页面已保留，请立即导出",
            5000,
          );
          return;
        }
        suppressNextSaveRef.current = true;
        pendingLocalChangesRef.current = false;
        applyPersistedState(restoredState);
        setSaveStatus(status);
        setLastSaveTime(Date.now());
        updateLoadStatus("ready");
        keepBlocked = false;
        notify("已恢复自动备份，恢复前状态也已保存", 2400);
      } catch (error) {
        pendingLocalChangesRef.current = true;
        stashRecoveryCopy(stateRef.current);
        setSaveStatus("error");
        notify(error instanceof Error ? error.message : "自动备份恢复失败", 2400);
      } finally {
        finishAuthoritativeWrite(keepBlocked);
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "自动备份恢复失败", 2400);
    }
  }, [
    applyPersistedState,
    beginAuthoritativeWrite,
    finishAuthoritativeWrite,
    notify,
    persistStateSnapshot,
    protectNewerState,
    protectStateSnapshot,
    stashRecoveryCopy,
    updateLoadStatus,
  ]);

  const restoreRecoveryCopy = useCallback(async (id: string) => {
    const recoveryCopy = recoveryCopiesRef.current.find((copy) => copy.id === id);
    if (!recoveryCopy?.state) return;
    if (!("indexedDB" in window)) {
      notify("本地数据库不可用，请先导出当前备份，再恢复副本");
      return;
    }
    if (!window.confirm("恢复这份未合并副本？当前状态会先保存为自动快照。")) {
      return;
    }
    if (!beginAuthoritativeWrite()) return;
    const currentState = stateRef.current;
    const protectedVersion = localStateVersionRef.current;
    let keepBlocked = true;
    try {
      if (!await protectStateSnapshot(currentState, "manual")) {
        throw new Error("无法建立恢复前快照，已取消恢复");
      }
      if (!await protectNewerState(protectedVersion, "manual")) {
        throw new Error("恢复期间的新修改无法备份，已取消恢复");
      }
      const status = await persistStateSnapshot(recoveryCopy.state, true);
      const protectedAfterCommit = await protectNewerState(
        protectedVersion,
        "manual",
      );
      if (!protectedAfterCommit) {
        pendingLocalChangesRef.current = true;
        setSaveStatus("error");
        notify(
          "恢复状态已写入，但页面新修改未能另存；页面已保留，请立即导出",
          5000,
        );
        return;
      }
      suppressNextSaveRef.current = true;
      pendingLocalChangesRef.current = false;
      applyPersistedState(recoveryCopy.state);
      const cleared = clearRecoveryCopy(id);
      setSaveStatus(status);
      setLastSaveTime(Date.now());
      updateLoadStatus("ready");
      keepBlocked = false;
      notify(
        cleared
          ? "恢复副本已写入，恢复前状态也已保存"
          : "恢复已写入，但副本标记删除失败，可稍后手动删除",
      );
    } catch (error) {
      pendingLocalChangesRef.current = true;
      stashRecoveryCopy(stateRef.current);
      setSaveStatus("error");
      notify(error instanceof Error ? error.message : "恢复副本写入失败");
    } finally {
      finishAuthoritativeWrite(keepBlocked);
    }
  }, [
    applyPersistedState,
    beginAuthoritativeWrite,
    clearRecoveryCopy,
    finishAuthoritativeWrite,
    notify,
    persistStateSnapshot,
    protectNewerState,
    protectStateSnapshot,
    stashRecoveryCopy,
    updateLoadStatus,
  ]);

  const discardRecoveryCopy = useCallback((id: string) => {
    if (operationInProgressRef.current) return;
    if (!window.confirm("确定删除这份恢复副本？删除后无法撤销。")) return;
    const cleared = clearRecoveryCopy(id);
    notify(cleared ? "恢复副本已删除" : "副本删除失败，请稍后重试", 1800);
  }, [clearRecoveryCopy, notify]);

  const resetLearningRecords = useCallback(async () => {
    if (!window.confirm("确定清空评分、记忆状态、错词和学习位置吗？收藏与内容缓存会保留。")) {
      return;
    }
    if (!beginAuthoritativeWrite()) return;
    const currentState = stateRef.current;
    const protectedVersion = localStateVersionRef.current;
    let keepBlocked = true;
    try {
      if (!await protectStateSnapshot(currentState, "manual")) {
        throw new Error("无法建立清空前恢复副本，本次操作已取消");
      }
      if (!await protectNewerState(protectedVersion, "manual")) {
        throw new Error("清空期间的新修改无法备份，本次操作已取消");
      }
      const latestState = stateRef.current;
      const resetState: StoredState = {
        ...latestState,
        reviews: [],
        wordProgress: {},
        mistakes: [],
        stubbornWords: {},
        positions: {},
        activeSession: undefined,
      };
      const status = await persistStateSnapshot(resetState, true);
      const protectedAfterCommit = await protectNewerState(
        protectedVersion,
        "manual",
      );
      if (!protectedAfterCommit) {
        pendingLocalChangesRef.current = true;
        setSaveStatus("error");
        notify(
          "清空状态已写入，但页面新修改未能另存；页面已保留，请立即导出",
          5000,
        );
        return;
      }
      suppressNextSaveRef.current = true;
      pendingLocalChangesRef.current = false;
      applyPersistedState(resetState);
      setSaveStatus(status);
      setLastSaveTime(Date.now());
      updateLoadStatus("ready");
      keepBlocked = false;
      notify("学习记录已清空，收藏和内容缓存已保留");
    } catch (error) {
      pendingLocalChangesRef.current = true;
      stashRecoveryCopy(stateRef.current);
      setSaveStatus("error");
      notify(
        isPersistenceConflictError(error)
          ? "另一标签页刚更新了数据，本次清空未写入"
          : error instanceof Error
            ? error.message
            : "清空操作保存失败，原记录未替换",
      );
    } finally {
      finishAuthoritativeWrite(keepBlocked);
    }
  }, [
    applyPersistedState,
    beginAuthoritativeWrite,
    finishAuthoritativeWrite,
    notify,
    persistStateSnapshot,
    protectNewerState,
    protectStateSnapshot,
    stashRecoveryCopy,
    updateLoadStatus,
  ]);

  return {
    hydrated,
    loadStatus,
    operationInProgress,
    saveStatus,
    lastSaveTime,
    automaticBackups,
    recoveryCopies,
    retrySave,
    exportBackup,
    exportRecoveryCopy,
    importBackup,
    restoreBackup,
    restoreRecoveryCopy,
    discardRecoveryCopy,
    resetLearningRecords,
  };
}
