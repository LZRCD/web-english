# 下一轮执行 Prompt：第 39 轮阶段 C 未来处置维度归因只读审计

## 当前现场

- 分支：`codex/follow-up-hardening`。
- 第 38 轮提交前 HEAD：`2059922`；第 38 轮处于待提交状态，最终 HEAD 以包含本文件的最新中文提交为准。
- 最新自动验证：`tests/weak-signals.test.ts` 81/81；lint、typecheck 通过；`npm test` 201/201，含生产构建。
- signal-flow E2E 17/17（42.8s）：既有 16 条语义保持，第 38 轮新增 1 条稳定完整周 seed，覆盖保持成功/失败、未观察、成功下一 sprint 截断、覆盖/保持/间隔/null/paired recall、`quiz:*` review 与 quizAttempt 不干扰。
- 工作区交接：用户未跟踪 `1.txt` 与并发文件 `docs/architecture-analysis-2026-08-09.md` 绝不修改或暂存；固定端口 3000/3001 无 LISTENING，本轮 PID 已精确清理。审批限制导致 `.codex-round38-20260809-010645.err.log` 与 `.out.log` 无法删除，两者保留为未跟踪且不得暂存。

## 已完成阶段与数据边界

- 阶段 A 已完成：冲刺活动量、当场达标、同词配对回忆观察、截至当前仍薄弱和近 7 天全局评分事件占比，均已明确分子、分母、窗口、权重、空样本与不能证明的结论。
- 阶段 B 已完成：`buildSprintRetentionSeries` 在最近 4 个完整处置周内按每词窗口内最近成功 sprint review 建 cohort；下一 sprint 截断，首条非 sprint review（含 `quiz:*` review、无 sessionId 旧 review）是随访；覆盖/保持/未观察/截断/实际间隔与 paired recall 分母独立披露，quizAttempt 不参与。
- 猜错仍只有累计次数，无真实事件时间、恢复或复发源；禁止伪造，但不阻止阶段 A/B 完成。
- 第 39 轮只进入阶段 C 的“未来处置维度归因”只读审计，不预设现有 sessionId 一定足够，不实现分维度指标、自适应或 schema。

## 唯一目标

只读判断现有结构化 `sprint:*` sessionId 能否对“未来新发生的处置”无歧义标识处置维度，并与第 38 轮首次正常 review 链安全连接；形成逐模式证据矩阵和一个明确的实现/停止结论。除审计文档与下一轮 prompt 外不改业务代码。

## 只读审计顺序

1. 核对 Git 状态、分支、HEAD、最近历史、保护文件、端口 3000/3001、历史 PID/日志；确认第 38 轮提交与实际测试证据。
2. 从所有创建入口追踪 sprint sessionId：通用冲刺、历史再跑、当前仍薄弱再冲刺、分册/单元冲刺、三类 Quiz 专项、查词主动回忆、顽固词三阶段；列出创建函数、编码格式、解析函数、刷新恢复、ReviewEvent 写入与历史消费者。
3. 对每种未来处置模式验证：sessionId 是否显式编码维度、是否可稳定解析、是否会被旧通用 `sprint:<ISO>` 混淆、是否跨刷新保持、首次有效 review 是否沿用相同 id、同一 session 是否可能混入多个维度。
4. 将可解析处置维度与 `buildSprintRetentionSeries` 的锚点/截断/随访规则逐项对照：最近成功锚点是否保留维度；下一 sprint 是否仍应无条件截断；`quiz:*` follow-up 是否只代表随访而不能倒推锚点维度；quizAttempt 是否仍不得替代 review。
5. 用最小反例审计：旧通用 sprint、结构化顽固三阶段、三类专项、查词专项、历史再跑、同词跨模式/跨 session、同 session 多 review、同毫秒 id tie-break、刷新恢复、非法/未知模式、缺失 sessionId。
6. 明确历史覆盖：只能讨论采用结构化 id 后未来产生的样本；禁止给旧通用 sprint 猜维度、禁止从词的当前薄弱标签/quizAttempt/题型反推历史处置、禁止回填或迁移历史 reviews。

