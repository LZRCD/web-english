# `rendered-html` 学习流程结构契约审计

- 审计日期：2026-08-09
- 审计基线：`codex/follow-up-hardening`，`2dac43b636b86467fe3071b5960745942a306549`
- 审计范围：仅 `tests/rendered-html.test.mjs:272-308` 最后一个测试中的 37 条源码正则断言。
- 证据边界：只读交叉核对当前源码与测试源码；未运行产品测试、构建或浏览器，因此“已有行为测试”表示当前测试源码存在直接证据，不表示本轮重新运行通过。

## 分类口径

1. 已有可靠行为测试覆盖：删除结构断言。
2. 缺少行为覆盖但属于稳定产品契约：先补最窄行为测试，再删除结构断言。
3. 构建、数据资产或静态供应链契约：保留静态检查。
4. 仅约束内部实现名称、调用文本、样式钩子或源码外观：删除，不建立等价结构断言。
5. 无法判断是否为产品要求：`BUSINESS DECISION REQUIRED`，停止目标。

## 37 条映射矩阵

| # / 行 | 当前断言 | 当前行为测试或静态契约证据 | 分类 | 建议 |
|---:|---|---|---:|---|
| 1 / 272 | `StudyScope = "selection" \| "all"` | 当前行为由 `page.tsx:279-306` 的过滤/队列投影实现；该断言只锁定类型别名文本，未执行任何模式行为。 | 4 | 删除，不补等价源码断言。 |
| 2 / 273 | `function startAllBookShuffle` | 当前入口在 `page.tsx:1471-1482, 2020-2023, 2186`；函数名不是用户契约。 | 4 | 删除，不锁定函数名。 |
| 3 / 274 | `setStudyScope("all")` | 当前全书模式由 `page.tsx:282, 1477-1482` 实现；具体 setter 调用是内部实现。 | 4 | 删除，不锁定调用文本。 |
| 4 / 275 | `已打乱 ${learningItemCount} 个学习项` | 当前源码提供全书乱序入口与反馈（`page.tsx:1471-1482, 2020-2023`）；现有 E2E 未直接点击全书乱序并验证范围、顺序或刷新保持。 | 2 | 先补一个全书乱序最窄 E2E（入口、范围/顺序、持久化），再删该文案正则；不要求逐字锁定 toast。 |
| 5 / 276 | `redbook-analysis.json` | `page.tsx:899-909` 把运行时分析资产接入加载链；同文件前 8 个测试中的全量审计（`rendered-html.test.mjs:166-183`）验证该资产与学习项数量。仅验证资产存在不能证明页面仍消费它。 | 3 | 保留静态运行时供应链接线检查，并在测试内单独命名其目的。 |
| 6 / 277 | `word-relation` | `WordCard.tsx` 的 class 名仅是样式钩子；断言不验证词源/词根关系是否可见或正确。 | 4 | 删除，不锁定 CSS class。 |
| 7 / 278 | `useStudyPersistence` | `page.tsx:804-891` 当前接入持久化；hook 名称与调用形状是内部边界。 | 4 | 删除，不锁定 hook 名。 |
| 8 / 279 | `loadStoredState(` | `data-lifecycle.spec.mjs:21-70, 236-256` 直接覆盖导入/刷新恢复与 IndexedDB 异常时载入兼容副本。 | 1 | 删除源码调用正则。 |
| 9 / 280 | `persistStateSnapshot(state)` | `data-lifecycle.spec.mjs:218-234, 258-279` 直接覆盖设置变化落入兼容存储及失败时不覆盖旧值。 | 1 | 删除源码调用正则。 |
| 10 / 281 | `saveStoredState(state)` | `data-lifecycle.spec.mjs:21-70, 218-279` 覆盖权威存储/兼容存储的保存与刷新结果；具体 helper 调用不再增加行为覆盖。 | 1 | 删除源码调用正则。 |
| 11 / 282 | `buildActivityCalendar(reviews, activityRange` | `study.test.ts:250-296` 直接验证每日去重分级、历史区间和不延伸到未来。 | 1 | 删除具体调用文本正则；UI 导航缺口由第 14 条单独承担。 |
| 12 / 283 | `activityRangeLabels` | 标签别名只约束 import/变量名称，未验证用户可选范围。 | 4 | 删除，不锁定变量名。 |
| 13 / 284 | `selectedActivityDate` | state 名只约束内部实现，未验证用户选日后的详情。 | 4 | 删除，不锁定 state 名。 |
| 14 / 285 | `回到今天` | 当前 `HistoryView` 提供返回今天操作；`study.test.ts:274-296` 仅覆盖日历纯逻辑，现有 E2E 未覆盖历史翻页、选日和回到今天。 | 2 | 先补一个历史日历最窄 E2E，再删展示字符串正则。 |
| 15 / 286 | `STORAGE_VERSION = 5` | `study.test.ts:77-122, 151-183` 与 `data-integrity.test.ts:58-83, 250-283` 直接验证 v5 迁移、非法/未来版本拒绝及备份版本一致性。 | 1 | 删除固定源码赋值正则；保留行为与迁移测试。 |
| 16 / 287 | `AbortSignal.timeout(` | `api-guard.test.ts:163-207` 直接调用 `chatCompletion`，验证请求携带 `AbortSignal`、请求体与响应提取；第 54 轮已重新运行直接行为测试。 | 1 | **第 54 轮已删除该断言及只为它存在的 `aiProvider` 源码读取槽位。** |
| 17 / 288 | `function undoLastRating` | `learning.spec.mjs:168-226` 直接覆盖评分后撤销、持久化回退及刷新后撤销。 | 1 | 删除函数名正则。 |
| 18 / 289 | `function startTodaySession` | `study.test.ts:421-541` 覆盖今日队列规则，但未直接覆盖页面“今日任务”入口建立会话及持久化。 | 2 | 先补最窄入口行为测试，再删函数名正则。 |
| 19 / 290 | `function startFavoriteSession` | `responsive.spec.mjs:85-112` 只确认“复习全部收藏”按钮可见，未点击并验证收藏会话。 | 2 | 先补点击收藏入口后队列/标题的最窄 E2E，再删函数名正则。 |
| 20 / 291 | `function startMistakeSession` | `responsive.spec.mjs:85-112` 只确认“强化当前错词”按钮可见，未点击并验证错词会话。 | 2 | 先补点击错词入口后队列/标题的最窄 E2E，再删函数名正则。 |
| 21 / 292 | `buildExamPlan` | `study.test.ts:401-419` 直接验证阶段、重点分册、剩余词数和预计工作量；函数如何被页面调用不是契约。 | 1 | 删除调用名正则。 |
| 22 / 293 | `记忆牢固度` | 当前 `WordCard` 展示该学习进度信息；现有 E2E 未断言其值来自当前 FSRS 进度。 | 2 | 先补一个 seeded progress 的词卡展示测试，再删源码文案正则。 |
| 23 / 294 | `下次复习` | 当前 `WordCard` 展示下次到期信息；现有 E2E 未验证时间投影。 | 2 | 与第 22 条同一最窄词卡行为测试补齐后删除；未补前保留。 |
| 24 / 295 | 不含 `词表来源` | 只禁止一段旧源码文案；没有可执行行为、数据契约或当前需求把该禁词定义为产品要求。 | 4 | 删除，不建立“源码不得含某词”的替代断言。 |
| 25 / 296 | `playWordAudio` | `learning.spec.mjs:45-68` 点击单词主体后直接观察音频播放与音标；`398-430` 覆盖播放失败回退。 | 1 | 删除函数名正则。 |
| 26 / 297 | `浏览器 TTS 回退` | `learning.spec.mjs:398-430` 直接模拟录音自动播放被阻止，验证 TTS 调用与 `autoplay-blocked` 诊断。 | 1 | 删除源码文案正则。 |
| 27 / 298 | `onReveal(); onSpeak();` | `learning.spec.mjs:45-68` 点击“显示单词释义”后同时验证音标/揭示入口与真实播放调用。 | 1 | 删除事件处理器调用顺序正则。 |
| 28 / 299 | `aria-keyshortcuts="E"` | 当前 `WordCard` 暴露 E 快捷键可访问性提示，但现有行为测试未按 E 触发内容补充。 | 2 | 先补键盘 E 的最窄 E2E，并断言可访问入口；再删源码属性正则。 |
| 29 / 300 | `<kbd>E</kbd> 内容补充` | 当前 UI 显示快捷键提示；没有行为测试证明提示对应真实 E 操作。 | 2 | 与第 28 条同一行为测试补齐后删除；避免逐字锁定 HTML。 |
| 30 / 301 | `function submitReinforcement` | `page.tsx:1215-1231, 1878-1894` 与 `WordCard.tsx:711-771` 当前实现低评分后的再提取；现有 E2E 没有覆盖答错、重试、答对提交和跳过。 | 2 | 先补低评分再提取最窄 E2E，再删函数名正则。 |
| 31 / 302 | `趁答案还在短时记忆里...` | 与第 30 条同一未覆盖用户流程；源码文案存在不能证明强化逻辑可用。 | 2 | 由第 30 条行为测试承接后删除，不单独锁定逐字文案。 |
| 32 / 303 | `rating-bar visible` | `learning.spec.mjs:168-185` 与 `responsive.spec.mjs:34-82` 直接在揭示后操作/观察评分按钮。 | 1 | 删除 class 拼接正则。 |
| 33 / 304 | `全局查词` | `visual.spec.mjs:108-125` 直接从完成页打开“全局查词”对话框；其他 learning E2E 覆盖划词查询。 | 1 | 删除跨多个源码文件搜索展示字符串的正则。 |
| 34 / 305 | `导出备份` | `data-lifecycle.spec.mjs` 当前覆盖导入、恢复、清空和兼容保存，但没有点击导出并验证下载内容。 | 2 | 先补最窄下载行为测试（文件名/可解析备份/当前状态），再删字符串正则。 |
| 35 / 306 | `未配置云端模型` | 当前 enrich route 返回 503；`api-guard.test.ts` 覆盖 provider helper，但没有直接验证 enrich no-key 分支。 | 2 | 先补 route 的 no-key 行为测试，再删源码错误文案正则。 |
| 36 / 307 | `collocations` | `data-integrity.test.ts:86-105` 只验证逐义项例句数量；`learning.spec.mjs:433-480` 的 mock 响应含 collocations，但未断言归一化/展示结果。 | 2 | 先补 enrich 响应中 collocations 的过滤、限长与返回行为测试，再删源码字段正则。 |
| 37 / 308 | 不含 `CET-6|IELTS|GRE|示例词表|算法动态安排` | `rendered-html.test.mjs:26-39` 已对真实 SSR HTML 直接断言不出现 CET-6/IELTS/GRE 及脚手架文案；额外源码禁词没有独立产品契约。 | 1 | 删除最后一个源码负向正则；保留 SSR 行为断言。 |

## 判定汇总

- 分类 1（已有行为覆盖，可删）：14 条。
- 分类 2（先补最窄行为测试）：14 条。
- 分类 3（静态供应链保留）：1 条，即 `redbook-analysis.json` 的运行时接线。
- 分类 4（仅源码外观，可删）：8 条。
- 分类 5（`BUSINESS DECISION REQUIRED`）：0 条。
- 不整块删除；每轮仍按一个可判定契约推进。

## 第 54 轮唯一清理目标

只清理第 16 条 `tests/rendered-html.test.mjs:287` 的 `AbortSignal.timeout` 源码正则，以及只为该断言存在的 `aiProvider` 变量和 `lib/ai-provider.ts` 读取项。理由：当前直接单测 `tests/api-guard.test.ts:163-207` 已覆盖请求携带超时信号，而且清理不引入任何业务判断、数据/schema 变化或新测试设计。

第 54 轮不得顺手清理其他 36 条，也不得把分类 2 项改成“先删后补”。
