# 第 22 轮报告：FSRS lapse 薄弱标签降级

> 执行日期：2026-08-08 ｜ 分支：`codex/follow-up-hardening`

## 目标

修复 lapse 恢复语义与统一薄弱画像之间的断链：遗忘词仍弱时保留历史 lapse 标签，满足既有恢复条件后淡出，再次遗忘时重新出现。

## 核实结论

- `applyRating` 在评分 0 时累加 `lapseCount` 并清零连续成功，评分 2/3 时累加 `consecutiveSuccesses`。
- `isWeakProgress` 已以「当前低评分，或历史 lapse 且连续成功不足 2 次」判弱，并尊重 `resolveWeakProgress` 的显式解除时间。
- `buildWordWeakSignals` 原先只检查 `lapseCount > 0`，使恢复词仍永久输出 lapse，统一画像、词书、冲刺与复发入口因此继续误判。

## 文件与关键改动

- `lib/weak-signals.ts`：lapse 标签在保留历史计数的前提下复用 `isWeakProgress`；恢复后从统一画像淡出，后续评分 0 自动重新转弱并恢复标签。
- `tests/weak-signals.test.ts`：用真实 `applyRating` 串联遗忘、一次成功、两次成功恢复、再次遗忘，覆盖其他薄弱信号不受影响。
- `lib/build-info.generated.ts`：随生产构建刷新起点提交与源码哈希。
- `docs/iterations/occlusion-table.md`、`docs/project-evolution.md`：记录第 22 轮新增联动检查与修复结论。

## 验证

- `node --experimental-strip-types --test tests/weak-signals.test.ts`：46/46 通过。
- `npm run lint`：通过。
- `npm run typecheck`：通过。
- `npm test`：163/163 通过，含生产构建成功。
- `npx playwright test tests/e2e/signal-flow.spec.mjs`：既有 8/8 通过（17.6s），未修改其语义。
- 固定端口 3000：启动前无监听，健康检查 200；结束后精确关闭本轮父 PID 13944 与监听 PID 6860，端口、日志和 PID 文件均已清理。

## 遗留与决策

- 核心 8 项历史保持不变；新增 lapse 降级检查已闭环。
- 本轮未实现非查词类「已稳定」UI，也未处理慢回忆或测验信号降级。
- 未改评分、FSRS 排程、`resolveWeakProgress`、历史 lapse 计数、备份或持久化 schema。
