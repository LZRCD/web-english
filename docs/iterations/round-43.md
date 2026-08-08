# 第 43 轮：架构重构第二阶段（AI Provider 客户端合并）

日期：2026-08-09
基线：`aaa1a1e`（第 42 轮合并提交）
分支：`codex/refactor-stage2`（完成后合回 `codex/follow-up-hardening`）

## 目标与边界

- 把 5 个 API 路由（coach/enrich/enrich/review/lookup/sense-frequency）各自重复实现的 Provider 客户端逻辑合并为唯一实现 `lib/ai-provider.ts`：环境变量读取、/chat/completions 请求构造、Markdown JSON 清理、响应提取、重试。新增 Provider、调整超时或统一日志的改动点从 7 处收敛为 1 处。
- 行为逐字节保持：各路由超时（15000/15000/12000/12000/20000）、max_tokens（260/1400/180/360/1200）、temperature（0.7/0.2/0/0.1/0.2）、thinking/response_format 有无、响应上限（1M/2M/512K/1M/2M）、错误文案、no-key 分支、coach localAnswer 本地兜底与静默 catch、重试范围（仅 enrich/lookup/sense-frequency 的 MAX_ATTEMPTS=2）全部按原实现。
- 不修改评分、FSRS、每日 Quiz 门禁、备份链路、package.json scripts、IndexedDB schema/StoredState、page.tsx、useStudyPersistence；不动 `lib/api-guard.ts`、`lib/enrichment.ts`、`lib/sense-frequency.ts`、`lib/learning.ts`、hooks、README、vite.config；不新增依赖；不发起真实云调用（单测 mock fetch）。

## 实现

1. `lib/ai-provider.ts`（新建）：`getProviderConfig()`（`DEEPSEEK_API_KEY ?? OPENAI_API_KEY`、`OPENAI_BASE_URL ?? "https://api.deepseek.com"`、`OPENAI_MODEL ?? "deepseek-v4-flash"`，apiKey 可 undefined）；`parseJsonContent<T>`（Markdown 围栏清理 + JSON.parse，逐字符复制 4 路由原实现）；`chatCompletion(options)`（尾斜杠处理、`AbortSignal.timeout`、Bearer 头、按「有则含无则不含」拼装 thinking/response_format、非 2xx 由调用方 `errorMessage(status)` 逐字提供文案、`readJsonBody(maxBytes)` 读体 + `choices[0].message.content` 提取、content 缺失返回 undefined）；`withRetry(attempts, fn)`（原 MAX_ATTEMPTS 循环语义：吞错重试、全败抛最后一次错误）。内部仅依赖 `lib/api-guard.ts`。
2. 5 个路由改写（仅替换 Provider 逻辑段）：env → `getProviderConfig()`；fetch 段 → `chatCompletion`（参数值按原请求体逐项传入）；Markdown 清理 → `parseJsonContent`；重试 → `withRetry(2, ...)`（仅 3 路由）；错误文案与日志前缀逐字保留在路由（coach `"AI service unavailable"` 且静默 catch 不新增日志；enrich/review/lookup `` `云端模型返回 ${status}` ``；sense-frequency `"云端模型返回 " + status`；`[api/enrich] 内容生成失败` 等 4 处日志）；no-key 分支（coach localAnswer、其余 503 文案）、系统提示词、boundedText 裁剪、normalize 校验全部原样。
3. `tests/rendered-html.test.mjs`：287 行 `assert.match(coach, /AbortSignal\.timeout\(15000\)/)` 改为对 `lib/ai-provider.ts` 源码的等价断言（`/AbortSignal\.timeout\(/`，新增读取 aiProvider 变量、移除不再使用的 coach 变量），其余断言一字未动。
4. `tests/api-guard.test.ts` 新增 9 个 test（Provider env 回退、parseJsonContent 清理、请求体/信号/Bearer、thinking/response_format 有无、choices 缺失返回 undefined、非 2xx 文案、maxBytes 413、withRetry 首败重试/全败抛末错）：mock `globalThis.fetch`，不发起真实网络；既有断言未改；测试文件在 `npm test` 显式列表内，不改 package scripts。

## 验证

- `npm run typecheck`：通过（零错误）。
- 定向（api-guard + rendered-html）：21/21（api-guard 12 = 既有 3 + 新增 9；rendered-html 9）。
- `npm run lint`：通过（0 问题；清理 rendered-html 中不再使用的 coach 变量）。
- `npm test`：226/226（基线 217 + 新增 9），含生产构建。
- `npm run build`：通过。
- `tests/e2e/signal-flow.spec.mjs`：18/18（46.5s），固定端口 3000（本项目 vinext dev，PID 48012，专属日志 `.codex-round43-e2e.{out,err}.log`，验证后按证据关闭，3000 无监听）。测试环境无 API key，E2E 全走 no-key 分支，响应逐字不变；既有 18 条语义未改。
- 请求体等价性由单测与主 Agent diff 审查双重确认（含 coach 无 thinking/response_format 字段的字段有无）。
- build 生成的 `lib/build-info.generated.ts` 已恢复基线（安全补丁，内容 diff 为空），不进入提交。

## 边界与清理

- 未新增 schema/version/store/domain；未改评分、FSRS、每日 Quiz 门禁、备份、package scripts、历史数据、推荐优先级；未动 api-guard/enrichment/sense-frequency/learning/hooks/README/vite.config。
- 统一客户端 API 形状为「参数化 + 必填 timeoutMs/maxTokens/maxBytes」，防止后续顺手统一参数值（参数值变化即行为变化，须产品决策）。
- coach 静默 catch 未新增日志（严格零行为变化）；lookup 内联 normalizeLookup 与 review 校验留在路由（缩小本轮范围）。
- 受保护未跟踪项未触碰；第 43 轮日志 `.codex-round43-e2e.*.log` 为未跟踪项，不进入提交。

## 阶段与交接

- 架构重构第二阶段完成：Provider 客户端唯一实现，5 路由 × 7 类重复收敛为 1 个 lib，行为逐字节保持，定向/全量测试、lint、typecheck、build 与 signal-flow E2E 全绿。
- 第 43 轮唯一提交在 `codex/refactor-stage2`，合回 `codex/follow-up-hardening`（merge --no-ff），不推送。
- 按自动串行协议：下一阶段（第 44 轮）候选为其余架构重构项（weak-signals.ts 拆分、useSelectionLookup 拆分、行为测试替换正则测试、View model/CSS 拆分等，需候选审计按最高价值断链选定），阶段 E 边界只读审计仍顺延到最后。
