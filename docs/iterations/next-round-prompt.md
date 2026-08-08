# 下一轮执行 Prompt：第 42 轮第一阶段架构重构（信号结构化 + 日期统一）

## 当前现场

- 第 41 轮阶段 D 已完成：分维度观察报告 `buildDimensionObservationReport`、定向 91/91、`npm test` 211/211、固定端口 3000 signal-flow 18/18（45.8s）。
- 任务 A（第 39~41 轮）已停止，最终提交 `1a4d330`（分支 `codex/follow-up-hardening`，相对远端 ahead 46，未 push）。
- 原始项目目录 `D:\me\小东西\单词` 工作区仅剩受保护未跟踪项（`1.txt`、`docs/architecture-analysis-2026-08-09.md`、第 38/40/41 轮日志、`.zcode/`）；端口 3000/3001 无监听。

## 前置门槛

- HEAD 必须仍为 `1a4d330`；若不一致停止并报告。
- 从 `1a4d330` 切出短命分支 `codex/refactor-stage1`，任务 B 全部代码修改、测试、构建和提交只发生在本分支。
- 全程使用 ZCode 接入的 DeepSeek V4 Flash（主 Agent 与子 Agent 均须以外部证据确认模型，配置别名 `zen-v4-flash=deepseek-v4-flash` 视为等价）；无法确认时停止并如实报告。
- 不修改受保护未跟踪项；不触碰任务 A 已提交内容；不推送远端。

## 唯一目标

WordLoop 第一阶段架构重构，消除「中文字符串作为模块通信协议」的高风险边界，统一分散的日期工具：

1. 信号类型改为结构化稳定 key（`lookup`/`guess`/`quiz-spelling`/`quiz-c2e`/`quiz-choice`/`slow-recall`/`stubborn`/`lapse`），key、数值、证据与中文标签分离；统计逻辑只依赖结构化 key，不再解析中文前缀（`startsWith("查过")` 等）。
2. 中文标签由独立 formatter/投影生成，逐字保持现有文案（含 CSV `词,信号列表`、复制文本、E2E 断言文案）；兼容投影保持 `signals: string[]` 形状（注意 `app/page.tsx:404` 的 `as Record<number, string[]>` 强转，严禁改变元素类型）。
3. 识别并统一重复日期工具：`localDateKey`/`localDayStart`/`addLocalDays`/`localWeekStart` 收敛到新建 `lib/date-utils.ts`（逐字符复制现有实现，行为零变化；`study.dateKey` 双语句 re-export 保持调用点零改动；不抽取毫秒窗口、不修时区混合）。
4. 补充行为测试（key↔label 映射、8 维归类、日期边界），确保重构前后结果一致；既有 E2E 语义不得改变。
5. 不改变现有业务行为、统计结果、StoredState、IndexedDB schema、信号阈值、冲刺/达标/复发计算；不修改评分、FSRS、每日 Quiz 门禁、备份链路或 package.json scripts；不拆分 `page.tsx`、不重构 `useStudyPersistence`、不创建 God Module、不引入事件总线。

## 强制安全规则

- 禁止 `git reset --hard`、`git checkout --`、`git clean`、强制覆盖、删除 Git lock；禁止 `git add .`/`git add -A`/`git commit -am`。
- 不删除、不覆盖用户已有修改；不自动清理任务 A 日志；不推送远端。
- 业务含义无法确认时标记「不确定」，不得自行定义产品规则；已知不确定项（到期词首次无实现、`answeredAt` 本地/UTC 混合、答错也写入 FSRS、ms 窗口 vs 日历天、attempt 5000 条裁剪）只固定现状，不改变。
- 结论必须基于当前实际代码重新验证，不得把架构报告历史状态当现状。

## 执行流程

1. Round 0 只读基线：git status/HEAD/分支/log/diff、端口 3000 状态；记录主 Agent 模型外部证据（配置快照、启动命令、会话文件模型字段，至少两项一致）。
2. 并行启动三个只读子 Agent（均为 ZCode DeepSeek V4 Flash，各自记录模型验证块）：
   - B-1 薄弱信号契约审查（weak-signals/session-summary/insights 及调用者、测试）：中文协议位置、生产者/转换者/消费者、最小结构化信号模型、稳定 key 清单、中文文案兼容方法、历史持久化兼容分析。
   - B-2 测验与日期口径审查（quiz/learning/study/insights/session-summary 及测试）：每日首次/到期词首次/本地自然日/日期 key/本周/上一窗口/跨午夜，标记一致与冲突，提出不改变行为的日期工具抽取边界。
   - B-3 测试与回归边界审查（weak-signals/insights/session-summary/quiz 测试、signal-flow E2E、rendered-html）：行为契约清单、脆弱测试、最小回归集合、最小验证命令。
3. 主 Agent 汇总并独立复核（不得照搬子 Agent 结论）：验证关键文件:行号，识别矛盾，输出实施前计划（修改文件/不动文件/信号映射/兼容策略/日期工具边界/测试/验证命令/回滚点/不确定规则）。
4. 实施阶段默认单实施子 Agent（防止 session-summary 等文件并发冲突），按顺序：结构化 key 与类型 → 保留中文 formatter → 消费者改 key → 移除中文解析 → 补结构化测试 → 抽取日期工具 → 替换调用点 → 补日期测试；实施子 Agent 不得提交。
5. 分级验证：typecheck → weak-signals/session-summary/insights/quiz 定向单测 → 日期边界测试 → `npm test` 全量（含 build）→ lint → build → signal-flow E2E（固定端口 3000，专属日志，验证后按证据关闭 PID，3000 释放）。新单测进入对应测试文件；日期测试并入 `tests/study.test.ts`（dateKey 原归属，不改 package scripts）；E2E 只进 `tests/e2e/signal-flow.spec.mjs` 且既有语义不变。build 生成的 build-info 恢复基线，不进入提交。
6. 创建第 42 轮唯一提交（`codex/refactor-stage1`），提交前展示 status/diff，只暂存任务 B 文件；更新 `docs/iterations/round-42.md`、`docs/project-evolution.md`（第六十一次迭代）、覆盖本文件为下一阶段（第 43 轮）prompt。
7. 合回 `codex/follow-up-hardening`（`git merge --no-ff`），合并后完整验证；不推送。

## 输出要求

- 按第十九节格式输出「第一阶段重构报告」：Round 0 基线、子 Agent 模型与分工、审查结论、实际修改、架构边界变化、兼容性说明、验证结果、Git 提交、未解决问题、合并状态。
- 最终汇报五要素简版（总长 ≤300 字）：本轮目标、修改文件与关键联动、lint/typecheck/单测数字/E2E、commit hash 与 message、遗留问题与下一阶段建议。
