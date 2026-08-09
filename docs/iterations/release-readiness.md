# 阶段 F 发布准备缺口矩阵

日期：2026-08-09
审计基线：`2715dd41caf2cc42021c890cee6e6a97742790da`（`docs: 评估自适应推荐数据门槛`）
审计性质：只读代码与既有测试证据审计；未读取浏览器 IndexedDB，未导入/导出用户数据，未重跑测试或 E2E。

## 判定口径

- “已有测试证据”只表示仓库中存在对应测试源码或历史 checkpoint，不表示第 48 轮重新通过。
- fixture、seed 和纯函数测试只证明确定性行为，不证明用户生产数据、生产规模、真实备份或设备性能。
- “不能证明”保留现实证据边界；不会用测试数据补成生产结论。
- 风险只按发布前数据安全与可恢复性判断；终局由最高风险的明确缺口决定。

## 发布缺口矩阵

| 发布面 | 代码/数据路径 | 现有护栏 | 已有测试证据 | 不能证明 | 风险 | 状态 | 解除条件 |
|---|---|---|---|---|---|---|---|
| 旧 schema 与未来版本 | `parseStoredState -> normalizeStoredState`；无版本按 v1，当前 `STORAGE_VERSION=5` | 非对象、非法版本和未来版本直接拒绝；旧可选字段回落默认值；v4 前 review kind 重建 | `tests/data-integrity.test.ts` 覆盖非法/未来版本；`tests/study.test.ts` 覆盖无字段默认值与 v2 迁移 | 未逐份读取真实旧版本用户状态 | 低 | 已具备发布护栏 | F2 建立 v1-v5 代表性兼容 fixture 清单并核对覆盖，不读取生产库 |
| 非法字段与不可恢复丢弃 | `normalizeReview`、`normalizeQuizAttempt`、各 map/array normalizer | 无效日期、非法 ID/评分/区段和损坏对象会被过滤，避免进入排程；未来版本整体拒绝而非降级覆盖 | 现有单测覆盖非法状态版本、损坏 FSRS 与若干非法时间派生语义 | 被过滤的原始 IDB 行没有逐条隔离区或丢弃报告；规范化后的后续保存无法恢复这些原始行 | 中 | 有明确缺口 | 在不自动修复历史的前提下，设计只读丢弃计数/导出隔离证据；任何迁移或改写需另行授权 |
| FSRS 进度损坏恢复 | `normalizeStoredState -> normalizeWordProgress -> rebuildWordProgress` | 健康词保持；仅缺失/损坏/落后于最新 review 的词按完整 reviews 重建；无 review 的损坏进度删除，不伪装完整 | `tests/data-integrity.test.ts` 覆盖单词级损坏、缺失和健康词隔离 | 真实损坏库的修复规模与耗时；无 review 的孤立进度是否有业务价值 | 中 | 已具备发布护栏 | F2 只审计修复计数、耗时指标和现有测试缺口；生产修复仍需用户授权 |
| IndexedDB 字段完整投影 | `StoredState -> splitStoredState -> buildStateDomainRecords -> combineStoredState` | 当前 StoredState 字段均进入 settings 或九个数据域；同一 `state-domains` 事务整体读写；combine 后再次 normalize | `tests/study.test.ts` 深比较分域往返；`tests/weak-signals.test.ts` 覆盖 thresholds、activeSession、activeQuiz、未来 sessionId | 新增 StoredState 字段时没有运行时 schema 清单自动报警；本轮未重跑类型检查 | 低 | 已具备发布护栏 | F2 将完整往返测试列为核心纵向链，并审计是否需要编译期 exhaustiveness 约束 |
| revision 与原子写入 | `writeSnapshot`、`matchesKnownStorageRevision`、单一 readwrite transaction | 已知 revision 必须匹配；冲突 abort；所有域同事务升级 revision；本标签写入串行排队 | 单测覆盖空库/旧 revision；`tests/e2e/concurrency.spec.mjs` 源码覆盖旧标签不覆盖新数据及恢复副本 | 当前浏览器/当前提交下该 E2E 未在本轮重跑 | 低 | 已具备发布护栏 | F2 把 concurrency E2E 纳入最小发布链，记录当前通过证据 |
| 备份格式与版本 | `createBackupDocument`、`parseBackupDocument` | 导出封装完整内存 StoredState；校验 format、导出时间、文档/状态版本一致和未来版本 | `tests/data-integrity.test.ts` 与 `tests/study.test.ts` 覆盖格式和版本拒绝 | 未对用户真实备份做只读解析；没有逐字段生产备份清单 | 中 | 当前不可证明 | F2 先收敛完整 fixture 往返；若仍需现实证明，只请求用户主动提供的只读导出，不访问浏览器库 |
| 导入与恢复前保护 | `useStudyPersistence.importBackup/restoreBackup/restoreRecoveryCopy` | 导入先 parse/normalize/确认；权威写入前建立自动备份或恢复副本；写入期间新修改最多三轮保护；失败保持 blocked | `tests/e2e/data-lifecycle.spec.mjs` 源码覆盖导入替换刷新、自动快照与指定恢复副本 | 真实配额、真实损坏库和用户大备份的恢复成功率 | 中 | 已具备发布护栏 | 先解除 5000 条裁剪；F2 再把导入/恢复/刷新列为核心纵向链并运行 |
| 自动备份与恢复副本 | `saveAutomaticBackup`、`recovery.ts`、localStorage 恢复集合 | 每日/导入前/手动快照；自动备份保留最近 5 份；恢复副本保留原始 raw，无法解析时仍可导出；最多 10 份恢复副本 | 单测覆盖旧单份、多份、按 ID 删除；data-lifecycle E2E 源码覆盖指定副本恢复 | 5/10 份上限是否符合用户恢复窗口；浏览器配额耗尽时能否实际保住大状态 | 中 | 当前不可证明 | F2 审计容量与提示契约；若需改变保留策略，另开单一授权轮 |
| `activeQuiz` 恢复 | `normalizeQuizSession -> restoreQuizQuestions -> QuizView` | 题组 ID 去重、限 30；按保存 seed/有序 ID 重建；删除词被过滤；索引按恢复后题数夹紧；旧会话无快照时按候选 fallback；sessionId 原样保持 | `tests/weak-signals.test.ts` 覆盖题组快照、删除首词、旧 fallback、分域与 id；signal-flow E2E 源码覆盖刷新续答 | 所有题均删除时只回空测验页，缺少面向用户的恢复原因区分 | 低 | 已具备发布护栏 | F2 纳入 activeQuiz 刷新链；补充“题组全失效”行为测试是否必要的审计结论 |
| `activeSession` 恢复 | `normalizeSession -> useStudySession -> page.sessionWords` | 持久化 ID 去重、合法范围清洗、索引按原 wordIds 长度夹紧；sessionId 原样保持；用户可退出会话 | `tests/study-session.test.ts` 只覆盖原列表索引/完成；分域测试覆盖 id 往返 | `wordById` 会过滤删除词，但 session 完成/进度仍按未过滤的原 wordIds；孤儿位于队首时可能重复展示并评分同一有效词 | 中 | 有明确缺口 | 单独补“删除词位于队首/中间/全部删除”的恢复契约与行为测试；是否修复须在高风险项之后授权 |
| reviews 长历史完整性与性能 | `normalizeStoredState` 全量 review 去重、排序、重建；页面多处派生 | reviews 不静默截断；重复 ID 保留最后一条并按 `(reviewedAt,id)` 排序；恢复链有读取/normalize/apply 性能计时 | `tests/study.test.ts` 以 10010 条断言完整保留；重复 ID 和顺序有单测 | 10010 条测试没有 SLA/耗时断言；真实长历史的 IDB 读取、O(n log n) 排序、多个派生扫描和设备内存 | 中 | 当前不可证明 | F2 先提出最小性能证据与阈值，不用合成数据冒充生产；需要生产导出时停止请求授权 |
| quizAttempts 长历史完整性 | `normalizeQuizAttempts` 与 `recordQuizResult` | 单条记录校验 wordId/answeredAt/mode/recallMs；其余分域、备份和恢复链可承载数组 | 没有覆盖超过 5000 条后仍完整的测试；历史文档只登记过该裁剪为未解决语义 | 第 5001 条后最早的合法 attempt 被静默丢弃；导入大备份时先裁剪再写入；已经丢失的历史无法从当前规范化状态恢复 | 高 | 有明确缺口 | 单独授权修复轮：取消静默裁剪并以 >5000 条的 normalize、分域、备份导入往返测试证明无损；不回填、不碰生产数据 |
| 重复 quizAttempt ID | `normalizeQuizAttempts -> weak-signals` | 恢复判定会按非空 attempt ID 去重；周趋势按词去重 | `tests/weak-signals.test.ts` 覆盖恢复判定中的重复 ID | normalize、错误累计和词级时间线未统一去重；合法重复 ID 可重复计数/展示 | 中 | 有明确缺口 | 在长历史修复后只读审计全消费者统一语义；不得自动重写历史 |
| 无效时间 | reviews/quizAttempts normalizer、周窗口和时间线派生 | review 与 attempt 的核心事件时间无效时会被过滤；派生窗口再用 `Number.isFinite` 守卫 | review 状态解析和弱信号无效时间规则有既有单测 | `activeQuiz.startedAt` 只校验字符串，非法字符串仍可保留；被过滤记录没有原始行级报告 | 中 | 有明确缺口 | F2 列出所有持久化时间字段的统一契约；只补行为测试，任何数据修复另行授权 |
| `weakThresholds` 持久化与派生 | settings 域 -> normalizeWeakThresholds -> weak profile/recommendation/report | 旧状态用固定默认；非法值夹紧；阈值随 settings 分域往返；默认值本轮不变 | `tests/study.test.ts` 与 `tests/weak-signals.test.ts` 覆盖默认、夹紧、分域和刷新源码 | 生产中阈值变化的实际影响和用户理解 | 低 | 已具备发布护栏 | F2 只审计阈值纵向测试是否重复；不调整默认值 |
| 离线与 IndexedDB 不可用 | `persistIndexedState -> writeFallbackState`、启动恢复 | IndexedDB 不可用时用 localStorage；原始异常 fallback 可转恢复副本；fallback 写入有 revision 和可用时的 Web Locks | data-lifecycle E2E 源码覆盖 IDB 禁用、IDB 损坏和 localStorage 配额耗尽 | Safari/无 Web Locks 等实际浏览器矩阵；大状态 localStorage 容量 | 中 | 已具备发布护栏 | F2 选择最小跨浏览器/失败链；容量策略若要改变需另行授权 |
| 刷新、跨标签与写入失败提示 | BroadcastChannel、storage event、pending local changes、blocked/retry | 有本地修改时不自动覆盖；冲突页状态转 error 并保存恢复副本；retry 先读取权威状态并保留本页修改 | concurrency 与 data-lifecycle E2E 源码覆盖冲突、刷新、错误提示和恢复副本 | 本轮没有当前提交的运行证据；BroadcastChannel 不可用时只依赖 revision/后续写冲突 | 中 | 已具备发布护栏 | F2 把 concurrency、导入刷新、配额失败合并成最小非重复纵向组并运行 |
| 清空学习记录语义 | `resetLearningRecords` | 权威清空前先建恢复快照；清 reviews/progress/mistakes/stubborn/positions/session/undo，保留收藏与内容缓存 | data-lifecycle E2E 源码覆盖上述 store 清空与恢复快照 | `quizAttempts` 与 `activeQuiz` 被保留，旧测验信号可继续影响“薄弱”派生；按钮文案未明确这两个例外 | 中 | 有明确缺口 | 在不丢历史的前提下先定义“清空”产品契约；禁止为通过测试直接删历史 |
| 发布检查、构建漂移与现场保护 | package scripts、`lib/build-info.generated.ts`、固定 3000、Git index/保护项 | test 含生产 build；E2E 独立；固定端口规则；build-info 为 tracked 文件；本轮已核对空 tracked/index、无监听和 25 个保护文件清单 | 第 45 轮历史 checkpoint：study 35/35、230/230、learning 17/17、signal-flow 18/18；不作为本轮结果 | 当前 HEAD 的 lint/typecheck/test/完整 E2E 未重跑；现有 `test:e2e` 包含更多 spec，历史 35 条不能代表全目录 | 中 | 当前不可证明 | 解除高风险缺口后进入 F2，只提出并批准最小测试收敛清单，再按清单运行；构建后恢复 build-info，精确清理项目 PID |

## 唯一终局

选择 **B：存在需单独授权的发布阻断/高风险缺口**。

决定性证据是合法 `quizAttempts` 的静默裁剪：

```text
备份 / IndexedDB state-domains / localStorage
  -> normalizeStoredState
  -> normalizeQuizAttempts(...).slice(-5000)
  -> 页面内存状态
  -> 分域写入 / 自动备份 / 导出

新作答
  -> setQuizAttempts([...items, attempt].slice(-5000))
  -> 分域写入 / 自动备份 / 导出
```

这不是生产规模未知或测试不足造成的推测，而是两条确定性路径上的合法历史丢弃；备份导入同样会先规范化并裁剪。它属于数据与备份一致性的高风险明确缺口，满足终局 B 的停止条件。

## 最小授权建议

下一轮只处理这一项：阻止未来 `quizAttempts` 静默丢失，并以超过 5000 条的 normalize、分域和备份导入往返测试证明完整保留。不得回填已经丢失的历史，不读取或改写用户浏览器库，不新增 schema/version/store/domain，不顺带修 activeSession、重复 ID、重置语义或性能优化。

只有用户明确授权后才能进入修复；否则保持停止状态。
