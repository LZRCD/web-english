# 咬合验证表（occlusion table）

> 以第 0 轮对前 18 轮的核对为基线，并持续记录第 19~33 轮修复。状态：✅ 已验证咬合 / ❌ 断链 / ⚠️ 存疑。
> 当前 21 项全部为 ✅；维度化处置审计另见 `dimension-treatment-audit.md`，其中“猜错”仍没有可靠事件时间源。只读子代理产出初版，后续轮次仅更新状态与修复证据。

| # | 联动检查项 | 关键代码位置 | 状态 | 断链说明（在哪一步断：数据流/UI/判定） | 修复轮次 |
|---|---|---|---|---|---|
| 1 | 答对 → 薄弱降级（查词标签淡出） | `buildWordWeakSignals` / `isLookupDemoted`；薄弱降级三态测试 | ✅ 已验证咬合 | 查词薄弱达到正确复习条件后实时淡出。 | 17（既有实现） |
| 2 | 处置 → 感知更新（冲刺/集中区后薄弱标签刷新） | `rateWord` → `setReviews` / `setWordProgress` → `weakSignalInput` / `buildWeakProfiles`；`buildSprintCompletionSummary` | ✅ 已验证咬合 | 处置结果写回 state 后，薄弱画像与冲刺总结实时重算。 | 既有实现 |
| 3 | 复发 → 回到处置（复发词可再冲刺） | `buildSprintRelapse` → `startSprintFromRelapse` → `HistoryView`；复发再冲刺测试 | ✅ 已验证咬合 | 复发词可从历史视图重新进入冲刺。 | 既有实现 |
| 4 | 复习 → 时间线记录（学习动作进时间线） | `rateWord` / `buildWordSignalTimeline`；四档评分与去重排序测试 | ✅ 已验证咬合 | 所有 review 动作均按 `reviewedAt` 进入时间线：`rating=0` 复用既有遗忘事件，1~3 显示“模糊/认识/熟练”，冲刺沿用 session 标记；相同 review ID 不重复，慢回忆等既有信号事件保留。 | 21 |
| 5 | 冲刺 → 成效反映（冲刺后成效 4 周/维度归因更新） | review `sessionId` → `buildSprintEffectiveness` / `buildSprintEffectivenessSeries` → `HistoryView` | ✅ 已验证咬合 | 冲刺复习带 sessionId，成效聚合与 4 周序列实时派生并展示。 | 既有实现 |
| 6 | 插队/补漏 → 学习卡感知（一键补漏词即时显示薄弱） | `lookupPriorityWordIds` / `buildTodayQueue` / `startTodayWithCurrent` → `WordCard` | ✅ 已验证咬合 | 插队与补漏词进入学习卡后可显示全态薄弱标签；现有 E2E 已覆盖按钮后的标签展示。 | 既有实现 |
| 7 | 全态标签 → 各入口一致（学习卡/词本/词书/集中度/复发判定同一派生） | `buildWordWeakSignals` / `buildWeakProfiles`；`weakSignalsByWordId`；`lookupWeakCandidateIds`；`buildSprintWordIds` | ✅ 已验证咬合 | 词书、划词候选、冲刺候选均消费统一实时画像；纯查词降级词退出各入口，仍有其他薄弱信号时继续保留。 | 19 |
| 8 | 薄弱→稳定转换可感知（「已稳定」提示） | `currentStabilizedDimensions` / `buildWordStabilizedDimensions` / `page.tsx` | ✅ 已验证咬合 | 稳定提示复用统一结构化派生；查词仍须达到当前薄弱阈值并满足既有降级条件，阈值变化实时生效，单维文案语义保持。 | 20、25 |

## 追加检查项（第 0 轮子代理发现的其他联动）

