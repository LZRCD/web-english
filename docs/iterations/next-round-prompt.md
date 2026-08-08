# 下一轮执行 Prompt：第 43 轮架构重构第二阶段（AI Provider 客户端合并）

## 当前现场

- 第 42 轮（任务 B）第一阶段架构重构已完成：信号结构化 key + 日期工具统一，提交 `305f059`，merge `aaa1a1e` 合回 `codex/follow-up-hardening`（HEAD，ahead 48，未 push）。
- 第 43 轮候选审计已完成（子 Agent 8e62e9f2，只读）：**唯一目标 = AI Provider 客户端合并**。5 个 API 路由 × 7 类 Provider 逻辑重复（env 读取、/chat/completions 请求构造、Markdown JSON 清理、响应提取、错误解析、重试、失败日志），合并为单一 `lib/ai-provider.ts` 是当前最高价值断链（新增 Provider 现需改 7 个触点 → 1 个）。
- 工作区仅剩受保护未跟踪项；端口 3000 无监听。

## 前置门槛

- HEAD 必须为 `aaa1a1e`；从 `codex/follow-up-hardening` 切短命分支 `codex/refactor-stage2`，全部代码修改/测试/构建/提交只在本分支。
- 全程使用 ZCode 接入的 DeepSeek V4 Flash（主 Agent 与子 Agent 均须外部证据确认，`zen-v4-flash=deepseek-v4-flash` 等价）；无法确认停止并如实报告。
- 不修改受保护未跟踪项；不触碰任务 A/B 已提交内容；不推送远端。

## 唯一目标

把 5 个 API 路由（app/api/coach、enrich、enrich/review、lookup、sense-frequency）重复实现的 Provider 客户端逻辑合并为唯一实现：

1. 新建 `lib/ai-provider.ts`：env 读取（`DEEPSEEK_API_KEY ?? OPENAI_API_KEY`、`OPENAI_BASE_URL ?? "https://api.deepseek.com"`、`OPENAI_MODEL ?? "deepseek-v4-flash"`）、参数化 `chatCompletion`（messages/temperature/maxTokens/timeoutMs/thinking/responseFormat/maxBytes）、`parseJsonContent`（Markdown 清理）、可选重试；参照 `lib/api-guard.ts` 的「唯一实现」模式。
2. 改写 5 个路由：仅替换 Provider 逻辑段；**逐字节保持**各路由参数值（超时 coach/enrich 15000、review/lookup 12000、sense-frequency 20000；温度 0.7/0.2/0/0.1/0.2；max_tokens 260/1400/180/360/1200；thinking/response_format 开关按各路由原请求体；响应上限 1M/2M/512K/1M/2M；错误文案 `AI service unavailable`/`云端模型返回 ${status}` 等；重试仅 enrich/lookup/sense-frequency MAX_ATTEMPTS=2）。保留：no-key 分支与文案（coach `localAnswer` 本地兜底、其余 503）、系统提示词、boundedText 裁剪、normalize 校验、coach 静默 catch（不新增日志）。
3. `tests/rendered-html.test.mjs:287` 断言 `assert.match(coach, /AbortSignal\.timeout\(15000\)/)` 合并后必红：按最小改动同步（改为断言新 `lib/ai-provider.ts` 源码中的等价特征），不得影响同文件其他断言。
4. 新建 Provider 单测：**mock fetch**（不得真实云调用），覆盖 env 默认值、baseUrl 尾斜杠、Bearer 头、5 组超时/上限参数传递、choices 提取、Markdown 清理、错误抛错、重试；测试并入 `tests/api-guard.test.ts`（`npm test` 显式列出的既有 API 基础设施测试文件，**不修改 package.json scripts**）。
5. 不修改：`lib/api-guard.ts`、`lib/enrichment.ts`、`lib/sense-frequency.ts`、`lib/learning.ts`、hooks、`README.md`、`vite.config.ts`、package.json scripts、E2E 文件；不引入新依赖。

## 强制安全规则

- 禁止 `git reset --hard`、`git checkout --`、`git clean`、强制覆盖、删除 Git lock；禁止 `git add .`/`git add -A`/`git commit -am`。
- 不删除、不覆盖用户已有修改；不自动清理既有轮次日志；不推送远端。
- 严格「只搬运不改口径」：不得顺手统一超时/温度/上限/错误文案（那是行为变化）；业务含义不确定项保持现状。
- 结论必须基于当前实际代码重新验证；不改评分、FSRS、每日 Quiz 门禁、备份、schema/StoredState、page.tsx、useStudyPersistence。

## 执行流程

1. Round 0 只读基线（git 状态/HEAD/端口 3000）+ 主 Agent 模型证据；切分支 `codex/refactor-stage2`。
2. 实施阶段单实施子 Agent（ZCode DeepSeek V4 Flash，记录模型验证块）：按上述边界实现 `lib/ai-provider.ts` + 5 路由替换 + rendered-html:287 断言同步 + api-guard.test.ts 并入新单测；子 Agent 不得提交。
3. 主 Agent 审查全部 diff：逐路由核对参数值/文案/no-key 分支逐字节保持；核对 fetch 请求体与原实现逐字段一致（用 git diff 对照 5 个路由原样）。
4. 分级验证：typecheck → 定向单测（api-guard/ai-provider 相关）→ `npm test` 全量（含 build，基线 217 + 新增）→ lint → build → signal-flow E2E（固定端口 3000，专属日志，验证后按证据关闭 PID，3000 释放）；build 生成的 build-info 恢复基线（安全补丁，不进入提交）。
5. 创建第 43 轮唯一提交（`codex/refactor-stage2`）：只暂存任务 B 文件 + `lib/ai-provider.ts` + 测试 + `docs/iterations/round-43.md` + `docs/project-evolution.md`（第六十二次迭代）+ 本文件（覆盖为第 44 轮）。提交前展示 status/diff 自查。
6. 合回 `codex/follow-up-hardening`（`git merge --no-ff`），合并后完整验证；不推送。

## 输出要求

- 按第 42 轮报告格式输出：Round 0 基线、子 Agent 模型与分工、实际修改、兼容性说明、验证结果（实际数字）、Git 提交（哈希/message）、未解决问题、与既有轮次合并状态。
- 最终汇报五要素简版（总长 ≤300 字）。
