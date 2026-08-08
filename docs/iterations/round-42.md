# 第 42 轮：第一阶段架构重构（信号结构化 + 日期统一）

日期：2026-08-09
基线：`1a4d330`
分支：`codex/refactor-stage1`（任务 B，完成后合回 `codex/follow-up-hardening`）

## 目标与边界

- 消除「中文字符串作为模块通信协议」的高风险边界：信号类型改为结构化稳定 key，中文标签只作为展示层字符串逐字保留；统计逻辑不再解析中文文案。
- 统一分散在多个模块的重复日期工具（本地自然日 key、日零点、日历日加减、本地周起点），逐字符复制现有实现，行为零变化。
- 不改变现有 UI 文案（含 CSV 导出、复制文本、E2E 断言文案）、不改变统计结果、不改变 StoredState/IndexedDB schema、不改变信号阈值与冲刺/达标/复发计算。
- 不修改评分、FSRS、每日 Quiz 门禁、备份链路或 package.json scripts；不动 `app/page.tsx`、`app/components/*`、`app/hooks/*`、`lib/learning.ts`、`lib/storage.ts`。
- 业务不确定项（「到期词首次」注释无实现、`answeredAt` 本地/UTC 混合比较、答错也写入 FSRS、毫秒窗口 vs 日历天、attempt 5000 条裁剪）一律保持现状，仅固定契约，不借重构改变。

## 实现

1. `lib/weak-signals.ts`：新增 `WeakSignalKey`（=`WeakDimensionTrend["key"]` 的 8 元 union）与 `WeakSignalEntry{key,label}` 类型；原 `buildWordWeakSignals` 完整逻辑迁入新增导出函数 `buildWordWeakSignalEntries`（8 个判定条件、固定顺序、阈值与淡出注释全部原样，`push(label)` 改为 `push({key,label})`）；`buildWordWeakSignals` 变为对 entries 的 label 投影，返回 `string[]` 形状与既有签名不变（`app/page.tsx:404` 的 `as Record<number, string[]>` 强转不受影响）。删除私有 `localDayStart/addLocalDays/localWeekStart/localDateKey`，改从 date-utils 导入。
2. `lib/date-utils.ts`（新建）：`localDateKey`（string|Date，= 原 `study.dateKey` 全文）、`localDayStart`、`addLocalDays`、`localWeekStart`，逐字符复制既有实现，不 import 任何其他模块（无循环依赖）。
3. `lib/study.ts`：`dateKey` 实现移除，改为 `import { localDateKey as dateKey } from "./date-utils.ts"` + `export { dateKey }`（双语句，保持 study.ts 内部 6 处调用与 8 个外部调用点零改动；单语句 re-export 在 ES 模块下不建立局部绑定，会破坏内部调用）。
4. `lib/quiz.ts`：`shouldApplyQuizToSchedule` 内联日期 key 替换为 `localDateKey(now)`（逐字符等价）；判定逻辑与注释一字未动（每日首次契约 = 只查该词当天是否已有测验作答，本地 today vs `answeredAt.slice(0,10)` UTC 混合比较现状保留）。
5. `lib/insights.ts`：删除私有 `localDayStart/addLocalDays/localWeekStart/localDateKey`，改从 date-utils 导入。
6. `lib/session-summary.ts`：`stillWeakWords` 增加 `signalKeys: WeakSignalKey[]` 加法字段；构建处一次调用 `buildWordWeakSignalEntries` 后投影 label/key；`sprintDimensionCounts` 删除 `startsWith("查过")` 等 8 条中文前缀解析链，改按结构化 key 累加；`signals` 标签与 `dimensionCounts` 输出结构一字不变（SessionCompleteView、page.tsx 零改动）。
7. 测试：`tests/weak-signals.test.ts` 新增「结构化信号条目 key↔label 同源映射完整且顺序固定」（8 key 顺序 + 8 label 逐字 + 与 `buildWordWeakSignals` 投影一致）；`tests/session-summary.test.ts` 新增「五维盲区按结构化 key 正确计数」（guess/quiz-spelling/quiz-c2e/quiz-choice/slow-recall 各 1，lookup/stubborn/lapse 为 0，signalKeys 与 signals 同长）；日期边界测试（localDateKey 本地语义、localDayStart 午夜归零、addLocalDays 跨月跨年负数、localWeekStart 周日/周一/边界）并入 `tests/study.test.ts`（dateKey 原归属文件，`npm test` 脚本显式列出、不改 scripts）。

## 验证

- 定向单测（weak-signals/session-summary/insights/quiz/study/study-session + 日期测试）：150/150。
- `npm run typecheck`：通过（零错误）。
- `npm run lint`：通过（0 问题；过程中清理一处未使用 import）。
- `npm test`：217/217（基线 211 + 新增 6：weak-signals 1、session-summary 1、日期 4），含生产构建。
- `npm run build`：通过。
- `tests/e2e/signal-flow.spec.mjs`：18/18（47.1s），固定端口 3000（本项目 vinext dev，PID 42272，专属日志 `.codex-round42-e2e.{out,err}.log`，验证后已按证据关闭，3000 无监听）。既有 18 条语义未改，无需新增。
- `lib/` 下无任何中文前缀/字符串解析信号类型残留（grep 复核）；日期函数唯一实现在 `lib/date-utils.ts`。
- build 生成的 `lib/build-info.generated.ts` 已按第 41 轮模式恢复基线（安全补丁方式，内容 diff 为空），不进入提交。

## 边界与清理

- 未新增 schema/version/store/domain；未改评分、FSRS、每日 Quiz 门禁、备份、package scripts、历史 reviews/quizAttempts、推荐优先级；未重构 `useStudyPersistence`、未拆分 `page.tsx`、未引入事件总线或新状态库；信号从不持久化（全部读时派生），历史数据兼容自动成立。
- 不确定业务规则已登记：quiz.ts 注释「到期词首次」无独立实现（`shouldApplyQuizToSchedule` 只查当天已作答）；本地/UTC 日期混合比较；答错 rating 0 也写入 FSRS；weak-signals 周窗口毫秒差 vs 日历天；attempt 5000 条裁剪后守卫重新放行。全部保持现状，需产品决策时另行处理。
- 受保护未跟踪项（`1.txt`、`docs/architecture-analysis-2026-08-09.md`、第 38/40/41 轮日志、`.zcode/`）未触碰；任务 B 自身日志 `.codex-round42-e2e.*.log` 为未跟踪项，不进入提交。

## 阶段与交接

- 任务 B（第一阶段架构重构）完成：中文标签不再作为信号分类协议，统计逻辑依赖结构化 key，中文 UI 文案逐字保持，日期工具唯一化，定向/全量测试、lint、typecheck、build 与 signal-flow E2E 全绿。
- 第 42 轮唯一提交在 `codex/refactor-stage1`，合回 `codex/follow-up-hardening`（merge --no-ff），不推送。
- 按自动串行协议：下一阶段（第 43 轮）为架构重构第二阶段（候选：AI Provider 客户端合并等，由审计后按最高价值断链选定），阶段 E 边界只读审计顺延到最后。
