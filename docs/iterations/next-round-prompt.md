# 第 47 轮 Prompt：阶段 E 自适应推荐可行性只读评估

## 当前真实现场

- 当前分支应为 `codex/follow-up-hardening`。
- 第 46 轮起始基线为 `16ed476f51ae5bcb242b10116d8d9d390248b49f`；第 46 轮完成后，当前 HEAD 应为唯一中文文档提交 `docs: 审计划词 I/O 状态机边界`。启动时以 `git rev-parse HEAD` 与 `git log -1` 的实际结果登记完整 hash，不猜测自引用 commit hash。
- 第 46 轮终局 B：停止继续拆分 `useSelectionLookup`，保留为合理 orchestration boundary；不得把 ProviderClient、日期语义、WeakSignal 公共面或其他架构后备项自动带入本轮。
- 阶段 A/B/C/D 已完成：成效口径诚实化、冲刺后首次正常复习保持、未来处置维度归因、分维度观察报告均已有实现与证据；阶段 D 的报告明确是固定推荐与用户选择下的观察，不代表模式效果、因果、最佳/最差或推荐依据。
- 最近完整行为基线仍来自第 45 轮：study 35/35、typecheck 通过、lint 0 error/1 个第 44 轮既有 warning、`npm test` 230/230（含 build）、固定 3000 的 learning 17/17 与 signal-flow 18/18。第 46 轮仅做文档检查，不得把这些数字写成第 46/47 轮重新运行结果。
- 起始 index 和 tracked 工作树应为空；受保护未跟踪项为 `1.txt`、`docs/architecture-analysis-2026-08-09.md`、`.zcode/` 与第 38/40/41/42/43/44 轮日志。先以实际 `git status` 建立保护清单，不得修改、删除或暂存。
- 3000/3001 应无监听；未 push。

## 本轮性质与唯一目标

这是阶段 E 的只读设计轮，不是推荐实现轮。

业务代码、测试、配置、schema、持久化和运行数据严格只读；只允许写入本轮评估文档、轮次记录、项目演进记录和下一轮 Prompt。

唯一目标：用现有真实数据结构和已实现观察口径逐项判断，自适应推荐是否同时满足长期计划 E2 的 8 个实施门槛；给出“已满足 / 未满足 / 当前不可证明”的证据矩阵，并决定继续停留在设计还是转入阶段 F。不得提出基于小样本、测试 seed 或历史猜测的权重、排名和模式胜负。

## 必须追清的证据链

1. 当前固定推荐：`buildSprintTreatmentRecommendation` 的真实输入、顺序、恢复/复发判断和 generic fallback；固定优先级必须原样登记。
2. 结构化归因：`createTreatmentSprintSessionId` / `parseSprintSessionId`、activeSession/activeQuiz、review 写入及 unknown/generic/stubborn 语义。
3. 后续保持：`buildSprintRetentionSeries` 的 cohort、截断、已观察分母、覆盖率、间隔和配对测时。
4. 分维观察：`buildDimensionObservationReport` 的全局唯一成功锚点、各自分母、样本数、unknown/generic、跨维活动重复和非因果限制。
5. 真实生产样本可获得性：区分仓库测试 seed、浏览器 IndexedDB 生产历史、用户导出和纯代码能力。测试 seed 只能证明算法行为，不能证明现实样本量。
6. 可解释差异、回退、用户关闭与默认恢复：只记录现有能力和明确缺口，不提前设计 UI 或修改推荐。
7. 猜错无时间源、slow-recall/lapse 单维判定、选择偏差和不同随访间隔对可比性的影响。

## E2 门槛矩阵

在 `docs/iterations/adaptive-recommendation-readiness.md` 中逐项记录：

| 门槛 | 现有证据与路径 | 真实样本状态 | 能证明 | 不能证明 | 状态 | 解除条件 |
|---|---|---|---|---|---|---|

门槛固定为：

