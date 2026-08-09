# 第 51 轮：阶段 F3 最小发布验证执行

- 日期：2026-08-09
- 分支：`codex/follow-up-hardening`
- 起始 HEAD：`3d8a8a8e695a1e0d3d75d4bcd4337ea880437200`
- 状态：停止

## 授权与唯一目标

- 用户授权：`按 docs/iterations/next-round-prompt.md 执行第 51 轮，严格遵循自动化迭代 SOP，完成 Round 0、最小发布验证清单、固定 3000 的 production smoke 与 7 项精选 E2E、生成文件恢复、精确提交和评估。只验证，不修复任何失败；不读取生产数据，不运行全目录 E2E，不 push。`
- 问题：第 50 轮只完成最小发布清单审计，当前 checkout 尚无同一轮静态、Node、production smoke 与 7 项精选浏览器链的实际运行证据。
- 完成定义：逐项运行已批准清单并登记真实通过/失败、能证明与不能证明的边界；全部通过后评估阶段 F，否则按停止条件保留已完成证据并生成单一诊断候选 Prompt。
- 允许范围：只运行批准的 `typecheck`、`lint`、`npm test`、production smoke 与 7 项精确 Playwright；只修改 `docs/iterations/round-51.md`、`docs/iterations/release-readiness.md`、`docs/iterations/next-round-prompt.md`、`docs/project-evolution.md`。
- 禁止范围：生产数据、用户浏览器 IndexedDB、真实备份、业务/测试/fixture/config/package scripts、schema/version/store/domain、备份格式、阈值、额外单测、全目录 E2E、性能基线、修复、merge 和 push。
- 停止条件：任一失败在一次可归因重试后仍失败；服务/浏览器验证连续两次失败；范围或保护项漂移；需要扩大授权或无法区分当前回归与既有失败。

## Round 0 现场

- 分支与 HEAD：`codex/follow-up-hardening`；实际 HEAD 为 `3d8a8a8e695a1e0d3d75d4bcd4337ea880437200 docs: 收敛最小发布验证清单`，与 Prompt 的提交标题和预期链一致。
- tracked 工作区：为空；`git diff` 无输出。
- 暂存区：为空；`git diff --cached` 无输出。
- 保护项：门禁登记 25 个既有未跟踪文件，包括 `1.txt`、两份 `.zcode/` 计划、架构分析、Typora 日志及第 38/40/41/42/43/44 轮服务日志；均未修改或暂存。Round 0 同一算法聚合 SHA-256 为 `a385cab2bd9838cf51ac4ed8f6a346e650786855fbdd4240094adb11e22a9ee6`。
- 端口/PID：3000/3001 均无监听；根目录 9 份既有 `.pid` 记录对应进程均已失效。
- 既有调用链与测试入口：`npm test` 包含 production build 与全部 Node 测试；production smoke 自行使用固定 3000；7 项 E2E 精确位于 `concurrency.spec.mjs`、`data-lifecycle.spec.mjs`、`signal-flow.spec.mjs`。
- STOP/GO：`scripts/check-iteration-gate.ps1 -Phase Start -ExpectedHead ... -ExpectedBranch ...` 通过，tracked/index、保护项和端口基线可信，结论为 **GO**。

## 执行结果

### 实际证据链

```text
当前 checkout
  -> typecheck：通过
  -> lint：0 error / 1 个既有 warning
  -> npm test：production build + Node 235/235 通过
  -> production smoke：固定 3000、客户端激活、真实 6550 词、音频索引、Range 206 通过
  -> dev 服务后台化：连续两次未形成可复用稳定实例
  -> 7 项精选 E2E：按 STOP 条件未运行
```

### 生成文件登记与恢复

`npm test` 将 `lib/build-info.generated.ts` 生成到当前源码：

- `APP_GIT_COMMIT`: `3d8a8a8e695a`
- `APP_SOURCE_HASH`: `6cb49fafb0f461fa5404ac820cbcc118d3726c990e97e120f9ac7c6dc9c00b40`
- `APP_BUILD_ID`: `0.1.0+3d8a8a8e695a.6cb49fafb0f4`
- runtime mode：production；首次 dev 启动又临时生成 development。

最终文档暂存前已把 commit、source hash、build ID 与 runtime mode 全部恢复为 HEAD；该文件未暂存。

### 服务停止现场

1. 首次使用 `Start-Process npm.cmd`、独立 `.codex-round51-dev-20260809042245.*.log` 启动。日志证明 vinext 固定监听 `127.0.0.1:3000` 且 `GET /` 返回 200，stderr 为空；但启动执行单元持续不返回，无法取得完成后的 PID 记录，违反“健康检查后启动命令立即返回”。中断执行单元后进程没有呈现可稳定查询的脱离/退出时点：日志继续记录 HMR 到 12:29:49，最终才退出。
2. 可归因重试改由系统进程创建接口后台化；受执行沙箱拒绝访问。按权限规则在沙箱外重放同一调用时，前置检查观察到 3000 仍被首次项目服务短暂占用而主动拒绝创建；随后复核 3000 已释放且没有可复用实例。两次启动编排均没有形成同时满足“立即返回、稳定复用、PID 可精确清理”的实例。
3. 最终只读父子链核对识别出首次启动的残留树：`cmd 59176 -> node 6208 -> cmd 61260 -> node 63616`，四个进程均在 12:22:50~12:22:51 创建。按叶到根只精确关闭这四个 PID，确认全部退出，未批量结束其他 node 进程。
4. 依据 Prompt 的连续两次服务验证失败停止条件进入 **STOP**；未尝试第三种启动方式，未运行任何 Playwright。

