# 第 28 轮报告：中译英薄弱维度化处置

> 执行日期：2026-08-08 ｜ 分支：`codex/follow-up-hardening` ｜ 起点：`a33e345`

## 目标

在拼写专项保持第一优先级的前提下，让拼写恢复后的中译英薄弱接管统一冲刺入口，直达现有“中文提示输入英文”，并复用已有结果、恢复、复发和冲刺归因链路。

## 文件与关键联动

- `lib/weak-signals.ts`：把 `SprintTreatmentRecommendation` 最小扩展为拼写/中译英联合类型；推荐按结构化模式顺序选择，候选只含对应维度尚未恢复且仍在统一冲刺画像中的词。
- `app/page.tsx`：继续复用同一 `QuizSessionState`、`QuizView` 和 `sprint:*` 会话，仅把提示改为适用于两种专项的通用表述。
- `tests/weak-signals.test.ts`：新增中译英恢复/复发及限定出题测试；调整多维测试，明确“拼写优先，恢复后中译英接管，再次拼写错后重新抢占”。
- `tests/e2e/signal-flow.spec.mjs`：新增真实入口测试，覆盖中文提示、英文输入、正确/错误写回、首次 review 冲刺归因、淡出后再错复发；既有 9 条语义未改。
- 审计、咬合表与项目演进文档同步记录本轮只读证据和实施结果。

## 验证

- 定向 `tests/weak-signals.test.ts`：65/65 通过。
- `npm run lint`、`npm run typecheck`：通过。
- `npm test`：182/182 通过，含生产构建成功。
- `tests/e2e/signal-flow.spec.mjs`：10/10 通过；固定端口 3000、单实例、HTTP 200。

## 边界与下一目标

- 未新增 schema，未改答案判定、评分、FSRS 排程、备份、package scripts 或猜错数据。
- 每次中译英结果继续写 `quizAttempts`；仅每日首次有效作答进入 `reviews/wordProgress`，冲刺首个有效结果保留 `sprint:*` 归因。
- 下一条最高价值断链：辨析薄弱仍从统一冲刺入口回退通用单词卡，尚未定向到 `meaning-choice`。
