# 第 55 轮：删除撤销函数名源码结构断言

- 日期：2026-08-09
- 分支：`codex/follow-up-hardening`
- 起始 HEAD：`9ffaecb2571c888b936fa6e13f1b1d523bca1fa5`
- 状态：等待总控提交复核

## 授权与唯一目标

- 用户授权：实施第一阶段残余契约清理计划；总控下发第 55 轮单断言清理任务包。
- 问题：`tests/rendered-html.test.mjs` 最后一个测试仍用 `function undoLastRating` 锁定撤销函数名，重复且弱于现有浏览器行为覆盖。
- 完成定义：只删除该函数名源码断言；保留全部源码读取槽位和其他 35 条结构断言；撤销 E2E 与风险匹配验证通过。
- 允许范围：`tests/rendered-html.test.mjs`、本轮报告、结构契约审计矩阵第 17 条、批次 STOP Prompt，以及批次阶段事实更新。
- 禁止范围：其他 35 条结构断言、E2E 断言、生产代码、撤销语义、config、脚本、schema/version/store/domain、用户数据及相邻学习业务。
- 停止条件：撤销 E2E 不再直接覆盖评分回退/持久化/刷新后撤销，需要修改产品或其他断言，现场漂移、3000 非项目占用，或连续两次服务验证失败。

## Round 0 现场

- 分支与 HEAD：`codex/follow-up-hardening` / `9ffaecb2571c888b936fa6e13f1b1d523bca1fa5`，与任务包一致；最近提交为 `test: 清理超时实现源码断言`。
- tracked 工作区与暂存区：均干净；`docs/iterations/round-55.md` 不存在。
- 保护项：`1.txt`、`.zcode/`、架构文档、Typora 日志和历史 `.codex-*.log` 均保持未跟踪，未修改、未暂存。
- 端口/PID：Start gate 确认固定端口 `3000` 无监听。
- 既有行为测试：`tests/e2e/learning.spec.mjs:168-226` 直接覆盖评分后撤销、reviews/word-progress 持久化回退、刷新后撤销栈恢复及再次回退。
- STOP/GO：`check-iteration-gate.ps1 -Phase Start` 通过，矩阵第 17 条仍为分类 1，证据成立，结论为 **GO**。

## 实施

### 证据链

评分后，现有 E2E 先等待 `reviews` 持久化，再从状态通知点击撤销，直接断言当前词和评分按钮恢复、`reviews` 与 `word-progress` 归零，并在刷新后复核回退结果。另一项 E2E 在评分后确认 `ratingUndoStack` 持久化，刷新页面再执行“撤销上一步”，断言词卡、reviews 和撤销栈全部恢复。因此用户可观察契约由真实交互和持久化状态守护，不需要固定内部函数名。

证据边界：这两项测试只证明当前 Chrome、单标签页、既有 seed 下的评分撤销与刷新恢复路径；不证明跨标签并发、任意历史深度、用户生产数据或其他浏览器实现。

### 最小变更

- `tests/rendered-html.test.mjs`：只删除 `assert.match(page, /function undoLastRating/);`；源码读取槽位与其他 35 条结构断言未改。
- `docs/iterations/structure-test-contract-audit.md`：只把矩阵第 17 条标为第 55 轮已删除，不改变分类。
- `docs/iterations/next-round-prompt.md`：本批次已满 3 Round，改为批次 STOP 和等待新授权，登记剩余 35 条。
- `docs/project-evolution.md`：只登记第 53～55 轮已完成的审计与两条清理事实，不宣称结构测试全部清理。

## 验证

