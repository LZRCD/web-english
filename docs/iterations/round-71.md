# 第 71 轮：Canonical P1-9 每日短文填词

- 日期：2026-08-11
- 分支 / 完整起始 HEAD：`codex/follow-up-hardening` / `586142507bc7969e364b14c7f1b12c0a10a449ff`
- 批次：Canonical P1-9 独立纵向批次；第 1/1 轮
- 状态：完成，STOP

## Round 0 与实施边界

- 分支、完整 HEAD、ahead 8、tracked working tree、index、build-info 与 Canonical SHA-256 均符合 Prompt 基线；固定端口 3000 无监听。
- Start 门禁唯一阻断是 Prompt 已登记的用户未跟踪保护路径仍被脚本报告为 unexpected；没有保护范围外新文件，全部保持原样、只读、未暂存。
- 只实施 P1-9：当天真实新词派生、结构化 AI 短文、settings 缓存、`passage-cloze` 测验闭环、恢复、弱信号、测试与迭代文档。未进入 P1-8、P2、提醒、真题语料或其他 AI 改造。
- `HistoryView.tsx` 未修改：短文填词通过既有 weak-signals 投影进入时间线和周趋势，但不混入冲刺维度推荐、冲刺留存或分维度观察口径。

## 当天真实新词与缓存身份

- 目标只取合法、非未来且落在当前本地自然日的 `review.kind === "new"` 事件；按 `reviewedAt`、review id、原序稳定排序，以真实 wordId 去重，并从当前词条按 ID 精确解析真实英文与释义，最多 10 个。普通 review、未来事件、无效/孤儿 ID 和进度反推结果都不进入；不足 10 个不补旧词，0 个不请求 API。
- 缓存独立使用 `schemaVersion = 1`、`promptVersion = "daily-cloze-v1"`，同时保存 `localDate`、有序 `targetWordIds`、结构化 content、ISO `generatedAt` 与 `source: "ai"`。
- `inputKey` 由固定属性顺序 JSON 确定性序列化 schema、prompt、本地日期及每个目标的真实 wordId/word/meaning；不含随机数、渲染次数或生成时间。同日同输入刷新稳定，跨日、目标增删/调序、拼写或释义变化都会使旧缓存失效。
- 缓存作为 `StoredState.dailyCloze?` 放入既有 settings 记录；`STORAGE_VERSION = 5`、`DATABASE_VERSION = 3`、`BACKUP_FORMAT = wordloop-backup`、既有 store 列表与 state domain 列表均未改变，未新增 object store/domain，也未修改 `lib/backup.ts`。旧状态无该字段可正常读取；清空学习记录会一并清除缓存和活动短文测验。

## API 与结构化解析契约

- 新增唯一 `POST /api/daily-cloze`；请求只允许 `{ localDate, targets: [{ wordId, word, meaning }] }`，顶层及 target 多余键拒绝，正文上限 64 KiB，目标 1–10 个且 wordId 为正安全整数并唯一，word/meaning 上限 160/1000 字符。
- 路由复用现有唯一 Provider、`readJsonBody`、`beginApiRequest`、`chatCompletion`、`parseJsonContent` 与 `withRetry`；独立策略为 10 次/分钟、最大并发 2、响应 2 MiB、25 秒、最多 2 次、temperature 0.35、JSON object。
- 未配置密钥返回 503，参数无效返回 400，api-guard 保留 403/413/429，Provider 或内容结构无效返回 502；没有本地伪 AI 200 fallback，也不发送学习历史、API key 或请求头。
- 成功响应固定为 `{ passage, questions: [{ wordId, options, explanation }] }`。passage 必须为 80–120 个英文词、最多 2000 字符且无占位符/代码围栏；题目数量和顺序与 targets 完全一致，每题恰好 4 个非空唯一候选并包含目标词原文，解释 trim 后最多 400 字符，每个目标词必须能按安全词边界在短文中恰好挖空一次。
- 系统提示和界面都明确内容为原创生成，不是历年真题、教材原文或权威语料，并禁止引用、拼接或近似改写受版权保护的教材/真题原句。

## passage-cloze、恢复与学习记录

- 新增独立 `QuizMode = "passage-cloze"` 和“短文填词”标签；只在测验页由用户显式生成或使用当天有效缓存，不在首屏、加载、切页、刷新或恢复时自动请求。
- 作答前只渲染已经安全挖空的 passage 和 4 个中性按钮；DOM 不携带 answer/correct/value/title 等答案属性，也不显示真实释义、正确答案或解释。作答后才显示正确答案、真实释义和 AI 解释，并持续展示“AI 原创短文 · 非历年真题”。
- `activeQuiz` 继续使用既有 settings 链，额外保存完整题目快照和 `inputKey`。刷新时只有 schema/prompt/localDate/有序 targets/inputKey 与当前输入全部一致才恢复；旧的 passage 会话缺少快照/inputKey 时拒绝恢复，跨日或当天新词变化时先从视图隐藏、再清除并提示重新生成。
- 每次作答都写真实 `QuizAttempt(mode: "passage-cloze")`。首次有效作答继续复用 `shouldApplyQuizToSchedule` 写入一次 FSRS；同词同日本模式重答、重新开始，或当天已在其他 QuizMode 作答时均只记 attempt、`appliedToSchedule: false`，不重复改写排程。
- 短文填词错误以独立 `quiz-cloze` 维度进入错词标签、时间线、周趋势及同维恢复，不冒充辨析、拼写或中译英，也不进入 sprint 推荐和留存分母。
- 同日有效缓存刷新、离线和重新开始均零新增 API；重新生成失败保留旧合法缓存与当前学习记录。无目标、503、429、502、断网或非法响应只显示诚实空态/错误，不写缓存、QuizAttempt、review 或 FSRS。

