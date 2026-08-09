# 第 54 轮：删除超时实现源码结构断言

- 日期：2026-08-09
- 分支：`codex/follow-up-hardening`
- 起始 HEAD：`d8bca6268ffc7d9a6e89fa27fc7940342a089c97`
- 状态：等待总控提交复核

## 授权与唯一目标

- 用户授权：实施第一阶段残余契约清理计划；总控下发第 54 轮单断言清理任务包。
- 问题：`tests/rendered-html.test.mjs` 仍通过读取 `lib/ai-provider.ts` 并匹配 `AbortSignal.timeout(` 锁定超时实现外观，重复且弱于现有直接行为测试。
- 完成定义：删除该源码正则、只为它存在的 `aiProvider` 解构变量与源码读取项；其余 36 条结构断言一字不动；直接行为测试和风险匹配验证通过。
- 允许范围：`tests/rendered-html.test.mjs`、本轮报告、结构契约审计矩阵第 16 条与下一轮唯一目标 Prompt。
- 禁止范围：其他 36 条结构断言、生产代码、Provider 语义、config、脚本、schema/version/store/domain、用户数据及任何学习业务行为。
- 停止条件：直接行为测试不再验证请求 signal、需要修改产品代码或其他断言、工作区/index/保护项漂移或需要扩大授权。

## Round 0 现场

- 分支与 HEAD：`codex/follow-up-hardening` / `d8bca6268ffc7d9a6e89fa27fc7940342a089c97`，与任务包一致；最近提交为 `docs: 审计学习流程结构断言契约`。
- tracked 工作区与暂存区：均干净；`docs/iterations/round-54.md` 不存在。
- 保护项：`1.txt`、`.zcode/`、架构文档、Typora 日志和历史 `.codex-*.log` 均保持未跟踪，未修改、未暂存。
- 端口/PID：Start gate 确认固定端口 `3000` 无监听；本轮不启动服务或浏览器。
- 既有行为测试：`tests/api-guard.test.ts:163-207` 直接调用 `chatCompletion`，捕获请求并断言 `captured.init?.signal instanceof AbortSignal`。
- STOP/GO：`check-iteration-gate.ps1 -Phase Start` 通过，矩阵第 16 条仍为分类 1，直接行为测试仍成立，结论为 **GO**。

## 实施

### 证据链

`chatCompletion` 的超时参数进入真实请求构造路径，mock fetch 捕获 `RequestInit`，`api-guard` 直接断言请求携带 `AbortSignal`，同时验证请求体与响应提取。因此测试无需再读取 Provider 源码并固定 `AbortSignal.timeout` 这一具体实现文本。

证据边界：当前行为测试证明请求携带 `AbortSignal`，不证明计时器在真实网络中于指定毫秒精确触发，也不锁定必须由 `AbortSignal.timeout` 实现。

### 最小变更

- `tests/rendered-html.test.mjs`：仅删除 `aiProvider` 解构变量、`../lib/ai-provider.ts` 读取项及 `assert.match(aiProvider, /AbortSignal\.timeout\(/)`；最后一个测试剩余 36 条结构断言文本未改。
- `docs/iterations/structure-test-contract-audit.md`：仅把矩阵第 16 条更新为第 54 轮已清理，并登记本轮重新运行行为测试。
- `docs/iterations/next-round-prompt.md`：继续时只选择矩阵第 17 条函数名正则作为下一轮候选，不合并其他契约。
- `docs/project-evolution.md`：批次阶段事实未变化，不修改。

## 验证

| 命令或检查 | 结果 | 能证明 | 不能证明 |
|---|---|---|---|
| `node --experimental-strip-types --test tests/api-guard.test.ts tests/rendered-html.test.mjs` | 通过，21/21 | 直接 Provider 请求 signal 行为和修改后的静态/SSR 测试入口共同通过 | 真实外部 Provider、浏览器交互或毫秒级超时精度 |
| `npm run typecheck` | 通过 | 当前 TypeScript 类型检查无错误 | 运行时与浏览器行为 |
| `npm run lint` | 通过，0 error、1 个既有 warning | 本轮变更未引入 lint error | 既有 `lib/weak-signals/projection.ts` 未使用类型 warning 未在本轮处理 |
| `npm test` | 通过；production build 成功，235/235 | 当前 checkout 的生产构建和完整 Node 测试集通过，包含目标行为与 rendered-html 回归 | E2E、真实网络、用户生产数据与范围外浏览器流程 |
| 目标结构复核 | 36 条保留；目标三处引用均为 0 | 其他 36 条断言文本未动，目标源码依赖已完整删除 | 其他结构断言是否应在未来清理 |

- 超时/重试：无；所有命令均在两分钟内完成。
- 浏览器服务：未启动；固定端口 `3000` 保持无监听。
- 历史证据：第 51/52 轮结果仅作背景；以上均为本轮新鲜运行证据。

## 提交前复核

- `git diff --check`：通过。
- 实际修改文件：`tests/rendered-html.test.mjs`、`docs/iterations/round-54.md`、`docs/iterations/structure-test-contract-audit.md`、`docs/iterations/next-round-prompt.md`。
- 精确暂存文件：与实际修改文件完全相同；不使用通配暂存。
- `scripts/check-iteration-gate.ps1 -Phase PreCommit ...`：通过后返回总控复核。
- 保护项和范围外文件：保持未跟踪且未暂存。
- 生成文件：`npm test` 改写的 `lib/build-info.generated.ts` 已在最终暂存前恢复为 HEAD；最终暂存后不再运行写仓库命令。

## 评估与交付

- 完成状态：实现与验证完成，等待总控 `APPROVE_COMMIT`。
- 用户价值：超时行为由直接请求测试守护，不再因等价重构 `AbortSignal.timeout` 的源码形状而误报。
- 剩余风险：该行为测试不验证真实计时到期；矩阵其余 36 条按各自分类继续独立处理。
- 提交：获批后由本轮执行者创建一个中文提交；本文件不预先猜测自引用哈希。
- push：不执行。

## 下一轮

- 决策：继续。
- 唯一候选目标：仅删除矩阵第 17 条 `function undoLastRating` 函数名源码正则，依赖既有撤销 E2E 行为覆盖；不改撤销产品逻辑或其他断言。
- 启动基线与停止条件写入 `docs/iterations/next-round-prompt.md`。
