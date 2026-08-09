# 第 46 轮：useSelectionLookup 剩余 I/O 状态机最终 stop/go 审计

日期：2026-08-09

起始基线：`16ed476f51ae5bcb242b10116d8d9d390248b49f`

分支：`codex/follow-up-hardening`

状态：完成只读审计；终局 B，停止继续拆分 `useSelectionLookup`。

## 起始 stop/go 核对

- `HEAD` 与 Prompt 声明一致；index 为空。
- 唯一 tracked diff 为 `docs/iterations/next-round-prompt.md`，且与用户提供的 `prompt-task-b.md` SHA-256 完全一致。
- 受保护未跟踪项为 `1.txt`、`docs/architecture-analysis-2026-08-09.md`、`.zcode/`，以及第 38/40/41/42/43/44 轮日志；已按实际 `git status` 建立清单和只读快照，未修改、删除或暂存。
- 3000、3001 均无监听；本轮没有启动服务。
- 现场满足 go 条件，随后只读审计 Hook、相关 lib、调用端、单测和 learning E2E。

## 真实调用图与状态机

```text
WordCard mouseup / 非 mouse pointerup
  -> handleTextSelection(SyntheticEvent)
     -> 排除交互控件、空/折叠/越界 Selection
     -> Selection + Range -> query / context / x / y
     -> abort 上一请求
     -> resolveKnownLookupResult
        -> 红宝书 exact/folded
        -> 已保存 lookupWords
        -> query/context 内存缓存
        -> 命中：保存词条 + 记录统计 + ready + trace
        -> 未命中：idle，等待用户点击“翻译”

translateSelection
  -> 非 forceAi 再查 known
  -> loading
  -> 本地词典：字母索引 -> prefix promise/cache -> Range 请求与整片回退
     -> 命中：保存词条 + 记录统计 + ready + trace
     -> 未命中：POST /api/lookup
  -> AI 返回 -> 本地音标补全 -> 接纳代次校验
     -> 120 项内存缓存 -> localStorage -> 保存词条/统计 -> ready + trace
  -> 失败：error；取消：不再写 UI/业务状态

关闭按钮 / 外部 pointerdown / Escape / 当前词变化 / unmount
  -> abort 当前请求；关闭时清空 popup
```

### 1. Selection/Range 到 popup

- `WordCard` 把 mouseup 与非 mouse pointerup 转给 Hook；Hook 直接读取 `window.getSelection()`、`Range`、视口尺寸与祖先 DOM。
- query 经 `cleanSelectedText` 清洗；context 优先取所选节点最近的 meaning/context/collocation/word 容器，否则回退当前词例句或释义，折叠空白并截到 500 字符。
- popup 横向限制在 12px 安全边界内，纵向优先放在 Range 下方，空间不足则放上方。
- popup 状态为 `undefined -> ready`（已知命中）或 `undefined -> idle -> loading -> ready/error`；关闭与当前词变化回到 `undefined`。

### 2. 字典 range/prefix 与 fallback

- `DICTIONARY_RANGE_INDEX` 给出字母索引发布名和 prefix 长度；字母索引请求按 letter 复用 promise，失败会删除 promise 以允许重试，并用 `isDictionaryLetterRangeIndexCompatible` 校验结构。
- prefix 层先查完成缓存，再复用进行中的 promise。一个 prefix 可对应多个 byte range；206 片段合并后缓存，200 或整片 fallback 结果进入 shard 缓存。
- `fetchDictionaryRangeWithFallback` 已负责 Range 超时、网络中断、206 内容损坏、Content-Range 不合法和非预期状态的整片回退；服务器忽略 Range 返回 200 时直接采用整分片。
- 若字母索引、prefix 索引或上述链路仍失败，Hook 还会按首字母请求 canonical 整分片；失败才把本地词典视为未命中并进入 AI fallback。
- 命中词典后由 Hook 格式化音标、释义和来源，再决定保存、统计、popup 与 trace，说明 lib 的 Range I/O 边界已经存在，prefix orchestration 仍依赖 Hook 的四组可变缓存。

### 3. 已知结果、本地词典、AI 与 trace

