# 第 24 轮报告：测验薄弱标签按模式降级

> 执行日期：2026-08-08 ｜ 分支：`codex/follow-up-hardening`

## 目标

修复三类测验历史答错永久留在统一薄弱画像的问题：同模式连续两次答对后只让当前标签淡出，之后同模式再次答错立即恢复标签。

## 核实结论

- `QuizAttempt` 已有 `answeredAt`、`correct`、`mode` 和稳定 `id`，无需新增 schema。
- 恢复按 `answeredAt` 排序，并以原数组位置打破同时间平局；非空重复 ID 只参与一次当前状态判定，避免重复记录伪造连续成功。
- 无效时间的答对不作为恢复证据；无效时间的答错无法可靠排序，保守保留当前标签。三种模式分别计算，跨模式正确不互相替代。

## 文件与关键改动

- `lib/weak-signals.ts`：保留历史累计错次派生，新增按模式判断最近两次可靠作答是否均正确；只控制当前标签显隐，不删除或改写 attempt。
- `tests/weak-signals.test.ts`：三种模式分别覆盖首次错、一次对不足、跨模式不恢复、同模式两次对淡出、再错复发；另覆盖乱序、同时间稳定次序、重复 ID、无效时间和历史时间线/周统计保持。
- `docs/iterations/occlusion-table.md`、`docs/project-evolution.md`：追加第 24 轮测验标签降级闭环。

## 验证

- `node --experimental-strip-types --test tests/weak-signals.test.ts`：54/54 通过。
- `npm run lint`、`npm run typecheck`：通过。
- `npm test`：171/171 通过，含生产构建成功。
- `npx playwright test tests/e2e/signal-flow.spec.mjs`：既有 8/8 通过（18.1s），语义未改。
- 固定端口 3000：启动前无监听，健康检查 200；结束后精确关闭本轮父 PID 13768 及其服务子进程，端口释放，日志与 PID 文件已清理。
- 服务实际约 1 秒可用，但 `Start-Process` 启动宿主因输出重定向句柄随子进程保持，工具在清理后才于 125.6 秒返回，超出单命令 2 分钟纪律 5.6 秒；未重跑，后续命令均未超时。

## 提交

- 提交信息：`fix: 修复测验薄弱标签永久保留`
- 提交：本提交（真实 hash 见最终回报）。

## 遗留与决策

- 历史测验错次、attempt、词级时间线和周维度统计继续表达历史事实，不随当前标签降级而删除或改写。
- 本轮不处理猜错降级，不新增非查词类「已稳定」UI；未改评分、FSRS 排程、备份、持久化 schema、package scripts 或 E2E 语义。
- 遗留执行纪律缺口仅为上述开发服务启动宿主延迟返回；功能与验收证据不受影响。
