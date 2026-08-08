# 第 41 轮：阶段 D 分维度观察报告

日期：2026-08-09
基线：`cf46fdc`
分支：`codex/follow-up-hardening`

## 目标与边界

- 建立只读、并列、非因果的“分维度观察报告”最小纵向链：从统一 parser 识别真实未来维度，按维度汇总冲刺活动与第 38 轮首次正常复习保持观察，在轨迹页披露样本数与未知历史；不排名、不改推荐、不进阶段 E。
- 不新增 schema/version/store/domain，不回填历史维度，不改评分、FSRS、每日 Quiz 门禁、备份、package scripts 或历史数据。
- 不修改当前固定处置优先级，不做排行、胜负、最佳模式、权重、自适应推荐或因果文案；不从按钮、标题、toast、中文标签、当前画像或 quizAttempt 猜历史维度。

## 实现

1. `lib/weak-signals.ts` 新增唯一纯函数 `buildDimensionObservationReport(reviews, input, now, weeks=4, thresholds)` 与类型 `DimensionObservationRow`/`DimensionObservationReport`：固定 8 个已知 treatment 维加 `unknown` 共 9 行，按 `SPRINT_TREATMENT_DIMENSIONS` 顺序输出，不按数量排序。
2. 锚点规则与第 38 轮 `buildSprintRetentionSeries` 完全一致：全局按 `(reviewedAtMs,id)` 总序取窗口内每词最近一次 `rating≥2` 冲刺为唯一锚点，再按 `parseSprintSessionId(锚点.sessionId).dimension ?? "unknown"` 归属维度；任意下一 `sprint:*` 无条件截断，`quiz:*` review 与无 sessionId review 可作随访，quizAttempt 不参与。维度只附着锚点，不改变 B 链窗口、截断、随访或分母。
3. 每维并列输出：活动（session 数、覆盖词数、当场达标词数）、成功锚点 cohort、随访覆盖数/率、未观察/截断、保持成功数/率、实际间隔、配对测时样本与变化、当前仍薄弱数/率。当场达标、仍薄弱、保持与配对测时四类分母独立；无样本显示“无样本/—”，真实 0（覆盖 0、保持 0、仍薄弱 0、合法测时 0）保留。
4. 当前仍薄弱复用第 34 轮语义：分子=该维全部唯一成功锚点词中当前 `buildWordWeakSignals` 非空者，分母=该维全部唯一成功锚点 cohort（含未观察与截断词），与 B 链随访可观测性完全解耦；跨维复用 `weakSignalCountByWordId` 判定缓存。
5. 历史维度只由 `parseSprintSessionId` 得出：已知 treatment、合法顽固主维度、generic-sprint、unknown 分列；旧 `sprint:<ISO>`、未知 treatment、非法顽固 mode、非法时间一律 unknown；顽固子 mode 只披露 `stubbornSubmodeSessionCounts`，不扁平并入普通听音拼写/中译英/lookup。
6. `app/page.tsx` 用 1 个 `useMemo` 派生并新增 1 个 prop；`app/components/HistoryView.tsx` 在“冲刺后首次正常复习保持 4 周”后新增 `<details>` 折叠节“分维度观察报告（最近 4 个完整周）”，固定 9 行、样本数/分子分母、无样本文案与非因果说明；`app/globals.css` 新增响应式网格。
7. 活动口径（覆盖/当场达标）按“该维窗口内去重”计算，同词跨维可重复计数，UI 明确标注“同词可跨维重复，不可跨维合计；session 数可以合计”；锚点系计数（cohort/随访/截断/保持/配对样本/仍薄弱）每词唯一归属，分维合计等于全局同窗值。

## 验证

- `tests/weak-signals.test.ts`：91/91（新增 6 条）。覆盖固定 9 行顺序与 parser 归属、合法顽固主维+子模式披露不扁平、全局唯一锚点且分维合计等于既有 `buildSprintRetentionSeries` 全局 cohort、跨维下一 sprint 截断、quiz/无 session 随访、同毫秒 id 总序与输入乱序 deepEqual 稳定、空样本 null 不伪造 0、真实 0（含合法测时 0）保留、活动覆盖词跨维重复但维内去重。
- `npm run lint`：通过。
- `npm run typecheck`：通过。
- `npm test`：211/211（205−85+91），含生产构建。
- `tests/e2e/signal-flow.spec.mjs` 新增第 18 条：确定性 seed 写入 meaning-choice（quiz 随访保持 1/1）、旧普通 unknown（保持 0/1）、generic、顽固 lookup-recall（子模式披露），断言 9 行固定顺序、无样本/无随访文案、非因果文案、跨维不可合计披露；既有 17 条未删改。
- `npx playwright test tests/e2e/signal-flow.spec.mjs --config playwright.config.mjs --reporter=line`：18/18（45.8s），固定端口 3000。
- 只使用确定性 seed 验证 UI 空/小样本行为；如实披露本地真实数据不足（生产历史在浏览器 IndexedDB，只读环境不可访问），未伪造生产历史。

## 边界与清理

- 未新增 schema/version/store/domain；未改评分、FSRS、每日 Quiz 门禁、备份、package scripts、历史 reviews/quizAttempts、阶段 A/B 指标或推荐优先级；未重构 `buildSprintRetentionSeries` 等既有函数，等价性由“分维合计==全局”单测钉住。
- 父会话按监听证据精确停止本轮固定 3000 的项目 node PID 45560，3000/3001 复核无监听、无本项目 node 残留；dev 生成的 build-info 已恢复基线。
- 本轮日志 `.codex-round41-20260809-023448.{out,err}.log` 与 `.codex-round41-impl-20260809-025127.{out,err}.log` 保留为未跟踪保护项，不进入提交。

## 阶段与交接

- 代码、定向/全量测试、静态检查、生产构建和固定 3000 E2E 证明分维度观察链完整闭环：解析归属、活动与锚点双口径、独立分母、unknown/generic 分列、stubborn 子模式披露、合计不变量与 UI 空/小样本行为。
- 阶段 D 完成；阶段 E 无既定定义，下一轮只读审计阶段 E 边界与真实样本门槛，不实现排行、权重、自适应或比较结论。
