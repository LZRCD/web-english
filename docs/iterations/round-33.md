# 第 33 轮：activeQuiz 题组快照刷新恢复闭环

日期：2026-08-08
只读基线：`84f627e`
分支：`codex/follow-up-hardening`

## 只读核对表

修改前 `QuizSessionState` 只保存模式、seed、位置、答案、正确数、完成态和开始时间。`seed` 能固定同一输入下的随机结果，却不能固定会被作答改变的输入候选与优先级。

| 核对项 | 修改前实现 | 漂移条件 | 状态 |
|---|---|---|---|
| mode / seed / startedAt | `normalizeQuizSession` 往返保留 | 无 | ✅ 保持 |
| questionIndex / correctCount | 数值往返并在恢复时夹取 index | 题组改变后 index 可能指向另一题 | ❌ 会话漂移 |
| answers | 以旧 `questionId` 为键往返 | 原题消失或换序后答案与可见题不一致 | ❌ 会话漂移 |
| 启动候选池 | 仅在启动 render 中提供 | 不持久化 | ❌ 候选漂移 |
| 实际生成题组 | `buildQuizQuestions` 由候选、progress、信号和 seed 生成 | 不持久化 | ❌ 候选漂移 |
| 普通 Quiz 恢复 | 全部当前已学词重新计算优先级 | 首题作答改变 progress | ❌ 题序漂移 |
| sprint 专项恢复 | 读取实时 `sprintTreatment.wordIds` | 首题恢复后退出当前推荐 | ❌ 题组缩减 |
| 顽固专项恢复 | 按 startedAt 重建阶段候选 | 当前 progress 仍会改变候选优先级 | ❌ 题序/选项漂移 |
| meaning-choice 干扰项 | 来自全部当前已学词 | 目标顺序改变使 `seed + index` 改变 | ❌ 选项漂移 |
| 完成态 / 再来一组 | complete 往返；重开使用新 seed | 旧题组仍无证据 | ⚠️ 依赖当前候选 |
| 旧/非法会话 | 旧会话按 seed 与当前候选回退 | 无法精确复原历史输入 | ⚠️ 只能安全兼容 |

只读实测使用同一 seed `330033`：普通中译英题序由 `[1,3,2,5,4]` 变为 `[1,2,3,5,4]`；sprint 候选由 `[1,2]` 缩为 `[2]`；顽固辨析目标由 `[1,2]` 变为 `[2,1]`，同词选项顺序也随 `seed + index` 改变。因此现有字段不能精确恢复，禁止从当前画像近似或逆推。

## 唯一修复

- `QuizSessionState` 仅新增向后兼容可选字段 `questionWordIds?: number[]`，保存实际生成题目的目标词有序快照。
- `QuizView` 从真实 `questions` 提取快照并随既有 activeQuiz 写盘；新会话和“再来一组”都生成独立快照。
- `normalizeQuizQuestionWordIds` 只保留正安全整数，按首次出现去重并限制 30 项；非数组按旧会话处理，空或失效快照安全回到可用测验入口。
- `restoreQuizQuestions` 有快照时忽略实时推荐与优先级，按快照原位置恢复；目标词已删除或未学习时过滤，但保留剩余目标原 `seedOffset`。
- meaning-choice 仍用全部已学词生成干扰项，未持久化题干、答案、选项、Word 对象或原始候选池。
- 旧 activeQuiz 无快照时沿用既有 seed + 当前安全候选回退；恢复出题后的正常写盘会自动补齐快照。

没有新增 IndexedDB store/domain，没有提升 schema/version；评分、FSRS、每日 Quiz 门禁、恢复/复发、题目答案、备份、猜错和 package scripts 均未改变。

## 验收证据

1. 单测覆盖快照清洗、去重、限长、分域往返、完成态、旧/非数组兼容。
2. 单测覆盖普通/顽固共有根因：progress 与实时候选改变后，目标顺序、questionId、答案和有效干扰项保持。
3. 删除或未学习目标会被过滤，剩余题 index 安全夹取；全部失效不崩溃。
4. E2E 种入两个中译英弱词，首题正确后该词退出实时推荐；刷新仍恢复原 `sprint:*`、原 seed/startedAt、原两题快照、第 2/2 题、正确数 1 和已答映射。
5. 完成后“再来一组”产生新 id/seed、空答案、index 0 和新快照。
6. 三类专项、查词、顽固、时间线、成效与既有 14 条 E2E 语义全部保持。

## 验证

- 定向 `tests/weak-signals.test.ts`：74/74。
- `npm run lint`、`npm run typecheck`：通过。
- `npm test`：191/191，含生产构建。
- `tests/e2e/signal-flow.spec.mjs`：15/15；新增 1 条刷新恢复链，既有 14 条语义不变。
- 固定端口 3000 健康检查 200；验证结束后仅清理本轮 PID 与日志。

## 阶段结论

结论 A：七个可实现维度、分域持久化往返及未完成 Quiz 刷新恢复均已收敛，项目进入稳定维护和真实学习成效验证阶段。

猜错继续为：`➖ 当前约束下不可闭环：只有累计次数，无真实事件时间、恢复或复发数据源。`
