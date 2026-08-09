# 自适应推荐可行性评估

日期：2026-08-09
审计基线：`a07e81d4acc20b6af086ab7eea8d47703c253f2b`
性质：阶段 E 只读设计评估；不实现、不改推荐。

## 唯一结论

选择终局 **B：当前不具备数据/产品门槛**。

- 现有代码能诚实记录部分未来处置维度，并能并列观察活动、后续保持、实际随访间隔和当前仍薄弱；这些能力证明“可以观察”，不证明“可以据此改变推荐”。
- `slow-recall`、`lapse` 目前只有枚举与解析能力，真实通用入口仍写 `generic-sprint`；因此“各维度有真实结构化归因”并未满足。
- 真实生产历史位于用户浏览器 IndexedDB。本轮按 Prompt 禁止读取该库，用户也未提供只读导出；仓库 fixture、单测与 E2E seed 只能证明算法和展示行为，不能证明现实样本量。
- 产品没有预先批准“足够样本”、最低覆盖率、随访区间或稳健性标准；不同模式又受固定优先级、用户选择、候选条件和不同随访间隔影响，当前不能解释为模式差异。
- 当前没有自适应规则的回退机制，也没有“关闭自适应推荐并恢复固定默认”的用户控制。

因此继续维持固定优先级，不给权重、阈值、排名、模式胜负或自适应实施草案；下一轮转阶段 F 发布准备只读审计。

## 当前固定推荐调用图

```text
IndexedDB/页面状态
  -> WeakSignalInput
     lookupStats / lookupWords / guessMistakes / quizAttempts
     reviews / stubbornWords / wordProgress
  -> buildSprintWordIds（当前薄弱候选）
  -> buildSprintTreatmentRecommendation
     1. 未恢复 listening-spelling 错误 -> 听音拼写
     2. 未恢复 chinese-to-english 错误 -> 中译英
     3. 未恢复 meaning-choice 错误 -> 释义辨析
     4. 达到查词阈值、未降级且非 FSRS 弱进度 -> 划词主动回忆
     5. buildStubbornTreatmentRecommendation -> 顽固多模式
     6. 无专项命中（调用端 fallback） -> 通用冲刺
  -> activeQuiz 或 activeSession
  -> applyRating -> reviews / wordProgress
  -> IndexedDB 分域持久化
```

固定优先级必须原样保持：

`听音拼写 -> 中译英 -> 释义辨析 -> 划词主动回忆 -> 顽固多模式 -> 通用冲刺`

### 恢复与复发边界

- 三类 Quiz：真实 `quizAttempts.mode/correct/answeredAt` 中最近两次同模式有效作答均正确才视为恢复；新的同模式错误会打断恢复并让该维重新进入固定优先级。无效时间的错误保守保留薄弱状态。
- 划词主动回忆：查询次数达到阈值、且最近成功评分尚未覆盖最后查询时才推荐；成功评分时间覆盖 `lookupStats.lastAt` 后降级，之后真实再次划词更新 `lastAt` 才重新进入。
- 顽固多模式：只按真实 review 触发与尾部成功序列派生阶段；按主动回忆、听音拼写、中译英的固定子序列推进。Quiz attempt 若未通过每日首次写盘门禁，不会伪装成 review 推进阶段。
- `slow-recall`、`lapse` 与猜错等无法在启动时证明完整词集为单一处置维度的入口继续走 `generic-sprint`；不从中文标签或当前画像反推维度。

## 结构化归因与持久化链

- `createTreatmentSprintSessionId` 只为未来会话写 `sprint:treatment:<dimension>:<ISO>`；`unknown` 只能由解析产生。
- `parseSprintSessionId` 是新 treatment、旧普通和顽固格式的统一解析器：旧 `sprint:<ISO>`、未知 treatment、非法顽固 mode 或非法时间安全落到 `unknown`；合法顽固只归主维 `stubborn`，子 mode 单独披露。
- 三类 Quiz 和查词专项从真实结构化推荐写入明确维度；顽固保留 `sprint:stubborn:<mode>:<ISO>`；通用、限定、补漏、当前仍薄弱再冲刺和历史复跑写 `generic-sprint`。
- `activeSession.id`、`activeQuiz.id/questionWordIds` 和 `reviews[].sessionId` 原样走现有 `StoredState` 与 IndexedDB 分域；`rateWord` 和 `recordQuizResult` 把冲刺 id 原样传入 `applyRating`。
- Quiz 每词每日首次有效作答才写 review/FSRS；其余作答只写 `quizAttempts`。因此 attempt 活动量与 review 随访样本不是同一分母。

