# 第 26 轮报告：冲刺处置周复发率回溯

> 执行日期：2026-08-08 ｜ 分支：`codex/follow-up-hardening`

## 目标

新增最近 4 个已完成冲刺周的截至当前复发率回溯：按冲刺处置周分组解决词，再用当前统一薄弱画像判断复发，不伪造历史周末状态。

## 文件与关键改动

- `lib/weak-signals.ts`：新增 `buildSprintRelapseSeries`；一次扫描按本地周一收集 `sessionId` 为冲刺且 `rating≥2` 的去重 cohort，跨周缓存当前 `buildWordWeakSignals` 判定，输出每周解决词数、复发词数与复发率；空周返回 `null`。既有 `buildSprintRelapse` 复用同一 cohort/排序逻辑。
- `app/page.tsx`、`app/components/HistoryView.tsx`：轨迹页在「冲刺成效 4 周」旁展示「冲刺复发率 4 周」，明确“按冲刺处置周分组、截至当前回溯（非历史周末快照）”；序列最后一周继续供既有复发词列表与「再冲刺」入口使用。
- `tests/weak-signals.test.ts`：新增 3 个用例，覆盖四周边界、周内去重、冲刺/评分过滤、当前画像与阈值、空周、恢复后更新，以及既有单周结果和复发词 ID 不变。
- `docs/iterations/direction-review-25.md`、`docs/iterations/occlusion-table.md`、`docs/project-evolution.md`：纳入第 25 轮方向审视并记录第 26 轮联动闭环。

## 验证

- `node --experimental-strip-types --test tests/weak-signals.test.ts`：61/61 通过。
- `npm run lint`、`npm run typecheck`：通过。
- `npm test`：178/178 通过，含生产构建成功。
- `npx playwright test tests/e2e/signal-flow.spec.mjs`：既有 8/8 通过（18.7s），未修改其语义。
- 固定端口 3000：启动前无监听，健康检查 200；结束后精确关闭本轮记录的 PID 21920 进程树，端口释放，PID 与唯一日志已清理。

## 遗留与决策

- 无冲刺解决词的周以 `null` 和「无冲刺解决词」展示，不将缺失数据误报为 0%；有解决词且当前无复发才显示 0%。
- 本轮未新增 schema 或保存历史快照，未改评分、排程、备份、package scripts、既有单周复发词列表与「再冲刺」语义。
- “猜错”仍受既有真实时间源/恢复规则缺失限制；第 26 轮后的整体评估交由主代理完成。
