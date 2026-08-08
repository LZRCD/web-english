# 第 19 轮报告：全态薄弱入口口径统一

> 执行日期：2026-08-08 ｜ 分支：`codex/follow-up-hardening`

## 目标

修复咬合表第 7 项，并在同一派生链路中修复第 9 项：词书、划词候选与冲刺候选统一复用实时薄弱画像。

## 文件与关键改动

- `lib/weak-signals.ts`：划词候选在当前查询阈值上复用 `buildWordWeakSignals`；冲刺候选以统一画像非空作为入选条件。
- `app/page.tsx`、`app/components/BooksView.tsx`：词书消费页面既有 `weakSignalsByWordId`，统一薄弱数量与单元分布。
- `app/components/WordbookView.tsx`：移除固定“查询 2 次+”判定，消费页面按当前阈值派生的候选 id。
- `tests/weak-signals.test.ts`：证明纯查词降级词退出画像/划词候选/冲刺，其他薄弱信号保留，并锁定阈值同步。
- `docs/iterations/occlusion-table.md`、`docs/project-evolution.md`：记录第 7、9 项修复与第十九轮信号联动。

## 验证

- `npm run lint`：通过。
- `npm run typecheck`：通过。
- `npm test`：156/156 通过，含生产构建成功。
- `node --experimental-strip-types --test tests/weak-signals.test.ts`：39/39 通过。
- `npx playwright test tests/e2e/signal-flow.spec.mjs`：既有 8/8 通过（18.1s）。
- 固定端口 3000：启动前无监听；健康检查 200；结束后仅关闭本轮记录的父 PID 1412 与监听 PID 6156，端口释放，开发日志与 PID 文件已清理。

## 提交

- 提交信息：`feat: 统一薄弱画像各入口口径`
- 提交：本提交（真实 hash 见最终回报）。

## 遗留

- 咬合表第 4 项：普通正向复习尚未进入词级时间线。
- 咬合表第 8 项：仅查询 1 次后答对仍可能误显“已稳定”。
- 本轮按边界未扩展上述两条断链，也未改评分、排程、备份链路。
