# 维度化处置闭环持久化收敛审计

> 第 32 轮，审计基线 `1e769ce`。状态流：页面 `persistedState` → `useStudyPersistence` → `saveStoredState` → `splitStoredState` → IndexedDB `state-domains` → `readStoredState` / `combineStoredState` → `normalizeStoredState` → `applyStoredState` / `hydrateSession` → 画像、推荐与会话重算。

## 维度状态 × 持久化往返矩阵

| 维度/状态 | 最小真实数据源 | 写入/读取与归一化 | hydrate 后结果 | 刷新后推荐、候选与模式 | 状态 |
|---|---|---|---|---|---|
| 拼写错 | `quizAttempts(mode=listening-spelling)` | 独立 domain；`normalizeQuizAttempts` 保留 mode/correct/answeredAt/appliedToSchedule/recallMs | `setQuizAttempts` 后统一画像重算 | 优先级第一，未恢复候选保持 | ✅ 往返保持 |
| 中译英错 | `quizAttempts(mode=chinese-to-english)` | 同上 | 同上 | 拼写恢复后接管 | ✅ 往返保持 |
| 辨析错 | `quizAttempts(mode=meaning-choice)` | 同上 | 同上 | 前两级恢复后接管 | ✅ 往返保持 |
| 查词频繁 | `lookupStats` + `lookupWords` | settings；`normalizeLookupStats/Words` 保留 count/firstAt/lastAt 与关联 | `setLookupStats/setLookupWords` | `isLookupDemoted` 与阈值重算一致 | ✅ 往返保持 |
| 慢回忆 | `reviews.recallMs` | reviews domain；`normalizeReview` 保留 review 字段和真实耗时 | `setReviews` 后重算 | 快速恢复/再次变慢语义保持 | ✅ 往返保持 |
| FSRS lapse | `wordProgress` + `fsrsCard` | progress/card 分域后合并；`normalizeWordProgress` 保留 lastRating、lastReviewedAt、lapseCount、consecutiveSuccesses 与卡片 | `setWordProgress` | 继续服从既有排程 | ✅ 往返保持 |
| 顽固词阶段 | `reviews` + 存量 `stubbornWords` | review 与 stubborn domain；normalize 后自动记录由 reviews 重建并覆盖同词存量 | 页面继续从真实 review 纯派生阶段 | 结构化阶段、恢复与低评重置保持 | ✅ 往返保持 |
| `activeSession` | settings 中完整 `StudySession` | `normalizeSession` 接受 sprint/reinforcement，保留 wordIds/index/createdAt/originKind | `hydrateSession` 克隆恢复 | 词卡候选、位置和 sessionId 保持 | ✅ 往返保持 |
| `activeQuiz` | settings 中 `QuizSessionState` | `normalizeQuizSession` 保留 id/mode/seed/index/answers/startedAt | `setActiveQuiz` 后按 seed 恢复题组 | 顽固专项按启动时刻恢复；普通专项作答后仍按当前推荐重算候选 | ❌ 候选漂移 |
| sprint `sessionId` | `ReviewEvent.sessionId` / 会话 id | `normalizeReview/Session/QuizSession` 保留；历史解析兼容普通与结构化顽固格式 | 时间线、历史、成效继续识别 `sprint:*` | 模式和归因保持 | ✅ 往返保持 |
| `weakThresholds` | settings 既有字段 | 本轮补齐 `StateSettings` 与 `splitStoredState`；normalize 继续夹取旧/非法值 | `setWeakThresholds` | 查词、慢回忆、排程候选和优先级刷新后不漂移 | ✅ 往返保持 |
| 猜错累计数 | `guessMistakes[wordId]` | 本轮补齐 settings 往返；`normalizeGuessMistakes` 只保留正整数累计事实 | `setGuessMistakes` 后标签保持 | 不生成恢复、复发、时间线或训练阶段 | ➖ 当前约束下不可闭环 |

## 只读证据与目标选择

修改前直接执行 `combineStoredState(splitStoredState(state))`，`weakThresholds={7,8,22000}` 被重置为默认 `{2,3,15000}`，`guessMistakes={1:3}` 变成空对象；同一 settings 投影还遗漏 `senseFrequency`、`hideChineseMeaning`、`guessContextFirst`。根因是 `StoredState` 已有字段未列入分域白名单，不是 schema 缺失。

本轮只修这一处最高价值根因：在 `StateSettings` 和 `splitStoredState` 补齐五个既有字段。没有新增对象仓、字段或版本，也没有改 normalize、评分、FSRS、每日测验门禁、恢复规则和备份。备份链路只读确认 `createBackupDocument` 直接封装完整 `StoredState`，无需修改。

## 结论 C：发现多个断链

本轮已修复会让统一画像和阈值直接丢失的 settings 投影断链。普通维度 `activeQuiz` 仍不持久化启动候选，而是在刷新时读取当前推荐；若作答已让维度恢复或优先级切换，题组可能漂移。本轮不混修，列为下一条最高价值目标。

猜错继续明确为：➖ 当前约束下不可闭环：只有累计次数，无真实事件时间、恢复或复发数据源。

## 验证

- 定向 `tests/weak-signals.test.ts`：72/72。
- `npm run lint`、`npm run typecheck`：通过。
- `npm test`：189/189，含生产构建。
- `tests/e2e/signal-flow.spec.mjs`：14/14，既有 13 条语义保持；固定端口 3000 健康检查 200，结束后精确释放本轮进程并清理本轮 PID/日志。
