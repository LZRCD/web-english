# 第 59 轮：首次使用的三步轻量引导

- 日期：2026-08-09
- 分支 / 起始 HEAD：`codex/follow-up-hardening` / `01608b6c75a13e321c992c9989ba08808aede858`
- 批次：首次引导、Windows 启动说明与会话失效恢复；第 1/3 轮
- 状态：完成

## 目标与边界

- 完成定义：首次状态依次解释今日任务、先回忆再揭示并评分、查词与词本；支持前进、后退、跳过、原生键盘操作和 320px。
- 状态决策：直接复用既有 `started=false` 欢迎状态；完成或跳过沿用 `beginFromWelcome -> startTodaySession`，不记录新的“已看过引导”。
- 禁止修改：默认队列、FSRS、评分、推荐、学习数据、schema/version/store/domain。
- Round 0：Start gate 在完整 HEAD 通过；tracked/index 与 `build-info` 干净，37 个保护项保留，3000 空闲，第 59～61 轮文档均不存在。

## 改动

- `WelcomeScreen`：欢迎页改为三步引导，提供上一步、下一步、跳过与最后一步“开始今日任务”；首次自动聚焦主操作，原生按钮支持 Tab、Shift+Tab、Enter 和空格。
- `globals.css`：新增引导卡、进度和键盘焦点样式；320px 下压缩图形与间距、操作改为两列并允许卡片内部纵向滚动。
- `onboarding.spec.mjs`：覆盖跳过、三步顺序、后退、Enter/空格、320px 横向溢出以及既有今日任务会话入口。
- 验证过程中曾尝试自定义方向键监听，但浏览器事件证据不稳定；最终删除该承诺，保留更简单可靠的原生按钮键盘语义。

## 验证

| 级别 / 命令 | 结果 | 证据边界 |
|---|---|---|
| V2 / `npm run typecheck` | 通过 | TypeScript 与组件 Props 契约 |
| V2 / `npm run lint` | 0 error / 1 个既有 warning | 本轮无 lint error；未处理 `projection.ts` 既有 warning |
| V2 / `npm run test:unit` | 240/240 | 既有队列、评分、FSRS 与持久化回归；不证明引导交互 |
| V3 / 新增 E2E | 2/2，4.7 秒 | 跳过、三步前进/后退、键盘、320px 与今日任务入口 |

- 服务：由 `manage-dev-server.ps1` 启动固定 3000；worker PID 42284、listener PID 30612，日志 `.wordloop-runtime/rounds/dev-20260809-152718.out.log`；提交前进程已退出且 3000 空闲，后续浏览器轮按脚本重新启动。
- 未运行 `npm test` 或 production build：本轮未触及 V4 边界，避免重复 `test:unit` 与无条件构建。

## 提交与判断

- 提交前恢复生成文件、精确暂存产品 2 文件、E2E 1 文件和本轮 3 份迭代文档；保护项与运行日志不暂存。
- 提交：本文件不预猜自身提交 hash；中文提交信息为 `feat: 增加首次使用三步引导`。
- 继续判断：未出现 schema/version/store/domain 或外部漂移；下一目标是已授权的纯文档 Windows 启动说明，按 Delta Gate 进入第 60 轮。
- push：未执行。
