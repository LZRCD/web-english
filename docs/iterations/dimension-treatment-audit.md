# 薄弱维度 × 处置闭环审计

> 审计日期：2026-08-08 ｜ 只读基线：`6a4f725` ｜ 分支：`codex/follow-up-hardening`
## 第 41 轮：分维度观察报告已实现

日期：2026-08-09 ｜ 基线：`cf46fdc`

- 新增唯一纯函数 `buildDimensionObservationReport`（`lib/weak-signals.ts`）：固定 8 个已知 treatment 维加 `unknown` 共 9 行，按 `SPRINT_TREATMENT_DIMENSIONS` 顺序并列输出，不按数量排序；维度只由 `parseSprintSessionId(锚点.sessionId).dimension ?? "unknown"` 归属。
- 锚点规则与第 38 轮 B 链逐字节一致：全局 `(reviewedAtMs,id)` 总序最近成功冲刺为唯一锚点，任意下一 `sprint:*` 截断，`quiz:*` review/无 sessionId review 可随访；维度只附着锚点，不改变窗口、截断、随访或分母。
- 活动口径（session 数/覆盖词/当场达标）按该维窗口内去重，同词跨维可重复，UI 标注“不可跨维合计”；锚点系计数（cohort/随访/截断/保持/配对样本/仍薄弱）每词唯一归属，分维合计==全局，单测钉死。
- 当前仍薄弱复用第 34 轮语义：分子=该维唯一成功锚点词中当前统一画像非空者，分母=该维全部唯一成功锚点 cohort（含未观察与截断），与随访可观测性解耦。
- 旧 `sprint:<ISO>`、未知 treatment、非法顽固 mode、非法时间一律 `unknown`；`generic-sprint` 与 `unknown` 分列；顽固子 mode 只披露 `stubbornSubmodeSessionCounts`，不扁平并入普通听音拼写/中译英/lookup。slow-recall/lapse 暂无可复用的启动级单维判定，继续只作为解析能力与空行，不形成虚假可归因样本。
- 验证：定向 91/91、全量 211/211、lint/typecheck/build 通过、固定 3000 signal-flow 18/18（45.8s）；UI 在轨迹页以 `<details>` 折叠披露样本数、分子/分母、无样本文案与非因果说明。
- 未新增 schema/version/store/domain，未回填历史，未改评分/FSRS/门禁/备份/scripts/推荐优先级；未重构既有 B 链函数，等价性由分维合计单测保证。阶段 D 完成；阶段 E 无既定定义，需先只读审计边界与真实样本门槛。


## 第 40 轮：未来结构化 sessionId 已实现

- 唯一新格式为 `sprint:treatment:<dimension>:<ISO>`；可写维度为 `listening-spelling`、`chinese-to-english`、`meaning-choice`、`lookup-recall`、`stubborn`、`slow-recall`、`lapse`、`generic-sprint`。`unknown` 仅是解析结果，编码器不能写入。
- `parseSprintSessionId` 是新旧格式的唯一权威解析器：旧普通 sprint 返回 `unknown + legacy + startedAt`；合法顽固返回 `stubborn + submode + startedAt`；未知 treatment/非法顽固 mode 在尾部时间合法时仍保留 startedAt；非法时间不伪造日期。
- 三类 Quiz 与查词主动回忆直接消费启动时已有的结构化 mode；顽固格式保持；通用、限定、补漏、当前仍薄弱与历史复跑固定写 generic。slow/lapse 本轮不复制画像判定，fallback 仍为 generic。
- `buildSprintHistory` 已改走统一 startedAt；精确词集再跑、时间线、成效、当前仍薄弱 cohort 与保持链继续按完整 id 或 `startsWith("sprint:")` 工作，不拆维度、不改分母。
- activeSession、activeQuiz 和 review 的分域往返测试证明新 id 原样保持，不需要 schema/version/store/domain。
- 自动证据为定向 85/85、全量 205/205、lint/typecheck/build 通过；固定 3000 的 signal-flow 17/17。复合 E2E 证明真实中译英与 lookup 启动、写盘刷新、review 同 id、历史和 generic 原词集复跑，既有旧格式链也保持。
- 首次 E2E 暴露 Quiz 成功 review 会使旧 lookup 信号降级；测试改为在成功 review 后真实再次划词触发复发，产品规则未放宽。阶段 C 已完成。

## 第 39 轮：阶段 C 未来 sessionId 归因审计

> 审计日期：2026-08-09 ｜ 只读基线：`54ab960`。本节审计未来编码可行性；示例是第 40 轮拟写格式，不代表已经存在或允许回填的历史事实。

### 完整入口证据矩阵