| # | 联动检查项 | 关键代码位置 | 状态 | 断链说明 | 修复轮次 |
|---|---|---|---|---|---|
| 9 | 设置阈值 → 划词候选口径同步 | `lookupWeakCandidateIds(input, thresholds)` → `WordbookView` | ✅ 已验证咬合 | 划词候选由页面统一派生后传入词本，实时跟随设置阈值并剔除无其他信号的已降级词。 | 19 |
| 10 | 答对/恢复 → lapse 标签降级 → 再次遗忘回到处置 | `applyRating` / `isWeakProgress` → `buildWordWeakSignals` → 统一画像各入口 | ✅ 已验证咬合 | 遗忘词仍弱时保留历史 lapse 标签；连续成功达到既有恢复条件后标签淡出；再次评分 0 后重新转弱，标签与统一画像、词书、冲刺及复发入口同步恢复。 | 22 |
| 11 | 快速回忆 → 慢回忆标签降级 → 再次变慢回到处置 | 带 `recallMs` 的 review / 当前 `slowRecallMs` → `buildWordWeakSignals` → 统一画像各入口 | ✅ 已验证咬合 | 历史慢回忆后，最近连续两次均为有测时、评分 2/3 且低于当前阈值时，当前慢回忆标签淡出；无测时或低评分不充当快速恢复，再次慢回忆立即恢复历史累计标签。历史 review、时间线、回忆统计与周趋势不删除、不改写。 | 23 |
| 12 | 同模式连续答对 → 测验标签降级 → 再次答错回到处置 | `quizAttempts` 的 `answeredAt` / `correct` / `mode` → `buildWordWeakSignals` → 统一画像各入口 | ✅ 已验证咬合 | 拼写、中译英、辨析分别按稳定时间顺序判断；最近连续两次同模式正确后当前标签淡出，跨模式正确不替代，再次同模式答错立即恢复历史累计错次标签。历史 attempt、时间线与周统计不删除、不改写。 | 24 |
| 13 | 非查词薄弱恢复 → 统一「已稳定」反馈 | lapse / 慢回忆 / 三类测验既有恢复派生 → `buildWordStabilizedDimensions` → `WordCard` | ✅ 已验证咬合 | 仅有真实历史弱点、满足对应既有恢复条件且当前统一画像完全清零时输出结构化维度；多维合并展示，任一当前弱点或复发都会撤回。猜错因无恢复规则明确排除。 | 25 |
| 14 | 4 周窗口内最近达标处置周 → 截至当前仍薄弱率 | 冲刺 review 周 cohort → `buildSprintRelapseSeries` / `buildWordWeakSignals` → `HistoryView` | ✅ 已验证咬合 | 最近 4 个完整本地周收集冲刺 `rating≥2` 的当场达标词；同词只归该窗口内最近一次达标处置周，再以当前统一画像判断截至当前仍薄弱。UI 明示不区分从未恢复与恢复后再次薄弱，不伪造历史复发事件。 | 26、34 |
| 15 | 拼写薄弱 → 听音拼写 → 同维结果回流 | `buildSprintTreatmentRecommendation` → `QuizView` listening-spelling → `quizAttempts` / sprint review | ✅ 已验证咬合 | 冲刺入口对未恢复拼写错误优先启动听音拼写并限定候选；同模式两次正确后退出，答错后重现；首次有效结果沿用 sprint sessionId 进入成效归因，其他维度不被降级。 | 27 |
| 16 | 中译英薄弱 → 中文提示输出英文 → 同维结果回流 | 结构化推荐优先级 → `QuizView` chinese-to-english → `quizAttempts` / sprint review | ✅ 已验证咬合 | 拼写专项优先；拼写恢复后，未恢复中译英错误接管冲刺并限定候选。每次结果回流同模式记录，两次正确淡出、再错复发；首次有效结果保留 sprint sessionId，辨析等其他维度不被降级。 | 28 |
| 17 | 辨析薄弱 → 释义选择 → 同维结果回流 | 结构化推荐优先级 → `QuizView` meaning-choice → `quizAttempts` / sprint review | ✅ 已验证咬合 | 拼写、中译英恢复后，未恢复辨析错误接管冲刺；只限定目标弱词，干扰项仍来自全部已学词。两次正确淡出、再错复发，高优先级维度复发后重新抢占，首次有效结果保留 sprint sessionId。 | 29 |
| 18 | 查词薄弱 → 主动回忆 → 同维恢复与真实查词复发 | `lookupStats` / `isLookupDemoted` → `lookup-recall` → WordCard review / `recordLookup` | ✅ 已验证咬合 | 三类 Quiz 恢复后，稳定进度的未降级查词词进入现有主动回忆卡；评分写真实 review、耗时和 sprint sessionId，成功后查词维度淡出，后续真实划词更新 lastAt 后复发。FSRS 弱进度继续走通用排程。 | 30 |
| 19 | 顽固词 → 多模式强化 → 真实 review 恢复与低评复发 | `rebuildStubbornWords` → 结构化顽固推荐 → WordCard / QuizView → reviews | ✅ 已验证咬合 | 前四级恢复后顽固词接管统一冲刺，词本入口复用同一推荐；按真实 review 阶段分组进入主动回忆、听音拼写、中译英。同日仅 attempt 不推进，三条成功 review 淡出，低评分重置并按既有窗口复发；结构化 sprint session 进入历史与成效。 | 31 |
| 20 | 维度事实/阈值 → 分域持久化 → 刷新后画像与推荐保持 | `persistedState` → `splitStoredState` / `combineStoredState` → `normalizeStoredState` → hydrate | ✅ 已验证咬合 | settings 分域补齐既有阈值、猜错累计、义项频率和两项显示设置；真实刷新与再次写盘后不丢失，不新增 schema/version。 | 32 |
| 21 | activeQuiz 启动题组 → 作答改变画像 → 刷新后原题组与进度保持 | `QuizView` 实际 questions → `questionWordIds` → `normalizeQuizSession` → `restoreQuizQuestions` | ✅ 已验证咬合 | 有序目标 ID 快照优先于刷新后的实时推荐和优先级；普通、sprint、顽固会话保持模式、题序、位置、答案、正确数和 sessionId，meaning-choice 干扰项仍来自全部已学词；旧会话安全回退后自愈。 | 33 |

