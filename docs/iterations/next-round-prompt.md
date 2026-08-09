# 第 49 轮待授权 Prompt：阻止测验作答历史静默丢失

## 当前真实现场

- 当前分支应为 `codex/follow-up-hardening`。
- 第 48 轮起始基线为 `2715dd41caf2cc42021c890cee6e6a97742790da`；第 48 轮完成后，HEAD 应为唯一中文文档提交 `docs: 审计发布准备数据护栏`。启动时用 `git rev-parse HEAD` 与 `git log -1` 登记实际完整 hash，不猜测自引用提交。
- 第 48 轮唯一终局 B：`normalizeQuizAttempts(...).slice(-5000)` 与 `setQuizAttempts([...items, attempt].slice(-5000))` 会静默丢弃合法旧作答；备份导入规范化也受影响，属于数据/备份一致性高风险明确缺口。
- `docs/iterations/release-readiness.md` 还登记了 activeSession 孤儿 ID、非法记录隔离、重复 attempt ID、清空语义和长历史性能等中风险项；本轮若获授权也不得顺带处理。
- 最近完整行为基线仍来自第 45 轮：study 35/35、typecheck 通过、lint 0 error/1 个既有 warning、`npm test` 230/230（含 build）、固定 3000 的 learning 17/17 与 signal-flow 18/18。第 46-48 轮只做文档检查，不得冒充第 49 轮结果。
- 起始 index 和 tracked 工作树应为空；继续保护实际未跟踪项、`1.txt`、`.zcode/`、架构笔记与历史日志。
- 3000/3001 应无监听；未 push。

## 授权门禁

这是终局 B 后的**待授权恢复 Prompt**，不是自动执行指令。

- 若用户没有明确说“授权第 49 轮修复”或等价指令：只核对当前状态并报告等待授权，不修改文件、不暂存、不提交、不启动服务。
- 若用户明确授权：才按下述唯一目标执行。
- 任何生产数据导出、浏览器 IndexedDB 读取/改写、历史回填、schema/version/store/domain 变化都超出本授权，立即停止请求另行授权。

## 唯一目标

防止未来合法 `quizAttempts` 因固定 5000 条裁剪而静默丢失，并用确定性测试证明状态归一化、IndexedDB 分域往返和备份导入规范化在超过 5000 条时完整保留。

不得回填已经丢失的历史，不读取或修改用户浏览器数据，不调整评分、FSRS、每日 Quiz 门禁、推荐、阈值、activeSession、activeQuiz、重复 ID 语义或清空语义。

## 允许的最小实现范围

1. 删除状态归一化与页面追加链上的固定 5000 条静默裁剪；优先复用一个可测试的追加边界，避免两个位置再次漂移。
2. 保持 `QuizAttempt` 字段、现有顺序、每日门禁、弱信号派生和 sessionId 语义不变。
3. 不新增 schema/version/store/domain，不迁移或重写历史。
4. 新增确定性测试，至少覆盖：
   - 5001 条及 10010 条合法 attempts 经 `parseStoredState` 数量与顺序完整；
   - `splitStoredState -> combineStoredState` 超过 5000 条无损；
   - `createBackupDocument -> parseBackupDocument -> parseStoredState` 超过 5000 条无损；
   - 新追加第 5001 条不丢最早记录；
   - 非法 attempt 仍按既有规则过滤，不能为“完整保留”放宽校验。
5. 如果无界数组使现有测试或构建出现可证明的内存/性能阻断，不得自行新增聚合归档、分表或 schema；记录证据并停止请求新授权。

## 建议修改边界

- `lib/study.ts`
- `lib/quiz.ts`（仅在提取可测试的无损追加 helper 时）
- `app/page.tsx`
- `tests/study.test.ts`、`tests/data-integrity.test.ts` 或一个最小等价测试文件
- `docs/iterations/round-49.md`
- `docs/iterations/release-readiness.md`
- `docs/iterations/next-round-prompt.md`
- `docs/project-evolution.md`

不得修改备份格式、storage domain、数据库版本、package scripts 或 E2E fixture 来规避问题。

## 验证顺序

授权后按风险递增执行：

1. 定向超过 5000 条的纯函数/分域/备份往返测试。
2. `npm run typecheck`。
3. `npm run lint`。
4. `npm test`（含生产 build）；若 `lib/build-info.generated.ts` 漂移，验证后恢复为本轮基线，不把生成漂移混入提交。
5. 只在纯测试无法覆盖真实页面追加时，才按固定 3000 规则运行最小相关 E2E；不得机械重跑全目录来代替针对性证据。
6. 精确复核 tracked diff、index、保护项清单和 3000/3001。

## 停止条件

- 未获得用户明确授权。
- 需要读取/修改生产数据或浏览器 IndexedDB。
- 需要回填已丢失历史。
- 需要新增 schema/version/store/domain、归档格式或备份格式。
- 发现与本缺口无关的 tracked diff、非项目端口冲突或保护文件变化。
- 无法在不改变评分/FSRS/门禁/推荐语义的前提下完成无损保留。

## 获授权后的交付

- 代码只修“未来 attempts 不再静默丢失”。
- 测试给出 >5000 条 normalize、分域、备份和追加的无损证据。
- `release-readiness.md` 只更新该高风险行；其他中风险项保持原状态。
- 精确暂存实际修改文件，创建一次中文提交，例如 `fix: 保留完整测验作答历史`；不 merge，不 push。
- 修复验证通过后，下一轮才可进入阶段 F2 测试收敛只读审计。
