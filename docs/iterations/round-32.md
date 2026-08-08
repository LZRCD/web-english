# 第 32 轮报告：维度闭环持久化收敛

> 执行日期：2026-08-08 ｜ 分支：`codex/follow-up-hardening` ｜ 起点：`1e769ce`

## 审计结论与唯一修复

完整追踪页面状态、分域写盘、IndexedDB 读取合并、normalize、hydrate、推荐和会话恢复后，确认 reviews、quizAttempts、lookupStats、wordProgress、顽固派生、activeSession 与 sprint sessionId 往返保持；发现 settings 分域遗漏五个已存在字段，导致阈值、猜错累计和既有学习设置刷新后丢失。

本轮只修复该投影断链：`lib/storage.ts` 的 `StateSettings` 与 `splitStoredState` 补齐 `weakThresholds`、`guessMistakes`、`senseFrequency`、`hideChineseMeaning`、`guessContextFirst`。不新增 schema/version，不改 normalize、评分、FSRS、门禁、恢复或备份。

## 回归证据

- `tests/weak-signals.test.ts`：用非默认阈值、猜错累计、义项频率和两项显示设置验证 split/combine 无损往返。
- `tests/e2e/signal-flow.spec.mjs`：种入状态并写入真实 IndexedDB，完整刷新后核对阈值 UI；修改阈值触发 hydrate 后再次写盘，确认猜错累计与其他字段仍在，再次刷新确认新阈值保持。
- 既有查词与顽固 E2E 已覆盖 activeSession/activeQuiz 刷新、真实结果回流、review sessionId、时间线与成效归因。

## 阶段结论

采用结论 C：本轮修复最高价值字段丢失；普通专项 activeQuiz 在作答后刷新仍可能因当前推荐变化而候选漂移，作为下一轮唯一目标。猜错只恢复累计事实的持久化，仍不得伪造闭环。

猜错：➖ 当前约束下不可闭环：只有累计次数，无真实事件时间、恢复或复发数据源。

## 验证

- 定向 `tests/weak-signals.test.ts`：72/72。
- `npm run lint`、`npm run typecheck`：通过。
- `npm test`：189/189，含生产构建。
- `tests/e2e/signal-flow.spec.mjs`：14/14；既有 13 条语义不变。
- 固定端口 3000 健康检查 200；只终止本轮确认归属的服务进程，PID 和唯一日志已清理。