| 处置入口 | 未来 sessionId 示例 | 当前创建函数 / 下一轮编码点 | 当前解析函数 / 下一轮解析点 | 显式唯一维度 | review 写入 | 刷新保持 | B 链连接 | 旧历史归因 | 歧义 | 审计结论 |
|---|---|---|---|---|---|---|---|---|---|---|
| 考前薄弱冲刺：听音拼写 | `sprint:treatment:listening-spelling:<ISO>` | `startSprintSession` 根据 `SprintTreatmentRecommendation.dimension=quiz-spelling, mode=listening-spelling` 创建 `activeQuiz`；下一轮调用统一编码器 | 当前只有顽固解析器；下一轮统一解析为 `dimension=listening-spelling` + startedAt | 是，推荐对象和 Quiz mode 同时明确 | `QuizView` → `recordQuizResult`；仅既有每日门禁通过时 `applyRating`，且 `sprint:*` 原样写入 | `activeQuiz.id/mode/startedAt/questionWordIds` 经分域与 normalize 保持 | 成功 review 可作锚点；后续任一 sprint 仍截断，`quiz:*` review 仍只作随访 | 旧 `sprint:<ISO>` 不可归因 | 当前三类专项共用普通 id | 第 40 轮直接接入新编码；不改 Quiz 门禁 |
| 考前薄弱冲刺：中译英 | `sprint:treatment:chinese-to-english:<ISO>` | 同上，结构化推荐为 `quiz-c2e/chinese-to-english` | 统一解析为 `chinese-to-english` | 是 | 同上 | 同上 | 同上 | 不可 | 当前与其他普通 sprint 相同 | 可直接编码 |
| 考前薄弱冲刺：释义辨析 | `sprint:treatment:meaning-choice:<ISO>` | 同上，结构化推荐为 `quiz-choice/meaning-choice` | 统一解析为 `meaning-choice` | 是 | 同上 | 同上 | 同上 | 不可 | 当前与其他普通 sprint 相同 | 可直接编码 |
| 考前薄弱冲刺：查词主动回忆 | `sprint:treatment:lookup-recall:<ISO>` | `startSprintSession` 已拿到 `dimension=lookup, mode=lookup-recall`，但当前调用 `startSession("sprint")` 丢维度；下一轮把统一 id 传入已有可选 `sessionId` | 统一解析为 `lookup-recall` | 是；只含达到查词阈值、未降级且无 FSRS 弱进度的候选 | WordCard `rateWord` → `applyRating(activeSession.id)` | activeSession normalize/hydrate 原样保持 | 成功 review 可作锚点，规则不变 | 不可 | 当前与 slow/lapse/generic 同 id | 可直接编码 |
| 考前 fallback：整组只含慢回忆 | `sprint:treatment:slow-recall:<ISO>` | 当前 `buildSprintWordIds` + `startSession("sprint")` 不携维度；下一轮只能由启动时结构化事实对完整词集做唯一性判定后编码 | 统一解析为 `slow-recall` | 当前否；下一轮只有每个目标均仅有慢回忆且无猜错/其他支持信号时才是 | WordCard `rateWord` 保留真实 `recallMs/sessionId` | activeSession 保持 | 可接 B 链 | 不可 | 不能解析 `buildWordWeakSignals` 中文标签；多信号即不唯一 | 支持未来唯一整组；否则 generic |
| 考前 fallback：整组只含 lapse | `sprint:treatment:lapse:<ISO>` | 同上；启动时结构化检查 `reviews/wordProgress` 与完整候选 | 统一解析为 `lapse` | 当前否；下一轮只有完整词集均唯一属于 lapse 时才是 | WordCard 真实评分；不改 FSRS | activeSession 保持 | 可接 B 链 | 不可 | lapseCount、慢回忆、查词等可同时存在 | 支持未来唯一整组；否则 generic |
| 考前 fallback：混合/多维/猜错/不可证明 | `sprint:treatment:generic-sprint:<ISO>` | `startSprintSession` fallback → 统一编码器 | 统一解析为 `generic-sprint` | 明确“不是单一可证明维度”，不是 unknown | WordCard 真实评分 | activeSession 保持 | 可接 B 链 | 旧记录仍 unknown，不能并入已知 generic | 同 session 可含不同弱因 | 必须写 generic，不追求虚假覆盖率 |
| 分册/单元限定冲刺 | `sprint:treatment:generic-sprint:<ISO>` | `startScopedSprint` → `buildScopedSprintWordIds` → `startSession`；下一轮显式传 generic id | 统一解析 | 否；范围只是位置，不是处置维度 | WordCard 真实评分 | activeSession 保持 | 可接 B 链 | 不可 | 区域内可混合全部弱因 | 固定 generic |
| 完成页“仍需关注”补漏 | `sprint:treatment:generic-sprint:<ISO>` | `startResprintSession` 按当前 `stillWeakWords` 开通用卡 | 统一解析 | 否 | WordCard 真实评分 | activeSession 保持 | 新 session 无条件截断旧锚点并建立自己的未来锚点 | 来源 session 维度不可自动继承 | 当前仍弱原因可能已变化/多维 | 固定 generic |
| 当前仍薄弱词再冲刺 | `sprint:treatment:generic-sprint:<ISO>` | `startSprintFromRelapse` 按当前统一画像词集开通用卡 | 统一解析 | 否 | WordCard 真实评分 | activeSession 保持 | 新 sprint 截断旧观察 | 不可 | 指标本身不能区分从未恢复与复发，词集也可多维 | 固定 generic |
| 冲刺历史“再跑一次” | `sprint:treatment:generic-sprint:<ISO>` | `startSprintFromHistory` 只用 `buildSprintRecordWordIds` 取词，随后开通用 WordCard | 统一解析新 id；原 id 仅用于精确取词 | 否；当前训练方式和当前弱因均未由原 id证明 | WordCard 真实评分 | activeSession 保持 | 新 sprint 截断旧观察 | 旧源 session 若 unknown 继续 unknown；即使新源已知也不自动继承 | 原会话可能是 Quiz，复跑却是 WordCard；当前状态也可能变化 | 固定 generic，禁止继承来源维度 |
| 词本/统一入口：顽固主动回忆 | `sprint:stubborn:lookup-recall:<ISO>` | `startStubbornTreatment` → `createStubbornSprintSessionId` | `parseStubbornSprintSessionId` 已可取 mode/startedAt；统一解析器应委托并返回 `dimension=stubborn, submode=lookup-recall` | 是，主维度 stubborn + 子 mode | WordCard `rateWord` | activeSession 保持，启动时刻可重建阶段候选 | 可接 B 链 | 已有结构化历史可归因 stubborn | 不能扁平映射成普通 lookup-recall | 保留格式，统一解析，不迁移 |
| 词本/统一入口：顽固听音拼写 | `sprint:stubborn:listening-spelling:<ISO>` | 同上，创建 activeQuiz | 同上，submode 为 listening-spelling | 是，主维度 stubborn | Quiz 首次有效结果原样写 id | activeQuiz + 题组快照保持 | 可接 B 链 | 已有结构化历史可归因 stubborn | 不能归到普通拼写专项 | 保留格式 |
| 词本/统一入口：顽固中译英 | `sprint:stubborn:chinese-to-english:<ISO>` | 同上 | 同上，submode 为 chinese-to-english | 是，主维度 stubborn | 同上 | 同上 | 可接 B 链 | 已有结构化历史可归因 stubborn | 不能归到普通中译英专项 | 保留格式 |
| 旧普通冲刺 | 历史实值 `sprint:<ISO>` | `createStudySession` 或旧 Quiz 覆盖 id；不再新写此格式 | 统一解析应返回合法 startedAt、`dimension=unknown`、legacy 格式 | 否 | 历史 review 保持原样 | normalize 保持 | 仍可作 B 链锚点/截断 | 只能显示“未标注/通用冲刺”，数据层是 unknown | 同一格式覆盖所有旧入口 | 不回填、不猜、不改写成 generic-sprint |
| 非法/未知 sprint | 如 `sprint:broken`、`sprint:treatment:new-mode:<ISO>` | 非法或未来未知输入 | 统一解析安全返回 unknown；时间非法则 startedAt 缺省，不抛错 | 否 | `startsWith` 消费者仍可能把它视为 sprint review | 原字符串保持 | 若已在 reviews，B 链仍按 sprint 截断；不得因解析失败变普通 review | 不可 | 当前 `buildSprintHistory` 会过滤无有效时间记录 | 安全兼容，历史列表不伪造时间 |
| 无 sessionId 的旧 review | 无 | 无 | 非 sprint / unknown，无 startedAt | 否 | review 本身是真实评分 | normalize 仍允许缺省 | 可作为锚点后的首次正常随访，不能作 sprint 锚点 | 不可 | 缺失不等于某种通用处置 | 保持 B 链现状 |

