# 第 34 轮：4 周当前仍薄弱口径诚实化

日期：2026-08-08
只读基线：`b645196`
分支：`codex/follow-up-hardening`

## 只读审计

- 修改前工作区只有用户未跟踪的 `1.txt`，无其他 diff；固定端口 3000 无监听。
- `buildSprintSolvedCohorts` 将同词每周一次 `rating≥2` 分别放入多个 cohort，导致 4 周序列跨周重复。
- `buildSprintCohortRelapse` 只把 cohort 与当前 `buildWordWeakSignals` 相交；没有恢复事件或历史快照，不能判断词是从未恢复还是恢复后再次薄弱。
- 轨迹页仍写“解决/复发/复发率”，超过真实数据证据。猜错只有累计次数，也不能补出严格复发路径。
- 七项指标的完整分子、分母、时间窗与配对审计见 `learning-effectiveness-audit.md`。

## 唯一目标

本轮只修 4 周“复发率”口径：

- 多周 cohort 为同词选择最近 4 周窗口内最近一次合法 `rating≥2` 冲刺处置周；使用 review 的真实 `reviewedAt` 比较，输入顺序不影响结果。
- 轨迹页统一为“冲刺后当前仍薄弱率”，分母称“当场达标词”，分子称“当前仍薄弱词”。
- 同时明示“未区分从未恢复与恢复后再次薄弱”，不再暗示已有历史恢复或严格复发事件。
- 上周当前仍薄弱词的一键再次冲刺保留；单周 `buildSprintRelapse` 行为和既有字段名为兼容不改。

“解决词数”和非配对“回忆提升”只登记为后续断链，本轮不混修。

## 验收证据

- 定向 `node --experimental-strip-types --test tests/weak-signals.test.ts`：75/75。
- `npm run lint`：通过。
- `npm run typecheck`：通过。
- `npm test`：192/192，0 失败、0 跳过，含生产构建。
- `npx playwright test tests/e2e/signal-flow.spec.mjs --config playwright.config.mjs --reporter=line`：15/15。
- 新单测证明同词跨周只归最近一次达标周，且乱序输入不改变结果；E2E 证明文案披露与再次处置入口均真实可用。

## 边界与清理

- 未新增 schema/version/store/domain；未修改评分、FSRS、每日 Quiz 门禁、备份链或 package scripts。
- 未删除、改写或伪造历史 reviews/quizAttempts；未把观察性结果写成因果。
- E2E 使用固定端口 3000。首次服务已健康但沙箱内端口查询不可见，第二次启动尝试未取得端口；提升只读权限后确认首个监听确属本仓库并复用。验证后精确关闭两组本轮进程树并删除本轮日志，3000 无监听。
- `lib/build-info.generated.ts` 的测试生成漂移已恢复，不纳入本轮提交；`1.txt` 未修改、未暂存。
