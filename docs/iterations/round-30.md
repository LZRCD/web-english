# 第 30 轮报告：查词频繁维度化处置

> 执行日期：2026-08-08 ｜ 分支：`codex/follow-up-hardening` ｜ 起点：`2c9c466`

## 目标

让三类 Quiz 专项恢复后的查词薄弱进入现有 WordCard 主动回忆，并让真实评分驱动淡出、真实再次查词驱动复发。

## 文件与关键联动

- `lib/weak-signals.ts`：新增结构化 `lookup-recall` 第四优先级；只收稳定进度、达到查词阈值且未降级的已学词，FSRS 弱进度仍走通用排程。
- `app/page.tsx`：查词建议启动现有 `sprint` WordCard；揭示、四档评分、`recallMs` 和 `sprint:*` 归因原样复用，不产生假 `quizAttempts` 或查词事件。
- `lib/storage.ts`、`lib/study.ts`：把既有 `lookupStats` 纳入 settings 分域映射，并允许既有 `sprint` 会话刷新恢复；schema/version/备份不变。
- `tests/weak-signals.test.ts`、`tests/e2e/signal-flow.spec.mjs`：覆盖四级接管、候选隔离、其他维度保留、隐藏/揭示、真实评分、刷新、淡出、真实划词复发和历史归因。

## 验证

- 定向 `tests/weak-signals.test.ts`：69/69 通过。
- `npm run lint`、`npm run typecheck`：通过。
- `npm test`：186/186 通过，含生产构建成功。
- `tests/e2e/signal-flow.spec.mjs`：12/12 通过；既有 11 条语义保持，固定端口 3000、HTTP 200。

## 边界与下一目标

- 未新增 schema，未改 lookup 阈值/事件含义、评分、FSRS、每日门禁、备份、package scripts 或普通入口。
- 查词训练本身从不修改 `lookupStats`；只有真实划词才触发复发。
- 下一条最高价值断链：顽固词仍只有通用卡和低评分后的单次拼写强化，尚未形成多模式强化闭环。