## 后续保持与分维观察边界

### `buildSprintRetentionSeries`

- 窗口是当前本地周一之前最近 4 个完整周；每词只选窗口内 `(reviewedAtMs,id)` 总序最近的 `rating>=2` 冲刺为唯一成功锚点。
- 锚点后的首条同词 review 若仍是任意 `sprint:*`，旧观察立即截断；否则首条非 sprint review（含 `quiz:*` 与无 sessionId 旧 review）才是随访。`quizAttempts` 不参与。
- 覆盖率分母是成功锚点 cohort；保持率分母只含已观察词；未观察和截断不算失败。
- 实际随访间隔按已观察词等权；配对测时只纳入锚点与随访两侧都有合法 `recallMs` 的同词，分母独立，无样本返回 `null`。

### `buildDimensionObservationReport`

- 先在全局为每词选择唯一成功锚点，再按锚点 `sessionId` 的 parser 结果分维；不能先分组再各选锚点。
- 固定并列 8 个 treatment 维和 `unknown`，不按数量或结果排序。`generic-sprint` 与 `unknown` 分列，顽固子 mode 不扁平到普通专项。
- 活动口径的覆盖词/当场达标词允许同词跨维重复，只能维内去重、不可跨维相加；锚点 cohort、随访、保持、配对测时与当前仍薄弱按每词唯一归属。
- 活动、当场达标、后续保持、配对测时、当前仍薄弱各有独立分母；报告明确是用户选择与固定推荐下的观察，不代表模式效果、因果、最佳/最差或推荐依据。

## 真实生产样本可获得性

| 来源 | 本轮可用性 | 能证明 | 不能证明 |
|---|---|---|---|
| 仓库单测 fixture | 可读；未机械重跑 | parser、锚点、截断、分母、null/真实 0 和固定优先级的算法行为 | 用户现实样本量、覆盖率、模式差异或长期稳健性 |
| E2E seed | 可读；本轮未启动浏览器 | 真实入口、刷新写盘和 UI 披露在确定性 seed 下可闭环 | seed 是生产历史、样本已足够或结果可推广 |
| 浏览器 IndexedDB | 生产历史所在；本轮按 Prompt 不读取 | 若以后经用户授权，可由 `reviews/quizAttempts/settings` 形成只读样本快照 | 本轮任何现实样本数量或分维分布 |
| 用户备份导出 | 代码支持完整 `StoredState` 导出；本轮未提供文件 | 以后可在不触碰在线浏览器状态时做只读统计 | 当前用户已有多少真实 treatment、随访或配对样本 |
| 历史轮次文档 | 可读 | 算法/E2E 在当时 checkpoint 的验证状态 | 当前生产数据、当前测试重跑结果或现实门槛已满足 |

本轮真实生产样本量结论：**不可获得**。不得以 fixture、seed、历史测试数字或纯代码能力替代。

## E2 八门槛矩阵

