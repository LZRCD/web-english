# 下一轮执行 Prompt：第 40 轮最小统一未来 sessionId 编码纵向链

## 当前现场

- 分支：`codex/follow-up-hardening`。
- 第 39 轮提交前 HEAD：`54ab960`；最终 HEAD 以包含本文件的最新中文提交为准。
- 第 38 轮自动验证基线：`tests/weak-signals.test.ts` 81/81，lint/typecheck 通过，`npm test` 201/201，signal-flow E2E 17/17（42.8s）。
- 第 39 轮是纯文档只读审计，实际定向静态验证数字见 `round-39.md`；未启动服务、未运行 E2E。
- 工作区保护：`1.txt`、`docs/architecture-analysis-2026-08-09.md`、`.codex-round38-20260809-010645.err.log`、`.codex-round38-20260809-010645.out.log` 均为未跟踪用户/并发文件，绝不修改或暂存。
- 固定端口 3000/3001 在第 39 轮初查与结束复查均应无监听；第 40 轮开始前重新核对，不沿用历史端口结论。

## 已完成阶段与第 39 轮结论

- 阶段 A 已完成成效口径诚实化；阶段 B 已完成成功 sprint review 到下一 sprint 前首次正常 review 的覆盖、保持、截断、间隔和同词测时观察。
- 第 39 轮确认当前只有顽固格式 `sprint:stubborn:<mode>:<ISO>` 可辨识；三类 Quiz、lookup、考前通用、限定、补漏、当前仍薄弱再冲刺、历史再跑、slow-recall 与 lapse 当前都落成 `sprint:<ISO>`。
- `ReviewEvent.sessionId`、activeSession/activeQuiz、normalize/hydrate 和分域已原样保留字符串，不需要 schema/version/store/domain。
- 所有 sprint 统计与第 38 轮 B 链均用 `startsWith("sprint:")`；新格式仍应被统一感知。唯一已确认日期断链是 `buildSprintHistory`：非顽固格式直接切片当日期，新 treatment 格式会被过滤。
- 旧 `sprint:<ISO>` 只能是 `unknown`；未来明确混合/通用处置是 `generic-sprint`，两者不得混同。顽固主维度与子 mode 也不得扁平映射为普通 Quiz/lookup 维度。
- 猜错仍只有累计次数，无真实事件时间、恢复或复发源；它只能迫使混合入口回退 generic，不能成为未来可归因维度。

## 第 40 轮唯一目标

实现一条“启动时真实维度 → 唯一 sessionId 编码 → review 原样写入 → 刷新保持 → 统一解析/startedAt → 历史、时间线、成效、保持、再跑全部兼容”的最小纵向链，只标注未来新 session；不做分维度报告。

这是一个功能目标，不得拆成只写编码器或顺带进入阶段 D。

## 必须先做的只读核对

1. 核对 Git HEAD/分支/最近历史、完整 status/diff、四个保护文件、3000/3001 监听与历史 PID/日志；确认第 39 轮提交和实际验证数字。
2. 重新追踪 `createStudySession`、`startSession`、`startSprintSession`、`startScopedSprint`、`startResprintSession`、`startSprintFromRelapse`、`startSprintFromHistory`、`startStubbornTreatment`、`recordQuizResult`、`rateWord`。
3. 重新枚举 `sprint:*` 消费者：`buildSprintHistory`、`buildSprintRecordWordIds`、`buildPairedRecallChange`、`buildSprintEffectiveness(Series)`、`buildSprintRelapse(Series)`、`buildSprintRetentionSeries`、`buildWordSignalTimeline`、完成摘要及 activeSession/activeQuiz 恢复。
4. 核对第 39 轮矩阵中的映射是否仍与代码一致；不得从按钮、标题、toast、中文标签、当前页面状态或历史 quizAttempt 反推维度。

## 编码与解析契约

### 维度枚举

至少覆盖：

- `listening-spelling`
- `chinese-to-english`
- `meaning-choice`
- `lookup-recall`
- `stubborn`
- `slow-recall`
- `lapse`
- `generic-sprint`
- `unknown`（解析结果；不得作为新的已知处置入口冒充事实）

