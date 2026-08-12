# 第 77 轮：查看释义后切换独立 Study Detail 布局（修复超长 Flashcard 与嵌套滚动）

日期：2026-08-12

目标：用户直接提供的「修复当前单词学习页『查看释义后布局失控』」任务。查看释义（Space / 点击）后，所有释义、例句、猜词、AI 助记、搭配和元数据继续塞进原 Flashcard，导致约 450px 的卡片变成超长卡片、Study Workspace 内重新出现独立纵向滚动条、页面形成「卡片内部长文档」视觉、Word 区域出现绿色矩形 focus 边框、底部评分栏可能遮挡正文、详情区域仍沿用 Flashcard 窄宽度。要求明确区分两个 UI 状态：State A（未查看释义，Flashcard，现状保持不动）与 State B（已查看释义，独立 Study Detail Layout）。

分支 `codex/follow-up-hardening`；起始 HEAD `8e0275e`；代码提交 `2673e86`，本文件为 docs 提交。状态：完成。

## 任务边界

- 允许：学习页 CSS/JSX 结构改动、`WordCard` 内部结构调整、`page.tsx` 布局类切换。
- 禁止（未触犯）：学习算法 / 新词调度 / 评分逻辑 / 数据库 schema / 词库 / 其他页面（轨迹、词书、词本、测验、设置）样式；**禁止用增大 card height、max-height、overflow:auto 修补**（本轮未使用，详情自然撑开页面）。
- 硬约束（全部满足）：State A 的 Flashcard 保持当前「居中、不滚动」现状；不破坏 Space、发音、猜词、评分等既有交互；只保留一个主要纵向滚动源。

## 改动

### WordCard.tsx
- 新增 `showDetail = revealed && redbookReady && reinforcementRating === null` 分支：展开态渲染独立 `StudyDetail` 布局（`.meaning-panel.study-detail`），**不再渲染** `.word-card` article；未查看释义 / 强化拼写态（`reinforcementRating !== null`）的 article 完全保持原样（word-heading、word-face、红宝书错误区、强化表单均未动）。
- 详情结构（对应任务推荐结构）：
  - `WordSummary` 紧凑 Header：词 `clamp(40px, 3.6vw, 48px)` + 音标 17px + 发音/收藏按钮 + 状态行「今日到期 · 必考词 · Unit N」（今日到期按 `nextDueAt` 与当前日期的本地日期比较，高亮绿色；首次学习无进度时不显示）。实测整体高度约 101px（目标 120–160px 内）。
  - 状态提示条（划词补漏 / 回忆统计 / 薄弱信号 / 已稳定）保留在 Header 之下；
  - 分节层级：1 猜词 → 2 释义与例句 → 3 AI 助记（词根拆解 + 词族）→ 4 常用搭配 → 5 词条信息；每节 `.detail-section-title` 绿色小标题 + 分隔线。
- 词本身保留为**无外观紧凑按钮**（`.detail-word-button`，含 h1.detail-word）：保留「点击词 = 发音」既有交互与焦点锚点（撤销评分、触屏划词 Escape 焦点恢复均依赖该按钮存在），键盘聚焦仅显示绿色下划线、无矩形边框。
- 猜词输入 / 例句二审重写 / 义项考频 / 真题原句 / 跨词例句复用 / 内容补充 E 等所有内层类名与逻辑原样迁移（`.meaning-panel`、`.context-sentence` 等 e2e 契约保持）。

### page.tsx
- 新增 `detailMode = revealed && redbookReady && reinforcementRating === null`；`learn-view` 与 `orbit-stage` 按 detailMode 追加 `detail-mode` 类（共 6 行）。

