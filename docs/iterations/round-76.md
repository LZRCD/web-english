# 第 76 轮：学习页视觉与信息层级精修（消除重复、强化焦点）

日期：2026-08-12

目标：用户直接提供的「精修当前单词学习页视觉与信息层级」任务——不重新设计页面结构、不新增功能、不破坏现有交互，把学习页从「干净可用」提升到「更聚焦、更成熟」。核心是减法：消除重复进度信息、扩大词卡视觉权重、收紧 metadata 与卡片关系、弱化装饰与辅助元素，让第一眼只有一个视觉主角：当前单词。

分支 `codex/follow-up-hardening`；起始 HEAD `d3a5b79`（工作区含上一轮遗留未提交改动：HistoryView/round-75 文档等，本轮未触碰）。状态：完成（未提交，等待用户决定提交方式）。

## 任务边界

- 允许：学习页 CSS/JSX 视觉与结构改动、`WordCard` 内部结构调整、e2e 文案断言保持（未破坏任何既有断言）。
- 禁止（未触犯）：学习算法 / 新词调度 / 评分逻辑 / 数据库 schema / 词库 / 其他页面（轨迹、词书、词本、测验、设置）样式。
- 视觉方向保持：极简、安静、低饱和、暖白底、少量品牌绿、serif 主词、monospace eyebrow/metadata、轻边框、极弱阴影、不游戏化。

## 改动

### page.tsx
- 卡片上方 metadata（原 `orbit-label-top` 的 `NEW · {currentLocation}`）改为状态码 + 位置：`DUE/NEW/REVIEW · 必考词 · UNIT 1`，回答「我现在为什么看到这个词」；新增模块级 `WORD_SOURCE_CODE` 映射（今日到期→DUE、今日新词→NEW、反复查词补漏→REVIEW、收藏复习→FAV、错词强化→FIX…，其余会话 kind 各有短码，未知回退 `STUDY`）；红宝书未就绪时显示 `LOADING/READ FAILED · 2027 红宝书`。删除了不再使用的 `currentLocation`。
- 删除卡片外重复提示：`orbit-label-bottom` 的 `SPACE · 查看释义` 分支删除，仅保留有行为指引价值的状态（`LOCAL · REDBOOK` / `RETRIEVE · 再提取一次` / 揭示后「请依据查看释义前的回忆状态评分」）；label 从 stage 内绝对定位改为 study-main-stack 内流式元素。
- `.card-metadata` 与 `.orbit-stage` 平级放入 `.study-main-stack`；`WordCard` 调用移除 `activeSession`、`newCount` 两个 prop（卡片内计数已删）。

### WordCard.tsx
- 卡片 Header 合并为一个整体：`.word-heading`（grid `1fr auto`）左侧 = 状态 chip（`wordSource.label`）+ 说明文字（`wordSource.description`），右侧 = 收藏/发音按钮；删除卡片内 `01 / 10` 计数（顶部 Header 已承担整体进度，不重复）。
- 主词区域独立居中：`.word-card` 改 flex column，`.word-face` 改 `flex: 1` + 居中（`justify-content: center`，揭示后 `flex-start`）——Header 文案/按钮变化不影响单词位置。

### globals.css
- **词卡放大**：`width: 100%`（视口层填满 stage）→ 桌面 `min(800px, calc(100% - 48px))`、`min-height: 470px`（揭示 540px）、`border: 1px solid rgba(20,35,25,.08)`、`background: rgba(255,255,255,.94)`、`box-shadow: 0 20px 60px rgba(35,50,42,.055)`、`padding: 32px 38px 34px`。
  - 关键修复：`.card-viewport` 从 `flex-shrink: 0; margin: auto` 改为 `flex: 1 1 auto`（填满 stage），否则 flex 子项宽度由内容决定，`calc(100% - 48px)` 在 flex 上下文中未定长 → 卡片坍缩成单词宽度（实测 391px）。原版 `min(620px, 74vw)` 因 vw 确定长无此问题。
