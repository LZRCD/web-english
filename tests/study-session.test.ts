import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceStudySession,
  appendTodayDueToStudySession,
  clearStaleTodayStudySession,
  isStudySessionComplete,
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
});
