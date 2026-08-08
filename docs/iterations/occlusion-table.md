# 咬合验证表（occlusion table）

> 逐条核对前 18 轮功能之间的实际联动是否生效。状态：✅ 已验证咬合 / ❌ 断链 / ⚠️ 存疑。
> 每轮更新本表；断链修复后把对应行改为 ✅ 并填「修复轮次」。只读子代理产出初版。

| # | 联动检查项 | 关键代码位置 | 状态 | 断链说明（在哪一步断：数据流/UI/判定） | 修复轮次 |
|---|---|---|---|---|---|
| 1 | 答对 → 薄弱降级（查词标签淡出） | `buildWordWeakSignals` / `isLookupDemoted`；薄弱降级三态测试 | ✅ 已验证咬合 | 查词薄弱达到正确复习条件后实时淡出。 | 17（既有实现） |
| 2 | 处置 → 感知更新（冲刺/集中区后薄弱标签刷新） | `rateWord` → `setReviews` / `setWordProgress` → `weakSignalInput` / `buildWeakProfiles`；`buildSprintCompletionSummary` | ✅ 已验证咬合 | 处置结果写回 state 后，薄弱画像与冲刺总结实时重算。 | 既有实现 |
| 3 | 复发 → 回到处置（复发词可再冲刺） | `buildSprintRelapse` → `startSprintFromRelapse` → `HistoryView`；复发再冲刺测试 | ✅ 已验证咬合 | 复发词可从历史视图重新进入冲刺。 | 既有实现 |
| 4 | 复习 → 时间线记录（学习动作进时间线） | `rateWord` / `buildWordSignalTimeline`；四档评分与去重排序测试 | ✅ 已验证咬合 | 所有 review 动作均按 `reviewedAt` 进入时间线：`rating=0` 复用既有遗忘事件，1~3 显示“模糊/认识/熟练”，冲刺沿用 session 标记；相同 review ID 不重复，慢回忆等既有信号事件保留。 | 21 |
| 5 | 冲刺 → 成效反映（冲刺后成效 4 周/维度归因更新） | review `sessionId` → `buildSprintEffectiveness` / `buildSprintEffectivenessSeries` → `HistoryView` | ✅ 已验证咬合 | 冲刺复习带 sessionId，成效聚合与 4 周序列实时派生并展示。 | 既有实现 |
| 6 | 插队/补漏 → 学习卡感知（一键补漏词即时显示薄弱） | `lookupPriorityWordIds` / `buildTodayQueue` / `startTodayWithCurrent` → `WordCard` | ✅ 已验证咬合 | 插队与补漏词进入学习卡后可显示全态薄弱标签；现有 E2E 已覆盖按钮后的标签展示。 | 既有实现 |
| 7 | 全态标签 → 各入口一致（学习卡/词本/词书/集中度/复发判定同一派生） | `buildWordWeakSignals` / `buildWeakProfiles`；`weakSignalsByWordId`；`lookupWeakCandidateIds`；`buildSprintWordIds` | ✅ 已验证咬合 | 词书、划词候选、冲刺候选均消费统一实时画像；纯查词降级词退出各入口，仍有其他薄弱信号时继续保留。 | 19 |
| 8 | 薄弱→稳定转换可感知（「已稳定」提示） | `currentLookupStabilized` / `isLookupStabilized` / `isLookupDemoted` / `page.tsx` | ✅ 已验证咬合 | 稳定提示复用统一派生：查询数达到当前薄弱阈值、随后满足既有降级条件且无其他当前薄弱信号时才显示；阈值变化实时生效。 | 20 |

## 追加检查项（第 0 轮子代理发现的其他联动）

| # | 联动检查项 | 关键代码位置 | 状态 | 断链说明 | 修复轮次 |
|---|---|---|---|---|---|
| 9 | 设置阈值 → 划词候选口径同步 | `lookupWeakCandidateIds(input, thresholds)` → `WordbookView` | ✅ 已验证咬合 | 划词候选由页面统一派生后传入词本，实时跟随设置阈值并剔除无其他信号的已降级词。 | 19 |

## 缺口清单（从第 0 轮报告 ⑥ 同步，后续轮次目标池）

- [x] 划词候选跟随设置页阈值，并剔除无其他薄弱信号的已降级词。（第 19 轮）
- [x] 普通复习已按四档评分语义进入时间线。（第 21 轮）
- [ ] “猜错”仍只有 `guessMistakes` 累计次数，没有可靠事件时间；不伪造时间、不新增持久化 schema，待未来有真实时间源后再接入。
- [ ] 非查词类薄弱消除后没有正向“已稳定”反馈。
- [x] 冲刺入口仅包含统一薄弱画像非空的已学词。（第 19 轮）
