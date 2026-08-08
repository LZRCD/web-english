# 第 23 轮报告：慢回忆薄弱标签降级

> 执行日期：2026-08-08 ｜ 分支：`codex/follow-up-hardening`

## 目标

修复慢回忆历史累计与当前统一薄弱画像之间的断链：历史慢事件保留，但达到可靠连续快速回忆条件后当前标签淡出，再次变慢时立即恢复。

## 核实结论

- 现有评分以 `rating >= 2` 表示成功，`recallMs` 可缺省；因此恢复只接受评分 2/3 且有合法测时的快速回忆。
- 抗抖门槛与既有 lapse 恢复一致，采用最近连续两次成功快速回忆；无测时、低评分或慢回忆均中断连续性。
- `slowRecallMs` 是当前可配置阈值，标签命中和恢复条件均实时使用该值。

## 文件与关键改动

- `lib/weak-signals.ts`：保留历史慢次数派生；新增当前恢复判定，最近连续两次有测时、评分 2/3 且低于当前阈值后只让慢回忆标签淡出，后续慢回忆立即重现。
- `tests/weak-signals.test.ts`：覆盖首次慢、一次快速不足、两次快速恢复、无测时/低评分不算快速、再次变慢、阈值实时生效、其他信号保留，以及历史时间线/周趋势/回忆统计不受影响。
- `lib/build-info.generated.ts`：随生产构建刷新起点提交与源码哈希。
- `docs/iterations/occlusion-table.md`、`docs/project-evolution.md`：记录第 23 轮联动闭环。

## 验证

- `node --experimental-strip-types --test tests/weak-signals.test.ts`：49/49 通过。
- `npm run lint`：通过。
- `npm run typecheck`：通过。
- `npm test`：166/166 通过，含生产构建成功。
- `npx playwright test tests/e2e/signal-flow.spec.mjs`：既有 8/8 通过（18.6s），未修改其语义。
- 固定端口 3000：启动前无监听，健康检查 200；结束后精确关闭本轮监听 PID 40548，记录父 PID 33648 已退出，端口、日志和 PID 文件均已清理。启动命令宿主未按预期返回，终止宿主后服务仍可用；未重启，完成验证后精确清理。

## 遗留与决策

- 历史慢回忆 review、词级时间线、回忆耗时统计和周趋势仍按历史事实保留，不改为当前状态口径。
- 本轮未新增非查词类「已稳定」UI，未处理测验/猜错降级；未改评分、FSRS 排程、备份、持久化 schema 或 E2E 语义。
