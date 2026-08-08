# 第 44 轮：架构重构第三阶段（weak-signals God Module 拆分）

日期：2026-08-09
基线：`b47ffde`（第 43 轮合并提交）
分支：`codex/refactor-stage3`（完成后合回 `codex/follow-up-hardening`）

## 目标与边界

- 把 `lib/weak-signals.ts`（1989 行、71 个导出、11 职责组、8 个消费端的业务 God Module）按职责物理拆分，行为零变化。
- 拆分依据第 44 轮候选审计（子 Agent 239af211，只读）实测：内部单向依赖 detection ← projection ← strategy；`lib/weak-signals.ts` 保留文件名作 barrel 转发，8 个消费端（app/page.tsx、HistoryView、WordCard、WordbookView、lib/insights.ts、lib/session-summary.ts、两个测试）import 路径与命名全部零改动。
- 不修改评分、FSRS、每日 Quiz 门禁、备份链路、package.json scripts、IndexedDB schema/StoredState、page.tsx、useStudyPersistence、E2E 文件；不确定业务口径（冲刺/复发/达标时间窗口、猜错累计、慢回忆/lapse 单维判定、isQuizModeRecovered 双连对规则）一律逐字搬运不改变。

## 实现

1. 新建 `lib/weak-signals/types.ts`：全部 28 个 type 导出 + 2 个与类型同源的常量（STUBBORN_TREATMENT_SEQUENCE、SPRINT_TREATMENT_DIMENSIONS，因 `typeof X[number]` 类型派生必须与类型同文件，避免 types↔detection 成环）。
2. 新建 `lib/weak-signals/detection.ts`：阈值常量、会话 id、检测/画像/候选/稳定性域（原 L26-670；含第 42 轮 key 契约 WeakSignalKey/WeakSignalEntry/buildWordWeakSignalEntries，label 与 key 同源约束未变）；3 个内部 helper（lookupStatByWordId/quizErrorCounts/isQuizModeRecovered）升格导出供兄弟域使用（不经过 barrel，公共面仍为原导出集）。
3. 新建 `lib/weak-signals/projection.ts`：冲刺历史/成效/复发/保持/维度观察/趋势/时间线/展示域（原 L671-1492 + L1737-1989）。
4. 新建 `lib/weak-signals/strategy.ts`：冲刺词集/顽固/治疗推荐/摘要/CSV 域（原 L1493-1736）；STUBBORN_TREATMENT_LABELS 迁至唯一消费方 strategy.ts。
5. `lib/weak-signals.ts` 改造为 barrel：5 个显式 re-export 块，导出集合与拆分前完全一致（主 Agent 独立脚本验证：旧=新=74 个名字，缺失 0、多余 0，type/value 标记逐一一致，`export { DEFAULT_WEAK_THRESHOLDS, type WeakThresholds } from "./study.ts"` 转发逐字保留）。
6. 依赖方向（无环，DFS 验证）：types → 仅外部模块；detection → types；projection → detection+types；strategy → detection+types；barrel → 全部。4 处内联 `import("./study.ts")` 类型改为相对路径 `import("../study.ts")`（文件迁移必然调整，语义不变）。

## 验证

- 主 Agent 独立复核：barrel 导出集合对比脚本（旧=新，无缺失/多余）；11 个关键函数体（buildWordWeakSignalEntries/buildWordWeakSignals/buildSprintCsv/buildDimensionObservationReport/buildSprintRetentionSeries/parseSprintSessionId/buildWeakProfiles/buildWordSignalTimeline/wordRecallStats/isQuizModeRecovered/buildStubbornTreatmentRecommendation）逐字一致（0 不一致）。
- `npm run typecheck`：通过（零错误）。
- 定向（weak-signals + session-summary + insights）：107/107。
- `npm run lint`：通过（0 问题）。
- `npm test`：226/226（基线未变，无新增/删除测试），含生产构建。
- `npm run build`：通过。
- `tests/e2e/signal-flow.spec.mjs`：18/18（47.3s），固定端口 3000（本项目 vinext dev，PID 49892，专属日志 `.codex-round44-e2e.{out,err}.log`，验证后按证据关闭，3000 无监听）。既有 18 条语义未改。
- build 生成的 `lib/build-info.generated.ts` 已恢复基线（安全补丁，内容 diff 为空），不进入提交。

## 边界与清理

- 未新增 schema/version/store/domain；未改评分、FSRS、每日 Quiz 门禁、备份、package scripts、历史数据、推荐优先级；消费端（含 page.tsx）零改动；E2E 未动。
- 唯一实现形状变化：3 个内部 helper 升格为兄弟域可用的非 barrel 导出（公共面不变）；STUBBORN_TREATMENT_LABELS 随唯一消费方归位；均为物理移动，无逻辑差异。
- 受保护未跟踪项未触碰；第 44 轮日志 `.codex-round44-e2e.*.log` 为未跟踪项，不进入提交。

## 阶段与交接

- 架构重构第三阶段完成：weak-signals God Module 物理拆分（检测/投影/策略/展示 + 类型），barrel 契约完整、消费端零改动、行为零变化，定向/全量测试、lint、typecheck、build 与 signal-flow E2E 全绿。
- 第 44 轮唯一提交在 `codex/refactor-stage3`，合回 `codex/follow-up-hardening`（merge --no-ff），不推送。
- 按自动串行协议：下一阶段（第 45 轮）候选为剩余架构重构项（useSelectionLookup 拆分【需先补测试】、行为测试替换正则测试、View model/CSS 拆分等，需候选审计选定），阶段 E 边界只读审计仍顺延到最后。
