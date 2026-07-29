import {
  STORAGE_VERSION,
  type StoredState,
} from "./study.ts";
import {
  openWordLoopDatabase,
  requestResult,
  STORES,
  transactionCompleted,
} from "./storage.ts";

export const BACKUP_FORMAT = "wordloop-backup";

export type BackupDocument = {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  state: StoredState;
};

export type AutomaticBackup = {
  id: string;
  createdAt: string;
  reason: "daily" | "before-import" | "manual";
  document: BackupDocument;
};

const MAX_AUTOMATIC_BACKUPS = 5;

export function createBackupDocument(
  state: StoredState,
  exportedAt = new Date().toISOString(),
): BackupDocument {
  return {
    format: BACKUP_FORMAT,
    schemaVersion: state.schemaVersion,
    exportedAt,
    state,
  };
}

export function parseBackupDocument(raw: string) {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("不是有效的词环备份文件");
  }
  const value = parsed as Partial<BackupDocument>;
  if (
    value.format !== BACKUP_FORMAT
    || !value.state
    || typeof value.state !== "object"
    || Array.isArray(value.state)
    || typeof value.exportedAt !== "string"
  ) {
    throw new Error("不是有效的词环备份文件");
  }
  // 校验 exportedAt 是否为有效日期
  if (Number.isNaN(new Date(value.exportedAt).getTime())) {
    throw new Error("备份文件导出日期无效");
  }
  const documentVersion = Number(value.schemaVersion);
  const stateVersion = Number((value.state as { schemaVersion?: unknown }).schemaVersion);
  if (
    !Number.isSafeInteger(documentVersion)
    || documentVersion < 1
    || !Number.isSafeInteger(stateVersion)
    || stateVersion !== documentVersion
  ) {
    throw new Error("备份文件版本信息不一致");
  }
  if (documentVersion > STORAGE_VERSION) {
    throw new Error(
      `备份文件来自更新版本的词环（v${documentVersion}），当前版本为 v${STORAGE_VERSION}，请升级后再导入`,
    );
  }
  return value as BackupDocument;
}

export async function listAutomaticBackups() {
  const database = await openWordLoopDatabase();
  try {
    const transaction = database.transaction(STORES.backups, "readonly");
    const values = await requestResult(
      transaction.objectStore(STORES.backups).getAll(),
    ) as AutomaticBackup[];
    return values.sort((first, second) => second.createdAt.localeCompare(first.createdAt));
  } finally {
    database.close();
  }
}

export async function saveAutomaticBackup(
  state: StoredState,
  reason: AutomaticBackup["reason"],
  now = new Date(),
) {
  const database = await openWordLoopDatabase();
  try {
    const createdAt = now.toISOString();
    const transaction = database.transaction(STORES.backups, "readwrite");
    transaction.objectStore(STORES.backups).put({
      id: `${createdAt}:${reason}`,
      createdAt,
      reason,
      document: createBackupDocument(state, createdAt),
    } satisfies AutomaticBackup);
    await transactionCompleted(transaction);
  } finally {
    database.close();
  }

  const backups = await listAutomaticBackups();
  const obsolete = backups.slice(MAX_AUTOMATIC_BACKUPS);
  if (!obsolete.length) return backups;
  const cleanupDatabase = await openWordLoopDatabase();
  try {
    const transaction = cleanupDatabase.transaction(STORES.backups, "readwrite");
    for (const backup of obsolete) {
      transaction.objectStore(STORES.backups).delete(backup.id);
    }
    await transactionCompleted(transaction);
  } finally {
    cleanupDatabase.close();
  }
  return backups.slice(0, MAX_AUTOMATIC_BACKUPS);
}

export async function getAutomaticBackup(id: string) {
  const database = await openWordLoopDatabase();
  try {
    const transaction = database.transaction(STORES.backups, "readonly");
    return await requestResult(
      transaction.objectStore(STORES.backups).get(id),
    ) as AutomaticBackup | undefined;
  } finally {
    database.close();
  }
}
