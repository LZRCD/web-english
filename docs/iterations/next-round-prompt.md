# 下一轮执行 Prompt：第 44 轮架构重构第三阶段（weak-signals God Module 拆分）

## 当前现场

- 第 42 轮（任务 B）：信号结构化 key + 日期工具统一（305f059/aaa1a1e）；第 43 轮：AI Provider 客户端合并（484df63/b47ffde）。HEAD=`b47ffde`（codex/follow-up-hardening，ahead 50，未 push）。
- 第 44 轮候选审计已完成（子 Agent 239af211，只读）：**唯一目标 = weak-signals.ts God Module 按职责拆分**。实测 1989 行 / 71 导出 / 11 职责组 / 8 消费端（page/HistoryView/WordCard/WordbookView/insights/session-summary + 2 测试），内部单向依赖（detection ← projection ← strategy），barrel 保持模块路径可零消费端改动。
- 工作区仅剩受保护未跟踪项；端口 3000 无监听。

## 前置门槛

- HEAD 必须为 `b47ffde`；从 `codex/follow-up-hardening` 切短命分支 `codex/refactor-stage3`，全部代码修改/测试/构建/提交只在本分支。
- 全程使用 ZCode 接入的 DeepSeek V4 Flash（主 Agent 与子 Agent 均须外部证据确认，`zen-v4-flash=deepseek-v4-flash` 等价）；无法确认停止并如实报告。
- 不修改受保护未跟踪项；不触碰既有轮次已提交内容；不推送远端。

## 唯一目标

`lib/weak-signals.ts`（1989 行 God Module）按职责物理拆分，行为零变化，barrel 保持契约：

1. 新建目录与文件：`lib/weak-signals/types.ts`（全部 type 导出）、`lib/weak-signals/detection.ts`（阈值常量 + 检测/画像/候选/稳定性域）、`lib/weak-signals/projection.ts`（冲刺历史/成效/复发/保持/维度观察/趋势/时间线/展示常量域）、`lib/weak-signals/strategy.ts`（冲刺词集/顽固/治疗推荐/摘要/CSV 域）；`lib/weak-signals.ts` 保留为 barrel，**71 个导出逐一对应 re-export**（含 `export { DEFAULT_WEAK_THRESHOLDS, type WeakThresholds } from "./study.ts"` 等既有转发）。
2. **逐字搬运**：函数体/常量/注释一字不改；仅调整文件归属与 import 头（兄弟文件用相对路径，type-only import 优先）。禁止顺手统一窗口、提取共享 helper、改变任何阈值/判定（冲刺/复发/达标时间窗口、猜错累计、慢回忆/lapse 单维判定、isQuizModeRecovered 双连对规则均为「不确定」口径，禁止固化或改变）。
3. 依赖方向只允许 detection ← projection ← strategy；禁止反向或跨层循环（type-only import 除外）。第 42 轮 key 契约（WeakSignalKey/WeakSignalEntry/buildWordWeakSignalEntries 及 label 与 key 同源约束）不得因拆分改变。
4. **8 个消费端零改动**：app/page.tsx、HistoryView、WordCard、WordbookView、lib/insights.ts、lib/session-summary.ts、两个测试文件的 import 路径与命名全部不变（barrel 保证）；不触碰 page.tsx/组件/hooks。
5. 不修改：评分、FSRS、每日 Quiz 门禁、备份链路、package.json scripts、IndexedDB schema/StoredState、useStudyPersistence、E2E 文件。

## 强制安全规则

- 禁止 `git reset --hard`、`git checkout --`、`git clean`、强制覆盖、删除 Git lock；禁止 `git add .`/`git add -A`/`git commit -am`。
- 不删除、不覆盖用户已有修改；不自动清理既有轮次日志；不推送远端。
- 结论必须基于当前实际代码重新验证；拆分正确性以「diff 只含文件移动与 import 头」为验收标准。

## 执行流程

1. Round 0 只读基线（git 状态/HEAD/端口 3000）+ 主 Agent 模型证据；切分支 `codex/refactor-stage3`。
2. 实施阶段单实施子 Agent（ZCode DeepSeek V4 Flash，记录模型验证块）：按上述边界完成拆分；子 Agent 不得提交。
3. 主 Agent 审查：逐导出核对 barrel 完整性（对比拆分前后 `git diff` 应只含移动与 import）；核对依赖方向；抽查关键函数体逐字一致。
4. 分级验证：typecheck → 定向单测（weak-signals/session-summary/insights）→ `npm test` 全量（含 build，基线 226）→ lint → build → signal-flow E2E（固定端口 3000，专属日志，验证后按证据关闭 PID，3000 释放）；build 生成的 build-info 恢复基线（安全补丁，不进入提交）。
5. 创建第 44 轮唯一提交（`codex/refactor-stage3`）：只暂存拆分文件 + `docs/iterations/round-44.md` + `docs/project-evolution.md`（第六十三次迭代）+ 本文件（第 44 轮 prompt）。提交前展示 status/diff 自查。
6. 合回 `codex/follow-up-hardening`（`git merge --no-ff`），合并后完整验证；不推送。

## 输出要求

- 按既有轮次报告格式输出：Round 0 基线、子 Agent 模型与分工、实际修改（文件归属表）、兼容性说明（barrel 契约/消费端零改动/不确定口径保持）、验证结果（实际数字）、Git 提交（哈希/message）、未解决问题、合并状态。
- 最终汇报五要素简版（总长 ≤300 字）。
