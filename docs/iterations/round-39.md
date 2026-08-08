# 第 39 轮：未来处置维度归因只读审计

日期：2026-08-09
只读基线：`54ab960`
分支：`codex/follow-up-hardening`

## 现场与唯一目标

- 初查 HEAD 为 `54ab960 feat: 建立冲刺后首次正常复习保持观察`，本地分支相对远端 ahead 43。
- 工作区只有四个预期未跟踪项：用户文件 `1.txt`、并发只读产物 `docs/architecture-analysis-2026-08-09.md`、第 38 轮两份 `.codex-round38-20260809-010645.*.log`；本轮均未读取后改写、未暂存。
- 固定端口 3000/3001 均无监听；本轮是文档审计，不启动服务、不运行浏览器 E2E。
- 唯一目标是审计阶段 C 未来处置维度归因：列全 sessionId 创建、写入、刷新、消费和反例，判断下一轮是否能在不新增 schema 的前提下统一未来编码。本轮不改业务代码、测试或 E2E，不实现分维度报告、排行、自适应或历史回填。

## sessionId 创建与写入全链

| 链路 | 当前创建 | 当前格式 | 写入 review | 刷新恢复 | 当前可辨识性 |
|---|---|---|---|---|---|
| 普通 `StudySession` 冲刺 | `startSession` → `useStudySession.startSession` → `createStudySession` | `sprint:<ISO>` | `rateWord` 把 `activeSession.id` 原样传给 `applyRating` | `splitStoredState.activeSession` → `normalizeSession` → `hydrateSession`，id 原样保留 | 只能证明是 sprint；不能证明 slow-recall、lapse、lookup 或 generic |
| 考前三类 Quiz 专项 | `startSprintSession` → `createQuizSession` 后覆盖 id | 三类都为 `sprint:<ISO>` | `QuizView` 回传 id；`recordQuizResult` 对任意 `sprint:*` 原样传给 `applyRating` | `activeQuiz` 分域持久化；`normalizeQuizSession` 保留 id/mode/startedAt/题组快照 | `activeQuiz.mode` 仅是运行态事实；落到 review 后三类 id 完全相同，历史不可分 |
| 查词主动回忆专项 | `startSprintSession` 的 `lookup-recall` 分支 → `startSession("sprint")` | `sprint:<ISO>` | 同普通 WordCard | 同 activeSession | 与慢回忆、lapse、通用冲刺不可分 |
| 顽固词主动回忆 | `startStubbornTreatment` → `createStubbornSprintSessionId("lookup-recall")` | `sprint:stubborn:lookup-recall:<ISO>` | WordCard 评分原样写 id | activeSession 保留；解析器可取 mode/startedAt | 可辨识为 stubborn + 子 mode |
| 顽固词听音拼写 / 中译英 | 同上，mode 分别为 `listening-spelling` / `chinese-to-english` | `sprint:stubborn:<mode>:<ISO>` | Quiz 首次有效结果原样写 id | activeQuiz 保留；题组快照恢复；解析器可重建启动时候选 | 可辨识为 stubborn + 子 mode |

`ReviewEvent` 无需扩展：`applyRating` 已原样复制传入的 `sessionId`；`normalizeReview` 只 trim 非空字符串，不改格式。`StudySession.id` 与 `QuizSessionState.id` 也都是普通字符串，现有 settings/reviews 分域即可持久化未来编码。

## 入口、维度和歧义结论

完整逐入口矩阵见 `dimension-treatment-audit.md`。核心结论如下：

