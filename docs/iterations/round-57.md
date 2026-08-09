# 第 57 轮：明确“清空本机学习记录”契约

- 日期：2026-08-09
- 分支：`codex/follow-up-hardening`
- 起始 HEAD：`2ad82524816f41cb5249fda90bd9b9a0bd12334e`
- 状态：完成

## 授权与唯一目标

- 用户授权：开始第 57 轮，实施下一轮 Prompt 已锁定的 P1。
- 问题：按钮承诺清空本机学习记录，但确认文案、实际字段和行为测试没有说明或清除 `quizAttempts` 与 `activeQuiz`，旧测验信号和进行中测验可在清空后继续存在。
- 完成定义：按钮说明、确认对话框、唯一清空函数、恢复快照、刷新后状态和纯函数/E2E 对同一字段清单达成一致。
- 允许范围：清空记录纯函数、持久化调用、设置页说明、直接单测、精选 data-lifecycle E2E 和本轮文档。
- 禁止范围：schema/version/store/domain、备份数量、数据迁移、FSRS、Quiz 作答规则、弱信号阈值、生产浏览器数据及其他数据生命周期缺口。
- 停止条件：现有产品表述无法支持唯一语义、现场漂移、非项目端口监听或需要扩大数据契约。

## Round 0 现场

- 分支与 HEAD：`codex/follow-up-hardening` / `2ad82524816f41cb5249fda90bd9b9a0bd12334e`。
- tracked 工作区与 index 均为空；`lib/build-info.generated.ts` 与 HEAD 一致；`round-57.md` 不存在。
- `1.txt`、`.zcode/`、架构文档、Typora/历史日志和既有服务日志保持未跟踪、未修改、未暂存。
- 固定端口 3000 无监听；Start gate 通过。
- 完整读取 `AGENTS.md`、自动化 SOP、下一轮 Prompt、上一轮文档、设置入口、持久化清空实现、分域存储和 data-lifecycle 测试。
- STOP/GO：现有按钮“清空本机学习记录”和确认文案均指向学习/测验进度；清空前恢复快照可保留完整历史，因此不需要业务决策，结论为 **GO**。

## 契约矩阵与实施

| 契约面 | 变更后语义 |
|---|---|
| 按钮与说明 | 明确清除评分与记忆进度、错词、测验记录、进行中学习任务和学习位置；保留收藏与内容缓存；清空前创建可恢复快照 |
| 确认对话框 | 与设置页说明使用同一字段范围和恢复承诺 |
| 清除字段 | `reviews`、`wordProgress`/FSRS 卡、`mistakes`、`stubbornWords`、`positions`、`activeSession`、`quizAttempts`、`activeQuiz`、`ratingUndoStack` |
| 保留字段 | 收藏、内容缓存、查词缓存和用户设置继续沿用既有语义 |
| 恢复能力 | 权威写入前仍先保存完整 `StoredState`；快照保留清空前的 `quizAttempts` 与 `activeQuiz` |
| 刷新结果 | 分域写入后 `quiz-attempts` 为空，settings 中不再有 `activeSession`/`activeQuiz` |

- `lib/study.ts` 新增纯函数 `clearLearningRecords` 作为唯一字段清单；没有新增持久化字段或第二套清空逻辑。
- `useStudyPersistence` 保留原有“先建恢复快照、再权威写入、冲突保护、失败副本”顺序，只把结果构造替换为纯函数。
- 设置页把危险按钮改为带说明的设置行，按钮名称保持不变；成功通知同时说明保留项和可恢复性。
- 范围外发现：`lookupStats`、猜错累计等既有保留语义未在本轮扩大或重定义；备份容量和非法行处理继续留在原边界。

## 验证

| 命令或检查 | 结果 | 能证明 | 不能证明 |
|---|---|---|---|
| `node --experimental-strip-types --test tests/study.test.ts` | 44/44 | 清除/保留字段和清空前快照纯函数契约 | IndexedDB 与浏览器交互 |
| `npm run typecheck` | 通过 | TypeScript 调用与状态契约成立 | 运行时持久化 |
| `npm run lint` | 0 error / 1 个既有 warning | 本轮未引入 lint error | 既有 `projection.ts` warning 未处理 |
| `npm test` | production build + Node 239/239 | 当前构建和完整 Node 套件通过 | 浏览器数据生命周期 |
| data-lifecycle 精选 E2E `--list` | 1 文件 / 1 项 | 精确测试选择，没有运行相邻 E2E | 产品行为 |
| 清空记录精选 E2E | 1/1，3.6 秒 | 确认文案、清除/保留域、恢复快照、刷新后 `quizAttempts`/`activeQuiz` 状态 | 真实生产数据、其他浏览器和多标签并发 |

- 所有验证命令均在两分钟内返回，无重试。
- 服务日志：`.codex-round57-dev-20260809-142802.{out,err}.log`；健康检查 HTTP 200。
- 服务链：`powershell 61180 -> cmd 53164 -> node 32256 -> cmd 312 -> node 44560(listener)`；E2E 后按叶到根精确关闭，3000 最终无监听。
- `lib/build-info.generated.ts` 已恢复为起始 HEAD 内容；未访问用户浏览器生产数据、真实备份或 IndexedDB。

## 提交前复核

- 实际产品/测试文件：`lib/study.ts`、`app/hooks/useStudyPersistence.ts`、`app/components/SettingsView.tsx`、`app/globals.css`、`tests/study.test.ts`、`tests/e2e/data-lifecycle.spec.mjs`。
- 文档文件：本文件、`docs/project-evolution.md`、`docs/iterations/next-round-prompt.md`。
- 最终执行 `git diff --check`、精确暂存、cached diff 检查和 PreCommit 门禁。
- 保护项、本轮服务日志和恢复后的生成文件不暂存；不 push。

## 评估与下一轮

- 用户价值：清空操作在点击前就能看见准确影响，测验历史和未完成测验不会在清空后悄然恢复，同时清空前完整状态仍可从快照恢复。
- 行为边界：不改变备份数量、持久化格式、排程、作答、弱信号计算或生产数据。
- 下一轮只选择“词库读取失败后的界面内重试与明确修复说明”，不合并首次引导或 README 启动说明。
