# 下一轮执行 Prompt：第 36 轮回忆变化同词配对口径

## 当前现场

- 分支：`codex/follow-up-hardening`
- 本轮提交前 HEAD：`a1db0ae`；第 35 轮处于待提交状态，最终 commit 以后续 Git 历史为准。
- 最新验证：定向 weak-signals 75/75；lint、typecheck 通过；`npm test` 192/192；signal-flow E2E 15/15。
- 工作区交接目标：第 35 轮提交后仅保留用户未跟踪 `1.txt`；固定端口 3000 已释放。

## 第 35 轮已完成

- `rating≥2` 的去重计数算法和内部 `resolvedCount` 保持不变。
- 周报、4 周趋势、冲刺完成页和冲刺历史卡统一改为“当场达标词数/当场达标”。
- “仍需关注”继续表示当前统一薄弱画像，不与当场达标互斥。

## 遗留断链

1. `buildSprintEffectiveness` 的“回忆降幅”比较两组不同事件权重的均值，没有按同词配对。
2. `buildSprintCompletionSummary` 的冲刺前后回忆对比同样按事件总体均值，页面却写“提升”。
3. 近 7 天全局“成功率”来自全部评分事件，与冲刺当场达标率数据源不同，尚待独立口径审计。
4. 猜错仍只有累计次数，无真实事件时间、恢复或复发数据源。

## 下一轮唯一目标

只审计并把用户可见的冲刺前后回忆变化收敛为同词配对的观察口径。必须先证明周报、4 周趋势和完成页可在现有 reviews/sessionId/recallMs 下形成一条完整单轮链；若不能完整收敛，停止实现并只提交审计证据。

## 只读核对项

- 先检查 Git 状态、分支、HEAD、最近历史、端口 3000 与 PID；确认只有 `1.txt` 未跟踪。
- 分别追踪 `buildSprintEffectiveness` 和 `buildSprintCompletionSummary` 的冲刺前样本、冲刺样本、时间窗、事件权重及同词重复规则。
- 核对同词配对可用的真实 `wordId`、`reviewedAt`、`recallMs` 与 session 边界；无合法两侧样本的词不得进入配对分母。
- 检查周报、4 周趋势、完成页及 signal-flow 的所有“提升/降幅/变慢/前后平均”用户入口。

## 实现边界

- 只修回忆变化配对口径；不同时建立冲刺后首次正常复习保持，也不进入处置维度归因。
- 无配对样本必须返回 `null`/显示无样本，不得填 0；同词在一个统计窗内只贡献一个明确配对值，并报告配对词数。
- 允许“观察到”“配对变化”等观察性文案，禁止“训练导致提升”等因果表述。
- 不改当场达标计数、薄弱画像、评分、FSRS、每日 Quiz 门禁、备份、package scripts；不新增 schema/version/store/domain，不改历史 reviews/quizAttempts。

## 验收标准

- 纯函数单测覆盖配对样本选择、同词多事件、缺失/非法 recallMs、无配对样本和时间边界。
- 周报、4 周趋势与完成页展示一致的配对语义和样本数，不再把非配对总体均值写成“提升”。
- 必须执行并报告实际数字：定向 weak-signals、lint、typecheck、`npm test`、signal-flow E2E；既有 15 条 E2E 语义不减少。
- 固定端口 3000 健康检查成功；结束后只清理本轮确认进程与日志。

## 文档与提交要求

- 更新 `learning-effectiveness-audit.md`，创建 `round-36.md`，更新 `project-evolution.md` 和 `next-round-prompt.md`；必要时更新咬合表。
- 完成验证与清理后先请求同一个 DeepSeek 任务做提交前复核；处理意见后显式暂存本轮文件。
- 一个中文 commit，不 push；禁止 `git add .`、`git add -A`、`git commit -am`，不修改或暂存 `1.txt`。

## 停止门槛

若完整链路需要新增 schema/version、伪造缺失测时或历史配对、进入后续保持/维度归因、修改评分/FSRS/每日门禁/备份，或固定端口被非项目进程占用、浏览器连续两次失败，立即停止并只报告证据。
