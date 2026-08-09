# 第 55 轮待授权 Prompt：删除已有撤销行为覆盖的函数名断言

## 当前真实现场

- 分支应为 `codex/follow-up-hardening`。
- 起始 HEAD 应为第 54 轮“删除超时实现源码结构断言”的唯一中文提交；启动时读取并登记完整 hash，不猜测自引用提交。
- 第 54 轮仅删除 `tests/rendered-html.test.mjs` 中 `AbortSignal.timeout` 源码正则及其唯一 `aiProvider` 读取槽位；其余 36 条结构断言未改。
- 当前唯一目标对应 `docs/iterations/structure-test-contract-audit.md` 矩阵第 17 条：`tests/e2e/learning.spec.mjs:168-226` 已直接覆盖评分后撤销、持久化回退及刷新后撤销，具体函数名不是产品契约。
- 第 54 轮的定向 21/21、typecheck、lint 0 error / 1 warning、production build 与 Node 235/235 仅作历史背景，不能替代下一轮运行。

## 授权门禁

这是下一轮候选 Prompt，不是自动执行指令。用户或批次总控未明确授权第 55 轮时，保持等待，不修改文件、不暂存、不提交、不启动服务。

授权后先独立核对：

1. branch、完整 HEAD、`git status --short --branch`、tracked diff 与 index；
2. `docs/iterations/round-55.md` 不存在；
3. 矩阵第 17 条仍为分类 1，`learning.spec.mjs:168-226` 的撤销、持久化回退和刷新后撤销断言仍存在；
4. `1.txt`、`.zcode/`、架构文档、Typora 日志和历史 `.codex-*.log` 未漂移；
5. `lib/build-info.generated.ts` 无修改，固定端口 `3000` 无监听。

任一不符立即 STOP，保留现场。

## 唯一目标与完成定义

仅删除 `tests/rendered-html.test.mjs` 最后一个测试中的：

```js
assert.match(page, /function undoLastRating/);
```

不删除任何源码读取槽位，不修改其他 35 条结构断言，不修改撤销实现或产品行为。

完成定义：rendered-html 不再锁定撤销函数名；既有撤销 E2E 行为保持原样并通过；风险匹配验证通过；一个中文提交，不 push。

## 允许范围

- `tests/rendered-html.test.mjs`
- `docs/iterations/round-55.md`
- `docs/iterations/structure-test-contract-audit.md`（仅把第 17 条标为已删除，不改其他分类）
- 仅在确定后续 `CONTINUE/STOP` 时更新 `docs/iterations/next-round-prompt.md`
- 只有批次阶段事实变化时才更新 `docs/project-evolution.md`

## 禁止范围

- 其余 35 条结构断言；不得整块删除、批量弱化或添加 skip/ignore。
- 生产代码、撤销语义、config、package scripts、schema/version/store/domain、用户数据和 `lib/build-info.generated.ts`。
- Quiz、Sprint、Review/FSRS、复发、猜错、恢复、持久化格式与 Provider 语义。
- 为通过测试降低门槛、改变 E2E 断言或复制第二套撤销实现。

## 验证与提交

1. 定向运行 `rendered-html` 对应 Node 入口；
2. 按固定端口 `3000` 规则运行 `learning.spec.mjs` 中评分后撤销、持久化回退及刷新后撤销的唯一目标 E2E；
3. `npm run typecheck`；
4. `npm run lint`；
5. `npm test`（当前脚本含 production build）；
6. 若 build/dev 改写 `lib/build-info.generated.ts`，在最终暂存前恢复；
7. `git diff --check`，记录实际修改文件并逐个精确暂存；
8. 运行 `check-iteration-gate.ps1 -Phase PreCommit -AllowedPath $roundFiles`，确认 unstaged tracked 为空、cached 文件集合精确相等、cached diff check 通过；
9. 返回 `READY_FOR_CONTROLLER_REVIEW`，获批后由同一执行者创建一个中文提交；不 push。

服务启动前必须核对固定端口 `3000` 与 PID；只清理确认属于本项目的进程，不得切换端口或批量结束 node。

## STOP 条件

- 撤销 E2E 不再直接覆盖评分回退、持久化或刷新后撤销；
- 必须修改生产代码、E2E 断言或其他结构断言才能通过；
- 工作区/index/保护项漂移，或端口 `3000` 被非项目进程占用；
- 连续两次浏览器服务验证失败、需要业务决策或扩大范围。

停止时报告已完成、未完成、Git 状态和准确恢复入口。
