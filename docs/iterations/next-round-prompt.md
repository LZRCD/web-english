# 第 54 轮待授权 Prompt：删除已被直接行为测试覆盖的超时源码断言

## 当前真实现场

- 分支应为 `codex/follow-up-hardening`。
- 起始 HEAD 应为第 53 轮“学习流程结构断言契约审计”的唯一中文文档提交；启动时读取并登记完整 hash，不猜测自引用提交。
- 第 53 轮只读审计已把 `tests/rendered-html.test.mjs:272-308` 的 37 条源码正则逐条分类，矩阵见 `docs/iterations/structure-test-contract-audit.md`。
- 当前唯一目标对应矩阵第 16 条：`tests/api-guard.test.ts:163-207` 已直接调用 `chatCompletion` 并验证请求携带 `AbortSignal`，所以读取 `lib/ai-provider.ts` 并匹配 `/AbortSignal\.timeout\(/` 不再提供额外行为证据。
- 第 53 轮未运行产品测试、构建或服务；历史第 51/52 轮结果不能替代本轮验证。

## 授权门禁

这是下一轮候选 Prompt，不是自动执行指令。用户或批次总控未明确授权第 54 轮时，保持等待，不修改文件、不暂存、不提交、不启动服务。

授权后先独立核对：

1. branch、完整 HEAD、`git status --short --branch`、tracked diff 与 index；
2. `docs/iterations/round-54.md` 不存在；
3. 第 53 轮矩阵仍把第 16 条标为分类 1，且 `tests/api-guard.test.ts` 的直接信号断言仍存在；
4. `1.txt`、`.zcode/`、架构文档、Typora 日志和历史 `.codex-*.log` 未漂移；
5. `lib/build-info.generated.ts` 无修改。

任一不符立即 STOP，保留现场。

## 唯一目标与完成定义

仅清理 `tests/rendered-html.test.mjs` 中 `AbortSignal.timeout` 的源码结构断言：

- 删除 `assert.match(aiProvider, /AbortSignal\.timeout\(/)`；
- 删除只为该断言存在的 `aiProvider` 解构变量；
- 删除只为该断言存在的 `../lib/ai-provider.ts` 源码读取项；
- 不修改该测试中的其他 36 条断言；
- 不修改 `lib/ai-provider.ts` 或任何产品行为。

完成定义：rendered-html 最后一个测试不再读取 AI Provider 源码来锁定超时实现；`api-guard` 的直接行为测试保持原样并通过；风险匹配验证全部通过；一个中文提交，不 push。

## 允许范围

- `tests/rendered-html.test.mjs`
- `docs/iterations/round-54.md`
- `docs/iterations/structure-test-contract-audit.md`（仅把第 16 条从“建议删除”更新为“已删除”，不得改其他分类）
- 仅在确定后续 `CONTINUE/STOP` 时更新 `docs/iterations/next-round-prompt.md`
- 只有批次阶段事实变化时才更新 `docs/project-evolution.md`

## 禁止范围

- 其余 36 条结构断言；尤其不得整块删除或批量弱化。
- 生产代码、config、package scripts、schema/version/store/domain、用户数据和 `lib/build-info.generated.ts`。
- Quiz、Sprint、Review/FSRS、复发、猜错、恢复、持久化与 Provider 语义。
- 为通过测试降低门槛、添加 skip/ignore、复制第二套超时实现。

## 验证与提交

按测试变更风险执行：

1. 定向运行 `api-guard` 与 `rendered-html` 对应测试入口；
2. `npm run typecheck`；
3. `npm run lint`；
4. `npm test`（当前脚本含 production build）；
5. 若 build 改写 `lib/build-info.generated.ts`，在最终暂存前恢复；
6. `git diff --check`；
7. 记录实际修改文件并逐个精确暂存；
8. 运行 `check-iteration-gate.ps1 -Phase PreCommit -AllowedPath $roundFiles`，确认 unstaged tracked 为空、cached 文件集合精确相等、cached diff check 通过；
9. 返回 `READY_FOR_CONTROLLER_REVIEW`，获批后由同一执行者创建一个中文提交；不 push。

不启动固定端口 `3000` 或浏览器服务；若定向 `rendered-html` 入口依赖现有构建产物，按仓库脚本实际依赖执行，不自行启动服务。

## STOP 条件

- 直接行为测试不再验证请求 signal，或当前实现/测试证据冲突；
- 必须修改产品代码或其他结构断言才能通过；
- 工作区/index/保护项漂移；
- 需要业务决策或扩大范围。

停止时报告已完成、未完成、Git 状态和准确恢复入口。
