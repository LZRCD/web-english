# 第 50 轮待授权 Prompt：阶段 F2 发布测试收敛只读审计

## 当前真实现场

- 当前分支应为 `codex/follow-up-hardening`。
- 第 49 轮起始基线为 `3666f6ce90769a1d815e0ae4cafdbaa3802104d1`；第 49 轮完成后，HEAD 应为唯一中文提交 `fix: 保留完整测验作答历史`。启动时用 `git rev-parse HEAD` 与 `git log -1` 登记实际完整 hash，不猜测自引用提交。
- 第 49 轮已删除 `quizAttempts` 的两处固定 5000 条裁剪；确定性验证为 study 40/40、typecheck 通过、lint 0 error/1 个既有 warning、`npm test` 含生产 build 235/235。未启动浏览器或 E2E，不得冒充当前 E2E 证据。
- `docs/iterations/release-readiness.md` 中 activeSession 孤儿 ID、非法记录隔离、重复 attempt ID、清空语义、备份容量和真实长历史性能等中风险项仍保持原状态；不得因高风险项解除而宣称全部发布就绪。
- 起始 index 和 tracked 工作树应为空；继续保护实际未跟踪项、`1.txt`、`.zcode/`、架构笔记与历史日志。
- 3000/3001 应无监听；未 push。

## 授权门禁

这是阶段 F2 的待授权 Prompt，不是自动执行指令。

- 若用户没有明确授权第 50 轮或等价指令：只核对当前状态并报告等待授权，不修改文件、不暂存、不提交、不启动服务。
- 若用户明确授权：才按下述唯一目标执行。
- 任何生产数据读取/改写、浏览器 IndexedDB 访问、业务修复、阈值调整、schema/version/store/domain/备份格式变化都超出本授权，立即停止请求另行授权。

## 唯一目标

只读审计现有单测、构建检查与 E2E 的覆盖重叠，提出一个最小、非重复、可执行的发布验证清单，并明确每项能证明与不能证明什么。

本轮不修复矩阵中的任何中风险缺口，不新增测试或 fixture，不修改业务代码、测试代码、package scripts、配置或生产数据；不得用历史 checkpoint、fixture 或合成数据冒充当前浏览器/生产证据。

## 允许的审计范围

1. 从 `package.json`、相关单测和 `tests/e2e/*.spec.mjs` 建立“风险项 -> 最小验证 -> 已有重叠”的覆盖表。
2. 重点收敛 schema/normalize、分域往返、备份/恢复、revision/跨标签、离线/配额失败、activeQuiz 刷新和构建漂移；只记录 activeSession、非法隔离、重复 attempt ID、清空语义等缺口，不修复。
3. 判断哪些验证可由现有 `npm test` 覆盖，哪些必须使用固定 3000 的浏览器链；不得机械运行全目录 E2E 代替审计。
4. 为每个保留的 E2E 给出唯一风险理由、前置状态、期望结果和与其他 spec 不重复的边界。
5. 若无法在不改代码/测试/配置的前提下形成可信最小清单，记录证据并停止，不得自行扩大授权。

## 建议修改边界

- `docs/iterations/round-50.md`
- `docs/iterations/release-readiness.md`
- `docs/iterations/next-round-prompt.md`
- `docs/project-evolution.md`

除上述审计文档外不得修改其他 tracked 文件。

## 审计顺序

1. 核对 HEAD、tracked/index、保护项和 3000/3001。
2. 只读检查 package scripts、测试入口、相关 spec 与发布矩阵；先完成覆盖表和去重理由。
3. 本轮不运行 `npm test`、E2E 或启动服务；先给出待下一轮授权执行的最小清单，避免审计与执行混为一轮。
4. 精确复核 tracked diff、index、保护项清单和端口。

## 停止条件

- 未获得用户明确授权。
- 需要读取或修改生产数据/浏览器 IndexedDB。
- 需要修改业务代码、测试、fixture、配置或 package scripts。
- 需要修复任一中风险缺口或改变产品语义。
- 发现范围外 tracked diff、非项目端口冲突或保护文件变化。
- 无法从现有测试源码和发布矩阵形成非重复的最小验证清单。

## 获授权后的交付

- 一份风险到测试的最小覆盖表，明确保留/删除重复项的理由以及证据边界。
- `release-readiness.md` 只更新 F2 测试收敛计划与当前证据状态，不改变中风险缺口结论。
- 下一轮 Prompt 只授权执行已经审计批准的最小验证清单；不夹带修复。
- 精确暂存实际修改的审计文档，创建一次中文文档提交；不 merge，不 push。
