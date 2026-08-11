# 第 72 轮：Canonical P1-8 长难句每日一句

- 日期：2026-08-11
- 分支 / 完整起始 HEAD：`codex/follow-up-hardening` / `51bbfc31c77a5b73821b59a052d26a2bea913e3e`
- 批次：Canonical P1-8 独立纵向批次；第 1/1 轮
- 状态：完成，P1 阶段结束，STOP

## Round 0 与实施边界

- 实际分支与 HEAD 符合 Prompt，分支相对远端 ahead 9 / behind 0；tracked working tree 与 index 均干净。
- 固定端口 3000 无监听；`lib/build-info.generated.ts` 工作区与 HEAD blob 均为 `4410b1880754eea8e9ee2a9263d372318efac3f3`；Canonical SHA-256 为 `334108484E19A792F9C5DAD2E50BC644EF4F0AB3097B45EDAD43A4267C1DA90F`。
- Start 门禁唯一 BLOCK 是 Prompt 已登记、脚本保护清单尚未覆盖的用户未跟踪路径；没有保护范围外新文件，保护文件保持原样、只读、未暂存。
- 只实施 P1-8：每日句纯函数、唯一 API、settings 缓存、学习页显式交互、浏览器朗读、测试与阶段文档。未进入 P2-10/P2-11/P2-12、提醒、真题语料、新 QuizMode、ReviewEvent/QuizAttempt/FSRS/weak-signals 或全站 AI 重构。

## UI、日期与缓存身份

- 学习页在“今日任务预览”之后、主词卡之前显示独立紧凑 region“今日长难句”；首次欢迎页、会话完成页与导航不新增该入口，不依赖红宝书加载。
- 初始仅显示标题、稳定披露“AI 原创长难句 · 非历年真题”和“生成今日长难句”；页面加载、视图切换、刷新、恢复和预加载均不请求 API。
- 本地自然日只复用 `localDateKey` 派生；`useClock` 继续每分钟更新，并在页面重新可见或窗口重新聚焦时立即刷新。日期变化以 `key={localDate}` 重建组件、取消旧请求和旧朗读；昨天缓存不作为今日内容。
- 缓存固定为 `schemaVersion: 1`、`promptVersion: "daily-sentence-v1"`、`localDate`、确定性 `inputKey`、结构化 `content`、ISO `generatedAt` 与 `source: "ai"`。
- inputKey 按固定字段顺序序列化 schemaVersion、promptVersion、localDate；不含随机数、生成时间、React render 次数或模糊的 today。
- 同日合法缓存刷新和 API 断网时直接显示，新增请求为 0；重新生成只有成功后才覆盖。503/429/502、断网或非法结构保留旧合法缓存；无当日缓存时只显示真实错误和重试，不显示本地模板或昨天内容。

## API 与结构化内容

- 新增唯一 `POST /api/daily-sentence`，请求正文上限 8 KiB，顶层只能是 `{ localDate }`；服务端严格校验 `YYYY-MM-DD` 与真实日历日期，不按服务器时区重算。
- 路由复用 `getProviderConfig`、`chatCompletion`、`parseJsonContent`、`withRetry`、`readJsonBody` 与 `beginApiRequest`；独立策略为 10 次/分钟、最大并发 2、响应 1 MiB、25 秒、最多 2 次、temperature 0.35、JSON object、maxTokens 1800。
- 未配置模型返回 503，非法日期/结构返回 400，api-guard 保留 403/413/429，Provider、JSON 或结构失败返回 502；无本地伪 AI 200，也不记录密钥、完整请求头或模型原文。
- 成功内容只含 `sentence`、`backbone`、`clauses[{text,type,function}]`、`modifiers[{text,target,relation}]`、`translation`。英文原句必须 30–70 词且不超过 1200 字符；主干、译文必填。
- clauses 为 2–8 项，至少一个 main 与一个非 main，枚举仅允许 main/relative/noun/adverbial/appositive/coordinate/other，text 必须连续映射原句；modifiers 为 1–12 项，text 连续映射原句，三个字段均非空。
- 所有字符串 trim 并折叠空白；字段缺失、错误数组、非法枚举、超量、无法映射、Markdown 围栏、HTML、占位符或残缺内容整体拒绝，不部分缓存。
- 系统提示明确生成考研英语风格原创句，不是历年真题、教材原文或权威语料，禁止引用、拼接或近似复现受版权保护原句。

## 持久化、朗读与数据隔离

- `StoredState.dailySentence?` 进入既有 settings，经 `normalizeStoredState`、默认旧状态、`splitStoredState/combineStoredState`、IndexedDB settings/state-domains、localStorage 兼容副本、自动 revision、跨标签同步、备份导入/导出和恢复副本完整往返。
- 非法 schema、prompt、inputKey、localDate、generatedAt、source 或 content 只移除 dailySentence，不丢弃其他 settings 或学习数据；旧状态无字段正常读取。
- `clearLearningRecords` 保留合法 dailySentence，它是日期绑定内容缓存而非学习事实。`STORAGE_VERSION = 5`、`DATABASE_VERSION = 3`、`BACKUP_FORMAT = wordloop-backup`、12 个既有 store/domain 均未变化；未修改 `lib/backup.ts`，未新增 object store 或 state domain。
- 成功卡片始终展示英文原句、中文译文、今日缓存日期和主要操作；解析可折叠，展开后显示主干、具名从句类型、结构功能及修饰目标/关系，不使用 HTML 注入或只靠颜色表达。
- 长句朗读复用 `lib/word-audio.ts` 的通用浏览器文本控制，不进入单词录音索引、不调用云端 TTS、不自动朗读；语音为 `en-US`、rate 0.8。
- 朗读、暂停/继续、重播均为原生按钮；重播先 cancel 再 speak。日期变化、内容替换与组件卸载取消旧 utterance；不支持 speechSynthesis 时可见说明“文字与解析仍可正常使用”。
- 生成、缓存、刷新、朗读、暂停、继续、重播和展开解析均不写或改变 reviews、quizAttempts、wordProgress、FSRS cards、今日任务、activeSession、activeQuiz、stubbornWords、lookupStats、guessMistakes、senseFrequency 或 weak-signals。

