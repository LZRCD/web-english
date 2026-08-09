# 第 64 轮完成 Prompt：activeQuiz 失效题组安全恢复

## 当前状态

- 用户已批准第 63 轮推荐方案，第 64 轮实施与验证已完成；单轮批次达到 1/1，STOP。
- 实施报告：`docs/iterations/round-64.md`。
- 不自动进入其他候选，不 push。

## 已完成契约

1. 部分失效：保留有效题原顺序与完整呈现快照，统一重算 index、answers、correctCount、complete 和结果分母，已写入的 attempt / review 不回滚。
2. 恢复等待 hydrate 与词库 ready；修正后一次写回，并提示题目减少及结果按剩余题计算。
3. 全部失效：清除 `activeQuiz`，保留历史作答事实，在模式页说明原因并提供重新开始入口。
4. 旧的仅 ID 会话继续兼容；新完整快照复用现有持久化链，不提升 schema/version，不新增 store/domain。

## 验证现场

- 定向 102/102，typecheck 通过，lint 0 error / 1 个既有 warning，Node 244/244，精选 E2E 2/2。
- 固定端口 3000 已释放；生成的 build-info 噪声已恢复。

## 等待规则

- 本目标已完成并停止。
- 若继续其他目标，需重新明确授权并执行新的 Round 0；不得顺带修改 activeSession、FSRS、评分、推荐或用户学习数据。
