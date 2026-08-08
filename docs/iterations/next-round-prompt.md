# 下一轮执行 Prompt：第 41 轮阶段 D 分维度观察报告

## 当前现场

- 第 40 轮定向 85/85、lint/typecheck、`npm test` 205/205，固定端口 3000 signal-flow 17/17（45.6s）。
- 阶段 C 已完成：未来编码、解析、startedAt、入口写入、刷新、历史、成效/B 链与 generic 历史复跑均有自动证据。

## 前置门槛

- 第 40 轮必须已经完成并提交：统一未来 `sprint:treatment:<dimension>:<ISO>` 编码、旧普通/顽固兼容解析、startedAt、全部入口、持久化、历史、成效/B 链与 generic 历史复跑。
- 必须有固定端口 3000 的 `tests/e2e/signal-flow.spec.mjs` 全组通过证据，并确认本轮服务 PID/日志精确清理、3000/3001 无项目残留。若该证据尚未补齐，只完成第 40 轮复验，不进入阶段 D。
- 保护且绝不修改/暂存：`1.txt`、`docs/architecture-analysis-2026-08-09.md`、第 38 轮两份 `.codex-round38-20260809-010645.*.log`、第 40 轮两份 `.codex-round40-parent-e2e.*.log`，以及任何并发任务目录（当前可见 `.zcode/`）。

## 唯一目标

建立一个只读、并列、非因果的“分维度观察报告”最小纵向链：从统一 parser 识别真实未来维度，按维度汇总冲刺活动与第 38 轮首次正常复习保持观察，在轨迹页披露样本数和未知历史；不排名、不改推荐。

本轮只补这一条完整链，不进入阶段 E。

## 口径

1. 维度只来自 `parseSprintSessionId` 的已知新 treatment 或合法顽固主维度；旧 `sprint:<ISO>`、未知 treatment、非法顽固 mode 必须进入 `unknown`，不能分摊到 `generic-sprint`。
2. 至少并列输出每维度：冲刺 session 数、覆盖词数、当场达标词数、成功锚点 cohort、随访覆盖数、保持成功数/保持率、实际随访间隔、配对回忆耗时样本/变化、当前仍薄弱数/比例。每个比例同时显示分子、分母或样本数。
3. 保持链继续使用每词窗口内最近成功 sprint 锚点、`(reviewedAtMs,id)` 总序、任意下一 sprint 截断、首条非 sprint review 随访；维度只附着锚点，不改变 B 链。
4. 当场达标、当前仍薄弱、随访保持与配对测时分母必须分开。无样本显示“无样本/—”，不得显示 0%；真实零必须保留。
5. `stubborn` 是主维度，子 mode 可披露但不得扁平并入普通听写/中译英/lookup。`unknown` 与 `generic-sprint` 必须分别展示。
6. 页面和文档明确：样本是用户选择与固定推荐下的观察，不代表模式效果、因果、最佳/最差或推荐依据。

## 禁止

- 不新增 schema/version/store/domain，不回填历史维度，不改评分、FSRS、每日 Quiz 门禁、备份、package scripts或历史数据。
- 不修改当前固定处置优先级，不做排行、胜负、最佳模式、权重、自适应推荐或因果文案。
- 不从按钮、标题、toast、中文标签、当前画像或 quizAttempt 猜历史维度。
- 若真实新维度样本不足以支撑完整报告，可用确定性单元/E2E seed 验证 UI 空样本/小样本行为，但必须如实披露本地真实数据不足，不能伪造生产历史。

## 验证与文档

- 定向测试覆盖新 treatment、stubborn、generic、unknown、无样本、真实 0、下一跨维 sprint 截断、quiz/无 session 随访、同毫秒总序与输入乱序；证明分维汇总合计不超过相应全局 cohort，且不改变既有 A/B 数字。
- E2E 只新增或扩展一条复合用户链，覆盖已知维度、unknown/generic 分列、样本数、无样本文案与非因果说明；固定端口 3000，signal-flow 全组。
- 运行定向测试、lint、typecheck、`npm test` 和 signal-flow；恢复 build-info 噪声并精确清理本轮 PID/日志。
- 创建 `round-41.md`，更新 `learning-effectiveness-audit.md`、`dimension-treatment-audit.md`、`project-evolution.md`、有新咬合时更新 `occlusion-table.md`，并生成下一轮 prompt。
- 提交前让同一 `opencode/zen-v4-flash` 任务复核实际 diff；只精确暂存本轮文件，一次中文 commit，不 push。

## 停止门槛

- 若第 40 轮固定端口 E2E 尚未通过，立即停在阶段 C 复验，不实现本轮功能。
- 若必须猜测历史维度、改变 B 链分母/截断、修改推荐或新增持久化 schema，立即停止并只提交阻断证据。
- 若样本只能支持活动量而不能支持保持，报告必须分项显示“无随访样本”，不能凑成综合分数或比较结论。
