# 第 69 轮：Canonical P0-6 复习趋势与 30 天复习压力

- 日期：2026-08-11
- 分支 / 起始 HEAD：`codex/follow-up-hardening` / `9a34248a8d75b20f157065dfbffb5e018c31a085`
- 批次：Canonical P0-6 独立纵向批次；第 1/1 轮
- 状态：完成，STOP

## Round 0 与实施边界

- 分支、完整 HEAD、ahead 6、tracked working tree 与 index 均符合 Prompt 基线；固定端口 3000 无监听。Start 门禁唯一阻断是 Prompt 已登记但脚本未登记的用户未跟踪保护基线，均保持只读、未暂存。
- 只扩展 `lib/insights.ts` 的 reviews 派生链、轨迹页趋势/快照 UI、CSS 与对应测试；未修改 schema/version/store/domain、ReviewEvent、ReviewKind、SessionKind、FSRS、`nextDueAt` 写入语义、备份或用户数据。
- Canonical 文件仅只读；`1.txt`、`2.txt`、`.zcode/`、日志、架构/竞品/规划文档、favicon 与爬取脚本均未修改、未暂存。

## 最近 4 周指标契约

- `buildReviewMetricTrend(reviews, now, weeks=4)` 默认返回含本周的最近 4 个本地自然周，复用 `localWeekStart` 与 `addLocalDays`，按最旧到本周升序排列；每周从本地周一 00:00 开始，历史周截止下一周周一之前，本周截止传入的 `now`，未来、非法时间与窗口外事件不计。
- 合法 `now` 即使 reviews 为空也保留 4 个连续日期点；无效 `now`、非正安全整数周数返回稳定空数组。每点均保留 numerator / denominator / rate，只有 denominator 为 0 时 rate 为 null；真实零分子保留 0%。
- 复习保持率直接复用 `buildTrueRetention(...).overall`：仅 `kind === "review"`，numerator 为非忘记评分数，denominator 为全部复习评分数。rating 0 失败；rating 1/2/3 保持成功；young/mature 的 `unclassifiedCount` 不影响 overall 分母。
- 困难率使用同一周窗口与同一复习评分分母：rating 0/1 命中，rating 2/3 不命中。测试样例 rating 0/1/2/3 得到保持 3/4（75%）、困难 2/4（50%）；rating 1 同时进入保持 numerator 与困难 numerator。
- `buildWeeklyLearningReport` 内部只调用一次 `buildReviewMetricTrend`，把结果放入 `reviewMetricTrend`；`HistoryView` 的本周摘要与 4 周图均读取该对象，没有在 `app/page.tsx` 或组件中复制 reviews 过滤、周边界或统计公式。

## 轨迹页与 30 天当前排程快照

- 周报新增“复习保持率/困难率趋势”，显示周起止、本周标识、两种指标文本、百分比及 numerator / denominator；空周显示 `— (0/0)`，真实零显示 `0% (0/N)`。颜色之外保留不同文本标签、可访问区域与每周稳定 aria-label。
- `app/page.tsx` 只把既有 `buildReviewForecast(wordProgress, now, 7)` 改为 30；没有新增预测函数、修改进度或从 reviews 推测未来排程。
- “未来 30 天到期复习（当前排程快照）”明确披露按当前 `nextDueAt` 计算、后续学习与评分会改变排程、不是未来承诺；逾期与今天到期共同落入第 1 天。
- 30 个本地自然日保持逐日粒度；第 30 天（today + 29）包含，第 31 天排除，非法 dueAt 忽略，全零仍返回 30 点。每点暴露真实日期和数量，总数独立显示。
- 30 天柱图只在自身焦点容器内横向滚动；320px 下 document/body 无横向溢出，键盘可聚焦并滚动。窄容器规则避免 400% CSS zoom 下固定 padding 把摘要压成 0 宽；200% / 400% 下趋势标题、披露和本周摘要均可滚动到并可见。

## 修改文件

- 派生与调用：`lib/insights.ts`、`app/page.tsx`。
- UI 与响应式：`app/components/HistoryView.tsx`、`app/globals.css`。
- 测试：`tests/insights.test.ts`、`tests/e2e/review-trends.spec.mjs`、`tests/e2e/signal-flow.spec.mjs`。后者仅把既有“当场达标”断言限定到“本次冲刺小结”可访问区域，解决两个真实同名元素的 strict locator 冲突，没有降低产品断言。
- 迭代文档：`docs/iterations/round-69.md`、`docs/project-evolution.md`、`docs/iterations/next-round-prompt.md`。

## 红测、修复与验证

| 级别 / 命令 | 结果 | 耗时与说明 |
|---|---|---|
| 红测 / `tests/insights.test.ts` | 预期失败 | 约 0.13 秒；`buildReviewMetricTrend` 尚未导出 |
| V1 / insights + study | 66/66 | 最终测试器约 0.33 秒 |
| V2 / `npm run typecheck` | 通过 | 最终约 2.4 秒 |
| V2 / `npm run lint` | 0 error / 1 个既有 warning | 最终约 8.8 秒；`lib/weak-signals/projection.ts` 的未使用类型未改 |
| V2 / `npm run test:unit` | 291/291 | 最终测试器约 0.87 秒 |
| V0 / `git diff --check` | 通过 | 仅 Git LF/CRLF 工作区提示 |
| V3 / 新趋势 E2E | 3/3 | 最终约 5.0 秒 |
| V3 / 趋势 + signal-flow + responsive | 25/25 | 最终约 66.3 秒 |

- 新 E2E 首轮暴露三处真实前置/布局问题：空周 exact 文本定位不符合实际标签；reviews 恢复链会补建额外 wordProgress，故预测场景改为隔离的当前进度快照；400% zoom 下嵌套固定 padding 把摘要宽度压为 0。分别用精确样本定位、隔离真实数据源和窄容器布局修复，未改指标公式或降低断言。
- 全套首次联跑 24/25，唯一失败为既有完成页两个“当场达标”导致 strict locator 冲突；限定到真实“本次冲刺小结”区域后聚焦 1/1、最终 25/25。

## 服务、生成文件与未执行项

- V3 使用固定 `127.0.0.1:3000`：worker PID 29068、listener PID 26180，唯一日志 `.wordloop-runtime/rounds/dev-20260811-172633.out.log`；日志与 HTTP 健康检查均为 200。
- 统一脚本的 `Status` 曾对仍在监听的 PID 26180 报假阴性，使用 `netstat` 与进程表核实归属后复用同一实例，没有启动第二个服务或切换 3001/3002。
- 验证后脚本停止 worker PID 29068；listener PID 26180 未随父进程退出，随后只对该已记录项目 PID 精确停止。最终脚本显示 `STOPPED | port 3000 is free`，没有批量终止 Node。
- dev 将 `lib/build-info.generated.ts` 从起始 blob `4410b1880754eea8e9ee2a9263d372318efac3f3` 改为 development 内容；已恢复并核对 hash 完全一致，恢复后未再运行 dev/build。
- 未运行 `npm test`、production build、production smoke 或全目录 E2E：本轮未触及依赖、构建链、API、schema/version/store/domain，V1 + V2 + 指定 V3 已覆盖授权边界。

## 提交与停止

- 精确提交信息：`feat: 增加复习趋势与30天压力图`。
- 只暂存本轮实现、测试和三份迭代文档；所有保护文件保持原样。
- Canonical P0-6 已完成，单轮批次达到 1/1；提交后 STOP，不自动进入 P1 或 P2-11，不 merge，不 push。