### 编码、解析与 startedAt 统一边界

- 当前唯一编码器只覆盖顽固：`createStubbornSprintSessionId`；唯一解析器也只覆盖顽固。普通 `createStudySession` 只按 kind 拼接 ISO，无法接收维度。
- `buildSprintHistory` 是确定断链：它只先尝试顽固解析，否则执行 `sessionId.slice("sprint:".length)`。任何 `sprint:treatment:<dimension>:<ISO>` 都会把 `treatment:...` 当成日期并被过滤。
- 第 40 轮应提供唯一公开编码器、解析器和 startedAt 提取，所有会话创建与日期消费者委托它；不允许每个入口自行拼字符串或每个统计自行切片。
- 统一解析结果应显式区分 `dimension=unknown` 与 `dimension=generic-sprint`。前者表示证据缺失，后者表示启动时已经知道这是混合/通用处置。
- 枚举至少覆盖 `listening-spelling`、`chinese-to-english`、`meaning-choice`、`lookup-recall`、`stubborn`、`slow-recall`、`lapse`、`generic-sprint`、`unknown`；顽固额外返回合法 `submode`，避免子模式与普通维度碰撞。

### 刷新、消费者与第 38 轮 B 链

- `ReviewEvent.sessionId` 经 `applyRating` 写入、`normalizeReview` 读取时原样保持；`activeSession.id` 经 `normalizeSession`，`activeQuiz.id` 经 `normalizeQuizSession` 原样保持。现有 `splitStoredState` 已把 activeSession/activeQuiz 放进 settings、reviews 放进 reviews 域，无需新 schema。
- activeQuiz 的 `questionWordIds` 是实际题组快照。未来新 id 即使当前尚未被顽固专用解析器识别，快照仍可固定目标；第 40 轮统一解析不得削弱快照优先或旧会话安全回退。
- 时间线、配对基线、周成效、当前仍薄弱 cohort 和 B 链都用 `startsWith("sprint:")`，因此新格式天然仍被视为 sprint。`buildSprintHistory` 的 startedAt 是唯一已确认会漏新格式的消费者。
- `buildSprintRetentionSeries` 必须继续让任意下一 `sprint:*` 无条件截断；维度只附着成功锚点，不改变窗口、最近锚点、随访分母或 `(reviewedAtMs,id)` 总序。`quiz:*` review 可以是随访，但其 mode 不能倒推锚点维度。
- `buildSprintRecordWordIds` 按完整 sessionId 精确匹配，天然支持新格式；历史复跑只能复用原词集，新会话写 generic，不能把源 id 维度冒充当前处置事实。

