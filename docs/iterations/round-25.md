# 第 25 轮报告：多维薄弱恢复统一反馈

> 执行日期：2026-08-08 ｜ 分支：`codex/follow-up-hardening`

## 目标

补齐非查词类薄弱消除后的正向反馈：复用第 22~24 轮及既有查词恢复规则，统一派生可测试的「已稳定」维度，并在学习卡支持多维合并展示。

## 文件与关键改动

- `lib/weak-signals.ts`：新增 `buildWordStabilizedDimensions`，覆盖查词、lapse、慢回忆、拼写、中译英与辨析；仅有真实历史弱点证据、满足对应既有恢复条件且当前统一画像完全清零时输出。猜错因没有恢复规则明确排除。
- `app/page.tsx`、`app/components/WordCard.tsx`：学习卡改为消费统一结构化维度列表；保留查词单维既有文案语义，多维合并展示，UI 不复制门槛或比较薄弱标签文案。
- `tests/weak-signals.test.ts`：覆盖六维恢复、组合输出、当前任一弱点阻断、从未薄弱、猜错排除、阈值变化与复发撤回。
- `docs/iterations/occlusion-table.md`、`docs/project-evolution.md`：新增第 25 轮联动闭环并更新缺口清单。

## 验证

- `node --experimental-strip-types --test tests/weak-signals.test.ts`：58/58 通过。
- `npm run lint`、`npm run typecheck`：通过。
- `npm test`：175/175 通过，含生产构建成功。
- `npx playwright test tests/e2e/signal-flow.spec.mjs`：既有 8/8 通过，语义未改。
- 固定端口 3000：启动前确认唯一服务，健康检查 200；结束后精确关闭本轮服务树并清理 PID/日志，端口无监听。

## 遗留与决策

- “猜错”继续只有 `guessMistakes` 累计次数，没有可靠事件时间或恢复规则；不伪造恢复、不误报稳定，等待未来真实时间源。
- 未新增持久化 schema，未改评分、FSRS 排程、备份、信号恢复条件、package scripts 或既有 E2E 语义。
- 本轮不做第 25 轮后的大方向审视，由主代理完成。
