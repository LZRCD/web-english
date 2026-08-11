# 第 65 轮：Canonical P0-1 考义高亮

- 日期：2026-08-11
- 分支 / 起始 HEAD：`codex/follow-up-hardening` / `195d85b23daeaf016db1464903ceef2849e8bce5`
- 批次：Canonical P0-1 独立纵向批次；第 1/1 轮
- 状态：完成，STOP

## 目标与边界

- 让已有 `senseFrequency` 标记为 `high` 的义项在学习卡与红宝书划词弹窗中使用同一语义 class、浅色背景和不低于 700 的字重。
- 只投影现有考频缓存；不生成新考频，不修改 API、schema、IndexedDB、FSRS、评分、队列或学习记录。
- ECDICT、AI、无 `linkedWordId` 或无对应考频缓存时保持原整段释义展示，不伪造高频标签。

## 实现

- `WordCard` 为精确命中 `level === "high"` 的义项增加 `sense-frequency-highlight`；`familiar` 组合仍保留高频浅底、边界和 700 字重，hover 与 focus-visible 沿用既有交互语言。
- `page.tsx` 只在划词结果含 `linkedWordId` 时，从已有 `senseFrequency[wordId]` 读取对应缓存并传给弹窗，没有新增请求、缓存或持久化字段。
- `SelectionLookupPopup` 仅在收到对应缓存时复用 `splitWordSenses` 拆分整段红宝书释义，并沿用 `entry.meaning === meaning` 的精确 high 匹配；非 high 片段不添加高频 class 或标签。
- 局部 CSS 为学习卡与弹窗共享浅色背景、轻边框和粗体；弹窗片段允许断行并保持 `min-width: 0`，避免 320px 横向溢出。

## 验证

| 级别 / 命令 | 结果 | 证据边界 |
|---|---|---|
| V1 / `study.test.ts` + `sense-frequency.test.ts` | 53/53 | 既有义项拆分与考频精确口径 |
| V1 / `npm run typecheck` | 通过 | 新弹窗 props、类型导入与页面投影 |
| V2 / `npm run lint` | 0 error / 1 个既有 warning | `projection.ts` 未使用类型 warning 与本轮无关 |
| V2 / `npm run test:unit` | 258/258 | 全量 Node 回归 |
| V3 / 新增唯一标题 E2E | 1/1，4.6 秒 | high/medium、熟练组合、两处同样式、无缓存降级、关闭、划词集与 320px |
| V3 / 相关划词回归 | 4/4，8.5 秒 | 红宝书直显、持久化、ECDICT Range、触屏焦点恢复与本轮用例 |

- 新用例首次运行 0/1：测试 locator 同时命中 `radiate` 的 `vt./vi.` 两个真实“散发”片段；收紧到首个可见片段后通过，没有修改产品语义或降低断言。
- 固定端口 3000 使用统一脚本启动：worker PID 52788、listener PID 47404，日志 `.wordloop-runtime/rounds/dev-20260811-134331.out.log`；验证后已精确停止，端口空闲。
- 未运行 `npm test`、production build 或全目录 E2E：本轮为局部 UI 投影，V1 + V2 + 精选 V3 已覆盖授权契约。dev 生成的 `lib/build-info.generated.ts` 已恢复。

## 提交与停止

- 精确暂存产品 3 文件、CSS 1 文件、精选 E2E 1 文件和本轮 3 份迭代文档；保护项与运行日志不暂存。
- 中文提交信息：`feat: 统一高频考义高亮`；不预猜本文件所在提交 hash。
- Canonical P0-1 已完成，单轮批次达到 1/1；提交后 STOP，不自动进入 P0-2，不 push。
