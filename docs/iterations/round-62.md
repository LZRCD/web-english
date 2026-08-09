# 第 62 轮：activeQuiz 失效 wordId 刷新行为只读审计

- 日期：2026-08-09
- 分支 / 起始 HEAD：`codex/follow-up-hardening` / `4c40ad83e3054555faf2510a1fce0e40010499a8`
- 批次：activeQuiz 失效题目刷新审计；第 1/1 轮
- 状态：只读审计完成；发现产品契约与数据结构决策点，STOP

## 授权与现场

- 唯一目标：审计 `activeQuiz` 的题组 `wordId` 部分或全部无法从当前 `words + wordProgress` 解析时，题序、作答快照、进度、完成态、刷新恢复与用户提示的实际行为。
- Round 0 门禁通过：tracked/index 无漂移，37 个保护性未跟踪项保持未暂存，`1.txt` 未改动；固定端口 3000 无监听。
- 严格边界：未修改产品代码、测试、`activeSession`、schema/version/store/domain、FSRS、评分、推荐或用户学习数据；未访问浏览器 IndexedDB。

## 实际恢复链

`normalizeQuizSession` 清洗并保留 `questionWordIds/index/correctCount/answers/complete`，页面 hydrate 后把 `activeQuiz` 传给 `QuizView`。`restoreQuizQuestions` 用当前仍同时存在于 `words` 和 `wordProgress` 的词建立映射；有题组快照时按原 ID 顺序取回目标，失效 ID 被过滤，剩余目标保留原 `seedOffset`。`QuizView` 只在恢复结果非空时进入保存模式，然后把当前题目 ID 列表和原进度字段继续写回既有 `activeQuiz`。

## 审计矩阵

| 核对项 | 部分 wordId 失效 | 全部 wordId 失效 | 结论 |
|---|---|---|---|
| 题序 | 剩余目标保持原相对顺序，并保留原 seed 偏移；当前推荐与优先级不参与重排 | 恢复结果为空 | 目标顺序有保护，但不是完整题目快照 |
| 作答快照 | `answers` 原样恢复且不裁剪，已失效题目的孤立 answer key 仍保留；`correctCount` 也原样保留 | 不进入本地 Quiz 状态，持久化快照仍原样存在 | 已提交答案不会被静默重算，但会与有效题组脱节 |
| 正确答案 / 选项 | 题干、正确答案和选项没有持久化；均用当前词数据重建。`meaning-choice` 干扰项来自当前全部已学词，删除目标词也可能改变剩余题的干扰项 | 无可见题目 | 现结构不能证明“失效词过滤后答案与干扰项完全保持” |
| 当前进度 | `index = min(旧 index, 新题数 - 1)`，没有按旧 index 前仍有效的题数重算。例：`[A,B,C]` 的当前题为 B，A 失效后恢复为 `[B,C]`，index 仍为 1，直接显示 C | 不恢复 index | 部分失效可跳过仍有效的当前题 |
| 完成状态 | `complete` 原样保留，不按有效题组或 answers 重算；已完成题组缩短后，结果页仍用旧 `correctCount / 新题数`，理论上可超过 100% | 页面不展示旧完成态，持久化中仍保留 | 完成态、分子和新分母可能不一致 |
| 刷新写回 | 恢复成功后 effect 会把过滤后的 `questionWordIds` 写回；原 index、answers、correctCount、complete 随之保留，后续刷新稳定在该新快照 | 不触发 Quiz 写回，不清除 `activeQuiz`；再次进入仍重复尝试，开始新测验后才会覆盖 | 部分失效会“自愈题组但固化错位”，全部失效会留下隐藏的陈旧会话 |
| 用户提示 | 直接续答或显示旧完成页，没有说明题目被移除、进度变化或分数口径 | 显示普通测验模式选择页，不显示“题组已失效/可重新开始”，也不会进入“题目不足”空页 | 两条路径均无失效原因提示 |

## 刷新时机风险

- `activeQuiz` 没有复用第 61 轮 `hydrated + redbookReady` 恢复门禁；它只在 `QuizView` 挂载时按 `savedQuiz` 引用变化尝试一次。
- 页面刷新默认回到学习页，通常会在用户随后进入测验页时恢复；但导航只等待本地状态加载，不等待红宝书 fetch。若用户在词库尚未 ready 时进入测验页，空 `words` 会令恢复结果为零，而 `previousSavedQuiz` 已记录同一引用；词库随后 ready 也不会自动重试。
- 这是源码可达路径；本轮未运行浏览器，不能把它写成现实发生频率。

## 现有证据覆盖与缺口

- `tests/weak-signals.test.ts` 已证明：题组 ID 清洗/限长/分域往返；画像变化时完整题组顺序与选项保持；删除首个目标后剩余 question ID 保持顺序且选项仍合法。
- 删除目标的断言没有覆盖 index、answers、correctCount、complete、写回和提示，也没有比较删除前后的剩余 `meaning-choice` 选项是否相同。
- `tests/e2e/signal-flow.spec.mjs` 的刷新链只覆盖两个 ID 均有效时的题序、index、正确数、answer 数、seed、startedAt、sessionId；没有部分失效、全部失效或词库未 ready 的恢复用例。
- 第 33 轮“全部失效不崩溃”只能证明纯构建函数返回空数组；不能证明用户看到正确说明或陈旧 `activeQuiz` 被清除。

## STOP 决策点

现有证据足以确定实现行为，但不足以替产品选择目标契约，且其中一项可能要求扩展持久化结构，因此按授权 STOP：

1. 部分失效时，进度是否按“旧 index 之前仍有效的题数”重算，并只保留有效题目的 answers / correctCount；还是保留原题组历史分数并单独展示原分母。
2. 已完成题组部分失效时，是保持原结果快照、按有效题重算，还是结束旧结果并提示重新开始。
3. 全部失效时，是清除 `activeQuiz` 并提示，还是保留陈旧会话供其他恢复方式使用；当前数据没有可用恢复方式证据。
4. “答案快照”只承诺保存用户已提交答案，还是还要求题干、正确答案与 `meaning-choice` 选项在词条删除后完全不变；后者需要评估新增持久化字段或其他数据结构变化。
5. 部分/全部失效提示需要批准具体语义，不能直接沿用 `activeSession` 文案冒充 Quiz 契约。

## V0 验证与收尾

- 静态核对：`app/components/QuizView.tsx`、`lib/quiz.ts`、`lib/study.ts`、`app/page.tsx`、相关 Node/E2E 测试及第 33/50/52/61 轮文档。
- V0：仅执行文件/符号/命令核对与 `git diff --check`；未运行 lint、typecheck、单测、全量测试、build、浏览器或服务。
- 本轮只更新本报告、`docs/project-evolution.md` 与 `docs/iterations/next-round-prompt.md`；精确暂存后创建一个中文文档提交，不 push。
- 批次达到 1/1；提交后保持 STOP，不自动实施修复或其他候选。