| 门槛 | 现有证据与路径 | 真实样本状态 | 能证明 | 不能证明 | 状态 | 解除条件 |
|---|---|---|---|---|---|---|
| 1. 各维度有真实结构化归因 | `createTreatmentSprintSessionId` / `parseSprintSessionId`；三类 Quiz、lookup、stubborn 与 generic 入口；`activeSession/activeQuiz -> review -> IndexedDB` | 未提供生产导出；且 slow-recall/lapse 真实入口仍写 generic | 新未来 id、旧 unknown、顽固子 mode 与 generic 可诚实区分 | slow-recall/lapse 已产生单维真实处置记录；所有维度在生产中都有样本 | **未满足** | 仅在启动当下能由结构化事实证明完整词集单维时写入真实维度并取得生产记录；不能证明时继续 generic，不得猜测 |
| 2. 有足够后续正常复习样本 | `buildSprintRetentionSeries` 与分维 cohort/随访样本数 | IndexedDB 未读、无导出；“足够”没有批准阈值 | 算法能区分已观察、未观察、截断与配对测时 | 当前样本量足够、每维足够或结论稳健 | **当前不可证明** | 用户先批准最低样本量、最低每维已观察数和稳健性规则，再用只读生产导出核验 |
| 3. 随访覆盖率透明 | `followedUpCount/cohortWordCount`、`coverageRate`、`unobservedCount`、`truncatedCount`、`followUpDelayMs`；HistoryView 明示未观察不算失败 | 本轮无现实数值，但字段和 UI 已存在 | 任意可用样本的覆盖率、未观察、截断和实际平均间隔可透明披露 | 覆盖率已经足够或不同维可比 | **已满足** | 保持现有分子/分母/null 语义；任何未来评估仍须同时披露现实样本数与间隔 |
| 4. 不同模式样本差异可解释 | 固定优先级、用户选择、模式候选条件、Quiz 每日写 review 门禁、分维实际随访间隔 | 无生产样本，亦无批准的可比性标准 | 已知存在选择偏差、入口差异和随访间隔差异 | 观察差异来自训练模式、可用于权重或胜负判断 | **当前不可证明** | 产品批准可比性标准；按真实入口、优先级位置、样本量和随访区间分层，仍只作观察性解释 |
| 5. 规则可回退 | 当前固定推荐与 generic fallback 都是硬编码纯派生；不存在自适应层、版本或回退状态 | 不适用 | 当前固定优先级可作为未来默认基线 | 新规则失败后可一键/自动恢复默认，或已记录回退原因 | **未满足** | 经用户另行批准后，先定义透明规则版本、固定默认和可验证回退契约；本轮不设计或实现 |
| 6. 不改 FSRS | 推荐纯函数只选训练入口；`applyRating` 和 `shouldApplyQuizToSchedule` 继续控制既有评分/排程 | 代码边界可读；无需生产样本证明职责分离 | 当前固定推荐不修改 FSRS 参数、评分或排程规则 | 未来未实现代码一定不会越界 | **已满足** | 任何获批方案必须继续只选择训练入口，并以 diff/测试证明 FSRS 与评分零改动 |
| 7. 用户可以关闭 | 设置中只有“自适应新词量”等其他功能开关；不存在自适应冲刺推荐开关、默认恢复或关闭后的固定优先级契约 | 不适用 | 当前没有隐藏的关闭能力 | 用户能关闭尚不存在的自适应推荐并恢复默认 | **未满足** | 经用户批准产品行为后提供明确关闭与恢复固定默认的契约和行为测试；本轮不改 UI |
| 8. 不需要伪造历史数据 | parser 把旧普通/未知/非法格式归 `unknown`；generic 单列；随访无样本为 null，未观察不算失败 | 生产量未知，但数据纪律已由代码和测试定义 | 无需回填旧历史即可继续积累未来真实归因；缺失样本可诚实为空 | 历史 unknown 的真实处置维度 | **已满足** | 永久保持 unknown/generic 分离，不回填、不用标签或当前推荐反推历史 |

## 不可比性与风险清单

- 固定优先级令低优先级模式天然出现在高优先级维度已恢复或缺席的词上，组间不是随机、同质样本。
- 用户可从统一冲刺、分册/单元、完成页补漏、当前仍薄弱和历史复跑等入口主动选择，处置选择与词难度、时间压力相关。
- Quiz attempt 每次记录，但每日门禁可能不写 review；WordCard 评分直接写 review，两个训练家族的活动量和可随访机会不同。
- 随访由真实学习与 FSRS 到期行为发生，不是固定实验时点；即使报告平均间隔，也不能把 5 分钟与 7 天样本当成同一效果证据。
- 猜错只有累计次数，无真实事件时间、恢复或复发源，不能进入时序自适应。
- slow-recall/lapse 当前没有不复制画像规则的启动级唯一判定，不能为了提高覆盖率伪造单维归因。
- 分维报告展示的是相关观察；没有对照、随机化或批准的稳健性标准，禁止因果、排名和“最佳/最差”结论。

## 阶段交接

- 阶段 E 停止在可行性报告，不修改推荐行为。
- 不生成待实施自适应 Prompt，不输出权重、阈值或规则草案。
- 下一轮进入阶段 F“发布准备只读审计”，只建立发布缺口清单；备份链路、schema/version/store/domain、评分、FSRS 和 package scripts 仍不自动修改。