1. 可直接统一编码的未来入口是三类 Quiz 专项和查词主动回忆：`SprintTreatmentRecommendation` 已分别携带结构化 `dimension/mode`，无需读取按钮、标题或标签。
2. 顽固三阶段已经可辨识。下一轮不得破坏或重写存量 `sprint:stubborn:<mode>:<ISO>`；统一解析结果应为 `dimension=stubborn`，并额外保留合法子 mode。不能把顽固听写历史误报为普通 `listening-spelling` 维度。
3. slow-recall 与 lapse 当前都进入通用 WordCard，`startSprintSession` 的 fallback 没有结构化维度参数。下一轮只有在启动当下用真实 `reviews/wordProgress/quizAttempts/lookupStats/stubbornWords/guessMistakes` 能证明本次完整词集只有一个支持维度时，才可分别写 `slow-recall` 或 `lapse`；任一多维、跨维、猜错或不可证明情况写 `generic-sprint`。禁止解析 `buildWordWeakSignals` 的中文标签。
4. 分册/单元限定、完成页补漏、当前仍薄弱再冲刺和历史记录再跑都直接打开通用 WordCard，且目标词可能来自不同信号。它们应写新的 `generic-sprint`，不能沿用来源 session 的旧维度，也不能按当前标签反推。
5. 旧 `sprint:<ISO>` 只能解析出 startedAt 和 `dimension=unknown`。虽然用户文案以后可显示“未标注/通用冲刺”，数据层不得把 unknown 改写成已知 `generic-sprint`。旧非法 `sprint:*` 仍是 sprint 事件，但 startedAt 不可得、维度 unknown。

## 消费者与反例

| 消费者 | 当前规则 | 新格式风险 | 下一轮要求 |
|---|---|---|---|
| `buildSprintHistory` | `startsWith("sprint:")` 分组；只特殊解析顽固，否则把 `sprint:` 后全部当日期 | `sprint:treatment:<dimension>:<ISO>` 会把 `treatment:...` 当日期并被过滤，历史列表漏数 | 全部 startedAt 都走唯一解析器；旧 ISO、顽固、新 treatment 兼容，非法时间继续不进可排序历史 |
| `buildSprintRecordWordIds` | 按 sessionId 完全相等提取去重 wordId | 无格式风险 | 保持精确匹配；历史再跑只复用词集，不继承无法证明的处置维度 |
| `buildPairedRecallChange` | 所有 `sprint:*` 都排除为非冲刺基线 | 无格式风险 | 保持 `startsWith` 统一识别 |
| `buildSprintEffectiveness(Series)` | 周窗内所有 `sprint:*` review | 无格式风险 | 新旧格式都不能漏；本轮不分维度 |
| `buildSprintRelapse(Series)` / `buildSprintSolvedCohorts` | 所有 `sprint:*` 的 `rating≥2` cohort | 无格式风险 | 保持现有 cohort/去重语义 |
| `buildSprintRetentionSeries` | `sprint:*` 作为成功锚点；锚点后任一 `sprint:*` 无条件截断 | 无格式风险 | 新维度只附着锚点；不得改变下一 sprint 截断，`quiz:*` 仍只是随访 review |
| `buildWordSignalTimeline` | `sprint:*` 显示“冲刺复习” | 无格式风险 | 继续识别所有格式；本轮不展示维度 |
| `recordQuizResult` | 传入 id 若为 `sprint:*` 则原样写 review，否则写 `quiz:<mode>:<date>` | 无格式风险 | 不改每日 Quiz 门禁或评分；新 id 继续原样传递 |
| activeSession / activeQuiz 恢复 | normalize 保留 id；Quiz 用 `questionWordIds` 快照恢复 | 新 treatment Quiz 不会被 `parseStubbornSprintSessionId` 识别，但已有题组快照仍能固定目标 | 下一轮统一解析器用于 startedAt/维度；不得削弱快照优先和旧会话回退 |

最小反例：

- `sprint:2026-08-09T00:00:00.000Z` 可能来自普通考前冲刺、三类 Quiz、查词、限定范围、补漏、当前仍薄弱再冲刺或历史再跑；任何单一维度结论都属于猜测。
- `sprint:stubborn:listening-spelling:2026-08-09T00:00:00.000Z` 的 mode 是顽固阶段子模式，不等同于普通拼写薄弱专项。
- `sprint:treatment:meaning-choice:2026-08-09T00:00:00.000Z` 在当前 `buildSprintHistory` 中会被整段当日期并过滤，证明只增加编码器不足以闭环。
- `quiz:meaning-choice:2026-08-10` 可以是 B 链的真实首次正常 review，但不能倒推出此前 sprint 锚点是辨析处置。
- 同词跨 session、同 session 多 review 或同毫秒事件都不改变维度来源：维度来自该次启动时写入的 sessionId；B 链继续用 `(reviewedAtMs,id)` 排序并按下一 sprint 截断。
- 无 sessionId 的旧 review 只能作为普通随访候选；它不是 sprint 处置证据。