顽固必须额外保留合法子 mode：`lookup-recall | listening-spelling | chinese-to-english`。

### 格式

- 新普通结构化格式使用一个明确版本的统一方案，例如 `sprint:treatment:<dimension>:<ISO>`；同轮不得出现多个新拼接规则。
- 顽固继续兼容且可继续创建现有 `sprint:stubborn:<mode>:<ISO>`；统一解析器返回 `dimension=stubborn` 和 `submode`，不得迁移或回写历史。
- 旧 `sprint:<ISO>` 返回 `dimension=unknown`、合法 startedAt 和 legacy 格式标记。
- 未知 treatment 维度或非法顽固 mode 安全返回 `dimension=unknown`；若结构中仍有合法 ISO，应保留 startedAt 供历史排序。只有时间本身非法时 startedAt 才缺省。解析不得抛错，且 `startsWith("sprint:")` 的既有统计身份不能被误改成普通 review。

### 唯一权威函数

- 只保留一个公开未来编码器、一个公开解析器和一个统一 startedAt 提取路径；顽固旧 helper 可委托/兼容，但入口和消费者不得各自手写切片。
- `buildSprintHistory` 必须改为使用统一 startedAt；旧、顽固、新 treatment 都可排序，非法时间仍不伪造历史记录。
- 新增代码应复用现有类型/判断，不复制评分、画像、恢复或统计逻辑。

## 新入口接入规则

- 三类 Quiz：直接使用 `SprintTreatmentRecommendation` 的结构化 `dimension/mode` 创建对应新 id；`QuizView` 与 `recordQuizResult` 继续原样回传，不能改每日首次有效门禁。
- 查词主动回忆：已有 `dimension=lookup, mode=lookup-recall`，把新 id 传入 `startSession` 的现有可选 sessionId；不改查词降级/复发。
- 顽固三阶段：保留现有格式、阶段、候选和刷新逻辑；不得把顽固听写/中译英记成普通 Quiz 维度。
- 考前 fallback：只有启动当下的完整目标词集用结构化事实证明为唯一 slow-recall 或唯一 lapse 时，才写对应维度；任一多维、跨维、猜错、lookup+FSRS 混合或不可证明情况写 `generic-sprint`。禁止解析 `buildWordWeakSignals` 文案。
- 分册/单元限定、完成页补漏、当前仍薄弱再冲刺、历史再跑：固定写 `generic-sprint`。历史再跑只复用原 session 的词集，不能继承原维度。
- 如果实现唯一 slow/lapse 判定会复制大量画像规则或无法对完整词集给出可靠结论，停止该映射并让这些入口统一 generic；不得为满足枚举覆盖而猜测。

## 时间线、历史、成效与保持不变量

- 时间线继续把全部 `sprint:*` 识别为冲刺；本轮不新增维度展示文案。
- 冲刺历史按完整 id 分组，startedAt 统一解析；活动量、当场达标和事件平均耗时口径不变。
- `buildSprintRecordWordIds` 继续完整 id 精确匹配；新格式再跑可取原词集，但新会话仍按当前入口事实写 generic。
- `buildPairedRecallChange` 继续排除全部 `sprint:*` 基线；`buildSprintEffectiveness(Series)` 和当前仍薄弱 cohort 继续纳入全部新旧 sprint，不按维度拆分。
- `buildSprintRetentionSeries` 继续使用最近成功 sprint 锚点、`(reviewedAtMs,id)` 总序、任意下一 sprint 无条件截断、首条非 sprint review 随访；`quiz:*` review 与无 sessionId review 仍可随访，quizAttempt 仍不得参与。
- 维度只附着锚点 session，不能改变 cohort、覆盖、保持、未观察、间隔、paired recall 的分子/分母或时间窗。

## 刷新、持久化与写入验收