- 非 forceAi 的优先级固定为：红宝书 exact/folded -> 已保存 `lookupWords` -> query/context 内存缓存 -> 本地词典 -> `/api/lookup`。
- forceAi 只跳过 known 与本地释义；仍复用当前词典音标或重新查本地音标，不信任 AI 音标覆盖既有来源。
- `lookup.total` 记录 first/repeat、forceAi、最终 source、cacheHit 与 ok/error/aborted；字典索引、Range、整片 fallback 和 JSON 下载/解析各有独立指标。UI 总耗时通过 `requestAnimationFrame` 后结束，不能随意移动。
- 红宝书、本地词典和 AI 成功都会写入父状态 `lookupWords`；真实查询统计只在当前路径规定的位置写入。父组件再把这些状态交给 `useStudyPersistence` 走既有 IndexedDB/备用存储链。

### 4. Abort、请求代次与过期响应

- 代码没有独立数字序号；`lookupAbortRef.current === controller` 是等价的请求代次令牌。
- 新 Selection 先 abort 旧 controller；关闭 popup 也 abort。字典 await 后、AI 响应及音标 await 后都检查 `signal.aborted` 和 controller 身份，旧代次不得接纳结果。
- 快速 A -> B 时，A 被取消，B controller 成为当前代次；现有 learning E2E 证明 A 晚返回不覆盖 B。关闭后晚返回不重新打开 popup，也有用户链 E2E。
- 已知结果的后台音标补全不用该 controller，但以当前 `state.query`、source 和“仍缺音标”三项约束接纳；当前学习卡音标 effect 则用 `active` 标志防止清理后写入。
- 这些 guard 与 error UI、保存顺序和 trace 完成位置交错，不能把“结果接纳”当成独立纯请求函数搬走。

### 5. localStorage lookup cache

- key 为 `wordloop-selection-lookups-v1:${DATA_CONTENT_VERSION}`；mount 时先调用 `cleanupOldLookupCaches` 删除同前缀旧版本 key，再容错读取当前对象。
- 只有已接纳的 AI 结果进入 query/context 缓存；`rememberLookupResult` 先裁剪到最近 120 项，再写入 localStorage。读写失败均保持查词主链可用。
- 红宝书/词典结果及查词统计不依赖这份缓存持久化，而是通过父状态和 `useStudyPersistence` 保存。

### 6. 音标加载与补全

- mount 时异步加载全局 phonetic index，以 `active` 防止卸载后写 ref/state；红宝书和已保存 AI 结果会优先使用该索引。
- 索引未命中时复用本地词典链：既用于 popup 后台补全，也用于当前学习卡音标补全，还位于 AI 结果接纳之前。
- 因此“加载索引”“查本地音标”“更新学习卡”“更新 popup”“接纳 AI 结果”并非一个可整体迁出的单一纯职责。

### 7. 后台预取

- `likelyDictionaryLetters` 从当前词、例句、搭配和释义中最多选 3 个字母；`allowsBackgroundPrefetch` 拒绝离线、后台、saveData 和 2G。
- 预取在 idle callback（2 秒 timeout）或 750ms timer 后开始，以两个 worker 消费共享队列；只加载字母索引，不下载 prefix 词典内容。
- 预取与前台查词复用同一 letter promise/cache。effect 清理会取消尚未开始的调度并令 worker 停止取下一项，但不另行 abort 已发出的索引请求。

## 现有职责边界与测试护栏

| 边界 | 当前职责 | 已有行为护栏 |
|---|---|---|
| `lib/selection-lookup.ts` | 红宝书映射、known 优先级、身份/upsert、统计、120 项裁剪等纯投影 | `tests/study.test.ts` 4 组直接行为测试 |
| `lib/dictionary-range.ts` | 单个 Range 请求、206/200 校验、超时/损坏/网络错误整片 fallback、指标 | `tests/performance-diagnostics.test.ts` 覆盖 206、200、网络、损坏、Content-Range 与超时 |
| `lib/performance-diagnostics.ts` | 通用 trace/timer、JSON 下载/解析与资源缓存标签 | 性能汇总与 Range 测试；调用点保持指标名称和结束顺序 |
| `lib/background-prefetch.ts` | 网络准入、字母选择和固定预算的纯判断 | 网络条件、字母顺序和 192000 字节预算单测 |
| Hook + Popup + WordCard | DOM 选区、popup 状态、查询编排、Abort/接纳、持久化触发、effect 清理 | learning E2E 覆盖划词持久化、206/200/损坏/网络 fallback、触屏/Escape、A->B、关闭后晚返回 |
| storage diagnostics | 旧版本 lookup cache 清理 | data-lifecycle E2E 覆盖启动清理旧 key |

