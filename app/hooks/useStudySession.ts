"use client";

import {
  useCallback,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  createStudySession,
  sessionProgress,
  type StudySession,
} from "../../lib/learning.ts";
import {
  dateKey,
  type StoredState,
} from "../../lib/study.ts";

export type StudySessionHydrationState =
  Pick<StoredState, "activeSession">;

export type UseStudySessionResult = {
  activeSession?: StudySession;
  setActiveSession: Dispatch<
    SetStateAction<StudySession | undefined>
  >;
  sessionComplete: boolean;
  sessionStats: ReturnType<typeof sessionProgress>;
  hydrate(state: StudySessionHydrationState): void;
  startSession(
    kind: StudySession["kind"],
    title: string,
    wordIds: number[],
    originKind?: StudySession["originKind"],
  ): StudySession | undefined;
  advanceSession(): void;
  restoreSession(session?: StudySession): void;
  clearSession(): void;
  appendTodayDue(wordIds: number[]): void;
  clearStaleToday(todayKey: string): void;
};

function cloneSession(session?: StudySession) {
  return session
    ? { ...session, wordIds: [...session.wordIds] }
    : undefined;
}

export function isStudySessionComplete(session?: StudySession) {
  return Boolean(
    session
    && session.wordIds.length > 0
    && session.index >= session.wordIds.length,
  );
}

export function advanceStudySession(session?: StudySession) {
  return session
    ? {
        ...session,
        index: Math.min(session.wordIds.length, session.index + 1),
      }
    : undefined;
}

export function appendTodayDueToStudySession(
  session: StudySession | undefined,
  wordIds: number[],
) {
  if (session?.kind !== "today") return session;
  const queued = new Set(session.wordIds);
  const additions = wordIds.filter((wordId) => {
    if (queued.has(wordId)) return false;
    queued.add(wordId);
    return true;
  });
  return additions.length
    ? { ...session, wordIds: [...session.wordIds, ...additions] }
    : session;
}

export function clearStaleTodayStudySession(
  session: StudySession | undefined,
  todayKey: string,
) {
  return session?.kind === "today"
    && dateKey(session.createdAt) !== todayKey
    ? undefined
    : session;
}

export type StudySessionWordRecovery = {
  session?: StudySession;
  removedCount: number;
  status: "unchanged" | "partial" | "cleared";
};

/**
 * 词库变化后恢复进行中会话：只移除无法解析的词，并按已完成的有效词数重算进度。
 */
export function recoverStudySessionWords(
  session: StudySession,
  availableWordIds: ReadonlySet<number>,
): StudySessionWordRecovery {
  const wordIds = session.wordIds.filter((wordId) =>
    availableWordIds.has(wordId));
  const removedCount = session.wordIds.length - wordIds.length;
  if (removedCount === 0) {
    return { session, removedCount: 0, status: "unchanged" };
  }
  if (wordIds.length === 0) {
    return { removedCount, status: "cleared" };
  }

  const completedBoundary = Math.min(
    session.wordIds.length,
    Math.max(0, Math.trunc(session.index)),
  );
  const index = session.wordIds
    .slice(0, completedBoundary)
    .filter((wordId) => availableWordIds.has(wordId))
    .length;
  return {
    session: { ...session, wordIds, index: Math.min(index, wordIds.length) },
    removedCount,
    status: "partial",
  };
}

export function useStudySession(
  initialSession?: StudySession,
): UseStudySessionResult {
  const [activeSession, setActiveSession] = useState<StudySession | undefined>(
    () => cloneSession(initialSession),
  );
  const sessionComplete = isStudySessionComplete(activeSession);
  const sessionStats = useMemo(
    () => sessionProgress(activeSession),
    [activeSession],
  );

  const hydrate = useCallback((state: StudySessionHydrationState) => {
    setActiveSession(cloneSession(state.activeSession));
  }, []);

  const startSession = useCallback((
    kind: StudySession["kind"],
    title: string,
    wordIds: number[],
    originKind?: StudySession["originKind"],
  ) => {
    if (!wordIds.length) return undefined;
    const session = createStudySession(
      kind,
      title,
      wordIds,
      new Date(),
      originKind,
    );
    setActiveSession(session);
    return session;
  }, []);

  const advanceSession = useCallback(() => {
    setActiveSession(advanceStudySession);
  }, []);

  const restoreSession = useCallback((session?: StudySession) => {
    setActiveSession(cloneSession(session));
  }, []);

  const clearSession = useCallback(() => {
    setActiveSession(undefined);
  }, []);

  const appendTodayDue = useCallback((wordIds: number[]) => {
    setActiveSession((session) =>
      appendTodayDueToStudySession(session, wordIds));
  }, []);

  const clearStaleToday = useCallback((todayKey: string) => {
    setActiveSession((session) =>
      clearStaleTodayStudySession(session, todayKey));
  }, []);

  return {
    activeSession,
    setActiveSession,
    sessionComplete,
    sessionStats,
    hydrate,
    startSession,
    advanceSession,
    restoreSession,
    clearSession,
    appendTodayDue,
    clearStaleToday,
  };
}
