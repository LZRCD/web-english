# 第 20 轮报告：查词已稳定阈值门禁

> 执行日期：2026-08-08 ｜ 分支：`codex/follow-up-hardening`

## 目标

修复咬合表第 8 项：只有查询次数确实达到当前查词薄弱阈值、随后满足既有降级条件且无其他当前薄弱信号时，学习卡才显示「已稳定」。

## 文件与关键改动

- `lib/weak-signals.ts`：新增可测试的 `isLookupStabilized` 统一派生，复用当前 `lookupWeak` 阈值、`isLookupDemoted` 与 `buildWordWeakSignals`。
- `app/page.tsx`：`currentLookupStabilized` 改为消费统一派生，移除 UI 层重复判定。
- `tests/weak-signals.test.ts`：新增 4 个单测，锁定未达阈值、降级条件、其他薄弱信号和阈值实时变化四类边界。
- `docs/iterations/occlusion-table.md`、`docs/project-evolution.md`：标记第 8 项修复并记录第二十轮信号联动。

## 验证

- `npm run lint`：通过。
- `npm run typecheck`：通过。
- `npm test`：160/160 通过，含生产构建成功。
- `node --experimental-strip-types --test tests/weak-signals.test.ts`：43/43 通过。
- `npx playwright test tests/e2e/signal-flow.spec.mjs`：既有 8/8 通过（18.6s）。
- 固定端口 3000：正式验证健康检查 200；结束后仅关闭本轮服务 PID 11240 与子进程 7244、39944，端口无监听，开发日志与 PID 文件已清理。首次服务生命周期命令触及 120 秒硬超时，定位并精确清理后仅重启一次完成正式验证。

## 提交

- 提交信息：`fix: 收紧查词已稳定提示门禁`
- 提交：本提交（真实 hash 见最终回报）。

## 遗留与决策

- 咬合表第 4 项：普通正向复习尚未进入词级时间线。
- 非查词类薄弱消除后仍无正向「已稳定」反馈。
- 本轮按边界未改上述两项，也未做第 20 轮后的大方向审视；该审视交由主代理完成。
