# 第 78 轮：轨迹页「记忆档案」UI 精修与信息层级重构

日期：2026-08-14

目标：按用户提供的 54 章本地化 Prompt，对「轨迹 / Memory Trace」页面做一次纯展示层精修：减少 Card 套娃、强化「今天 / 本周 / 未来 / 轨迹 / 分析」阅读层级、压缩无意义空白与空数据噪音、新增确定性「本周诊断」，同时严格保持学习算法、统计口径、数据持久化和既有交互契约不变。

分支 `codex/follow-up-hardening`；起始 HEAD `75cd4d8`。本轮开始时工作区已有用户未提交的 `lib/build-info.generated.ts` 改动（与 HEAD 相差 3 行），全程逐字节保留未触碰。

## 任务边界

- 允许：`app/components/HistoryView.tsx`、`app/globals.css`、`tests/rendered-html.test.mjs`、`docs/iterations/round-78.md`、`docs/project-evolution.md`。
- 禁止（未触犯）：`lib/insights.ts`、`lib/study.ts`、`lib/learning.ts`、`lib/storage.ts`、`lib/weak-signals/**`、任何 FSRS / 队列 / 评分 / session / 恢复逻辑、IndexedDB / localStorage schema、其他页面组件与样式、词库与生成数据。
- 未修改 `app/page.tsx`（props 构造与回调链路无必要改动）。
- 未新增 API、未调用 AI、未新增缓存 / schema / 持久化 / 统计函数；未伪造示例数字，未新增「现在复习」类单词级学习入口。

## 改动

### HistoryView.tsx（约 175 行变化）

- **Hero**：右侧两个指标统一为同构数据组（`trace-hero-stat`：数字上、标签下、右对齐），间距 36px，数字 500 字重品牌绿。
- **本周报告结论优先**：原「说明文字 + 小字变化」重构为两个核心结论块（真实复习保持率 / 本周困难率，36px serif + 分子分母 `n / m` + 较上周 ±N 个百分点），rate 为 null 时大数显示「暂无样本」并用中性色（`.no-sample`）；辅助四指标降为低一级的竖线分组 strip；阅读顺序变为「结论 → 数据依据 → 趋势 → 值得注意 → 建议」。
- **未来排程降噪**：30 天柱状图默认只标注今天、每周节点、月份跨界与下一个高峰，非关键日不渲染日期与数字（每个日格仍保留完整 `aria-label` / `title` / `data-date`，零值未从数据语义删除）；柱高上限 48→36、图表高度 80→56。
- **新增确定性「本周诊断」**：详细学习分析展开后第一块，全部由现有 props 投影：计数最高且 >0 的薄弱信号（label/count/change）、贡献最高的薄弱分册建议、冲刺样本存在性（有样本只复述次数/覆盖/当场达标并保留口径，无样本显示「本周暂无可分析的冲刺样本。」）。不输出因果结论。
- **冲刺空状态合并**：冲刺观察 4 周 / 冲刺后当前仍薄弱率 4 周 / 冲刺后首次正常复习保持 4 周——只有四周均为真正无样本（`effectiveness`/`relapse`/`retention` 全为 null）时合并为一行说明；真实 0 与部分覆盖周照常展示。
- **薄弱集中区**：单元明细浮层文案更新为「悬停或聚焦查看单元明细」，行容器新增 `:focus-within` 展开浮层，键盘可达。
- **日期显示统一**：轨迹页可见短日期统一为点分格式（趋势周标签、30 天图关键日、冲刺系列周标签、峰值日、冲刺记录日期 `MM.DD`），仅改显示层；ISO 日期键、`dateKey`、`data-date`、存储值与比较逻辑、ARIA 完整日期均未改动。
- 背诵日历、最近学习、近 7 日指标、LOOKUP TRACE、冲刺记录等既有数据与回调零删除。

### globals.css（末尾追加「第 78 轮」区块 + 少量原位修改）