当前没有 Hook 级直接单测，也没有直接覆盖 prefix promise 复用、localStorage 当前 key 读写、phonetic effect 和预取清理的行为测试；这使大范围移动异步编排的风险更高，不构成必须新增抽象的理由。

## 候选矩阵

| 候选 | 当前输入/输出 | 状态与副作用 | 可复用实现 | 现有测试护栏 | 时序风险 | 预计修改面 | 结论 |
|---|---|---|---|---|---|---|---|
| 字典 range/prefix 访问适配边界 | query/tags -> shard/result | 4 组 shard/prefix/promise 缓存、字母索引与两层 fallback、指标 | `dictionary-range.ts`、`performance-diagnostics.ts` 已覆盖高价值单请求边界 | Range 单测 + learning 206/200/损坏/网络 E2E | 高；完整提取需多组可变缓存或新 controller，扁平参数会泄漏内部状态 | Hook、新 service/lib、相关单测与 learning E2E | 不实施；门槛 2/4/6 不满足 |
| phonetic index 加载与补全边界 | query/current word -> phonetic | mount effect、ref/ready state、字典复用、popup 与学习卡 guarded patch | `fetchJsonWithDiagnostics`、`findInLocalDictionary` | 音标用户链与 Range E2E，缺 effect 级直接测试 | 中高；索引 readiness 和两个 UI 接纳点耦合 | Hook、新 lib/测试，可能牵动 page setter | 不实施；完整职责携带 React/ref，窄 fetch 包装收益不足 |
| localStorage lookup cache 适配边界 | key/cache -> 容错读写 | localStorage、版本清理、内存 ref、AI 接纳后写入 | `cleanupOldLookupCaches`、`rememberLookupResult` | 120 项纯函数测试 + 旧 key 清理 E2E | 低到中 | Hook、新 storage lib/单测 | 不实施；纯读写仅是约 19 行薄包装，不能带来高价值职责收敛，门槛 6 不满足 |
| AI lookup 请求与结果接纳边界 | query/context/signal -> AI JSON/accepted result | fetch、30 秒 timeout、controller 代次、phonetic await、缓存/业务保存、统计、popup/error、trace | `/api/lookup`、`rememberLookupResult`、performance helpers | A->B 与关闭晚返回 E2E；无独立 request adapter 测试 | 高；完整接纳依赖当前 popup 快照和多次有序写入 | Hook、新 client/lib、测试与 learning E2E | 不实施；只抽 fetch 是低价值包装，连同接纳则违反门槛 2/3/6 |
| Selection/Range 与 popup orchestration 保留在 Hook | SyntheticEvent/current -> popup state 与查询动作 | DOM/Range、React state/effects、关闭、焦点/快捷键联动 | `selection-lookup.ts` 已承接纯业务，Popup 已独立展示 | 触屏/Escape、known/local/AI、竞态 E2E | 移动风险最高 | 若拆分会扩散 Hook、WordCard、Popup、page | 保留；这是合理 orchestration boundary，不作为实施候选 |

## 唯一终局：B

没有候选同时满足 7 项门槛，停止继续拆分 `useSelectionLookup`。

- 第 45 轮已提取真正稳定、无副作用且可直接测试的业务投影。
- 剩余代码的价值来自维持 Selection、查询优先级、缓存、Abort、音标、trace、错误 UI 和 effect 清理的同一时序；完整下沉必然携带 React/DOM/多组 mutable state，或新增 Prompt 明令禁止的 controller/平行缓存抽象。
- 把 request、JSON parse 或 localStorage get/set 单独迁出虽然形式上可注入，却只是移动少量行数，不能提高完整职责的可复用性，也无法覆盖结果接纳与竞态。
- 因此 767 行是当前合理 orchestration boundary 的体量证据，不是继续拆分的授权。

下一轮返回长期总计划，进入阶段 E“自适应推荐可行性评估”的只读设计。未经用户另行批准不得修改推荐行为；若真实生产数据门槛不足，应明确维持固定优先级并转阶段 F 发布准备。

## 本轮验证边界

- 本轮未修改业务代码、测试、配置或运行数据；未启动服务、浏览器或 E2E。
- 没有重跑 lint、typecheck、build 或 `npm test`；第 45 轮数字只作为历史基线，不冒充本轮证据。
- 收口只执行 Prompt 指定的三项文档/Git 检查。
