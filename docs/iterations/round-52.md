# 第 52 轮：阶段 F3 最小发布验证高效收尾

- 日期：2026-08-09
- 分支：`codex/follow-up-hardening`
- 起始 HEAD：`758889102a9e41089210465ce2b314a866a587e4`
- 状态：完成

## 授权与唯一目标

- 用户授权：用户指出第 51 轮效率偏低，并明确同意把“服务启动诊断”和“剩余 7 项 E2E”合并为一个收尾轮；不重复同一源码上的 typecheck、lint、235/235 与 production smoke，产品断言失败仍只记录、不修复。
- 问题：第 51 轮已经获得静态、Node/build 与 production smoke 证据，但固定 3000 dev 服务没有稳定后台化，7 项精选 E2E 尚未运行。
- 完成定义：在不改业务/测试/启动脚本的前提下，让固定 3000 服务健康后立即返回完整 PID 链；精确选择并通过 7 项 E2E；精确清理进程、恢复生成文件并评估阶段 F。
- 允许范围：Round 0、固定 3000 后台服务编排、7 项既有 E2E、运行日志与 PID 核对；只修改 `docs/iterations/round-52.md`、`docs/iterations/release-readiness.md`、`docs/iterations/next-round-prompt.md`、`docs/project-evolution.md`。
- 禁止范围：生产数据、用户浏览器 IndexedDB、真实备份、业务代码、测试、fixture、package scripts、启动脚本、配置、schema/version/store/domain、备份格式、阈值、全目录 E2E、重复静态/Node/smoke、性能基线、失败修复、merge 和 push。
- 停止条件：基线漂移、3000 非项目占用、后台服务无法稳定登记/清理、7 项中出现产品断言失败，或需要扩大授权。

## Round 0 现场

- 分支与 HEAD：`codex/follow-up-hardening`；实际 HEAD 为 `758889102a9e41089210465ce2b314a866a587e4 docs: 记录第51轮验证停止现场`。
- tracked 工作区与 index：均为空；`git diff`、`git diff --cached` 无输出。
- 证据复用门禁：`7588891` 只修改第 51 轮四份文档，未改源码、测试、fixture、package scripts 或配置；dev 生成的源码 hash 仍为第 51 轮登记的 `6cb49fafb0f461fa5404ac820cbcc118d3726c990e97e120f9ac7c6dc9c00b40`。因此复用第 51 轮同一源码上的 typecheck、lint、235/235 与 production smoke，不机械重跑。
- 保护项：启动门禁登记 27 个既有未跟踪保护项，包括 `1.txt`、`.zcode/`、架构文档、历史日志与两份 Round 51 日志；均未修改或暂存。
- 端口/PID：3000/3001 均无监听；第 51 轮登记的四个 PID 均已退出。
- E2E 入口：3 个 spec 中 7 个批准标题各唯一存在；Playwright `testDir` 为 `tests/e2e`，单 worker，默认基址为 `http://localhost:3000`。
- STOP/GO：`check-iteration-gate.ps1 -Phase Start` 通过，结论为 **GO**。

## 执行结果

### 固定 3000 后台生命周期

使用沙箱外 Windows `Win32_Process.Create` 创建独立隐藏 PowerShell launcher，再由 launcher 在项目目录运行既有 `npm run dev` 并写入唯一日志；没有修改项目启动脚本。

- 启动命令 11.9 秒内完成创建、HTTP 200 健康检查、PID 链登记并返回。
- launcher PID：`50452`；固定 3000 监听 PID：`60892`。
- 完整父子链：`powershell 50452 -> cmd 48184 -> node 61624 -> cmd 64604 -> node 60892`。
- 日志：`.codex-round52-e2e-20260809043815.out.log`；stderr 日志为 0 字节。
- E2E 后按叶到根精确关闭 `60892`、`64604`、`61624`、`48184`、`50452`；五个 PID 均确认退出，3000/3001 均无监听。未批量结束其他 node 进程。

### 精选 E2E 命令校正

第 50 轮审计给出的 `--grep "^(标题1|...|标题7)$"` 在当前 Playwright 中匹配完整标题串（含文件/describe 上下文），因此首次原命令和一次文件路径归因重试都在 1.6 秒内返回 `No tests found`，没有启动浏览器或运行测试。

先用 `--list` 证明：

- 保留首尾锚点时为 0 项；
- 去掉首尾锚点、保留 7 个唯一完整标题的 alternation 后，精确列出 3 个文件中的 7 项。

正式运行使用同一已校验 grep，未使用全目录无筛选命令；实际只启动下列 7 项：

