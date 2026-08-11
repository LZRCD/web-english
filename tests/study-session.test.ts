import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceStudySession,
  appendTodayDueToStudySession,
  clearStaleTodayStudySession,
  isStudySessionComplete,
  recoverStudySessionWords,
} from "../app/hooks/useStudySession.ts";
import type { StudySession } from "../lib/learning.ts";

function session(overrides: Partial<StudySession> = {}): StudySession {
  return {
    id: "session-1",
    kind: "today",
    title: "今日任务",
    wordIds: [1, 2],
    index: 0,
    createdAt: "2026-07-29T08:00:00.000+08:00",
    ...overrides,
  };
}

test("学习会话推进不会越过队列末尾", () => {
  assert.equal(advanceStudySession(session())?.index, 1);
  assert.equal(advanceStudySession(session({ index: 2 }))?.index, 2);
});

test("完成状态只在非空队列到达末尾后成立", () => {
  assert.equal(isStudySessionComplete(session({ index: 2 })), true);
  assert.equal(isStudySessionComplete(session({ wordIds: [], index: 0 })), false);
});

test("今日会话只追加尚未入队的到期词", () => {
  assert.deepEqual(
    appendTodayDueToStudySession(session(), [2, 3, 3])?.wordIds,
    [1, 2, 3],
  );
  assert.deepEqual(
    appendTodayDueToStudySession(session({ kind: "favorites" }), [3])?.wordIds,
    [1, 2],
  );
});

test("跨自然日后清除旧今日会话，不影响其他来源", () => {
  assert.equal(
    clearStaleTodayStudySession(session(), "2026-07-30"),
    undefined,
  );
  assert.equal(
    clearStaleTodayStudySession(
      session({ kind: "favorites" }),
      "2026-07-30",
    )?.kind,
    "favorites",
  );
  assert.equal(
    clearStaleTodayStudySession(
      session({ kind: "article", title: "文章提词" }),
      "2026-07-30",
    )?.kind,
    "article",
  );
});

test("会话词条部分失效时保留有效顺序并按有效完成数夹取进度", () => {
  const recovered = recoverStudySessionWords(
    session({ wordIds: [1, 1_234_567, 2, 3], index: 2 }),
    new Set([1, 2, 3]),
  );

  assert.equal(recovered.status, "partial");
  assert.equal(recovered.removedCount, 1);
  assert.deepEqual(recovered.session?.wordIds, [1, 2, 3]);
  assert.equal(recovered.session?.index, 1);
});

test("会话词条全部失效时清除会话，正常会话保持原引用", () => {
  const current = session({ wordIds: [1, 2], index: 1 });
  const unchanged = recoverStudySessionWords(current, new Set([1, 2]));
  const cleared = recoverStudySessionWords(
    session({ wordIds: [1_234_567], index: 0 }),
    new Set([1, 2]),
  );

  assert.equal(unchanged.status, "unchanged");
  assert.equal(unchanged.session, current);
  assert.deepEqual(cleared, {
    removedCount: 1,
    status: "cleared",
  });
});