| 命令或检查 | 结果 | 能证明 | 不能证明 |
|---|---|---|---|
| `node --experimental-strip-types --test tests/rendered-html.test.mjs` | 通过，9/9 | 删除目标断言后 rendered-html/SSR 入口仍通过 | 浏览器撤销交互 |
| `npx playwright test tests/e2e/learning.spec.mjs --config playwright.config.mjs --grep '评分写入后可以撤销，并把持久化进度恢复到评分前|刷新页面后仍可撤销最近评分' --list` | 通过，1 文件、精确 2 项 | 正式 E2E 选择器不为零匹配且未扩大到其他 learning 测试 | 交互本身通过 |
| 同一选择器正式运行 | 通过，2/2，单 worker，7.1 秒 | 当前 checkout 的评分撤销、持久化回退和刷新后撤销浏览器路径通过 | 跨标签、生产数据、其他浏览器与范围外流程 |
| `npm run typecheck` | 通过 | 当前 TypeScript 类型检查无错误 | 运行时与浏览器行为 |
| `npm run lint` | 通过，0 error、1 个既有 warning | 本轮变更未引入 lint error | 既有 `lib/weak-signals/projection.ts` 未使用类型 warning 未在本轮处理 |
| `npm test` | 通过；production build 成功，235/235 | 当前 checkout 的生产构建和完整 Node 测试集通过 | 精选 E2E 之外的浏览器流程、真实网络与用户数据 |
| 目标结构复核 | 目标引用 0；最后一个测试剩余 35 条结构断言 | 唯一目标已删除，其他断言数量保持 | 剩余断言未来应保留或清理的最终结论 |

- 超时/重试：第一次 `Start-Process npm.cmd` 启动日志已到 HTTP 200，但启动执行单元未按 SOP 返回；约 65 秒内中断，未超过两分钟。沙箱外准备创建第二实例时，前置检查发现第一次服务的项目子链仍健康监听，因此安全拒绝重复创建并直接复用；没有第三次创建，也没有产品断言重试。
- 浏览器服务：固定 `3000`，日志 `.codex-round55-dev-20260809-134728.out.log` / `.err.log`；复用前确认 HTTP 200，项目链为 `node 61524 -> cmd 57892 -> node 44316`（监听）。E2E 后按叶到根精确停止 `44316`、`57892`、`61524`，此前 launcher `58320` 已退出；全部确认退出，3000 无监听，未批量结束 Node。
- 历史证据：第 54 轮结果仅作起始背景；以上均为本轮新鲜运行证据。

## 提交前复核

- `git diff --check`：通过。
- 实际修改文件：`tests/rendered-html.test.mjs`、`docs/iterations/round-55.md`、`docs/iterations/structure-test-contract-audit.md`、`docs/iterations/next-round-prompt.md`、`docs/project-evolution.md`。
- 精确暂存文件：与实际修改文件完全相同；不使用通配暂存。
- `scripts/check-iteration-gate.ps1 -Phase PreCommit ...`：通过后返回总控复核。
- 保护项和范围外文件：保持未跟踪且未暂存；本轮服务日志也不暂存。
- 生成文件：dev/build 改写的 `lib/build-info.generated.ts` 已在最终暂存前恢复为 HEAD；临时 PID 记录已移除。

## 评估与交付

- 完成状态：实现与验证完成，等待总控 `APPROVE_COMMIT`。
- 用户价值：撤销行为由真实交互和持久化状态守护，不再因等价函数重命名而误报。
- 剩余风险：矩阵仍有 35 条未清理项，其中分类 2 的 14 条必须先补最窄行为测试，分类 3 的 1 条静态供应链接线应保留。
- 提交：获批后由本轮执行者创建一个中文提交；本文件不预先猜测自引用哈希。
- push：不执行。

## 下一轮

- 决策：**批次 STOP / 等待新授权**；本批次已完成第 53、54、55 共 3 个 Round，不生成自动继续授权。
- 恢复建议：新授权后从当前现场重新运行 Round 0，再独立选择一个剩余分类 1 或分类 4 项；矩阵第 21 条 `buildExamPlan` 可作为建议候选，但不得自动执行。
- 剩余矩阵、恢复入口和停止条件写入 `docs/iterations/next-round-prompt.md`。