### 阶段 C 审计结论

现状是“部分可辨识”：顽固三阶段完整可辨识；三类 Quiz 与查词入口在启动瞬间有结构化维度，但普通 id 丢失该事实；slow-recall/lapse 只有在下一轮以结构化数据证明完整启动词集唯一时才可标注；其余混合入口必须 generic。旧普通 sprint 永远 unknown。

因此本轮不允许先做偏样本分维度报告。第 40 轮唯一目标应是“最小统一未来 sessionId 编码纵向链”，先让创建、解析、startedAt、写入、刷新、历史、成效、B 链与再跑全部兼容；完成后再判断阶段 C 是否达到进入阶段 D 的门槛。

## 只读基线矩阵

以下状态记录本轮修改前的真实数据流。入口按代码传入的结构化参数追踪，不按按钮名称或标签文案推断。

| 薄弱维度 | 信号来源 | 当前入口 | 实际训练方式 | 结果写入位置 | 降级规则 | 复发规则 | 状态 |
|---|---|---|---|---|---|---|---|
| 查词频繁 | `lookupWords` 关联学习项，`lookupStats.count/firstAt/lastAt` 达阈值 | 今日任务插队、词本划词候选、考前薄弱冲刺 | `startSession` 打开通用 `WordCard`；不强制词义主动回忆或语境辨析 | 评分写 `reviews`、`wordProgress`；查询仍留在 `lookupStats` | `lastRating≥2` 且 `lastReviewedAt≥lastAt` 时 `isLookupDemoted`，退出候选 | 后续查词令 `lastAt` 晚于评分，标签与候选重现 | ❌ 处置错配 |
| 拼写测验错 | `quizAttempts` 中 `mode=listening-spelling && !correct` | 考前薄弱冲刺 | 通用 `WordCard`，没有进入已有听音拼写组件 | 通用评分只写 `reviews/wordProgress`，不会新增同模式 `quizAttempts` | 仅最近两次同模式 `quizAttempts` 正确才淡出，因此通用冲刺无法完成降级 | 再次同模式答错可重现，但原入口不能产出该事件 | ❌ 处置错配 |
| 中译英错 | `quizAttempts` 中 `mode=chinese-to-english && !correct` | 考前薄弱冲刺 | 通用 `WordCard`，没有进入已有中译英输入模式 | 同上，通用评分不写该模式 `quizAttempts` | 最近两次同模式正确淡出 | 再次同模式答错重现 | ❌ 处置错配 |
| 辨析错 | `quizAttempts` 中 `mode=meaning-choice && !correct` | 考前薄弱冲刺 | 通用 `WordCard`，没有进入已有释义选择/近义辨析模式 | 同上，通用评分不写该模式 `quizAttempts` | 最近两次同模式正确淡出 | 再次同模式答错重现 | ❌ 处置错配 |
| 回忆偏慢 | `reviews.recallMs≥slowRecallMs` | 考前薄弱冲刺、集中区冲刺、复发再冲刺 | 通用主动回忆卡，揭示前计时，评分保留 `recallMs` | `rateWord` → `reviews.recallMs`、`wordProgress`，冲刺评分保留 `sessionId` | 最近连续两次均为 `rating≥2`、合法测时且低于阈值时淡出 | 任一新慢回忆或低评分中断恢复并重现 | ✅ 已形成维度闭环 |
| FSRS lapse | `wordProgress.lapseCount>0` 且 `isWeakProgress`；事件来自 `reviews.rating=0` | 错词、顽固词、考前/复发冲刺 | 通用复习卡，仍调用既有 `applyRating` | `reviews`、`wordProgress.fsrsCard/lapseCount` | 既有 FSRS 评分推进；连续成功达到 `isWeakProgress` 恢复条件后淡出 | 再次评分 0 增加 lapse 并重现 | ✅ 已形成维度闭环 |
| 顽固词 | `rebuildStubbornWords`：30 天内 3 次 Again 或 5 次低评分 | 词本顽固词专项、考前薄弱冲刺 | 通用卡；仅低评分后有一次拼写强化，不是稳定的多模式强化 | `reviews` 重建 `stubbornWords`，评分仍写 `wordProgress` | 连续 3 次成功或最后低评分 30 天后退出 | 再次满足低评分窗口条件后重新激活 | ❌ 处置错配 |
| 猜错 | `guessMistakes[wordId]` 累计次数 | 统一画像进入考前冲刺 | 通用卡；猜词组件只在手动隐藏释义时记录累计数 | `GuessMistakeMap` 只有计数；无事件时间、模式结果或恢复记录 | 无可靠降级规则 | 无法区分历史猜错、恢复与再次猜错 | ➖ 当前约束下不可实现 |

## 横向核对