## 缺口清单（从第 0 轮报告 ⑥ 同步，后续轮次目标池）

- [x] 划词候选跟随设置页阈值，并剔除无其他薄弱信号的已降级词。（第 19 轮）
- [x] 普通复习已按四档评分语义进入时间线。（第 21 轮）
- [ ] “猜错”仍只有 `guessMistakes` 累计次数，没有可靠事件时间；不伪造时间、不新增持久化 schema，待未来有真实时间源后再接入。
- [x] 非查词类 lapse、慢回忆与三类测验恢复后进入统一“已稳定”反馈，并支持多维合并。（第 25 轮）
- [x] 冲刺入口仅包含统一薄弱画像非空的已学词。（第 19 轮）
- [x] FSRS lapse 标签不再因历史计数永久保留；恢复后淡出，再次遗忘后重现。（第 22 轮）
- [x] 慢回忆标签不再因历史慢样本永久保留；连续两次可靠快速回忆后淡出，再次变慢后重现。（第 23 轮）
- [x] 三类测验标签不再因历史答错永久保留；同模式连续两次正确后淡出，再次答错后重现。（第 24 轮）
- [x] 最近 4 个冲刺处置周已按同词最近一次达标周去重，并改为截至当前仍薄弱率；空周与 0% 语义明确区分，不声称历史复发。（第 26、34 轮）
- [x] 拼写测验薄弱已从统一冲刺入口进入听音拼写，并让结果回到同模式恢复/复发与冲刺归因。（第 27 轮）
- [x] 中译英薄弱已在拼写恢复后接管统一冲刺，进入中文提示输出英文，并回到同模式恢复/复发与冲刺归因。（第 28 轮）
- [x] 辨析薄弱已在拼写、中译英恢复后接管统一冲刺，进入 `meaning-choice`，并回到同模式恢复/复发与冲刺归因。（第 29 轮）
- [x] 查词频繁已在三类 Quiz 恢复后进入 `lookup-recall` 主动回忆，结果回到既有查词降级规则，真实再次划词可复发。（第 30 轮）
- [x] 顽固词已按真实 review 阶段进入主动回忆、听音拼写和中译英；连续三次成功淡出，低评分重置并按既有窗口复发。（第 31 轮）
- [x] `weakThresholds`、`guessMistakes` 等既有 settings 字段已完成 IndexedDB 分域往返，刷新和再次写盘不再丢失。（第 32 轮）
- [x] 普通、sprint 与顽固 activeQuiz 已持久化实际题目目标 ID 有序快照；作答改变推荐后刷新仍恢复原题组、位置、答案与归因，旧会话安全回退后自愈。（第 33 轮）