1. 双标签并发写入时旧 revision 不会覆盖新数据；
2. 导入备份会替换状态，并在刷新后保持；
3. 可从多份恢复副本中恢复指定副本，并保留其余副本；
4. IndexedDB 被禁用时使用 localStorage 兼容存储；
5. IndexedDB 损坏异常时载入兼容副本且不覆盖原记录；
6. IndexedDB 不可用且 localStorage 配额耗尽时暂停写入；
7. 信号联动：维度化 Quiz、主动回忆、刷新、历史与 generic 复跑纵向贯通。

结果：**7/7 通过，单 worker，17.5 秒**。

## 验证

| 命令或检查 | 结果 | 能证明 | 不能证明 |
|---|---|---|---|
| Round 0 门禁与 `git show HEAD` | 通过；HEAD 仅为第 51 轮文档提交 | 第 51 轮静态/Node/smoke 证据对应的源码、测试和脚本未漂移，可复用 | 不把文档提交后的 HEAD 字符串冒充重新 build |
| 固定 3000 后台创建与健康检查 | 通过；11.9 秒返回，HTTP 200，完整 5 层 PID 链 | Windows/Codex 当前执行环境可稳定脱离服务、登记所有权并供后续命令复用 | 不证明所有未来 Windows 权限配置都相同 |
| 锚定 grep 的原命令 | 失败；0 项，未运行测试 | 第 50 轮命令模板存在测试发现缺陷 | 不表示任何产品断言失败 |
| 非锚定唯一标题 `--list` | 通过；3 文件、恰好 7 项 | 校正后的选择器不会机械运行全目录其余测试 | 列表不证明交互通过 |
| 7 项精选 E2E | 通过；7/7，17.5 秒 | 当前 checkout 的 revision 冲突、导入、指定恢复、三类 fallback 失败链与 activeQuiz 刷新浏览器契约通过 | 不证明用户生产数据、Safari/无 Web Locks、真实大状态、容量、设备性能或矩阵外行为 |
| 服务与生成文件收尾 | 通过 | 5 个项目 PID 精确退出，3000/3001 释放，`lib/build-info.generated.ts` 恢复为 HEAD | 不改变生成元数据长期维护策略 |

- 第 51 轮复用证据：typecheck 通过；lint 0 error / 1 个既有 warning；production build 与 Node 235/235 通过；production smoke 的客户端激活、真实 6550 词、音频索引和 Range 206 通过。
- 本轮没有读取生产数据、用户浏览器 IndexedDB 或真实备份；没有运行全目录 E2E、额外单测、单独 build、性能基线或任何产品修复。
- `lib/build-info.generated.ts` 的 dev 生成值已登记为 commit `758889102a9e`、source hash `6cb49faf...`、development，并在文档暂存前完整恢复为 HEAD。

## 提交前复核

- `git diff --check` 与 `git diff --cached --check`：通过。
- 实际修改文件：`docs/iterations/round-52.md`、`docs/iterations/release-readiness.md`、`docs/iterations/next-round-prompt.md`、`docs/project-evolution.md`。
- 精确暂存文件：同上四项；不使用通配暂存。
- `check-iteration-gate.ps1 -Phase PreCommit ...`：通过；index 只含四份授权文档，固定 3000 无监听。
- 保护项：启动时 27 个既有保护项加本轮两份 Round 52 日志，共 29 个未跟踪保护项，均不暂存。
- 生成文件与服务：`lib/build-info.generated.ts` 与 HEAD 一致；3000/3001 无监听；五个本轮 PID 均退出。

## 评估与交付

- 完成状态：第 50 轮批准的最小发布验证链已经闭环；第 51 轮静态/Node/build/smoke 与第 52 轮当前源码下 7/7 浏览器证据可组合成立。
- 阶段结论：阶段 F 的“最小发布护栏验证”可以条件收尾，但不能写成“全部发布就绪”。
- 剩余风险：activeSession 孤儿 ID、非法记录行级隔离、重复 quizAttempt ID、activeQuiz 非法时间、清空语义、自动备份/恢复副本容量与真实长历史性能仍保持中风险或当前不可证明。
- 效率改进：后续需要固定 3000 独立服务时，优先复用本轮已验证的系统进程创建 + 完整 PID 链方案；精选 Playwright grep 不再使用首尾锚点，先 `--list` 核对数量。
- 提交：使用一次中文文档提交 `docs: 完成最小发布验证收尾`；完整 hash 由下一轮启动登记，不在本提交内自引用。
- push：不执行。

## 下一轮

- 决策：阶段 F 条件收尾，等待用户选择是否继续处理中风险；不机械开启新一轮。
- 唯一候选目标：若继续，先只读排序剩余中风险并选择一个独立授权目标；不得把所有中风险合并修复。
- 启动基线与授权门禁写入 `docs/iterations/next-round-prompt.md`。