### globals.css
- **滚动模型**：detail-mode 下 `.study-main-stack` 改为 `overflow: visible; min-height: min-content`（不再形成第二个滚动容器），`.learn-view` 成为唯一纵向滚动源（`scrollbar-gutter: stable`）；`.card-metadata` 对齐详情宽度且 `margin-top` 归零。
- **详情宽度**：`min(960px, calc(100% - 48px))`（Flashcard 800px → Detail 960px，任务要求 880–980px）；orbit 装饰圆环（`::before/::after`）在 detail-mode 下隐藏。
- **评分栏 Sticky Action Bar**：`position: sticky; bottom: 16px; z-index: 6; flex-shrink: 0`，宽度 `min(860px, calc(100% - 48px))` 略窄于详情主内容；详情 `padding-bottom: 120px` 保证最后内容不被遮挡；移动端（≤820px）宽度 `calc(100% - 24px)`、bottom 10px。
- **视觉层级**：主要释义区白色极浅卡（`rgba(255,255,255,.92)` + 轻边框）；例句 / 真题原句用 divider（`border-bottom`）分隔，不再各自成卡，避免 card-in-card-in-card；内容补充 CTA 浅色虚线框；AI 助记保留唯一蓝调卡；常用搭配左缘强调线；词条信息无卡背景。绿色只用于状态、正反馈、小标题、CTA。
- **切换动画**：`detail-in 240ms`（opacity 0→1 + 8px 位移），`.detail-section` 延迟 70ms；不做高度过渡。
- **focus 修复**：`.word-card:focus-visible`（3px 绿框）与 `.word-face:focus-visible`（mint 2px 矩形，Space 揭示后键盘焦点落在整个词面）均移除；词面键盘聚焦仅点亮「点击 / Space 查看释义」提示文案。

## 验证

| 级别 / 命令 | 结果 | 证据边界 |
|---|---|---|
| `tsc --noEmit` | 通过 | 类型与 ref 泛型（detail 根 div） |
| `npm run lint` | 0 error（1 个既有 warning `lib/weak-signals/projection.ts`，非本轮引入） | 全量 |
| 单元测试（rendered-html / study / weak-signals / session-summary 等） | 187/187 通过 | 无业务语义改动 |
| e2e 全量 | **90/90 通过**（3.8m） | 含 signal-flow / learning / visual / responsive / today-* / redbook-retry / data-lifecycle / leech-signals 等 |
| 独立 Playwright 布局脚本（`tmp/verify-detail-layout.mjs`，gitignore） | 19/19 通过 | 三分辨率 State A/B、滚动源唯一性、sticky 评分栏不遮内容、无绿色矩形、猜词/展开/收起、无横向溢出 |

浏览器实测（1366×768 / 1440×900 / 1920×1080，几何 + 计算样式断言；截图存 `gui-test-screenshots/`）：
- State A：卡片统一 800×470、工作区列内居中；`learn-view` 与 `study-main-stack` 均 `scrollH == clientH` 无滚动（零回归）。
- State B：detail 960px；WordSummary 约 101px（词 48px / 音标 17px）；`learn-view` 861/680 为唯一滚动容器，`study-main-stack` `overflow: visible` 无内滚，全页无其他 scrollTop>0 元素；评分栏 sticky 实测底部粘于 730px；滚动到底后最后内容 495px 远高于评分栏顶 656px（120px 留白生效）；首屏 Word（248px）与释义（322px）同时可见。
- 撤销评分 / 刷新后撤销 / 触屏划词 Escape 焦点恢复 / 200% 与 400% 缩放共 4 项 e2e 在基线复测确认与本轮相关后，通过「详情词按钮保留焦点锚点契约」全部恢复为通过（中途曾因展开态不再存在 `.word-face` 按钮而失败，修复后全绿）。
- 服务：端口 3000 旧实例（PID 48040，本项目 `vinext dev`）识别后清理；新实例固定 `3000` 启动（PID 65232），日志 `.codex-dev-20260812-214735.log` / `.err.log`（err 为空），PID 记录 `.codex-dev-20260812-214735.pid`；健康检查 `HTTP 200`。

## 提交与判断

- 实际修改：`app/page.tsx`、`app/components/WordCard.tsx`、`app/globals.css`、`docs/iterations/round-77.md`。
- 未触碰：`1.txt`、`2.txt`、`.zcode/`、历史日志、`tmp/`（验证脚本已在 gitignore）、`gui-test-screenshots/`（验收截图证据，未提交）。
- 提交：`2673e86`（feat: 查看释义后切换独立 Study Detail 布局，修复超长 Flashcard 与嵌套滚动）；本文件 docs 提交。
- 下一步：等待用户检查视觉效果与验收清单（12 项验收逐项自查已通过）。
- push：未执行。
