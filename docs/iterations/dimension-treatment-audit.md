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
