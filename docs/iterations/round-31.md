# 第 31 轮报告：顽固词多模式强化闭环

> 执行日期：2026-08-08 ｜ 分支：`codex/follow-up-hardening` ｜ 起点：`a038d48`

## 目标

让活跃顽固词按真实 review 跨“词义主动回忆 → 听音拼写 → 中译英”推进，连续三次成功后淡出，低评分重置并按既有规则复发。

## 文件与关键联动

- `lib/weak-signals.ts`：新增纯派生顽固阶段推荐与 `sprint:stubborn:<mode>:<ISO>` 创建/解析；按模式分组候选，只由触发后的尾部成功 review 数推进。统一冲刺保持“拼写 → 中译英 → 辨析 → 查词 → 顽固 → 通用”。
- `app/page.tsx`：词本和统一冲刺复用同一推荐；阶段 0 启动现有 WordCard，阶段 1/2 启动现有 QuizView。刷新按 session 开始时刻重建原候选，避免后续作答令题组漂移。
- `tests/weak-signals.test.ts`：覆盖分组、前四级抢占、attempt 不推进、真实 review 推进、低评重置、三成功淡出、复发、旧记录回退、结构化历史与刷新候选。
- `tests/e2e/signal-flow.spec.mjs`：覆盖词本入口、隐藏释义、刷新、真实评分/sessionId、听音拼写接管、统一入口进入中译英及冲刺历史感知。

## 关键选择

`meaning-choice` 要求至少四个可用已学词及唯一干扰项，无法保证所有活跃顽固词都有题目，因此不把它放入强制恢复阶梯。现有 WordCard、听音拼写和中译英都能对单个已学词可靠训练，且三步均写真实 review；同日被 Quiz 门禁拦截的 attempt 只留作答记录，不推进阶段。

## 验证

- 定向 `tests/weak-signals.test.ts`：71/71 通过。
- `npm run lint`、`npm run typecheck`：通过。
- `npm test`：188/188 通过，含生产构建成功。
- `tests/e2e/signal-flow.spec.mjs`：13/13 通过；既有 12 条语义保持，固定端口 3000、HTTP 200。

## 边界与下一阶段

- 未新增 schema/version，未改 `rebuildStubbornWords`、评分、FSRS、每日 Quiz 门禁、备份、题目/答案/干扰项算法或 package scripts。
- 不直接写 `stubbornWords` 假装恢复，不把多个 attempts 伪造成 reviews；普通成功 review 仍按既有规则参与恢复。
- 剩余受约束维度只有“猜错”：当前仅有累计次数，没有真实事件时间、恢复或复发数据源；在现有边界下继续标记为不可诚实实现。