- 拼写、中译英、辨析虽有独立 `QuizView` 模式，但薄弱入口修改前只调用 `startSession("sprint")`，三种测验结果不会回到对应 `quizAttempts.mode`。
- `buildSprintWordIds` 修改前只按 lapse、查词次数、平均回忆耗时排序；多维词没有“训练方式”优先级。
- 已恢复维度会由 `buildWordWeakSignals` 淡出并退出冲刺候选；其他仍弱维度会让该词继续留在统一画像，不会被一并降级。
- 通用冲刺 review 的 `sessionId` 可进入冲刺历史、成效与复发统计；普通测验 review 修改前使用 `quiz:*`，无法归因到由冲刺入口发起的专项。
- “猜错”只有累计数；在不新增 schema 的边界下不能诚实生成时间线、恢复或复发事件。

## 唯一目标选择

选择“拼写测验错 → 听音拼写 → 同模式结果回流”作为第 27 轮唯一目标：它是已有入口与已有训练组件之间的直接错配，可复用 `quizAttempts`、`reviews`、`QuizSessionState.id` 和既有恢复规则形成完整闭环。中译英、辨析与查词虽同样有价值，但本轮不并行扩张。

## 第 27 轮实施后目标行

| 薄弱维度 | 信号来源 | 当前入口 | 实际训练方式 | 结果写入位置 | 降级规则 | 复发规则 | 状态 |
|---|---|---|---|---|---|---|---|
| 拼写测验错 | 结构化读取未恢复的 `listening-spelling` 错误；不解析标签文案 | 考前薄弱冲刺；多维词中拼写专项优先于通用冲刺 | 限定当前拼写薄弱词集，直接恢复/启动 `QuizView` 听音拼写 | 每次作答写 `quizAttempts`；当日首次有效作答按既有门禁写 `reviews/wordProgress`，并沿用 `sprint:*` sessionId | 最近两次同模式正确后，拼写维度退出建议与统一画像 | 再次同模式答错后，拼写标签、推荐与入口立即重现 | ✅ 已形成维度闭环 |

专项 review 的冲刺 `sessionId` 继续被 `buildSprintHistory`、`buildSprintEffectiveness(Series)` 与 `buildSprintRelapse(Series)` 感知；FSRS 仍由 `shouldApplyQuizToSchedule` 和 `applyRating` 控制。本轮未新增 schema，未修改评分、排程或备份。

## 第 28 轮只读复核

> 复核基线：`a33e345`。分支仅有用户文件 `1.txt` 未跟踪，固定端口 3000 无监听、无 PID 文件；以下结论在修改前取得。

| 核对项 | 当前实现 | 证据位置 | 是否闭环 |
|---|---|---|---|
| 中译英信号来源 | `quizAttempts` 中同词 `mode=chinese-to-english && !correct` 的历史累计，恢复只看同模式有效时间序列 | `quizErrorCounts` / `isQuizModeRecovered` / `buildWordWeakSignals` | ✅ 信号真实 |
| 结构化处置建议 | 推荐联合类型仅含 `quiz-spelling → listening-spelling` | `SprintTreatmentRecommendation` / `buildSprintTreatmentRecommendation` | ❌ 未接中译英 |
| 冲刺入口路由 | 有拼写建议时直达 Quiz；否则回退通用 `startSession("sprint")` | `page.tsx#startSprintSession` | ❌ 中译英回退通用卡 |
| 实际训练模式 | 现有 Quiz 已支持 `chinese-to-english`，以 `word.meaning` 为提示、`word.word` 为答案 | `buildQuizQuestions` / `QuizView` 文本输入分支 | ✅ 组件可复用 |
| 候选词限定 | `candidateWordIds` 能贯穿恢复出题和新建出题，但上游只提供拼写候选 | `QuizView` / `restoreQuizQuestions` / `buildQuizQuestions` | ❌ 中译英无上游候选 |
| `quizAttempts` 回流 | 每次作答写入题目真实 `mode/correct/recallMs/answeredAt` | `QuizView#submitAnswer` → `recordQuizResult` | ✅ 已具备 |
| `reviews/sessionId` 归因 | 每日首次有效作答才调 `applyRating`；`sprint:*` 原样写入 review | `shouldApplyQuizToSchedule` / `recordQuizResult` | ✅ 已具备 |
| 连续正确淡出 | 最近两次同模式正确后中译英标签淡出 | `isQuizModeRecovered` | ✅ 已具备 |
| 再错复发 | 新同模式错误中断恢复，中译英标签重现 | `isQuizModeRecovered` / `buildWordWeakSignals` | ✅ 已具备 |
| 多维优先级 | 仅定义拼写专项；拼写恢复后未让仍弱中译英接管 | `buildSprintTreatmentRecommendation` | ❌ 优先级断在第二级 |

只读结论：不是缺训练组件、结果数据源或恢复规则，而是结构化推荐只实现了第一优先级。第 28 轮唯一目标因此选择“拼写优先 → 中译英接管”这一处最小路由断链。

## 第 28 轮实施后目标行

