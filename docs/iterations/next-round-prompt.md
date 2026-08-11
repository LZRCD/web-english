# 第 65 轮完成 Prompt：Canonical P0-1 考义高亮

## 当前状态

- Canonical P0-1 已完成：学习卡与红宝书划词弹窗现在一致突出 `senseFrequency` 中的 high 义项。
- 实施报告：`docs/iterations/round-65.md`。
- 单轮批次达到 1/1，STOP；不自动进入 Canonical P0-2，不 push。

## 已完成契约

1. `WordCard` 的 high 义项使用稳定语义 class、浅底、轻边框和 700 字重；与 `familiar`、hover、focus-visible 正确组合。
2. 划词弹窗只复用页面现有缓存；`linkedWordId` 命中时通过 `splitWordSenses` 拆分并按精确 meaning 标记 high。
3. medium/low、无考频、无关联 ID、ECDICT 与 AI 结果不伪造高频标签；发音、翻译、划词入库、关闭和焦点恢复保持不变。
4. 未修改 API、schema、IndexedDB、FSRS、评分、队列或学习记录。

## 验证现场

- 定向 53/53，typecheck 通过，lint 0 error / 1 个既有 warning，Node 258/258。
- 新增唯一标题 E2E 1/1，相关划词回归 4/4；320px 无横向溢出。
- 固定端口 3000 已释放；生成的 build-info 噪声已恢复。

## 等待规则

- 本目标已完成并停止。
- 若继续 Canonical P0-2「词汇量测试」或其他目标，需重新明确授权并执行新的 Round 0；不得顺带修改考频数据、FSRS、评分、队列或用户学习数据。
