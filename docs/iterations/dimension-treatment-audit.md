# 薄弱维度 × 处置闭环审计

> 审计日期：2026-08-08 ｜ 只读基线：`6a4f725` ｜ 分支：`codex/follow-up-hardening`

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