## 必须产出的证据矩阵

每行至少包含：处置入口、未来 sessionId 示例、创建函数、解析函数、是否显式唯一维度、review 写入路径、刷新后是否保持、能否连接首次正常 review、历史旧记录能否归因、冲突/歧义、结论。

至少覆盖：

- 通用冲刺与限定范围冲刺；
- 历史再跑、当前仍薄弱词再冲刺；
- 听音拼写、中译英、释义辨析专项；
- 查词主动回忆；
- 顽固词主动回忆/听音拼写/中译英三个阶段；
- 无 sessionId 与旧 `sprint:<ISO>` 记录。

## 判定门槛

- 只有未来所有拟报告维度都有显式、稳定、唯一、可往返解析的 sessionId，且同一 session 不混维度、review 写入不丢 id，才可判定进入下一轮最小“未来处置维度 cohort”实现。
- 若只有部分模式可辨识，必须列出可辨识/不可辨识集合；不得先实现偏样本报告并把它写成全维度结论。下一 prompt 的唯一目标应是最小统一 sessionId 编码方案的只读设计审计，仍不得直接新增 schema。
- 若完整链需要新增持久化 schema/version/store/domain、回填历史、从当前画像/quizAttempt 推断维度、改变第 38 轮锚点/截断规则，立即停止实现并只提交审计结论。

## 严格边界

- 复用现有 `sessionId` 字符串承载能力；本轮不新增 schema/version/store/domain，不修改或回填历史 reviews/quizAttempts。
- 不改评分、FSRS、每日 Quiz 门禁、备份、package scripts、冲刺写入、阶段 A 指标、第 38 轮 cohort/覆盖/保持/间隔/paired recall、当前仍薄弱、再冲刺或薄弱画像。
- 不实现分维度保持率、维度排行、维度好坏判断、推荐权重、自适应排程或因果结论。
- 不把 quizAttempt 当 ReviewEvent，不把 `quiz:*` follow-up 的 mode 倒推为先前 sprint 处置维度，不跨下一 sprint，不把未观察算失败。
- 文案不得使用“某模式导致提升/恢复/掌握”或比较样本稀少的维度优劣。

## 验收标准

- 新建 `docs/iterations/round-39.md`，完整记录现场、sessionId 全链、反例矩阵、历史覆盖、判定和停止门槛。
- 更新 `docs/iterations/dimension-treatment-audit.md` 与 `learning-effectiveness-audit.md` 的未来归因边界；更新 `project-evolution.md` 和覆盖 `next-round-prompt.md`。
- 只有咬合状态或关键证据发生变化才更新 `occlusion-table.md`；纯审计若没有新闭环不得虚增 ✅。
- 审计为只读业务代码轮：执行至少 `npm run lint`、`npm run typecheck` 与审计涉及的现有定向测试；若文档外无代码变更，不为追数字重跑无关 E2E。若需要浏览器验证，仍必须固定 3000、HTTP 200、唯一 PID/日志、两次失败停止并精确清理。
- 提交前把实际 diff、测试数字、保护文件、端口、边界和判定交回同一 `opencode/zen-v4-flash` 任务只读复核；处理意见后精确暂存。

## 文档、提交与停止门槛

- 一个中文 commit，不 push；禁止 `git add .`、`git add -A`、`git commit -am`，不得暂存 `1.txt` 或 `docs/architecture-analysis-2026-08-09.md`。
- 若审计证明现有编码完整且无歧义：下一轮唯一目标才是纯派生未来维度 cohort，不同时做 UI 排行/自适应。
- 若证明部分或全部模式有歧义：下一轮唯一目标改为统一未来 sessionId 编码的最小设计/实现边界，旧记录继续“未知维度”，不得回填。
- 若必须新增 schema、推断/伪造历史、改变评分排程或跨新冲刺才能成立，停止阶段 C 实现并提交阻断证据。
- 第 38 轮未触发停止门槛：阶段 B 完成后可自动串行进入本轮只读审计；仍须先做现场核对，不得把只读审计扩成实现。
