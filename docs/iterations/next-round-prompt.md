# 下一轮执行 Prompt：第 38 轮冲刺后首次正常复习保持

## 当前现场

- 分支：`codex/follow-up-hardening`
- 第 37 轮提交前 HEAD：`b189ab9`；第 37 轮处于待提交状态，最终 HEAD 以包含本文件的最新 Git 提交为准。
- 最新验证：定向 insights 8/8；lint、typecheck 通过；`npm test` 197/197；signal-flow E2E 16/16。
- 工作区交接目标：第 37 轮提交后仅保留用户未跟踪 `1.txt`；固定端口 3000 已释放。

## 阶段 A 结论与阶段 B 入口

- 阶段 A 已完成：冲刺活动量、当场达标、同词配对回忆观察、截至当前仍薄弱和近 7 天全局评分事件占比均已明确分子、分母、窗口、权重、空样本及不能证明的结论。
- 猜错仍只有累计次数，无真实事件时间、恢复或复发数据源；禁止无 schema 伪造，但不阻止进入阶段 B。
- 第 38 轮只建立阶段 B 的“冲刺后首次正常复习保持”观察链。必须先只读审计 B1/B2/B3 的现有数据可行性；只有 `reviews[].wordId/reviewedAt/rating/sessionId/recallMs` 足以完整证明规则时才实现，不新增 schema。

## 唯一目标

对每个在冲刺中当场达标的词，寻找该次成功冲刺之后、下一次冲刺之前的首条非 sprint review，诚实报告保持结果、随访覆盖和实际间隔；有合法测时的配对样本另报告回忆耗时变化。未随访必须保持“未观察”，不得进入失败分母。

## 只读审计顺序

1. 核对 Git 状态、分支、HEAD、最近历史、端口 3000、历史 PID，确认只有 `1.txt` 未跟踪。
2. 追踪 `ReviewEvent`、`sessionId`、冲刺识别、历史去重/排序和现有周报/轨迹消费者；确认普通 review 能由“非 `sprint:*`”稳定识别，`quizAttempts` 不参与。
3. 用最小反例逐项证明 B1/B2/B3：同词多条冲刺、同一冲刺多次达标、冲刺后先有普通 review、先有下一次冲刺、没有后续、乱序、同毫秒、非法时间、缺失/非法 `recallMs`。
4. 若现有字段不能无歧义建立链，立即停止实现，只提交审计证据和所缺真实字段；禁止推断、补写或伪造事件。

## B1：cohort 与随访配对边界

- 起点必须是可识别 `sprint:*` session 中 `rating≥2` 的成功冲刺 review；`rating<2` 不进入 cohort。
- 同一成功冲刺 cohort 内同一 wordId 只计一次；必须审计并明确多条达标 review 的锚点选择与稳定 tie-break，不能让输入顺序决定结果。
- 对每个 cohort 词，只找锚点之后首条非 sprint review；该 review 是真实后续观察，不是 quizAttempt。
- 锚点之后若先发生同词下一次 `sprint:*` review，则旧 cohort 被截断，不能跨新冲刺配对后续普通 review。
- 只有实际找到后续非 sprint review 的 cohort 词才进入保持率分母；没有后续是“未观察”，不是失败。
- 同一 wordId 在本轮报告 cohort 中只归一次；必须先审计采用哪次成功冲刺并与“再次冲刺截断”一致，禁止跨 cohort 重复计数。

## B2：保持结果与覆盖披露

- 后续首条非 sprint review 的 `rating≥2` 才记为保持成功；`rating<2` 记为已观察未保持。
- 保持率分子是已观察且后续 `rating≥2` 的去重 cohort 词数；分母是已有后续首条非 sprint review 的去重 cohort 词数。
- 同时报告：成功冲刺 cohort 词数、已有后续的观察词数、未观察词数、随访覆盖率、保持率，以及从成功冲刺锚点到后续 review 的实际间隔。
- cohort 为空、观察词为 0 时对应比率必须为 `null`；不能填 0。覆盖率只有 cohort 非空时存在；保持率只有观察词非空时存在。
- 不把结果写成冲刺导致的提升、恢复或掌握；两次事件之间可能存在其他学习行为，全部文案必须标注观察性。

## B3：配对回忆耗时

- 只在同一 cohort 词的成功冲刺锚点和已配对首条非 sprint review 两侧都有合法 `recallMs` 时进入测时配对分母。
- 测时必须沿用真实记录；`recallMs` 缺失、负数、NaN 或无穷值均不进入测时样本，也不影响该词已观察的评分保持结果。
- 报告配对测时词数、冲刺侧均值、后续正常复习侧均值和“后续 − 冲刺”的变化；无配对测时返回 `null`，不填 0。
- 保持率与 paired recall 是两个分母，必须分别披露；不能用有测时子样本代替全部已观察词，也不能把 quizAttempt 的测时混入 review 配对。

## 实现边界

- 优先新增/复用纯函数，确保 cohort、截断、首条后续、去重和排序在一个权威实现中完成；不得在多个 UI 分别复制规则。
- 本轮只建立总 Prompt 规定的 B1/B2/B3 链，不同时进入维度归因、分维度报告、自适应推荐或阶段 C。
- 不改近 7 天评分事件占比、现有冲刺活动/当场达标/同词配对回忆/当前仍薄弱指标。
- 不新增 schema/version/store/domain；不改评分、FSRS、每日 Quiz 门禁、备份、package scripts、历史 reviews/quizAttempts、薄弱画像、恢复/复发或再冲刺。

## 验收标准

- 纯函数单测覆盖：成功/失败冲刺、同词多事件与去重、首条非 sprint、下一次冲刺截断、无后续未观察、同词只归一次、乱序和同毫秒稳定性、未来/无效时间、保持率/覆盖率空样本、合法/非法配对测时及两个分母独立。
- 用户入口/E2E 至少覆盖：有随访保持、有随访未保持、无后续未观察、下一次冲刺截断、覆盖率/保持率/实际间隔、无样本 `null` 和 paired recall 合法/无样本；既有 signal-flow 16 条语义不减少。
- E2E seed 必须依据待验证的 cohort/截断边界生成明确本地时间；若复用周报入口，不得用可能在本地周一落入上周的通用 `daysAgo(1)` 代替本周事件。
- 更新 `learning-effectiveness-audit.md`，创建 `round-38.md`，更新 `project-evolution.md` 和 `next-round-prompt.md`；仅在咬合状态变化时更新 `occlusion-table.md`。
- 必须实际执行并报告定向测试、lint、typecheck、`npm test` 和 signal-flow E2E。

## 提交与停止门槛

- 固定端口 3000，健康检查成功后才跑浏览器；只清理确认属于本轮的 PID 和唯一日志。浏览器连续两次失败则停止重试，改报自动检查证据。
- 完成验证与清理后，先请求同一个 `opencode/zen-v4-flash` 任务做提交前只读复核；处理意见后显式暂存本轮文件。
- 一个中文 commit，不 push；禁止 `git add .`、`git add -A`、`git commit -am`，不修改或暂存 `1.txt`。
- 若完整链必须新增 schema/version、推断 session kind、把 quizAttempt 当 review、跨新冲刺、把未观察算失败、伪造历史样本或进入维度归因/自适应，立即停止实现并只提交审计结论。