| 薄弱维度 | 信号来源 | 当前入口 | 实际训练方式 | 结果写入位置 | 降级规则 | 复发规则 | 状态 |
|---|---|---|---|---|---|---|---|
| 中译英错 | 结构化读取未恢复的 `chinese-to-english` 错误；不解析标签文案 | 考前薄弱冲刺；拼写专项优先，拼写恢复后中译英接管 | 限定当前中译英薄弱词集，以中文释义提示并输入英文 | 每次作答写 `quizAttempts`；首次有效作答按既有门禁写 `reviews/wordProgress`，并沿用 `sprint:*` sessionId | 最近两次同模式正确后退出建议与统一画像；其他维度保持 | 再次同模式答错后，中译英标签、建议和入口重现 | ✅ 已形成维度闭环 |

第 28 轮没有新增 schema，也没有修改答案判定、评分、FSRS 排程、备份或普通测验语义。拼写和中译英的结构化优先级固定为前者优先；辨析仍回退通用冲刺，是下一条最高价值断链。

## 第 29 轮只读复核

> 复核基线：`7b507c3`。分支仅有用户文件 `1.txt` 未跟踪，固定端口 3000 无监听；以下结论在修改前取得。

| 核对项 | 当前实现 | 证据位置 | 是否闭环 |
|---|---|---|---|
| 辨析信号来源 | `quizAttempts` 中同词 `mode=meaning-choice && !correct` 累计；恢复只看同模式有效时间序列 | `quizErrorCounts` / `isQuizModeRecovered` / `buildWordWeakSignals` | ✅ 信号真实 |
| 结构化处置建议 | 推荐联合类型和优先级只有拼写、中译英 | `SprintTreatmentRecommendation` / `buildSprintTreatmentRecommendation` | ❌ 未接辨析 |
| 冲刺入口路由 | 有前两类建议才直达 Quiz；仅辨析薄弱时回退通用 `WordCard` | `page.tsx#startSprintSession` | ❌ 处置错配 |
| 实际训练模式 | `QuizView` 已真实支持 `meaning-choice` 四选一 | `buildQuizQuestions` / `QuizView#submitAnswer` | ✅ 组件可复用 |
| 题干与选项 | 多义词问未熟义项，单义词按释义选英文；答案来自目标词，干扰项来自全部已学词并去重 | `buildMeaningQuestion` / `distinctOptions` | ✅ 已具备 |
| 候选弱词限定 | `candidateWordIds` 只限制目标词，全部已学词仍供干扰项；但辨析没有上游候选 | `buildQuizQuestions` / `restoreQuizQuestions` | ❌ 辨析无上游 |
| 结果与归因 | 每次作答写真实 `mode/correct/recallMs`；每日首次有效结果才写排程，`sprint:*` 原样进入 review | `recordQuizResult` / `shouldApplyQuizToSchedule` | ✅ 已具备 |
| 淡出与复发 | 最近两次同模式正确后淡出；新同模式错误中断恢复并重现，其他维度不受影响 | `isQuizModeRecovered` / `buildWordWeakSignals` | ✅ 已具备 |
| 多维优先级 | 拼写 → 中译英 → 通用，缺辨析第三级 | `buildSprintTreatmentRecommendation` | ❌ 优先级断在第三级 |

只读结论：断点只在结构化推荐层。第 29 轮唯一目标选择“拼写 → 中译英 → 辨析 → 通用”，复用现有训练、候选、回流、恢复和冲刺归因，不改题目或干扰项算法。

## 第 29 轮实施后目标行

| 薄弱维度 | 信号来源 | 当前入口 | 实际训练方式 | 结果写入位置 | 降级规则 | 复发规则 | 状态 |
|---|---|---|---|---|---|---|---|
| 辨析错 | 结构化读取未恢复的 `meaning-choice` 错误；不解析标签或按钮文案 | 考前薄弱冲刺；拼写、中译英恢复后辨析接管 | 只限定当前辨析薄弱目标词，直达现有释义选择；干扰项仍来自全部已学词 | 每次作答写 `quizAttempts.mode=meaning-choice`；首次有效作答按既有门禁写 `reviews/wordProgress` 并沿用 `sprint:*` | 最近两次同模式正确后退出辨析建议与统一画像；其他维度保持 | 再次同模式答错后，辨析标签、建议与入口重现；高优先级复发可重新抢占 | ✅ 已形成维度闭环 |

专项 review 继续被冲刺时间线、历史、成效与复发统计感知。本轮未新增 schema，未修改答案判定、干扰项、评分、FSRS 排程、备份或普通测验语义。

## 第 30 轮只读复核

> 复核基线：`2c9c466`。分支仅有用户文件 `1.txt` 未跟踪，固定端口 3000 无监听；以下结论在修改前取得。