## 实际修改文件

- 核心与 API：`lib/daily-sentence.ts`、`lib/study.ts`、`lib/storage.ts`、`lib/ai-provider.ts`、`lib/word-audio.ts`、`app/api/daily-sentence/route.ts`。
- UI：`app/components/DailySentenceCard.tsx`、`app/page.tsx`、`app/hooks/useClock.ts`、`app/globals.css`。
- 最小兼容修复：`app/hooks/useSelectionLookup.ts`。新增卡片使词卡下移后，既有划词弹窗 220px 估高与 CSS 330px 上限不一致；改为真实上限并夹取视口上界，不改变查词数据或交互语义。
- 测试：`tests/api-guard.test.ts`、`tests/study.test.ts`、`tests/e2e/daily-sentence.spec.mjs`。
- 文档：`docs/iterations/round-72.md`、`docs/project-evolution.md`、`docs/iterations/next-round-prompt.md`。
- 未修改 `lib/backup.ts`、Quiz/FSRS/ReviewEvent/weak-signals、红宝书/数据文件、Provider 协议、Canonical 或其他用户保护文件。

## 红测、修复与验证

| 级别 / 命令 | 结果 | 耗时与说明 |
|---|---|---|
| 红测 / api-guard + study | 0 pass / 2 fail | 约 0.14 秒；两个入口均因 `lib/daily-sentence.ts` 尚不存在而预期失败 |
| V1 / api-guard + study | 90/90 | 最终测试器约 0.34 秒；新增日期、篇幅、结构、缓存、settings/备份/清空契约 |
| V2 / `npm run typecheck` | 通过 | 最终约 2.1 秒 |
| V2 / `npm run lint` | 0 error / 1 个既有 warning | 约 8.4 秒；`lib/weak-signals/projection.ts` 的未使用类型未改 |
| V0 / `git diff --check` | 通过 | 仅 Git LF/CRLF 工作区提示 |
| V3 / 新 daily-sentence E2E | 4/4 | 约 11.8 秒；显式生成、缓存/跨日/失败、朗读与响应式 |
| V3 / 相邻链拆分联跑 | 41/41 | 约 92 秒有效运行；daily-sentence 4、learning 19、daily-cloze+etymology 7、data-lifecycle+responsive 11 |
| V4 / `npm test` | build 通过；unit 319/319 | 整条约 8.8 秒；Node 测试器约 0.82 秒；构建识别 `/api/daily-sentence` |
| V4 / `npm run smoke:production` | 通过 | 首页激活、静态资源、6550 词、音频索引和 Range 206 均有效 |

- 相邻 E2E 首次整组因工具缓冲导致连续两分钟无输出，按 SOP 中断后拆分；随后 Range 用例真实暴露划词弹窗落出视口，按上述最小兼容修复后所有 41 项通过，没有降低断言。
- 新增 E2E 证明 API body 只有浏览器本地 localDate，加载态 `aria-busy` 可见，结构完整，reviews/quizAttempts/wordProgress/FSRS 和今日任务前后不变。
- 缓存刷新、API 断网、昨天状态、503/502、重新生成失败保留、无缓存失败、SpeechSynthesis mock、Enter/Space、320px、200%/400% 均有自动证据。

## 服务、生成文件与保护现场

- dev 在受限沙箱内首次启动被 CIM 拒绝且未占端口；授权后固定 `127.0.0.1:3000` 启动唯一实例：worker PID 56748、listener PID 21308，日志 `.wordloop-runtime/rounds/dev-20260811-200820.out.log` / `.err.log`，健康状态为 200。
- V3 后精确停止 worker PID 56748，listener 随服务退出；未切换 3001/3002，未批量终止 Node。
- production smoke 采集到 worker/listener PID 55672/55672，日志 `.wordloop-runtime/smoke-20260811T123225Z.out.log` / `.err.log`，wrapper exit 0；脚本自行停止，最终端口 3000 无监听。
- dev/build 曾改写 `lib/build-info.generated.ts`（dev 临时 blob `c07076f3bf833df7522c18bb111ff91029bc94eb`）；所有服务、build 和 smoke 结束后仅恢复该文件为起始/HEAD blob `4410b1880754eea8e9ee2a9263d372318efac3f3`，之后不再运行生成命令。
- Canonical 前后 SHA-256 均为 `334108484E19A792F9C5DAD2E50BC644EF4F0AB3097B45EDAD43A4267C1DA90F`；`1.txt`、`2.txt`、`.zcode/`、历史日志、架构/竞品/规划文档、favicon 与爬取脚本均未修改、未暂存。

## 提交与停止

- 指定提交信息：`feat: 增加长难句每日一句`。
- 只精确暂存本轮实现、测试和三份迭代文档；不 merge、不 push。
- P1-7、P1-9、P1-8 已分别独立完成，P1 阶段结束。第 1/1 轮提交后立即 STOP，不自动进入 P2-10/P2-11/P2-12。
