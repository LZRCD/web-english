# 第 27 轮报告：拼写薄弱维度化处置

> 执行日期：2026-08-08 ｜ 分支：`codex/follow-up-hardening`

## 目标

把统一画像中的“拼写测验错”从通用单词卡改接到现有听音拼写训练，并让专项结果回到同模式测验记录、恢复规则与冲刺成效。

## 文件与关键改动

- `docs/iterations/dimension-treatment-audit.md`：保存八维只读基线矩阵、横向证据、唯一目标选择与实施后目标行。
- `lib/weak-signals.ts`：新增 `buildSprintTreatmentRecommendation`；只读结构化 `quizAttempts.mode/correct`，复用已有测验恢复与冲刺候选规则，未恢复的拼写维度优先于通用冲刺，恢复后退出、再错后重现。
- `lib/quiz.ts`、`app/components/QuizView.tsx`：专项可限定候选词集，首次挂载可恢复外部发起的现有 `QuizSessionState`；首题和逐题重置真实计时，作答回传已有 sessionId。
- `app/page.tsx`：考前冲刺遇到拼写建议时直达听音拼写；每次结果仍写 `quizAttempts`，当日首次有效作答继续遵守既有 FSRS 门禁，并以 `sprint:*` review 进入冲刺历史、成效与复发归因。
- `tests/weak-signals.test.ts`、`tests/e2e/signal-flow.spec.mjs`：覆盖建议、限定出题、两次正确淡出、其他维度保留、再错复发，以及真实入口、正确/错误反馈、数据回流和 sessionId 归因。

## 验证

- `node --experimental-strip-types --test tests/weak-signals.test.ts`：63/63 通过。
- `npm run lint`、`npm run typecheck`：通过。
- `npm test`：180/180 通过，含生产构建成功。
- `npx playwright test tests/e2e/signal-flow.spec.mjs`：9/9 通过；既有 8 条语义保持，新链路 1 条。

## 边界与下一目标

- 未新增持久化 schema，未改评分、FSRS 排程、备份或 package scripts；`quizAttempts` 仍全量记录，`reviews` 仍只接收每日首次有效测验结果。
- 多维优先级本轮明确为“未恢复拼写专项优先于通用冲刺”；中译英与辨析仍是下一批真实错配，未在本轮并行实现。
- 下一条最高价值断链：中译英薄弱从统一冲刺入口直达 `chinese-to-english`，复用本轮 session 与结果归因方式。