1. 各维度有真实结构化归因。
2. 有足够后续正常复习样本。
3. 随访覆盖率透明。
4. 不同模式样本差异可解释。
5. 规则可回退。
6. 不改 FSRS。
7. 用户可以关闭。
8. 不需要伪造历史数据。

“足够”不得自行编造阈值。若产品没有预先批准的样本量、覆盖率、随访区间或稳健性标准，状态必须为“当前不可证明”，并把阈值决策列为需用户批准的产品决策。

## 唯一终局选择

最终只能选择以下一个结论：

### A. 仅设计上具备进一步讨论条件

- 8 项门槛均有真实生产证据或明确可验证证据，且不存在测试 seed 冒充生产样本。
- 本轮仍不实现、不改推荐；输出一份最小、透明、可关闭、可回退、不改 FSRS 的规则草案与风险清单。
- 自动串行必须停止，请求用户另行批准阶段 E 行为变更；下一轮 Prompt 只能是“待批准实施草案”，不得自动执行。

### B. 当前不具备数据/产品门槛

- 任一门槛未满足或当前不可证明，即选择 B。
- 明确维持固定优先级：听音拼写 -> 中译英 -> 释义辨析 -> 划词主动回忆 -> 顽固多模式 -> 通用冲刺。
- 不生成自适应推荐实施 Prompt；下一轮转阶段 F“发布准备只读审计”，只建立发布缺口清单，不自动修改备份链路或 schema。

## 本轮只读核对与验证

1. 核对 branch、HEAD、status、index、保护项及 3000/3001；发现任何 tracked diff 立即停止。
2. 阅读上述函数、调用端、持久化路径、阶段 B/C/D 文档及相关行为测试，形成证据矩阵。
3. 不启动开发服务，不运行浏览器，不读取或改写浏览器生产 IndexedDB；若没有用户提供的只读导出，必须明确“真实生产样本量不可获得”，不得以 fixture/seed 替代。
4. 不修改业务代码或测试，不机械重跑 lint/typecheck/build/npm test/E2E。
5. 文档完成后只运行：
   - `git diff --check -- docs/iterations/round-47.md docs/iterations/adaptive-recommendation-readiness.md docs/iterations/next-round-prompt.md docs/project-evolution.md`
   - `git status --short`
   - `git diff --cached --name-only`

## 允许修改与提交

本轮只允许修改：

- `docs/iterations/round-47.md`
- `docs/iterations/adaptive-recommendation-readiness.md`
- `docs/iterations/next-round-prompt.md`
- `docs/project-evolution.md`

完成后精确暂存实际修改文件，创建一次中文文档提交，例如：

`docs: 评估自适应推荐数据门槛`

不使用 `git add .`、`git add -A` 或 `git commit -am`；不 merge，不 push。

## 禁止与停止门槛

- 不修改推荐逻辑、优先级、权重、阈值、UI、评分、FSRS、每日 Quiz 门禁、备份、schema/version/store/domain、package scripts 或历史数据。
- 不新增排名、“最佳/最差模式”、因果结论、黑箱模型或自动学习权重。
- 不把 unknown 历史分配到维度，不把无随访样本算失败，不混淆活动量、当场达标、后续保持和当前仍薄弱。
- 不用测试 seed 证明真实样本充足，不用当前标签/按钮/文案反推历史处置。
- 一旦需要新增 schema、修改评分/FSRS/备份、改变推荐行为，或缺少真实生产样本/批准阈值，停止实现并按终局 B 记录证据。
- 若结论 A，自动串行也必须暂停并请求用户授权；阶段 E 行为变更不在本 Prompt 授权内。

## 完成交付

- `docs/iterations/round-47.md`：调用图、E2 门槛矩阵摘要、唯一终局和证据。
- `docs/iterations/adaptive-recommendation-readiness.md`：完整可行性报告，不排名、不夸大因果。
- `docs/project-evolution.md`：登记第 47 轮只读结论。
- 本文件：按终局 A 写待批准草案，或按 B 覆写为阶段 F 发布准备只读 Prompt。
- 一次中文文档提交；工作区仅保留基线保护项；3000/3001 无监听；不 push。
