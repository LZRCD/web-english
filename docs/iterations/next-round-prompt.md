# Canonical P1 阶段完成检查点

## 当前状态

- P1-7“AI 词根拆解与助记”已在第 70 轮独立完成。
- P1-9“每日短文填词”已在第 71 轮独立完成。
- P1-8“长难句每日一句”已在第 72 轮独立完成。
- P1 三项均已分别验收和提交，P1 阶段结束，当前 STOP；本检查点不授权自动进入 P2。

## P1-8 已完成契约

1. 学习页在今日任务预览之后、主词卡之前显示“今日长难句”；仅用户点击后请求 `/api/daily-sentence`，刷新、恢复、切页和加载不自动生成。
2. 请求只有浏览器本地自然日 `{ localDate }`；缓存固定为 schemaVersion 1、promptVersion `daily-sentence-v1`、localDate、确定性 inputKey、结构化 content、generatedAt 与 AI source。
3. 内容严格包含 30–70 个英文词的原创完整长句、主干、2–8 个从句结构、1–12 个修饰关系和中文译文；界面稳定披露“AI 原创长难句 · 非历年真题”。
4. 同一本地自然日刷新和离线直接显示合法缓存；跨日旧缓存不作为今日内容。重新生成失败保留旧合法缓存，无当日缓存则诚实显示暂不可用，不用本地模板伪造 AI 内容。
5. 缓存只作为 `StoredState.dailySentence?` 进入既有 settings、IndexedDB 分域、localStorage 兼容、自动保存、备份导入/导出、恢复副本和跨标签链；清空学习记录保留该内容缓存。
6. 朗读只使用浏览器 speechSynthesis：英文 0.8 语速，支持朗读、暂停/继续、重播，重播先 cancel；日期变化、内容替换和组件卸载取消旧朗读。能力不可用时原句、译文和解析仍完整可读。
7. 生成、缓存、刷新和全部朗读/展开操作不写 review、QuizAttempt、FSRS、wordProgress、weak-signals、activeSession、activeQuiz、今日任务或词条。
8. `STORAGE_VERSION = 5`、`DATABASE_VERSION = 3`、`BACKUP_FORMAT = wordloop-backup` 与既有 store/domain 均未变化；未修改 `lib/backup.ts`、Canonical、红宝书或真题语料。
9. 键盘 Enter/Space、稳定 region/aria-busy/role=alert/aria-live、从句文字类型、320px 无横向溢出及 200%/400% 缩放均通过。

## 验证现场

- 红测按预期 0 pass / 2 fail；最终聚焦 90/90，typecheck 通过，lint 0 error / 1 个既有 warning，`git diff --check` 通过。
- daily-sentence 新用例 4/4；daily-sentence、learning、daily-cloze、etymology、data-lifecycle、responsive 相邻链拆分联跑合计 41/41。
- `npm test` production build 识别 `/api/daily-sentence`，全量 Node 319/319；production smoke 验证首页激活、静态资源、6550 词、音频索引和 Range 206。
- dev worker/listener PID 56748/21308，production worker/listener PID 55672/55672；两种服务均精确停止，固定端口 3000 已释放。
- build-info 已恢复为起始 HEAD blob `4410b1880754eea8e9ee2a9263d372318efac3f3`；Canonical SHA-256 保持 `334108484E19A792F9C5DAD2E50BC644EF4F0AB3097B45EDAD43A4267C1DA90F`。

## 等待规则

- P1 阶段完成后保持 STOP，不自动进入 P2。
- P2-10 真题例句库、P2-11 leech 渐进阈值、P2-12 每日提醒均是新的独立产品目标，任一项都必须由用户重新授权并执行新的 Round 0。
- 未获得新授权前，不修改真题/教材语料、leech 持久化阈值、Service Worker、PWA、后台通知、提醒或其他 P2 能力。
