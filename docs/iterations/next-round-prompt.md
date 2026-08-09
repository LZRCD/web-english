# 第 46 轮 Prompt：useSelectionLookup 剩余 I/O 状态机只读审计

## 现场基线

- 第 45 轮已把红宝书映射、已知结果解析、词条 upsert、查词统计和 120 项缓存裁剪提取为 `lib/selection-lookup.ts` 纯函数；hook 从 846 行降至 767 行。
- 独立 E2E 稳定化提交：`b6eebdd test: 稳定划词与测验端到端定位`。
- 第 45 轮最终证据：study 35/35、typecheck 通过、lint 0 error/1 个既有 warning、`npm test` 230/230、固定 3000 的 learning 17/17 与 signal-flow 18/18。
- 受保护项：`1.txt`、`docs/architecture-analysis-2026-08-09.md`、`.zcode/` 与既有轮次日志；不得修改、删除、暂存。

## 唯一目标

严格只读审计 `app/hooks/useSelectionLookup.ts` 剩余 767 行的 I/O 状态机，回答“是否存在一个能在不改变异步时序的前提下继续提取的窄边界”。本轮默认不写业务代码；只有证据完整且边界不携带 React/DOM 状态时，才为下一轮写实施 Prompt。

## 必须画清的链路

1. 浏览器 Selection/Range → query/context/坐标 → popup 初始状态。
2. 词典字母 range index → prefix promise/cache → Range 206/200/损坏/超时 fallback → phonetic 补全。
3. 已知结果、本地词典、AI `/api/lookup` 三层优先级与性能 trace。
4. AbortController、请求序号、关闭弹窗、快速 A→B 时的过期响应保护。
5. localStorage lookup cache 的读取、写入、版本 key 与旧缓存清理。
6. 后台预取的网络条件、预算、promise/cache 复用和 effect 清理。

## 架构判断标准

可继续提取的候选必须同时满足：

- 输入输出能用普通数据和显式依赖描述；
- 不接收 React setter、SyntheticEvent、DOM Element/Range 或多组可变 ref；
- 不改变请求发起顺序、缓存命中顺序、Abort/关闭语义、性能埋点或错误 UI；
- 能复用现有 `lib/dictionary-range.ts`、`lib/performance-diagnostics.ts`、`lib/background-prefetch.ts`，不再造平行抽象；
- 能用行为测试覆盖，不依赖源码字符串断言。

若不存在满足条件的边界，结论应是“停止继续拆分”，并说明 hook 虽大但当前是合理 orchestration boundary。不要为了减少行数引入 controller 类、事件总线、状态管理库或巨大参数对象。

## 只读验证

- 核对 branch/HEAD/status/index、受保护项、3000/3001。
- 读取 hook 与上述三个 lib 的真实调用图、相关单测及 learning E2E；不启动服务，不改文件。
- 给出每个候选的收益、时序风险、现有测试护栏和预计修改面。
- 最终只选择一个结论：
  1. 一个最窄可实施边界及其下一轮 Prompt；或
  2. 停止拆 hook，转向更高价值候选（显式 ProviderClient、WeakSignal 公共面收窄、日期语义决策），并给出选择依据。

## 禁止

- 不修改 schema/version/store/domain、评分、FSRS、每日 Quiz 门禁、备份、package scripts、历史数据。
- 不改变查询优先级、缓存上限、音标来源、AI fallback、Range fallback、Abort 语义或埋点。
- 不修改 `page.tsx`、`useStudyPersistence`、globals.css。
- 不 stage、不 commit、不 merge、不 push；不启动 3000。
- 不触碰受保护未跟踪项。

## 交付物

- `docs/iterations/round-46.md`：只读调用图、候选矩阵、唯一结论和证据。
- 若选择可实施边界，覆写本文件为下一轮最小实施 Prompt；若选择停止拆分，覆写为下一个高价值候选的只读/实施 Prompt。