| 核对项 | 当前实现 | 代码证据 | 是否闭环 |
|---|---|---|---|
| 查词信号与关联 | `lookupStats.count/firstAt/lastAt` 经 `lookupWords.query` 和 `learningWordId` 关联学习项 | `lookupStatByWordId` / `useSelectionLookup#recordLookup` | ✅ 信号真实 |
| 当前处置入口 | 三类 Quiz 专项之后回退通用冲刺，没有查词结构化模式 | `buildSprintTreatmentRecommendation` / `startSprintSession` | ❌ 处置未分型 |
| 主动回忆训练 | `WordCard` 初始隐藏释义，点击揭示后才开放四档评分 | `startSession` / `WordCard` / `RatingBar` | ✅ 组件可复用 |
| 结果与降级 | `rateWord` 写真实 `reviews/wordProgress/recallMs/sessionId`；`lastRating≥2 && lastReviewedAt≥lastAt` 时降级 | `rateWord` / `isLookupDemoted` | ✅ 已具备 |
| 失败与复发 | 未揭示不产生评分；0/1 不降级；真实再次划词才增加 `count` 并刷新 `lastAt` | `rateWord` / `recordLookup` | ✅ 已具备 |
| 会话刷新 | `activeSession` 已持久化，但归一化允许列表遗漏 `sprint`；分域 settings 也遗漏既有 `lookupStats` | `normalizeSession` / `splitStoredState` | ❌ 刷新断链 |
| 多维优先级 | 拼写 → 中译英 → 辨析 → 通用；FSRS 弱进度应继续走排程型通用复习 | 推荐优先级 / `isWeakProgress` | ❌ 缺查词层 |

只读结论：现有 WordCard、评分、降级与真实查词源足以闭环；断点是推荐路由和两个既有字段的持久化/归一化映射。第 30 轮只处理稳定进度中的查词薄弱，FSRS 弱进度继续走通用排程，避免查词专项改变 lapse 处置。

## 第 30 轮实施后目标行

| 薄弱维度 | 信号来源 | 当前入口 | 实际训练方式 | 结果写入位置 | 降级规则 | 复发规则 | 状态 |
|---|---|---|---|---|---|---|---|
| 查词频繁 | 结构化读取达到阈值、未被 `isLookupDemoted` 覆盖且无 FSRS 弱进度的查词词；不解析文案 | 考前薄弱冲刺；三类 Quiz 恢复后由 `lookup-recall` 接管 | 仅限本维候选，启动现有 `sprint` WordCard；初始隐藏释义，揭示后四档评分 | `rateWord` 写真实 `reviews/wordProgress/recallMs` 并保留 `sprint:*`；训练不写 `lookupStats` | 既有 `lastRating≥2 && lastReviewedAt≥lastAt` 后仅查词维度淡出 | 后续真实划词增加 count、更新 lastAt，标签与专项重新出现 | ✅ 已形成维度闭环 |

本轮同时让既有 `lookupStats` 随 settings 分域持久化，并让 `sprint` 会话通过既有 `StudySession` 归一化，未新增 schema/version。冲刺 review 继续进入时间线、历史与成效统计；评分、FSRS、备份和普通入口未改。

## 第 31 轮只读复核

> 复核基线：`a038d48`。分支仅有用户文件 `1.txt` 未跟踪，固定端口 3000 无监听、无 PID/本轮日志；以下结论在修改前取得。

| 核对项 | 当前实现 | 代码证据 | 是否可闭环 |
|---|---|---|---|
| 顽固触发与恢复 | `reviews` 30 天窗口内 3 次 0 或 5 次 ≤1 激活；任一低评分清零，连续 3 条 ≥2 恢复，末次低评 30 天后自然退出 | `rebuildStubbornWords` | ✅ 真实 review 可闭环 |
| 自动/存量记录合并 | 状态归一化与页面都用重建记录覆盖存量同词记录；自动结果不另写阶段字段 | `normalizeStoredState` / `page.tsx#stubbornWords` | ✅ 可兼容 |
| 词本与统一入口 | 词本顽固专项打开通用 WordCard；统一冲刺在前四级无建议时也回退通用卡 | `startStubbornSession` / `startSprintSession` | ❌ 无多模式路由 |
| 低评分强化 | WordCard 的 0/1 先要求一次听写强化，完成后仍只按用户原评分写一条 review | `rateWord` / `reinforcementRating` | ✅ 不伪造成功 |
| 可复用模式 | WordCard 主动回忆、听音拼写、中译英均可限定候选；`meaning-choice` 还要求至少 4 个可用已学词/唯一干扰项 | `WordCard` / `buildQuizQuestions` / `buildMeaningQuestion` | ✅ 前三者稳定可用 |
| 结果与门禁 | WordCard 评分直接写真实 review；Quiz 每次写 attempt，但仅每日首次有效作答写 review/排程 | `rateWord` / `recordQuizResult` / `shouldApplyQuizToSchedule` | ✅ 职责明确 |
| 阶段归因 | 修改前无顽固阶段；但 `reviews` 尾部连续成功数足以纯派生 0/1/2 阶段 | `rebuildStubbornWords` 的 `successStreak` | ❌ 缺结构化派生 |
| 恢复、重置、复发 | 三条真实成功 review 淡出；低评分中断；恢复后窗口内新低评可按既有计数重新激活 | `rebuildStubbornWords` | ✅ 已具备 |
| 冲刺时间线与成效 | 任何 `sessionId.startsWith("sprint:")` 的 review 都进入时间线/成效；历史列表修改前只接受冒号后直接 ISO | `buildWordSignalTimeline` / `buildSprintEffectiveness` / `buildSprintHistory` | ⚠️ 需兼容结构化时间 |
| 刷新恢复 | `activeSession`、`activeQuiz` 已持久化；Quiz 候选需按会话开始时刻重建，避免作答后阶段变化导致题组漂移 | settings 分域 / `restoreQuizQuestions` | ⚠️ 需固定启动时候选 |