## 验证

| 命令或检查 | 结果 | 能证明 | 不能证明 |
|---|---|---|---|
| `scripts/check-iteration-gate.ps1 -Phase Start ...` | 通过 | 起始分支、完整 HEAD、空 tracked/index、25 个保护项与 3000 基线可信 | 不证明产品行为 |
| `npm run typecheck` | 通过 | 当前 checkout 的 TypeScript 静态契约成立 | 不证明 lint、运行时或浏览器行为 |
| `npm run lint` | 通过；0 error、1 warning：`lib/weak-signals/projection.ts:15` 的 `SprintHistoryRecord` 未使用 | 当前 ESLint 无 error | 不证明 warning 无风险，也不证明运行时 |
| `npm test` | 通过；production build 成功，235/235 | 当前 fixture 上 schema/normalize、分域、备份、revision helper、长历史确定性契约及 production build 通过 | 不证明真实用户数据、浏览器事务、配额、设备性能或 7 项交互 |
| `npm run smoke:production` | 通过 | 固定 3000 的真实构建产物首页、客户端激活、静态资源、真实 6550 词、音频索引与 Range 206 有效；脚本退出后端口释放 | 不证明全部交互或精选数据生命周期 E2E |
| 固定 3000 dev 服务启动 | 失败并在一次可归因重试后 STOP | 首次日志证明服务本身曾返回 HTTP 200；最终 3000/3001 无监听 | 无法证明后台启动生命周期、稳定 PID 所有权或 Playwright 前置服务可复用 |
| 7 项精确 Playwright 命令 | 未运行 | 无新增浏览器证据 | revision、导入、指定恢复、三类 fallback 失败链和 activeQuiz 刷新在当前 checkout 未获本轮 E2E 证据 |

- 超时/重试：首次服务实际健康但执行单元约 65 秒未返回，按 SOP 中断；一次可归因后台化重试未形成稳定实例后停止。没有命令静默超过两分钟。
- 浏览器服务：仅首次日志记录一次固定 3000 HTTP 200；无 Playwright 启动。最终精确关闭 PID `63616`、`61260`、`6208`、`59176`，确认 3000/3001 均无监听、四个 PID 均退出；新增两份 Round 51 日志保留为未跟踪证据。
- 生产数据：未读取；production smoke 使用仓库当前私有数据文件并实际通过 6550 词检查，不存在缺失跳过。
- 禁止项：未运行全目录 E2E、额外聚焦单测、单独 build、性能基线；未修复任何 warning、服务脚本或产品问题。

## 提交前复核

- `git diff --check` 与 `git diff --cached --check`：通过。
- 实际修改文件：`docs/iterations/round-51.md`、`docs/iterations/release-readiness.md`、`docs/iterations/next-round-prompt.md`、`docs/project-evolution.md`。
- 精确暂存文件：同上四项；不使用通配暂存。
- `scripts/check-iteration-gate.ps1 -Phase PreCommit ...`：通过；index 仅含四份授权文档，固定 3000 无监听。
- 保护项和范围外文件：原 25 个保护项同一算法聚合 SHA-256 仍为 `a385cab2bd9838cf51ac4ed8f6a346e650786855fbdd4240094adb11e22a9ee6`；本轮新增两份 `.codex-round51-dev-*.log` 也只作为未跟踪运行证据保留，27 个保护项均未暂存。
- 生成文件：`lib/build-info.generated.ts` 已恢复为 HEAD，未暂存；最终暂存后不再运行 build/dev。

## 评估与交付

- 完成状态：**部分证据完成、按授权停止**。静态、Node、production build 与 production smoke 当前证据有效；7 项精选 E2E 因前置服务生命周期失败未运行，最小发布验证清单没有闭环。
- 用户价值：明确保留了可独立成立的 235/235 与真实 production smoke 证据，没有把服务启动或历史 E2E 冒充当前浏览器通过。
- 剩余风险：阶段 F 不能收尾；除原有 activeSession、非法行隔离、重复 attempt ID、activeQuiz 非法时间、清空语义、备份容量和真实长历史性能外，当前还缺 7 项精选浏览器链证据。
- 提交：使用一次中文文档提交 `docs: 记录第51轮验证停止现场`；完整 hash 由下一轮启动登记，不在本提交内自引用。
- push：不执行。

## 下一轮

- 决策：等待授权，先诊断而非修复。
- 唯一候选目标：第 52 轮只读诊断固定 3000 dev 服务后台化为何无法同时满足“立即返回、稳定 PID、可精确清理”，形成一个可验证的启动契约；不重跑产品验证、不修业务或测试。
- 启动基线与停止条件：写入 `docs/iterations/next-round-prompt.md`。
- 已完成：Round 0、typecheck、lint、production build、Node 235/235、production smoke、生成文件恢复、最终端口清理。
- 未完成：固定 3000 的稳定 dev 前置服务与 7 项精选 E2E。
- 停止原因：连续两次服务启动验证未形成符合 SOP 的可复用实例。
- 恢复入口：新授权后从第 52 轮 Round 0 开始，只诊断启动生命周期；诊断结论另行授权后才能重跑第 51 轮剩余 7 项 E2E。
