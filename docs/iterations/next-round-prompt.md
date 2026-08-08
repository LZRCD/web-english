# 下一轮执行 Prompt：第 35 轮“解决词数”改为当场达标口径

## 当前现场

- 分支：`codex/follow-up-hardening`
- 本轮提交前 HEAD：`b645196`；第 34 轮处于待提交状态，最终 commit 以后续 Git 历史为准。
- 最新验证：定向 weak-signals 75/75；lint、typecheck 通过；`npm test` 192/192；signal-flow E2E 15/15。
- 工作区交接目标：第 34 轮提交后仅保留用户未跟踪 `1.txt`；固定端口 3000 已释放。

## 第 34 轮已完成

- 创建证据驱动学习路线与七项成效口径矩阵。
- 同词在 4 周内多次冲刺达标时只归该窗口内最近一次达标处置周。
- 4 周与上周 UI 改为“当场达标/当前仍薄弱率”，明示不能区分从未恢复与恢复后再次薄弱。
- 保留当前仍薄弱词再次处置，不改单周派生、评分、FSRS 或持久化。

## 遗留断链

1. `rating≥2` 的去重词目前仍在周报、4 周成效和冲刺完成页写成“解决/已解决”，文案超过证据。
2. “回忆降幅/提升”是两组不同事件权重的非配对均值，不能证明同词速度提升。
3. 猜错仍只有累计次数，无真实事件时间、恢复或复发数据源。

## 下一轮唯一目标

只把产品当前的 `rating≥2` “解决词数/已解决”口径诚实化为“当场达标词数/当场达标”。不改计数算法，不同时处理回忆耗时配对。

## 只读核对项

- 先检查 Git 状态、分支、HEAD、最近历史、端口 3000 与 PID；确认只有 `1.txt` 未跟踪。
- 追踪 `buildSprintEffectiveness.resolvedCount` 与 `buildSprintCompletionSummary.resolvedCount` 的真实来源、去重和评分条件。
- 检查 `HistoryView.tsx`、`SessionCompleteView.tsx`、`page.tsx` 及 signal-flow 既有“已解决”断言，确认所有当前用户可见入口。
- 核对完成页“仍需关注”与达标词可以重叠的既有语义，不把当前画像改成达标判定。

## 实现边界

- 仅改当场达标命名、必要注释与对应测试；内部兼容字段 `resolvedCount` 可保留。
- 不改 `rating≥2` 条件、去重、完成摘要、薄弱画像、再冲刺行为、评分、FSRS、每日 Quiz 门禁、备份、package scripts。
- 不处理回忆“提升/降幅”；不新增 schema/version/store/domain；不改历史 reviews/quizAttempts。
- 不把当场达标写成恢复、掌握、长期保持或因果效果。

## 验收标准

- 周报、4 周成效、冲刺完成页不再显示“解决/已解决”，统一为“当场达标”。
- `resolvedCount` 数值和所有现有业务入口保持；既有 15 条 E2E 语义不减少。
- 必须执行并报告实际数字：定向 weak-signals、lint、typecheck、`npm test`、signal-flow E2E。
- 固定端口 3000 健康检查成功；结束后只清理本轮确认进程与日志。

## 文档与提交要求

- 更新 `learning-effectiveness-audit.md` 对应状态，创建 `round-35.md`，更新 `project-evolution.md` 和 `next-round-prompt.md`；必要时更新咬合表。
- 完成验证与清理后先请求同一个 DeepSeek 任务做提交前复核；处理意见后显式暂存本轮文件。
- 一个中文 commit，不 push；禁止 `git add .`、`git add -A`、`git commit -am`，不修改或暂存 `1.txt`。

## 停止门槛

若需要改评分/FSRS/每日门禁/备份、需要新增 schema/version、需要伪造历史恢复或因果、固定端口被非项目进程占用、浏览器连续两次失败，立即停止并只报告证据。