## 下一轮最小统一实现结论

阶段 C 尚未完成，但可在现有 schema 内形成下一条完整纵向链。第 40 轮应只实现一个权威编码/解析模块和所有现有启动入口的未来写入：

- 枚举至少覆盖 `listening-spelling`、`chinese-to-english`、`meaning-choice`、`lookup-recall`、`stubborn`、`slow-recall`、`lapse`、`generic-sprint`、`unknown`。
- 提供唯一 `create...SessionId`、`parse...SessionId` 与 startedAt 提取；建议新格式 `sprint:treatment:<dimension>:<ISO>`，但顽固继续兼容原格式并返回子 mode。
- 新编码只写未来会话；旧普通 sprint 返回 unknown，不回填；非法/未知模式安全返回 unknown/无 startedAt，不抛错。
- 三类 Quiz/lookup 用既有结构化推荐直接编码；显式顽固沿用既有格式；通用/限定/补漏/当前仍薄弱/历史复跑默认 generic。slow-recall/lapse 只有完整启动词集经结构化事实证明唯一时才编码，否则 generic。
- 把统一解析接入历史 startedAt、时间线/历史/成效/当前薄弱/B 链、再跑和刷新回归，但不改变这些消费者既有分母、窗口、去重、锚点或截断语义。

第 40 轮仍不得实现分维度报告。只有未来写入、解析、恢复、历史、B 链和再跑都验证闭环后，阶段 C 才可完成并评估进入阶段 D。

## 停止门槛与本轮边界

- 若统一实现需要新增 schema/version/store/domain、回填旧 reviews、从当前标签/文案/quizAttempt 推断历史、修改评分/FSRS/每日 Quiz 门禁/备份，立即停止。
- 若无法为某入口证明唯一维度，写 `generic-sprint`；不得为了提高“可归因覆盖率”猜测。
- 本轮没有新增咬合或改变既有咬合证据，因此不更新 `occlusion-table.md`。
- 本轮未启动服务、未运行 E2E；定向静态验证及 DeepSeek 提交前复核结果在提交前补录。

## 验收证据

- `node --experimental-strip-types --test tests/weak-signals.test.ts`：81/81，通过；0 失败、0 跳过，测试进程报告 168.7907ms。
- `npm run lint`：通过（7.3s）。
- `npm run typecheck`：通过（1.9s）。
- 本轮文档外无代码改动，因此按本轮边界不启动服务、不运行无关 E2E。

## DeepSeek 提交前复核

- 父会话已把实际 5 份文档 diff、81/81 定向测试、lint/typecheck、四个保护文件、端口和红线交回同一 `opencode/zen-v4-flash` 任务。
- 复核结论：可提交、无阻断。独立确认入口/消费者矩阵无遗漏，旧 `unknown` 与未来 `generic-sprint` 必须分开，顽固主维度与 submode 不应扁平化，slow-recall/lapse 只能在启动时结构化事实证明完整词集唯一时编码，历史再跑的新 session 写 generic 边界正确。
- 独立确认第 40 轮 prompt 是单一完整纵向目标，覆盖编码、解析、startedAt、未来入口写入、刷新、历史、成效、第 38 轮 B 链与再跑，且没有提前进入分维度报告、排行或自适应；本轮不更新 `occlusion-table.md` 正确。
- DeepSeek 定向复跑 `tests/weak-signals.test.ts` 为 81/81；复核时 3000/3001 无监听，四个保护文件继续未跟踪且不进提交。
