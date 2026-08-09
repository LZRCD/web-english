# 第 64 轮：activeQuiz 失效题组安全恢复

- 日期：2026-08-09
- 分支 / 起始 HEAD：`codex/follow-up-hardening` / `a2c9561f47c886e288ab86b4a226f0061a3e0cd8`
- 批次：实施第 63 轮已批准推荐契约；第 1/1 轮
- 状态：完成，STOP

## 目标与边界

- 部分题目失效时保留有效题原顺序与完整呈现快照，协调重算 index、answers、correctCount、complete 和结果分母，并提示分母变化。
- 全部题目失效时清除 `activeQuiz`，保留既有 attempt / review，提示结束原因并在测验模式页提供重新开始入口。
- 恢复只在持久化 hydrate 与红宝书 ready 后执行，避免把加载中的空词库误判为全部失效。
- 未修改 `activeSession`、FSRS、评分、推荐、学习历史或用户数据；未新增 IndexedDB store/domain，未提升 schema/version。

## 实现

- `QuizSessionState` 新增向后兼容的可选 `questionSnapshots`，保存题目 id、mode、wordId、题干、正确答案、选项、标签和解析；运行时 Word 仍必须从当前词库与进度解析，失效目标不能继续作答。
- normalize 对快照限长、按目标去重并拒绝无法安全呈现的题目；新快照作为题组顺序真源进入既有分域、备份、导入与清空链。旧的仅 `questionWordIds + seed` 会话继续兼容，并在恢复写盘后自愈为完整快照。
- `recoverQuizSession` 以恢复后的有效题集合为统一口径：index 按旧边界前有效题数重算；失效题答案从活跃会话移除；正确数按保留答案重算；所有剩余题已有答案才完成；结果页继续以剩余题数为分母。
- 页面恢复桥等待 hydrate + redbook ready。部分失效一次写回并显示题目减少/分母变化提示；全部失效写回 `undefined`，保留历史记录，并在模式页显示结束说明和“重新开始 10 题”入口。

## 验证

| 级别 / 命令 | 结果 | 证据边界 |
|---|---|---|
| V1 / `quiz.test.ts` + `weak-signals.test.ts` | 102/102 | 完整题目快照、部分/全部失效协调、normalize 与分域往返 |
| V1 / `npm run typecheck` | 通过 | 新持久化类型、恢复返回值与页面接线 |
| V2 / `npm run lint` | 0 error / 1 个既有 warning | `projection.ts` 未使用类型 warning 与本轮无关 |
| V2 / `npm run test:unit` | 244/244 | 全量 Node 回归 |
| V3 / `active-quiz-recovery.spec.mjs` | 2/2，4.6 秒 | 部分失效写回/续答/再次刷新；全部失效清除/历史保留/重开入口 |

- 首次 E2E 0/2：fixture 缺少健康 FSRS card，导致种入进度被既有完整性修复安全丢弃；另一处 locator 同时命中两块规则说明。补齐真实已学习前置并收紧定位后 2/2 通过，未降低产品断言。
- 固定端口 3000 使用统一脚本启动：worker PID 47476、listener PID 54600，日志 `.wordloop-runtime/rounds/dev-20260809-162642.out.log`；验证后已精确停止，端口空闲。
- 未运行 `npm test`、production build 或全目录 E2E：本轮为 V3 UI/持久化变更，V1 + V2 + 精选 V3 已覆盖获批契约。dev 生成的 `lib/build-info.generated.ts` 已恢复。

## 提交与停止

- 精确暂存产品 4 文件、单元测试 2 文件、精选 E2E 1 文件和本轮 3 份迭代文档；保护项与运行日志不暂存。
- 中文提交信息：`fix: 安全恢复失效测验题组`；不预猜本文件所在提交 hash。
- 获批契约已完成，批次达到 1/1；提交后 STOP，不自动进入其他候选，不 push。
