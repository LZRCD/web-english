import {
  parseStoredState,
  type StoredState,
} from "./study.ts";

export const RECOVERY_COLLECTION_FORMAT = "wordloop-recovery-collection-v1";

export type RecoveryCopy = {
  id: string;
  createdAt: string;
  raw: string;
  state?: StoredState;
};

export type RecoveryCopySelector =
  | { id: string; raw?: string }
  | { id?: string; raw: string };

export type RecoveryCopyRemoval = {
  removed: RecoveryCopy | null;
  remaining: RecoveryCopy[];
  nextRaw: string | null;
};

function recoveryHash(raw: string) {
  let hash = 2166136261;
  for (const character of raw) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function recoveryId(raw: string) {
  const nonce = globalThis.crypto?.randomUUID?.()
    ?? Math.random().toString(36).slice(2);
  return `${Date.now()}-${recoveryHash(raw)}-${nonce}`;
}

export function parseRecoveryCopy(
  raw: string,
  id = recoveryId(raw),
  createdAt = new Date().toISOString(),
): RecoveryCopy {
  const normalizedCreatedAt = Number.isNaN(new Date(createdAt).getTime())
    ? new Date().toISOString()
    : createdAt;
  try {
    return {
      id,
      createdAt: normalizedCreatedAt,
      raw,
      state: parseStoredState(raw),
    };
  } catch {
    return { id, createdAt: normalizedCreatedAt, raw };
  }
}

export function parseRecoveryCopies(raw: string): RecoveryCopy[] {
  try {
    const parsed = JSON.parse(raw) as {
      format?: unknown;
      copies?: unknown;
    };
    if (
      parsed?.format === RECOVERY_COLLECTION_FORMAT
      && Array.isArray(parsed.copies)
    ) {
      const copies = parsed.copies.flatMap((value) => {
        if (!value || typeof value !== "object") return [];
        const copy = value as Record<string, unknown>;
        if (typeof copy.raw !== "string") return [];
        return [parseRecoveryCopy(
          copy.raw,
          typeof copy.id === "string" ? copy.id : recoveryId(copy.raw),
          typeof copy.createdAt === "string"
            ? copy.createdAt
            : new Date().toISOString(),
        )];
      });
      if (copies.length > 0 || parsed.copies.length === 0) return copies;
    }
  } catch {}
  // 兼容旧版单份 StoredState 原始值，并保留无法解析的原文供导出。
  return [parseRecoveryCopy(raw)];
}

export function serializeRecoveryCopies(copies: RecoveryCopy[]) {
  return JSON.stringify({
    format: RECOVERY_COLLECTION_FORMAT,
    copies: copies.map(({ id, createdAt, raw }) => ({ id, createdAt, raw })),
  });
}

export function removeRecoveryCopyFromRaw(
  storedRaw: string,
  selector: RecoveryCopySelector,
): RecoveryCopyRemoval {
  const copies = parseRecoveryCopies(storedRaw);
  let selectedIndex = selector.id
    ? copies.findIndex((copy) => copy.id === selector.id)
    : -1;

  // 旧版单份副本每次解析时可能生成新 ID，因此 ID 未命中时再用原文兜底。
  if (selectedIndex < 0 && selector.raw !== undefined) {
    selectedIndex = copies.findIndex((copy) => copy.raw === selector.raw);
  }
  if (selectedIndex < 0) {
    return { removed: null, remaining: copies, nextRaw: storedRaw };
  }

  const remaining = copies.filter((_, index) => index !== selectedIndex);
  return {
    removed: copies[selectedIndex],
    remaining,
    nextRaw: remaining.length ? serializeRecoveryCopies(remaining) : null,
  };
}