- 卡片 Header：chip `24px / 11px / rgba(39,130,92,.07)` 圆角 999；说明 `12px #6b746d`；收藏按钮刻意弱化（更浅边框/图标），发音按钮 38px、hover 浅灰；删除旧 `.word-count` 样式与文件后段残留的旧 `.word-source` 规则（会级联覆盖新样式）。
- 主词：`clamp(60px, 5.2vw, 84px)`、`color: #17191a`、weight 400；音标 `19px #969d98`、距主词 16px；卡内提示 `13px muted`、距音标 26px。
- 背景圆环：保留 2 层——主圆 680px（`border rgba(63,112,89,.055)` + 极淡 conic 进度弧 + 百分比 mask 收成 2px 环带）、辅助虚线圆 800px `rgba(118,156,136,.08)`；`inset: 0; margin: auto` 保证中心与卡片一致；`overflow: clip` 防撑大 scrollHeight（沿用第 75 轮方案）；移除 `orbit-reveal` 动效（背景圆不移动）。
- Toolbar（`.learning-context`）：白底 80%、radius 14px、高 46px；select/segmented 高 34px，选中态白底 + 极弱阴影（不染绿）；保持页面级左对齐，与居中卡片层级分离。
- 顶部：learn-topbar 标题 `20–22px / 600`；eyebrow letter-spacing 0.16em→0.12em；右侧工具统一 32px 高。
- 撤销按钮：白底、`border rgba(25,45,35,.1)`、`shadow 0 4px 14px rgba(29,52,39,.06)`、高 40px、Badge 22px 低饱和（`rgba(47,127,91,.1)` 底 + `#3d8a66` 字）。
- 垂直节奏：metadata `margin-top: clamp(10px, min(9vh, calc(100dvh - 690px)), 148px)`——高屏 100–120px（实测 1080→114 / 900→97），矮窗（≤720px 高）自动压缩 margin 保证卡片完整可见；metadata→卡 14px。
- 响应式：≤820px 卡 `min(88vw, 470px)`、圆环 `min(88vw+32px, 502px)`、辅助圆隐藏；≤640px 卡/metadata/stage 均 `94vw`。

## 验证

| 级别 / 命令 | 结果 | 证据边界 |
|---|---|---|
| `tsc --noEmit` | 通过 | 类型与 props 清理（WordCard 移除 2 个 prop） |
| `eslint app/page.tsx app/components/WordCard.tsx` | 通过 | 两个改动文件 |
| `npm run build` | 通过 | 生产构建 |
| e2e（today-task-preview / learning / visual） | 22/22 通过 | 首次 40 项（含 signal-flow）通过，CSS 修复后复跑 22 项仍全绿 |
| 浏览器实测（IAB + 计算布局指标） | 通过 | 见下 |

浏览器实测（1920×1080 / 1600×900 / 1440×900 / 1366×768 / 1280×800 / 1024×768 / 820×1180 / 390×844；1440×700/768/900/1080）：
- 卡片桌面统一 800×470，完整可见；metadata 左缘与卡片左缘对齐（x 差值 0）；metadata→卡 14px；Toolbar→metadata 桌面 97–114px（≈100–120 参考）。
- 所有视口 `scrollWidth == clientWidth`（无横向溢出）；1366×768 等常规高度 `.study-main-stack` 无内滚；1440×700 卡片完整可见（margin 压缩到 26px 间隙，仅 6px 幽灵滚动）。
- 揭示后卡片变高为既有设计（释义面板滚动）；底部状态 label 居中于卡片。
- 主词 1366 下 71px；音标 19px / 距主词 16px / 提示 26px；chip 24px；发音/收藏按钮 38px；撤销按钮 109×39、Badge 22×22 低饱和。
- metadata 动态状态已实测：`NEW · 超纲词 · UNIT R`、`NEW · 基础词 · UNIT 31` 随词变化；DUE/REVIEW 由 `WORD_SOURCE_CODE` 映射（e2e 覆盖 chip 文案）。
- 过程中发现并修复：卡片坍缩 bug（见上，`.card-viewport` flex 宽度）与旧 `.word-source` 级联覆盖。

## 提交与判断

- 实际修改：`app/page.tsx`、`app/components/WordCard.tsx`、`app/globals.css`、`docs/iterations/round-76.md`。
- 未触碰：`1.txt`、`2.txt`、`.zcode/`、`docs/iterations/round-75.md`、`docs/project-evolution.md`（工作区已有用户未提交改动）、历史日志。
- 服务：端口 3000 原为本项目生产服务（`scripts/start-production.mjs`，PID 55948），识别为本项目旧实例后清理；dev server（PID 516）以固定 3000 启动，日志 `.zcode/dev-server-round77.log`。
- 提交：未执行（等待用户决定）。
- 下一步：等待用户检查视觉效果与验收清单（任务第 54 节逐项已自查通过）。
- push：未执行。
