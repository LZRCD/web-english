# 第 71 轮完成 Prompt：Canonical P1-9 每日短文填词

## 当前状态

- Canonical P1-9 已完成：测验页支持用户显式生成、缓存、恢复和重新生成“每日 AI 原创短文填词”。
- 实施报告：`docs/iterations/round-71.md`。
- 目标只来自当前本地自然日真实 `review.kind === "new"` 事件，按有效真实 wordId 精确解析、稳定排序去重，最多 10 个；不混入 review、未来事件、无效 ID 或进度反推词，不用旧词补足。
- 界面和生成契约明确“AI 原创短文 · 非历年真题”；内容不是教材原文、权威语料或历年真题。
- 单轮批次达到 1/1，STOP；不自动进入 P1-8、P2、提醒、真题语料或其他目标，不 push。

## 已完成契约

1. 新增唯一 `/api/daily-cloze`，请求只含 localDate 与有序 targets(wordId/word/meaning)，复用现有 Provider、api-guard、超时、重试、JSON 解析和密钥缺失处理；无本地伪 AI 200 fallback。
2. 响应只含 passage 与 questions(wordId/options/explanation)：正文 80–120 个英文词、1–10 题、每题恰好 4 个唯一候选并包含真实答案，所有目标顺序和 ID 与输入严格一致，每个词按安全边界恰好挖空一次。
3. 缓存固定为 schemaVersion 1、promptVersion `daily-cloze-v1`，保存 localDate、确定性 inputKey、有序 targetWordIds、结构化 content、generatedAt 与 AI source。inputKey 完整包含每个目标的真实 wordId/word/meaning。
4. 缓存仅作为 `StoredState.dailyCloze?` 进入既有 settings 记录；`STORAGE_VERSION = 5`、`DATABASE_VERSION = 3`、备份格式和既有 stores/domain 均未改变，未新增 store/domain，也未修改 `lib/backup.ts`。
5. 同日同输入刷新、离线与重新开始只用有效缓存，不自动请求；跨本地自然日，或当天目标增删/调序、英文/释义变化时旧缓存与 passage activeQuiz 都失效。重新生成失败保留旧合法缓存。
6. 新增 `passage-cloze` QuizMode；activeQuiz 保存完整题目快照与 inputKey，只有日期、版本、目标和输入身份都匹配时恢复，陈旧会话先隐藏后清除并给出提示。
7. 每次作答写真实 QuizAttempt。首次有效作答复用 `shouldApplyQuizToSchedule` 写入一次 FSRS；同词同日重答、重新开始或其他 QuizMode 已作答时只记录 attempt，`appliedToSchedule: false`。
8. 错误以独立 `quiz-cloze` 维度进入错词标签、时间线、周趋势与同维恢复；不冒充辨析/拼写/中译英，不混入 sprint 推荐、冲刺留存或分维度观察分母。
9. 作答前 DOM 只含安全挖空短文与 4 个中性选项，不含正确答案、真实释义、解释或 answer/correct 等泄漏属性；作答后才展示答案、释义和解释。
10. 零目标、503、429、502、断网或非法响应均诚实降级且零业务写入；原生按钮支持 Tab、Enter/Space，320px 无横向溢出，200% / 400% 缩放下核心信息和操作可达。

## 验证现场

- 红测按预期 92 pass / 4 fail；最终聚焦 187/187，typecheck 通过，lint 0 error / 1 个既有 warning，`git diff --check` 通过。
- daily-cloze、activeQuiz recovery、data lifecycle、signal flow、responsive 联跑 35/35；其中覆盖跨模式同日 FSRS 去重、重新生成失败保留旧缓存、离线恢复与输入变化失效。
- `npm test` production build 通过并识别 `/api/daily-cloze`，全量 Node 310/310；production smoke 验证首页激活、静态资源、6550 词、音频索引和 Range 206。
- 最终 dev worker/listener PID 51516/58760，production worker/listener PID 37032/37032；两种服务均精确停止，固定端口 3000 已释放。
- build-info 已恢复为起始 HEAD blob `4410b1880754eea8e9ee2a9263d372318efac3f3`；Canonical SHA-256 保持 `334108484E19A792F9C5DAD2E50BC644EF4F0AB3097B45EDAD43A4267C1DA90F`。

## 等待规则

- P1-9 已完成并停止，当前检查点不构成 P1-8 或任何其他路线图目标的实施授权。
- P1-8 必须由用户重新授权，并从新的 Round 0 开始重新核对分支/HEAD、tracked/index、保护文件、真实调用链、端口归属和最新验证基线。
