# 第 29 轮报告：辨析薄弱维度化处置

> 执行日期：2026-08-08 ｜ 分支：`codex/follow-up-hardening` ｜ 起点：`7b507c3`

## 目标

让拼写、中译英恢复后的辨析薄弱接管统一冲刺入口，直达现有 `meaning-choice`，并复用真实结果、恢复、复发与冲刺归因链路。

## 文件与关键联动

- `lib/weak-signals.ts`：推荐联合类型最小加入 `quiz-choice → meaning-choice`，结构化优先级固定为拼写 → 中译英 → 辨析；只选择仍在统一画像且未恢复的同维词。
- 既有 `QuizSessionState`、`QuizView`、`candidateWordIds`、`recordQuizResult` 原样复用：目标词受限定，干扰项仍来自全部已学词，答案算法不变。
- `tests/weak-signals.test.ts`：覆盖三维接管、恢复后下级接管、复发重新抢占、其他维度保留，以及目标限定、四项唯一答案和全体已学词干扰项。
- `tests/e2e/signal-flow.spec.mjs`：覆盖真实冲刺入口、释义四选一、正确/错误写回、首次 review 的 `sprint:*` 归因、冲刺历史感知与复发再进入。

## 验证

- 定向 `tests/weak-signals.test.ts`：67/67 通过。
- `npm run lint`、`npm run typecheck`：通过。
- `npm test`：184/184 通过，含生产构建成功。
- `tests/e2e/signal-flow.spec.mjs`：11/11 通过；既有 10 条语义保持，固定端口 3000 单实例、HTTP 200。

## 边界与下一目标

- 未新增 schema，未改答案判定、评分、干扰项算法、FSRS 排程、每日门禁、备份、package scripts 或普通测验语义。
- 下一条最高价值断链：查词频繁已有降级闭环，但仍使用通用卡，尚未进入词义主动回忆或语境辨析处置。
