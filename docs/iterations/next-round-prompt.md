# 第一阶段残余契约清理批次 STOP：等待新授权

## 当前真实现场

- 本批次已严格串行完成第 53、54、55 共 **3 个 Round**，达到批次上限，必须停止；本文件不构成自动继续授权。
- 分支应为 `codex/follow-up-hardening`；下一次启动必须读取并登记第 55 轮实际完整提交 hash，不在本轮文档中猜测自引用提交。
- 第 53 轮完成 `tests/rendered-html.test.mjs` 最后一个测试原 37 条结构断言的逐条分类矩阵。
- 第 54 轮已删除 `AbortSignal.timeout` 源码断言及只为它存在的 Provider 源码读取槽位。
- 第 55 轮已删除 `function undoLastRating` 函数名断言，保留全部源码读取槽位与其他 35 条结构断言；撤销 E2E 2/2 重新运行通过。
- 第 55 轮的 rendered-html 9/9、撤销 E2E 2/2、typecheck、lint 0 error / 1 warning、production build 与 Node 235/235 是本轮证据；未来恢复时不能替代新 checkout 的验证。

## STOP 原因与剩余矩阵

本批次已经完成授权上限 3 Round，因此当前状态为 **STOP / WAIT_AUTH**。剩余 35 条结构断言按原矩阵分类的当前未清理数为：

| 分类 | 当前未清理数 | 恢复规则 |
|---:|---:|---|
| 1：已有可靠行为覆盖 | 12 | 新授权后仍需逐条复核当前行为证据，再一次只删一条。 |
| 2：缺少稳定行为覆盖 | 14 | 必须先补一个最窄行为测试，再删除对应结构断言。 |
| 3：静态供应链契约 | 1 | 保留 `redbook-analysis.json` 运行时接线静态检查。 |
| 4：仅内部实现或源码外观 | 8 | 可逐条删除，但不得整块弱化或建立等价脆弱断言。 |
| 5：需要业务决策 | 0 | 当前无此类项；若现场变化产生冲突则 STOP。 |

这里的 35 条不是自动执行清单，也不表示都应删除。分类 2 仍有行为覆盖缺口，分类 3 应保留，其他项目也必须以恢复时的当前源码、测试和 Git 证据重新判定。

## 建议恢复入口（非自动执行）

只有用户发出新的明确授权后，才从 `WAIT_AUTH` 进入 Round 0：

1. 完整读取 `AGENTS.md`、`docs/iterations/AUTOMATION-SOP.md`、本文件和 `docs/iterations/structure-test-contract-audit.md`；
2. 核对 branch、实际完整 HEAD、`git status --short --branch`、tracked diff、index、保护项、`lib/build-info.generated.ts` 与固定端口 `3000`；
3. 以已跟踪的最大 Round 编号加 1，确认目标 Round 文档不存在；
4. 重新核对候选对应的当前行为证据，且一个 Round 只处理一个契约；
5. 风险匹配验证、恢复生成文件、精确暂存、PreCommit、一个中文提交，不 push。

若新授权希望继续候选 A，矩阵第 21 条 `buildExamPlan` 可作为**建议**：现有纯函数测试直接覆盖阶段、重点分册、剩余词数与预计工作量，而调用名本身不是产品契约。总控仍需先确认它是恢复时最高价值目标；不得由本文件自动执行，也不得同时清理其他断言。

## 保持不变的边界

- 不修改生产代码、E2E 断言、撤销语义、config、package scripts、schema/version/store/domain 或用户数据。
- 不改变 Quiz、Sprint、Review/FSRS、复发、猜错、恢复、持久化格式或 Provider 语义。
- 不整块删除、批量弱化、skip/ignore 或降低门槛；分类 2 不得先删后补。
- `1.txt` 只读；`.zcode/`、架构文档、Typora/历史日志及本轮服务日志保持未跟踪、不暂存。
- 固定端口只用 `3000`，只清理确认属于本项目的 PID；不得换端口或批量结束 Node。
- 留在当前分支，不 push/merge/rebase/stash/reset；只精确暂存和提交授权文件。

## STOP 条件

- 未获得新授权；目标已完成、证据冲突或需要业务决策；
- 需要修改生产代码、E2E 断言或相邻结构断言才能通过；
- 工作区/index/保护项漂移，目标 Round 文档已存在，或 3000 被非项目进程占用；
- 连续两次浏览器服务验证失败、需要降低门槛或扩大范围。

停止时必须报告已完成、未完成、Git/服务状态和准确恢复入口。