- 复用全部现有 token（`--accent*` / `--warning*` / `--border-subtle` / `--radius-*` / `--ease`），未新建 token、未改全局 `--content-max-width: 1280px`；阅读宽度只在 `.content-view.history-view` 局部收窄到 1180px。
- Level 1 Section（当前状态/周报/排程/日历/最近学习/两个折叠区）保留统一细边框 + `--radius-lg`；Level 2 Module（划词集/薄弱趋势/冲刺系列/分维度观察/集中区）全部改为透明 + 顶部发丝线；Level 3 Metric 只用间距或竖线分组（当前状态四指标、周报辅助四指标、排程四指标、近 7 日四指标、划词集三指标均去掉独立边框与背景）。
- 「复习 →」从绿色 pill 改为纯文字行动（保留 `<button type="button">`、原回调、min 40×40 触控区与 `focus-visible` 轮廓）。
- 背诵日历只压缩 padding / gap / 空白（`.activity-scroll` 24px 26px 20px → 14px 20px 10px，标题与摘要同步收紧），热力图 7×12px 格子、20 周/半年/一年、图例→统计顺序、中心轴与滚动契约全部不动。
- 文字层级收敛：正文与说明 ≥11.5px，标题 16px，图表轴标签 10px；暖橙只用于到期/困难/遗忘/薄弱。
- 响应式复用现有 980/820/640 断点行为：四列 → 2×2 → 1–2 列，不缩字强保四列；移动端仅 `.activity-heatmap-scroll` 允许横向滚动。

### tests/rendered-html.test.mjs

- 日历外层 padding 结构守卫同步为新的有效值（`padding: 14px 20px 10px`），断言强度不变。

## 验证

| 级别 / 命令 | 结果 | 说明 |
|---|---|---|
| `npm run typecheck` | 通过 | — |
| `npx eslint app/components/HistoryView.tsx` | 0 error | — |
| `node --experimental-strip-types --test tests/rendered-html.test.mjs` | 12/12 | 含 DOM 顺序、渐进披露、日历结构契约 |
| `npx playwright test tests/e2e/review-trends.spec.mjs` | 10/10 | 三态主行动、5 条最近学习、4 周口径、30 天边界、日历键盘 |
| `npx playwright test tests/e2e/responsive.spec.mjs` | 17/17 | 轨迹 9 视口几何验收 + 一年范围无横向滚动 + 触控目标 |
| `npx playwright test tests/e2e/signal-flow.spec.mjs` | 18/18 | 近 7 日口径、集中区冲刺、复发追踪、cohort、分维度观察 |
| 定向状态脚本（`tmp/trace-round78/verify-states.mjs`，gitignore） | 18/18 | 富数据/零数据诊断内容、暂无样本中性色、聚焦展开单元明细、无溢出 |

同 seed、同视口（1440×900 展开/折叠、390×844）改前/改后实测（`tmp/trace-round78/{before,after}/metrics.json`）：

- 页面总高度：折叠 2857 → 2514（**-12.0%**），展开 5343 → 4737（**-11.3%**）；未达 15–25% 目标，因为本周结论按 Prompt 要求放大为 36px 核心视觉（+63px）且新增诊断摘要内容；日历与指标区超额完成。
- 背诵日历高度：404 → 295（**-27%**，达到 20–30% 目标）。
- 近 7 日指标展开高度：580 → 420（-160px，整层卡片移除）。
- 卡片感元素（有背景+边框+圆角）：45 → 12（**-73%**，远超 25–35% 目标）。
- <11px 文本元素：260 → 69（-73%）；剩余均为图表轴刻度（10px 数字/日期与少量「今天/本周」刻度），正文与说明全部 ≥11.5px。
- 页面级横向溢出：0（9 个视口全部通过既有几何守卫）。

## 未解决问题与风险

- 桌面页高 -12% 未达到 15–25% 的设计目标；按 Prompt 第 0.11/37 节，优先保证可读性与契约，如实报告实测。若需继续压缩，可在不触碰日历契约的前提下再收紧周报趋势区，但不建议牺牲当前可读性。
- 移动端展开态（390px）总高 -1.2%，原因是新增诊断摘要与模块发丝线在窄屏单列化；默认折叠态不受影响。
- 未运行 `npm test`（会重建 production bundle 并改写 `lib/build-info.generated.ts`）；`lib/build-info.generated.ts` 保持本轮开始时的既有未提交状态，未覆盖用户变更。

## 服务与提交

- 复用会话前已确认的本项目 `vinext dev`（固定端口 3000，PID 17660，健康检查 200），未重启、未换端口、未批量终止 Node。
- 未触碰 `1.txt`、`2.txt`、`.zcode/`、`.codex-*.log`、`gui-test-screenshots/` 等受保护内容。
