# 第 69 轮完成 Prompt：Canonical P0-6 复习趋势与 30 天复习压力

## 当前状态

- Canonical P0-6 已完成：轨迹页已有最近 4 个本地自然周的复习保持率/困难率趋势，以及未来 30 天到期复习的当前排程快照。
- 实施报告：`docs/iterations/round-69.md`。
- 单轮批次达到 1/1，STOP；不自动进入 P1 AI、P2-11 leech 或其他路线图目标，不 push。

## 已完成契约

1. 最近 4 周含本周、周一为周起点、按时间升序；历史周统计到下一周周一之前，本周只统计到 now，未来与非法事件排除。
2. 复习保持率只统计 review：rating 0 失败，rating 1/2/3 成功；困难率只统计 review：rating 0/1 命中。两者同周 denominator 完全一致。
3. 每个周点保留 numerator / denominator / rate；无样本显示 `— (0/0)`，有样本且 numerator 为 0 显示真实 `0% (0/N)`。
4. 周报本周摘要与 4 周图都读取 `buildWeeklyLearningReport.reviewMetricTrend`，其内部只调用一次共享 `buildReviewMetricTrend`；页面与组件没有第二套统计公式。
5. 未来到期继续复用 `buildReviewForecast(wordProgress, now, 30)`；逾期与今天进入第 1 天，第 30 天包含，第 31 天排除，无效 dueAt 忽略，全零仍保留 30 点。
6. 标题与披露明确 30 天图只按当前 `nextDueAt` 计算，继续学习和评分会改变排程，不是未来承诺；没有加入新词参考线或持久化预测。
7. 轨迹页以文本和 aria-label 同时披露指标、样本量、日期与数量；30 天图内部可键盘聚焦横向滚动，320px、200% 与 400% 缩放验证通过。
8. 未改变 successRate、buildTrueRetention 口径、FSRS、nextDueAt 写入、ReviewKind、schema/version/store/domain、备份或其他功能。

## 验证现场

- V1 66/66，typecheck 通过，lint 0 error / 1 个既有 warning，Node 291/291，`git diff --check` 通过。
- 新趋势 E2E 3/3；趋势、signal-flow 与 responsive 联跑 25/25。
- 覆盖 4 周 rating 语义、空周/真实 0%、周报同源、30 天首日与第 30/31 天边界、逐日可访问名称、320px 内部滚动、键盘焦点及 200% / 400% 缩放。
- 固定端口 3000 已释放；worker PID 29068 / listener PID 26180 已精确停止；dev 生成的 build-info 已恢复为起始 HEAD blob。

## 等待规则

- P0-6 已完成并停止，不自动进入 P1、P2-11、提醒、真题语料或其他目标。
- 后续目标必须由用户重新授权并执行新的 Round 0；当前检查点不构成任何后续实施授权。