只读结论：无需新增 schema 即可把“最近低评分后的连续成功 review 数”作为真实阶段源。同日仅新增 attempt、未写 review 时阶段不会推进。由于 `meaning-choice` 的最低已学词与干扰项约束无法保证所有顽固词可训练，最小可靠序列选择“主动回忆 WordCard → 听音拼写 → 中译英”；统一入口保持前三类 Quiz → 查词 → 顽固 → 通用，词本入口直接复用同一顽固推荐。

## 第 31 轮实施后目标行

| 薄弱维度 | 信号来源 | 当前入口 | 实际训练方式 | 结果写入位置 | 降级规则 | 复发规则 | 状态 |
|---|---|---|---|---|---|---|---|
| 顽固词 | 继续由 `rebuildStubbornWords(reviews)` 触发；阶段按触发后尾部真实成功 review 数纯派生，不解析文案 | 前四级恢复后接管统一冲刺；词本顽固专项复用同一结构化推荐 | 阶段 0 主动回忆 WordCard，阶段 1 听音拼写，阶段 2 中译英；不同阶段词分组，本次只训练一组 | WordCard 写 `reviews/wordProgress/recallMs`；Quiz 每次写 `quizAttempts`，仅既有门禁允许时写 review；均用 `sprint:stubborn:<mode>:<ISO>` | 只有真实 review 推进；连续 3 条 ≥2 后由既有重建规则淡出，同日被门禁拦截的 attempt 不推进 | 任一低评分重置阶段并保持 active；恢复后按既有 30 天低评分窗口重新激活 | ✅ 已形成维度闭环 |

结构化 sessionId 未改变 ReviewEvent schema，旧/非法记录安全回退起始阶段；历史解析兼容内嵌模式后的 ISO，时间线与成效仍按 `sprint:*` 感知。刷新时用 session 开始时刻重建原候选组。评分、FSRS、每日门禁、备份、package scripts 和前三类 Quiz/查词处置均未修改。

## 第 32 轮持久化收敛审计

完整矩阵见 `dimension-treatment-closure.md`。只读往返实测发现 settings 分域遗漏 `weakThresholds`、`guessMistakes`、`senseFrequency`、`hideChineseMeaning`、`guessContextFirst`：前两者会直接造成统一画像事实和判定口径刷新后丢失。本轮只补齐这一组既有字段的分域投影，不新增 schema/version；真实浏览器完成“写盘 → 刷新 hydrate → 改阈值再写盘 → 再刷新”验证。

结论 C：字段丢失已修复；普通专项 activeQuiz 作答后刷新仍可能按当前推荐重算出不同候选，下一轮单独处理。猜错继续为“➖ 当前约束下不可闭环：只有累计次数，无真实事件时间、恢复或复发数据源”。

## 第 33 轮 activeQuiz 题组快照审计

> 只读基线：`84f627e`。分支仅有用户文件 `1.txt` 未跟踪，固定端口 3000 无监听、无 PID/本轮日志；以下漂移证据均在修改前取得。

| 核对项 | 修改前真实数据流 | 断链 | 修复后 |
|---|---|---|---|
| mode / seed / startedAt | `QuizSessionState` 与 normalize 已保留 | 无 | 保持 |
| index / answers / correctCount | 保存旧题进度 | 题组变化后可指向另一题或孤立 questionId | 与原题组共同恢复 |
| 普通 Quiz | 同 seed + 当前全部已学词与 progress | 作答改变优先级后换序 | 按实际题目 ID 快照 |
| sprint 专项 | 同 seed + 当前 `sprintTreatment.wordIds` | 首题恢复后当前候选缩减或切换维度 | 快照优先于当前推荐 |
| 顽固专项 | startedAt 重建阶段候选 + 当前 progress 排序 | 候选仍可能换序，meaning-choice 选项随 index 漂移 | 保留原目标顺序和 seed 偏移 |
| 旧/非法会话 | 无启动题组证据 | 无法精确逆推 | 无快照安全回退；非法 ID 清洗；正常写盘自愈 |
| meaning-choice | 目标和干扰项都由当前已学词构建 | 不得把快照误作干扰项池 | 仅目标受快照限制，干扰项仍来自全部已学词 |

同 seed `330033` 的修改前实测：普通中译英 `[1,3,2,5,4] → [1,2,3,5,4]`；sprint `[1,2] → [2]`；顽固辨析 `[1,2] → [2,1]` 且同词选项顺序变化。现有字段不能精确恢复，因此本轮唯一方案是在 `QuizSessionState` 增加向后兼容可选 `questionWordIds`，只保存实际题目目标 ID 有序快照。

修复后普通、sprint、顽固共用同一恢复路径；快照去重、限长并过滤非法/未学习/删除 ID，剩余题保留原 seed 偏移。新会话与“再来一组”生成独立快照；旧会话回退后由正常写盘补齐。未保存完整题目、答案或选项，未新增 IndexedDB store/domain，未提升 schema/version，未改评分、FSRS、每日门禁、恢复规则、备份或猜错。

结论 A：七个可实现薄弱维度、分域持久化及未完成会话刷新均已收敛。项目进入稳定维护和真实学习成效验证阶段；猜错继续为“➖ 当前约束下不可闭环：只有累计次数，无真实事件时间、恢复或复发数据源”。
