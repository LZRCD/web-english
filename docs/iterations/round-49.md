# 第 49 轮：阻止测验作答历史静默丢失

日期：2026-08-09
起始基线：`3666f6ce90769a1d815e0ae4cafdbaa3802104d1`
分支：`codex/follow-up-hardening`
状态：完成修复与验证；交付提交使用本轮中文提交，完整 hash 由下一轮启动登记，不在提交内自引用。

## 启动 stop/go 核对

- `HEAD` 为 `3666f6ce90769a1d815e0ae4cafdbaa3802104d1`，提交为 `docs: 审计发布准备数据护栏`；分支符合 Prompt。
- tracked 工作树和 index 均为空，没有范围外 tracked diff。
- 受保护未跟踪项共 25 个实际文件：`1.txt`、`docs/architecture-analysis-2026-08-09.md`、`.zcode/`、第 38/40/41/42/43/44 轮日志，以及 `docs/iterations/Typora_Hook_Log.txt`；全部只读保护。
- 3000/3001 均无监听；用户已明确授权第 49 轮，未命中生产数据、历史回填、schema/version/store/domain 或范围外缺口等停止条件，结论为 **GO**。

## 最小修复

- `normalizeQuizAttempts` 保留既有字段校验和原顺序，删除 `.slice(-5000)`，合法状态、分域合并与备份导入规范化不再静默丢弃最早记录。
- `lib/quiz.ts` 新增 `appendQuizAttempt` 无损追加边界，页面 `recordQuizResult` 复用该 helper，不再维护第二处固定裁剪。
- `QuizAttempt` 字段、顺序、非法记录过滤、每日门禁、评分、FSRS、弱信号、推荐和 sessionId 语义均未改变。
- 未新增 schema/version/store/domain、迁移、归档或备份格式；未读取或修改浏览器 IndexedDB，未回填已经丢失的历史。

## 确定性证据

`tests/study.test.ts` 新增 5 项：

1. 5001 条与 10010 条合法 attempts 经 `parseStoredState` 数量、字段和顺序完整。
2. 在 5001 条合法记录前加入非法时间记录，非法项仍被过滤，其余记录完整保留。
3. 5001 条经 `splitStoredState -> combineStoredState` 无损往返。
4. 5001 条经 `createBackupDocument -> parseBackupDocument -> parseStoredState` 无损往返。
5. `appendQuizAttempt` 追加第 5001 条后长度为 5001，最早记录仍为 `attempt:0`。

## 验证

- 定向 `node --experimental-strip-types --test tests/study.test.ts`：40/40。
- `npm run typecheck`：通过。
- `npm run lint`：0 error / 1 个第 44 轮既有 warning（`lib/weak-signals/projection.ts` 的未使用类型），未处理范围外告警。
- `npm test`：生产 build 通过，235/235；超过 5000 条的确定性用例没有造成内存或性能阻断。
- 页面只改为调用已直接单测的纯追加 helper，真实页面追加无需浏览器状态；分域与备份链也由纯往返覆盖，因此按 Prompt 不启动 3000、不运行 E2E。
- build 产生的 `lib/build-info.generated.ts` 漂移已恢复为本轮基线；恢复后不再运行 build 生成命令。

## 范围与交付

- `docs/iterations/release-readiness.md` 仅解除 `quizAttempts` 静默裁剪这一高风险项；activeSession、非法隔离、重复 attempt ID、清空语义和长历史性能等原中风险项不变。
- 下一轮进入阶段 F2 测试收敛只读审计；不得把本轮合成测试冒充生产数据或设备性能证据。
- 精确暂存本轮实际修改文件，创建一次中文提交 `fix: 保留完整测验作答历史`；不 merge，不 push。

## 提交前复核

- 实际授权 diff 共 8 个文件：`app/page.tsx`、`lib/quiz.ts`、`lib/study.ts`、`tests/study.test.ts`、本轮记录、发布矩阵、下一轮 Prompt 与项目演进记录；没有范围外 tracked 文件。
- `git diff --check` 通过；index 在精确暂存前为空，`lib/build-info.generated.ts` 与起始基线一致。
- 25 个既有未跟踪保护文件仍在原清单中；`1.txt`、架构笔记、Typora 历史日志及两份 `.zcode` 计划的 SHA-256 与启动登记逐项一致，本轮未启动会写日志的服务。
- 3000/3001 最终均无监听；未访问 IndexedDB，未 merge，未 push。