## 实际修改文件

- 核心与 API：`lib/daily-cloze.ts`、`lib/word-utils.ts`、`lib/quiz.ts`、`lib/study.ts`、`lib/storage.ts`、`lib/ai-provider.ts`、`app/api/daily-cloze/route.ts`。
- weak-signals：`lib/weak-signals/types.ts`、`lib/weak-signals/detection.ts`、`lib/weak-signals/projection.ts`。
- UI：`app/page.tsx`、`app/components/QuizView.tsx`、`app/globals.css`。
- 测试：`tests/api-guard.test.ts`、`tests/quiz.test.ts`、`tests/study.test.ts`、`tests/weak-signals.test.ts`、`tests/e2e/daily-cloze.spec.mjs`。
- 文档：`docs/iterations/round-71.md`、`docs/project-evolution.md`、`docs/iterations/next-round-prompt.md`。

## 红测、修复与验证

| 级别 / 命令 | 结果 | 耗时与说明 |
|---|---|---|
| 红测 / api-guard + quiz + study + weak-signals | 预期失败 4 项 | 约 0.25 秒；3 个测试入口因 `lib/daily-cloze.ts` 尚不存在失败，weak-signals 生命周期因缺少短文维度失败；总计 92 pass / 4 fail |
| V1 / api-guard + quiz + study + weak-signals | 187/187 | 最终测试器约 0.34 秒 |
| V2 / `npm run typecheck` | 通过 | 最终约 3.7 秒 |
| V2 / `npm run lint` | 0 error / 1 个既有 warning | 最终约 10.5 秒；`lib/weak-signals/projection.ts` 的 `SprintHistoryRecord` 未使用，按要求未顺手修改 |
| V0 / `git diff --check` | 通过 | 仅 Git LF/CRLF 工作区提示 |
| V3 / daily-cloze + recovery + lifecycle + signal-flow + responsive | 35/35 | 约 93 秒；单 worker 联跑 |
| V4 / `npm test` | build 通过；unit 310/310 | 命令约 8.8 秒，Node 测试器约 0.91 秒；构建识别 `/api/daily-cloze` |
| V4 / `npm run smoke:production` | 通过 | 约 7.5 秒；首页激活、静态资源、6550 词、音频索引、Range 206 均有效 |

- 场景 A 证明零自动请求、真实当日 new 目标及顺序、显式加载、请求最小化、挖空和作答前 DOM 不泄漏；作答后才展示答案、释义和解释。
- 场景 B 证明真实 QuizAttempt、首次 FSRS 写入、其他 QuizMode 已作答后的跨模式去重、同模式重答去重，以及独立“短文填词错”而非“辨析错”。
- 场景 C 证明完整 activeQuiz 刷新恢复、缓存离线命中、旧缓存重新生成失败保留、当天输入变化即时失效并清除陈旧活动会话。
- 场景 D 证明零目标不请求、503/429/502 零业务写入、键盘 Enter/Space、320px 无横向溢出及 200% / 400% 缩放下核心信息和操作可达。

## 服务、生成文件与保护现场

- dev 首次在受限沙箱内启动因 CIM 权限被拒，未占用端口；获准后最终验证在固定 `127.0.0.1:3000` 使用唯一实例：worker PID 51516、listener PID 58760，日志 `.wordloop-runtime/rounds/dev-20260811-193600.out.log` / `.err.log`，健康检查通过。
- V3 完成后精确停止 worker PID 51516，listener 随服务退出；未切换 3001/3002，未批量终止 Node。
- production smoke 最终复核：worker/listener PID 均为 37032，日志 `.wordloop-runtime/smoke-20260811T114114Z.out.log` / `.err.log`；npm exit 0，脚本自行停止，最终端口 3000 无监听。
- dev/build 曾将 `lib/build-info.generated.ts` 改写为起始提交 `586142507bc7` 与当前 source hash 的临时构建信息；所有会改写它的构建/dev 完成后，已恢复为起始/HEAD blob `4410b1880754eea8e9ee2a9263d372318efac3f3`，之后只运行不改写该文件的 smoke/审计命令。其他 tracked 生成文件无漂移。
- Canonical 前后 SHA-256 均为 `334108484E19A792F9C5DAD2E50BC644EF4F0AB3097B45EDAD43A4267C1DA90F`，未修改、未暂存。
- `1.txt`、`2.txt`、`.zcode/`、历史日志、架构/竞品/规划文档、Canonical、favicon 与爬取脚本等用户保护文件均保持原样、未暂存。

## 提交与停止

- 精确提交信息：`feat: 增加每日短文填词`。
- 只精确暂存本轮实现、测试和三份迭代文档；不 merge、不 push。
- Canonical P1-9 已完成，第 1/1 轮后立即 STOP；不自动进入 P1-8、P2 或其他目标。
