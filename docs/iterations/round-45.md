# 第 45 轮：useSelectionLookup 纯业务边界提取

日期：2026-08-09

起始基线：`3861aed`

分支：`codex/refactor-stage4`

状态：完成；行为零变化，测试基线问题已独立修复。

## 前三轮架构复核

- 第 42 轮信号 key 与日期工具集中方向正确；后续应把 `WeakSignalKey` 提升为独立领域枚举，并单独决策本地日与 UTC 字符串比较语义，本轮不混改。
- 第 43 轮 Provider 请求已收敛；后续可用显式 ProviderClient/依赖注入替代隐式 env 与 `unknown[]` messages，但重试策略属于行为决策，不能顺手修改。
- 第 44 轮 weak-signals 已形成无环物理边界；74 个 barrel 导出仍偏宽，`projection.ts` 也仍大，但不应继续按行数机械拆分。

## 本轮架构选择

`app/hooks/useSelectionLookup.ts` 原约 846 行且没有 hook 级直接单测。为避免把 DOM、React 生命周期、词典网络、AI、Abort、预取和性能 trace 一次性搬动，本轮只提取确定无副作用、能直接做行为测试的业务投影。

## 实现

1. `lib/selection-lookup.ts` 新增纯函数：
   - `buildRedbookLookupResult`：红宝书词条转划词结果；
   - `resolveKnownLookupResult`：保持红宝书 exact/folded、已保存划词、query/context 缓存的原优先级；
   - `upsertLookupWord`：按 identity 去重并保留原 id/addedAt，新词继续沿用冲突 ID 分配；
   - `recordLookupStat`：保持 trim/lowercase、count、firstAt、lastAt；
   - `rememberLookupResult`：保持对象插入顺序与 120 项裁剪。
2. `app/hooks/useSelectionLookup.ts` 改为委托上述纯函数；异步控制流、fetch、Abort、弹层状态、音标后台补全、localStorage 和预取顺序未动。文件从 846 行降至 767 行。
3. `tests/study.test.ts` 新增 4 组直接行为测试，覆盖 exact/folded、音标来源、saved/cache 优先级、去重与 ID 冲突、统计时间和缓存裁剪；没有源码正则断言。

## 独立 E2E 基线稳定化

初次当前工作树验证中，`learning.spec` 两次均为 10/17：6 条因相同例句命中两个元素而触发 Playwright strict-mode，1 条在已存在活动题组时错误等待模式按钮。

用户选择隔离复验后，在临时干净 `3861aed` 副本中补齐与主工作区哈希一致的 Git 忽略运行数据，精确复现了两类相同失败，证明它们不是本轮回归。随后独立提交 `b6eebdd test: 稳定划词与测验端到端定位`：

- 重复例句通过统一 helper 明确选择第一个可见实例；
- 返回测验页时复用已存在的活动题组，只断言真实 `.quiz-view`，不再错误启动第二组。

同一干净基线服务上修复后 `learning.spec` 17/17。

## 最终验证

- 修改前 `tests/study.test.ts`：31/31；修改后：35/35。
- `npm run typecheck`：通过。
- `npm run lint`：0 error；保留第 44 轮已有的 1 个 warning（`lib/weak-signals/projection.ts` 未使用 `SprintHistoryRecord`，不在本轮 diff）。
- `npm test`：230/230，含生产 build（基线 226 + 新增 4）。
- 固定端口 3000 健康检查 HTTP 200；最终 `learning 17/17 + signal-flow 18/18 = 35/35`。
- `git diff --check`：通过。

## 边界与清理

- 未修改 schema/version/store/domain、评分、FSRS、每日 Quiz 门禁、备份、AI Provider、package scripts、历史 reviews/quizAttempts。
- 未把 DOM、React、fetch、Abort、localStorage 或可变 ref 下沉到纯函数。
- 隔离副本在核对绝对路径与 junction 后已删除；两个本轮服务均按监听 PID 精确停止，3000/3001 无监听，本轮日志已删除。
- `lib/build-info.generated.ts` 已恢复，无 diff；受保护未跟踪项未修改、未暂存；未 push。

## 后续建议

下一轮不要继续按 767 行机械拆 hook。先只读画出剩余 I/O 状态机（Selection/Range、字典 range/prefix、AI 请求、Abort、缓存持久化、预取和 trace），证明一个可注入且不改变时序的窄边界后再决定是否实施；若边界必须携带 React setter、DOM 或多组可变 ref，则停止拆分。
