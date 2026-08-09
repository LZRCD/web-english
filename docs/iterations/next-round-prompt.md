# 第 48 轮 Prompt：阶段 F 发布准备只读审计

## 当前真实现场

- 当前分支应为 `codex/follow-up-hardening`。
- 第 47 轮起始基线为 `a07e81d4acc20b6af086ab7eea8d47703c253f2b`；第 47 轮完成后，HEAD 应为唯一中文文档提交 `docs: 评估自适应推荐数据门槛`。启动时用 `git rev-parse HEAD` 与 `git log -1` 登记实际完整 hash，不猜测自引用提交。
- 第 47 轮终局 B：真实生产样本不可获得，且 E2 的结构化归因、足够随访、差异可解释、规则回退与用户关闭等门槛未同时满足；继续维持固定优先级，不生成或实施自适应推荐。
- 阶段 A/B/C/D 已完成；阶段 E 停止在只读可行性报告。不得把自适应推荐、useSelectionLookup、ProviderClient、日期语义或 WeakSignal 公共面自动带入本轮。
- 最近完整行为基线仍来自第 45 轮：study 35/35、typecheck 通过、lint 0 error/1 个第 44 轮既有 warning、`npm test` 230/230（含 build）、固定 3000 的 learning 17/17 与 signal-flow 18/18。第 46/47 轮均只做文档检查，不得把这些数字写成第 48 轮重跑结果。
- 起始 index 和 tracked 工作树应为空。受保护未跟踪项至少包括 `1.txt`、`docs/architecture-analysis-2026-08-09.md`、`.zcode/`、第 38/40/41/42/43/44 轮日志与 `docs/iterations/Typora_Hook_Log.txt`；以实际 `git status` 建立清单，不修改、删除或暂存。
- 3000/3001 应无监听；未 push。

## 本轮性质与唯一目标

这是阶段 F 的发布准备只读审计，不是稳定性修复轮。

业务代码、测试、配置、schema、备份链路、持久化和运行数据严格只读；只允许写本轮审计文档、轮次记录、项目演进记录和下一轮 Prompt。

唯一目标：基于现有代码、历史兼容逻辑与既有行为测试，建立一份可执行但不自动修复的发布缺口清单；逐项判断发布前的证据状态、风险等级、现有护栏与解除条件，并选择阶段 F 的下一步。不得因发现缺口而修改备份、schema、FSRS、评分或生产数据。

## 必须审计的发布面

1. 旧版本状态兼容：`normalizeStoredState`、旧 schema、可选字段和非法值清洗；区分安全兼容、数据丢弃与不可恢复。
2. IndexedDB 分域完整性：`splitStoredState` / `combineStoredState` / `stateDomains` / revision 冲突；核对 `StoredState` 字段是否完整投影，不新增 store/domain。
3. 备份导出/导入一致性：格式/version 校验、导入前保护、恢复副本与自动备份；只审计，不读取用户浏览器库，不修改备份链路。
4. `activeSession` / `activeQuiz` 恢复：题组快照、删除词过滤、旧会话 fallback、完成/索引边界与原 sessionId 保持。
5. 长历史性能：reviews/quizAttempts 的读取、归一化、派生与上限；只依据代码和已有测试，不用合成大样本宣称生产性能。
6. 无效时间、重复 ID、删除词与孤立记录：确认清洗、去重、跳过或保留语义；不得自动删除历史。
7. 阈值变化：`weakThresholds` 持久化与派生影响；不得调整当前默认值。
8. 离线、刷新、跨标签与写入失败：fallback、revision 冲突、恢复副本、状态提示和现有测试护栏。
9. 发布检查面：lint/typecheck/test/E2E、build-info 漂移、package scripts、端口与受保护文件；历史数字只作 checkpoint。

## 发布缺口矩阵

创建 `docs/iterations/release-readiness.md`：

| 发布面 | 代码/数据路径 | 现有护栏 | 已有测试证据 | 不能证明 | 风险 | 状态 | 解除条件 |
|---|---|---|---|---|---|---|---|

状态只使用：

- 已具备发布护栏
- 有明确缺口
- 当前不可证明
- 不适用

风险只使用：阻断 / 高 / 中 / 低。

不得把测试 fixture、历史 E2E 数字或纯代码能力冒充生产数据、生产性能或备份实测。

## 唯一终局选择

最终只能选择一个：

### A. 发布护栏结构完整，可进入阶段 F2 测试收敛审计

- 没有阻断级或高风险的明确数据断链；中低风险均有边界与解除条件。
- 本轮仍不机械重跑全套测试；下一轮只审计核心纵向链与重复 E2E，先提出最小测试收敛清单，不直接删改测试。

### B. 存在需单独授权的发布阻断/高风险缺口

- 任一备份一致性、schema/分域、数据损坏、恢复或跨标签写入风险缺少可靠护栏，即选择 B。
- 只登记最小复现、影响面和建议的单一修复轮；自动串行停止，请求用户授权。不得在本轮修改备份链路、schema/version/store/domain 或历史数据。

### C. 现有证据不足，无法作发布判断

- 代码与已有测试仍不能判断关键发布面，且需要用户生产导出、浏览器状态或外部环境才能继续，即选择 C。
- 明确缺失证据与最小只读输入，自动串行停止；不得用 seed 补齐现实证据。

## 本轮只读核对与验证

1. 核对 branch、HEAD、status、index、保护项及 3000/3001；发现任何 tracked diff 立即停止。
2. 阅读上述代码路径、调用端、归一化/存储/备份测试和 data-lifecycle/learning E2E；只形成证据矩阵。
3. 不启动开发服务，不运行浏览器，不读取或改写浏览器 IndexedDB，不导入/导出用户数据。
4. 不修改业务代码或测试，不机械重跑 lint/typecheck/build/npm test/E2E。
5. 文档完成后只运行：
   - `git diff --check -- docs/iterations/round-48.md docs/iterations/release-readiness.md docs/iterations/next-round-prompt.md docs/project-evolution.md`
   - `git status --short`
   - `git diff --cached --name-only`

## 允许修改与提交

本轮只允许修改：

- `docs/iterations/round-48.md`
- `docs/iterations/release-readiness.md`
- `docs/iterations/next-round-prompt.md`
- `docs/project-evolution.md`

完成后精确暂存实际修改文件，创建一次中文文档提交，例如：

`docs: 审计发布准备数据护栏`

不使用 `git add .`、`git add -A` 或 `git commit -am`；不 merge，不 push。

## 禁止与停止门槛

- 不修改业务代码、测试、推荐、UI、评分、FSRS、每日 Quiz 门禁、备份、schema/version/store/domain、package scripts 或历史数据。
- 不清理、迁移、去重、回填或重写用户 reviews/quizAttempts/IndexedDB。
- 不用测试 seed 证明生产兼容、性能、备份可靠或现实样本充分。
- 一旦需要生产导出、读取浏览器状态、新增 schema、修改备份、改变评分/FSRS，停止并按终局 B/C 记录。
- 若固定端口被非项目进程占用，记录冲突并停止；本轮本就不应启动服务。

## 完成交付

- `docs/iterations/round-48.md`：发布面调用图、矩阵摘要、唯一终局和证据。
- `docs/iterations/release-readiness.md`：完整发布缺口清单。
- `docs/project-evolution.md`：登记阶段 F 只读结论。
- 本文件：按唯一终局覆写下一轮只读 Prompt；若 B/C 则只写待授权恢复 Prompt，不自动执行。
- 一次中文文档提交；工作区仅保留基线保护项；3000/3001 无监听；不 push。