- activeSession：新 id 经 `splitStoredState`、IndexedDB、`normalizeSession`、hydrate 后保持，WordCard 评分写相同 id。
- activeQuiz：新 id/mode/startedAt/questionWordIds/进度经写盘刷新保持，作答后的首次有效 review 写相同 id；题组快照继续优先，不能因实时推荐变化漂移。
- ReviewEvent normalize 往返不丢新/旧/顽固 id；不新增 schema/version/store/domain。
- Quiz 每次 attempt 仍写真实 mode/correct/recallMs，只有既有门禁通过才写 review/FSRS；不得为维度归因伪造 review。

## 测试与 E2E

单测至少覆盖：

- 新编码器/解析器/startedAt 的全部枚举；ISO 含冒号仍可稳定往返。
- 旧 `sprint:<ISO>` → unknown + startedAt；三类合法顽固 → stubborn + submode；未知维度/非法 mode 但时间合法时仍保留 startedAt；非法时间安全回退且不伪造日期。
- 三类 Quiz、lookup、顽固、唯一 slow、唯一 lapse、混合 generic 的启动映射；猜错/多维不得误标。
- `buildSprintHistory` 同时保留旧、顽固、新 treatment，按时间倒序；非法时间过滤；总次数/覆盖词数不漏合法新格式。
- 再跑按完整新 id 提取词集；时间线、周成效、当前仍薄弱 cohort和第 38 轮保持链继续把新格式当 sprint。
- B 链明确覆盖：新维度成功锚点、下一不同维度 sprint 截断、`quiz:*` 随访、无 sessionId 随访、同毫秒 tie-break，不改变既有数字。
- normalize / split-combine 往返保持 activeSession、activeQuiz 与 ReviewEvent 的新 id。

E2E 只新增/扩展一个复合纵向链，进入 `tests/e2e/signal-flow.spec.mjs`：至少从真实三类专项之一和 WordCard 专项之一启动，证明页面入口创建新 id、写盘、刷新恢复、真实 review 写同 id、冲刺历史能看到、历史再跑取原词集且新跑写 generic；同时证明旧 session 不报错。不要为每个枚举复制 E2E。

最终必须运行并报告实际数字：

- `node --experimental-strip-types --test tests/weak-signals.test.ts`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npx playwright test tests/e2e/signal-flow.spec.mjs --config playwright.config.mjs --reporter=line`

若浏览器验证需要服务，严格复用固定端口 3000、唯一日志/PID和健康检查；不得自动换到 3001。连续两次浏览器验证失败则停止服务重试，按规则报告。

## 红线与停止门槛

- 不新增 schema/version/store/domain，不修改评分、FSRS、每日 Quiz 门禁、备份、package scripts、历史 reviews/quizAttempts。
- 不回填旧维度，不从当前画像、标签、文案、toast、session title 或 quizAttempt 倒推历史。
- 不把 unknown 并入 generic，不把顽固子 mode 扁平映射成普通维度。
- 不改变第 38 轮锚点、下一 sprint 截断、随访、未观察和 paired recall 规则。
- 不实现分维度报告、排行、模式优劣、自适应推荐、推荐权重或因果文案。
- 如果需要上述任一越界、无法形成编码→写入→刷新→消费完整纵向链、固定端口被非项目进程占用或连续两次浏览器失败，立即停止并只提交阻断证据。

## 文档、提交与交接

- 创建 `docs/iterations/round-40.md`，更新 `dimension-treatment-audit.md`、`learning-effectiveness-audit.md`、`docs/project-evolution.md`、必要时 `occlusion-table.md`，并覆盖下一轮 prompt。
- 提交前让同一 `opencode/zen-v4-flash` 任务复核实际 diff、编码/解析、旧格式、写入/刷新、所有消费者、测试/E2E、保护文件和红线；处理或以代码证据驳回意见。
- 只能精确暂存本轮文件；禁止 `git add .`、`git add -A`、`git commit -am`，不得暂存四个保护文件。
- 一次中文 commit，不 push。提交后报告 hash/message、测试数字、工作区残留、端口状态、下一 prompt 路径、阶段 C 是否完成及是否允许自动继续。
- 只有未来编码、解析、startedAt、入口写入、刷新、历史、成效、B 链和再跑都被当前证据证明完整，才能宣布阶段 C 完成；否则继续阶段 C，不得提前进入阶段 D。
