# 第 37 轮：近 7 天评分达标事件占比诚实化

日期：2026-08-09
只读基线：`b189ab9`
分支：`codex/follow-up-hardening`

## 只读审计

- 修改前工作区只有用户未跟踪的 `1.txt`，无其他 diff；固定端口 3000 无监听。
- `buildLearningInsights` 先丢弃 `reviewedAt` 无法解析的记录；当前窗是本地当天向前共 7 个自然日的 00:00 至 `now`（含），上一窗是再前 7 个自然日的 00:00（含）至当前窗起点（不含），未来事件不进入任一窗口。
- 旧 `successRate` 的分子是 `rating≥2` 的事件数，分母是窗内全部合法时间评分事件数。它不按词去重，同词多次评分每次一票，也不区分 new/review/sprint 或普通/冲刺 session。
- 唯一 UI 消费者是 `HistoryView` 学习趋势卡；旧实现把空当前窗返回为 0%，并以“成功率”和上下箭头显示两窗事件总体占比差，无法区分无样本与真实 0%，也未说明百分点单位。

## 唯一目标与实现

- 将 `LearningInsights.successRate` 收敛为 `number | null`：当前窗没有评分事件时返回 `null`，真实有样本但全部未达标时仍返回 0；无效 `now` 或非正窗口同样不伪造 0。
- 保留既有分子、分母、事件权重、混合会话和窗口边界；`successRateDelta` 仅在当前与上一窗口都有事件时存在，值仍为“当前占比 − 上一占比”的百分点差。
- 轨迹页标题改为“评分达标占比”，披露“`rating≥2 / 全部评分事件`”与“近 7 天截至目前”。无当前样本显示“— / 当前窗无样本”，真实 0 显示 `0%`；上一窗无样本显示“无可比上窗”，有可比样本显示“较上窗 ±N 个百分点”，舍入后为 0 时显示“较上窗持平”。
- 去除上下箭头和宽泛“成功率”，不写提升、下降原因、冲刺效果或后续保持；不改变其他学习趋势卡或任何冲刺指标。

## 验收证据

- `node --experimental-strip-types --test tests/insights.test.ts`：8/8。
- `npm run lint`：通过。
- `npm run typecheck`：通过。
- `npm test`：197/197，0 失败、0 跳过，含生产构建。
- `npx playwright test tests/e2e/signal-flow.spec.mjs --config playwright.config.mjs --reporter=line`：16/16（36.4s）。新增一条复合用户链路覆盖当前窗无样本、真实 0% 与 -100 个百分点、上下窗 50% 持平；既有 15 条语义全部通过。
- 单测另覆盖上一窗无样本、100%、同词多事件事件加权、new/review/sprint 与普通/冲刺 session 混合、本地当前/上一窗口边界、未来和无效时间。

## 边界与清理

- 未新增 schema/version/store/domain；未修改冲刺指标、评分、FSRS、每日 Quiz 门禁、备份、package scripts、历史 reviews/quizAttempts、薄弱画像、再冲刺或猜错数据。
- 未按词去重、未排除任何 session/kind、未造事件或回填历史；两窗口事件构成可不同，百分点差只作观察描述，不声称因果。
- 固定端口 3000 由本轮 2026-08-09 00:30:18 启动的 node PID 30980 监听，健康检查返回 HTTP 200；E2E 后精确停止该 PID，端口已释放，本轮两份唯一日志已删除，未批量终止 Node。
- `npm test` / dev 生成的 `lib/build-info.generated.ts` 工作树噪声已恢复到只读基线；`1.txt` 未修改、未暂存。

## 阶段判断

- 阶段 A 完成：冲刺指标矩阵已收敛，本轮又关闭最后一个高价值全局用户入口的空样本与命名缺口；当前可见指标均明确披露证据边界。
- 猜错缺少真实事件时间是数据缺口，不能在无 schema 条件下伪造随访，但不阻止阶段 A 的口径诚实化完成。
- 下一轮进入阶段 B 的“冲刺后首次正常复习保持”，必须先审计现有 review/sessionId 能否完整建立 B1/B2/B3 链，再在同一唯一目标内实现；本轮未提前实现阶段 B。

## DeepSeek 提交前复核

- 父会话已把本轮实际 diff、测试数字、工作区、端口和边界交回同一 `opencode/zen-v4-flash` 任务。结论为可提交、无阻断；独立确认 nullable 类型、空/0/100、窗口边界、事件加权与混合会话、百分点与舍入持平、UI 文案、8 文件范围、阶段 A 结论及第 38 轮 B1/B2/B3 边界均正确。
- DeepSeek 只读复验 `tests/insights.test.ts` 8/8、lint 和 typecheck 通过。
- 非阻断意见处理：当前真实 0 且上一窗无样本已有纯函数单测覆盖，不再增加第四个 E2E 场景；第 38 轮提示词补充周一边界 seed 规则；`formatSuccessRateDelta` 当前只有唯一消费者，暂不扩成公共抽象。
