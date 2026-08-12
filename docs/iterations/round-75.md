# 第 75 轮：全站 UI/UX 深度优化（视觉收束）

日期：2026-08-12

目标：用户直接提供的「WordLoop 词环全站 UI/UX 深度优化任务」——不重新设计产品、不增加大型新功能、不修改学习算法，而是把已经不错的 WordLoop 收束成统一、成熟的产品：视觉统一、信息层级重构、渐进披露、组件规范化、信息密度优化、响应式修正。

分支 `codex/follow-up-hardening`；起始 HEAD `a1ff948`（工作区含上一轮遗留未提交改动）。状态：完成（本轮改动未提交，等待用户决定提交方式；P2-12 仍待授权）。

## 任务边界

- 允许：CSS/JSX 视觉与结构改动、新增公共样式与少量组件类、轨迹页信息架构重排（唯一允许明显重构的页面）、e2e 断言随渐进披露同步。
- 禁止（未触犯）：复习算法 / 新词调度 / 评分逻辑 / 数据库 schema / 词库数量 / 缓存 / 学习历史 / 统计定义；不新增 Styling Library；不引入渐变、玻璃拟态、发光、3D、营销 Hero、Bento 满屏等 AI 模板感设计。
- 视觉方向：极简编辑排版 × 安静数据仪表盘；保留既有 DNA（Eyebrow、Serif 大标题、暖绿环境色、低饱和、轻边框）。
- 环境：端口 3000 已有本项目生产服务（PID 59320，`scripts/start-production.mjs`），按 AGENTS.md 识别为本项目实例；非本轮启动，不在「自动换端口」豁免内。

## Round 0 与保护现场

- 起始 HEAD `a1ff948`，工作区有上一轮遗留未提交改动（长难句浮层 + 学习加固 + 文档）；按用户指示「先提交了再做」先提交为 `09ab5ee chore: 提交长难句浮层与学习加固阶段性改动`（52 文件，含 DailySentenceOverlay、调研文档等）。
- 架构调查结论（Explore agent + 全文阅读）：
  - 单页应用：`main.app-shell`（grid 108px rail + workspace）+ 全站共享 `header.topbar`（88px）+ 每页 `.content-view > .section-heading` Hero 结构；纯自定义 CSS（Tailwind 仅 preflight，JSX 零工具类）。
  - `:root` 仅 11 个 token，7206 行 CSS 中数百个硬编码色值、border-radius 出现 235 次；`.quiet` 按钮修饰重复定义 8 次；panel/segmented/pill 配方重复 3～4 组。
  - 学习页顶部把「必考词/Unit/顺序/全书」全塞进顶栏；今日任务条为绝对定位绿色 Banner。
  - 轨迹页 21 个数据模块全部平铺，仅 1 个 `<details>`（分维度观察）；KPI 5 个横向大卡。
  - HistoryView 无顶层 early-return，各 section 独立条件渲染；`stat-grid` 5 列。
- 本轮未触碰：`1.txt`、`2.txt`、`.zcode/`、历史日志、调研/规划文档、Canonical 与真题语料。

## 改动（按阶段）

### Phase 1 Design Foundation

- `app/globals.css` `:root` 扩展为设计 Token（全部从既有配色提取，未换品牌色）：`--sidebar-width: 108px`、`--topbar-height: 88px`、`--content-max-width: 1280px`、`--space-page-x: clamp(28px, 4vw, 64px)`、`--text-primary/secondary/tertiary`、`--accent*`（`#27825c` 系）、`--warning*`（`#c36f52` 系）、`--border-subtle/normal`（绿色调 rgba）、`--radius-sm/md/lg/xl/2xl`、`--ease: 160ms ease`。
- Sidebar：宽度 token 化；Active 状态从「白卡 + 阴影」弱化为「浅绿底 `rgba(47,127,96,.055)` + 1px 内描边 `rgba(47,127,96,.22)` + 圆角 16 + 图标品牌绿」。
- 全局 Header：`--topbar-height`、eyebrow 10→11px（`--text-tertiary`）、`topbar-title` 15→17px、边框改 `--border-subtle`；所有页面共用同一 Header（本就共享，消除密度差）。
- 内容容器：`.content-view` 增加 `max-width: 1280px; margin-inline: auto`，padding `60px var(--space-page-x) 88px`；Hero `clamp(38px, 4vw, 56px)/1.08`，词书页再收 10%（`clamp(34px, 3.4vw, 50px)`）；`section-heading` margin-bottom 50→44px。
- 共享面板统一 `--radius-xl`（历史/活动/设置/快捷键面板）。

### Phase 2 学习页

- 学习工具（必考词 select / Unit select / 顺序·乱序·全书）从顶栏移入学习页顶部新 `.learning-context` 紧凑工具栏（44px、浅色 surface、`width: fit-content`）；顶栏只保留全局功能（今日长难句 / 查词 / 今日进度），满足「第一眼看到当前单词」。
- 今日任务条由绝对定位绿色 Banner 改为文档流内「静默 Status Strip」：白色 0.92、`--border-subtle`、无阴影、80px 高；title/action 只保留单一绿色焦点，chips 改低饱和 `rgba(47,127,96,.08)`。
- `.learn-view` 由 grid 改 flex 列（context bar → 任务条 → 主栈 → 评分条）；移除 `has-today-preview` 绝对定位补偿规则。
- Flashcard：`orbit-stage` 710→680px、min-height 535→480；`.word-card` 530→620px、min-height 390→400、圆角 32 token；装饰虚线圆环 alpha 0.25→0.14；IPA 15→16px；卡面提示文案「先在脑中回忆，再点击查看」→「点击 / Space 查看释义」（`WordCard.tsx`），提示行 margin 45→22px、颜色更淡。

### Phase 3 词书 / 词本 / 测验（精修）

- 词书页（`BooksView.tsx`）：Hero 缩小约 10%；`resource-badge` 改 12px 浅绿底 + 细边框低对比；「全书乱序」卡改为行动入口（`ALL WORDS` 风格 CTA 文案「随机开始 →」）。
- 词本页（`WordbookView.tsx`）：四项统计（收藏/错词/顽固/划词）合并为一个整体 Stats Group（单边框模块 + 分隔线，不再四散漂浮）；右侧动作分组 `wordbook-heading-actions`（测试词汇量 = 次级浅绿按钮、批量动作 = 主要 ink 按钮，disabled 状态保持明显差异）。
- 测验页：`.quiz-mode-card` min-height 270→252、标题上距 46→26px，压缩垂直空白约 10～15%；CTA 继续 `margin-top: auto` 对齐底部。

### Phase 4 轨迹页（唯一允许信息架构重构的页面）

- 全部数据重排为六段渐进披露，新增 `.trace-section` 分组标签（今天 → 本周 → 未来 → 薄弱项 → 历史）：
  - **今天**：KPI 收敛为 4 项（今日新学 / 今日复习 / 已到期(按钮) / 平均记忆牢固度）；`stat-grid` 5→4 列；「完成次数」降为二级。
  - **本周**：WEEKLY REPORT 四格 + 复习保持率/困难率趋势 + 新增「本周最值得注意」薄弱高亮条（只列发生过且 count>0 的前 4 维，暖橙数字）+ 考研节奏建议；学习趋势（insights）保留 4 核心卡，「不同单词/完成次数」改为 `insights-meta` 浅底 inline 条（第二行不空）。
  - **未来**：EXAM READINESS 就绪度 + 未来 30 天到期复习（从 insights 面板中独立移出）。
  - **薄弱项**：薄弱集中区保持可见（不埋入高级分析），暖橙进度条语义不变。
  - **详细学习分析**：新增默认折叠的 `.trace-details`（`<details>`）面板，收纳：划词集 LOOKUP TRACE（含查询次数分布）、薄弱维度近 4 周趋势、完整本周薄弱维度、本周冲刺观察、冲刺观察 4 周、冲刺后仍薄弱率/追踪、首次正常复习保持 4 周、分维度观察报告（嵌套 details）、冲刺维度归因、冲刺记录 SPRINT TRACE。
  - **历史**：背诵日历 + 最近学习（原样保留）。
- 数据零删除：仅移动位置 / 折叠 / 简化默认视图 / 修改表现方式；计算逻辑全部保留。
- 词本空状态：虚线边框降噪（`rgba(25,45,35,.14)`）、min-height 310→280。

### Phase 5 响应式

- DOM 测量（Playwright）：1920/1600/1440/1366/1180/1024/820/640/480 × 6 视图全扫描，**零横向溢出、零 Hero 标题与右侧操作冲突**；学习上下文条移动端满宽 wrap；任务条 ≤820 改 5 行栅格。
- 顶栏 ≤900 隐藏长难句全称与查词文字、≤640 隐藏进度计数（沿用既有规则，适配移动后的结构）。

### Phase 6 回归

- lint 0 error / 1 个既有 warning（`lib/weak-signals/projection.ts` 未使用 `SprintHistoryRecord`，非本轮文件）；typecheck 通过；production build 通过；Node 单测 **343/343**。
- 完整 E2E **90/90**。最初 89/90 的唯一失败 `today-task-preview.spec.mjs:75`（到期/补漏分开预览）在基线代码上复现；经根因排查确认不是业务 bug，而是「今日任务队列按日期种子整体乱序」的设计与测试旧断言（首词必须是到期词）冲突——乱序来自用户此前「今日任务里的新单词乱序」需求（2.txt），但实现把到期/补漏/新词全部一起洗牌。用户裁决：**只乱序新词，到期词置前**（见下「第 75 轮追加：今日任务到期优先」）。
- 轨迹页渐进披露使 13 个 signal-flow 用例失效（断言折叠面板内模块可见），更新为先在 `helpers.mjs` 新增幂等辅助 `openTraceAnalysis(page)`（展开 `.trace-details`），18/18 全过；断言未降级，仅前置展开。
- `git diff --check` 通过。

## 服务、生成物与提交门

- 会话开始时端口 3000 运行本项目生产服务（PID 59320）；按 AGENTS.md 复用规则未换端口。验证期改用 dev：停止旧实例，固定 3000 启动 dev（日志 `.zcode/ui-round-dev.log` + pid），浏览器/DOM 验证结束后精确停止。
- 最终重建 production build 并恢复生产服务（PID 30412，日志 `.zcode/ui-round-prod.log`），恢复会话开始时状态；健康检查 200。
- `lib/build-info.generated.ts` 为构建产物，已恢复为 HEAD blob（`00efa47`，无漂移）。
- 本轮改动文件（未提交）：`app/globals.css`、`app/page.tsx`、`app/components/HistoryView.tsx`、`app/components/BooksView.tsx`、`app/components/WordbookView.tsx`、`app/components/WordCard.tsx`、`tests/e2e/helpers.mjs`、`tests/e2e/signal-flow.spec.mjs`。
- 提交：未执行（用户未要求；用户可在确认后按阶段分 commit）。本文件与 `docs/project-evolution.md` 随本轮记录。
- `next-round-prompt.md` 中预写的 P2-12 Prompt 原标「第 75 轮」，本轮为 UI 收束任务，已更正为「第 76 轮」并保持内容不变；P2-12 仍需用户重新授权并执行新的 Round 0。不 push。

## 第 75 轮追加：今日任务到期优先（用户裁决后修复）

- 背景：`today-task-preview.spec.mjs:75` 在基线上即失败。根因排查（stash 基线 + `rebuildWordProgress`/`buildTodayQueueParts`/`buildStudyWordSource` 逐层验证 + 浏览器实测会话 wordIds）确认：`buildTodayQueueParts` 以日期种子 `seededScore(todayKey, 1)` 对整队（到期+补漏+新词）洗牌，到期词不保证队首；测试旧断言「首词=今日到期」与设计冲突。该乱序实现源自用户此前「今日任务里的新单词乱序」需求（2.txt），但作用域超出了「新词」。
- 用户裁决：**只乱序新词（含补漏），到期词保持置前**——更贴合需求原意，复习优先不被随机打乱。
- 实现（`lib/learning.ts` `buildTodayQueueParts`）：无种子行为不变（到期→补漏→新词）；带种子时 `[ ...dueIds, ...shuffleWordIds([...priorityIds, ...newIds], seed) ]`。同种子确定性、跨批次/预览一致、次日换新语义均保留；日期种子只作用于补漏与新词尾部。
- 单测（`tests/study.test.ts`）：原「整队完全混排」用例更名为「到期词保持置前，补漏与新词混排为确定性排列，成员与计数不变」，新增断言：`seeded[0] === 1`（到期恒为队首）、尾部确实被洗牌（`seeded !== ordered`）、种子 20260728 的确定性全队列 `[1,2,3,4,5]`。
- e2e（`today-task-preview.spec.mjs`）：seed 调整为 `dailyGoal: 10 + sessionBatchSize: 15`（整队 12 词落入单批可穷尽；dailyGoal 3 会被 `normalizeStoredState` 白名单回退为 20，不可用）；用例改为：预览断言到期/补漏/新词计数 → 首词断言「今日到期」→ 逐词评分推进 12 词，收集全部来源标签，断言「到期/补漏/新词」三类都出现。注意：`[...seen].sort()` 按 Unicode 排序，「新词」(U+65B0) 排在「补漏」(U+8865) 前。
- 验证：关键单测 196/196、`npm run test:unit` 全量 fail 0、typecheck 通过、lint 0 error / 1 个既有 warning、完整 E2E **90/90**（此前唯一失败用例现通过）。
- 本轮无「未解决问题」遗留。

## 第 75 轮追加二：新词从全书候选随机抽取（用户需求）

- 用户要求：「新词希望是从全书随机抽取」——此前实现只对队列尾部（补漏+新词）洗牌，但新词的**抽取源**仍按红宝书书序取前 N 个（每天从 Unit 1 头部顺序推进），只是呈现顺序随机。
- 实现（`lib/learning.ts` `buildTodayQueueParts`）：候选过滤（未学/未到期/非补漏/非今日已评/去重）后，先按日期种子 `shuffleWordIds(candidates, seed)` 洗牌再顺序取前 dailyNewGoal 个；无种子时保持书序抽取（行为不变）。同词族当天错开逻辑保留。抽取与队列尾部共用同一 `seededScore` 散列排序（FNV-1a 变体：wordId 字符串逐字符异或乘 16777619，32 位哈希升序），与输入顺序无关，因此：当天固定一批（刷新/跨批次一致）、次日自动换一批、不重复、已学词排除。
- 效果实测（200 词模拟）：当天抽得 `[150,151,152,132,153,143,133,154,142,130]`（覆盖全书而非书序头部 6..15）、同种子逐字节一致、次日组合不同。
- 单测（`tests/study.test.ts`）：新增「新词从全书候选随机抽取：非书序前 N，同日确定、次日换一批、已学排除」——断言抽取结果不是书序前 N、覆盖全书候选、同日确定、次日不同、去重与已学排除；「今日任务带日期种子」与「不同日期种子」用例期望值不变（尾部洗牌只依赖散列，与输入顺序无关）。
- 验证：`tests/study.test.ts` 64/64、`npm run test:unit` 344/344、typecheck、lint 0 error / 1 个既有 warning、完整 E2E **90/90**。

## 第 75 轮追加三：学习页双层纵向滚动与词卡跳动修复（用户报告）

- 现象：学习页右侧同时存在两根纵向滚动条（body + `.study-main-stack`）；内层 scrollTop 变化导致整个学习内容上移，「NEW · 全书乱序 · 必考词 Unit 17」标签被滚出且回不来；词卡位置随 previous scrollTop 漂移。
- 根因定位：
  - 滚动容器 1：`html/body` —— `.learn-view` 使用 `min-height: calc(100vh - 88px)`（可被内容撑高），揭示后释义内容可达 1000px+，撑高 `.workspace`（min-height: 100vh 允许）→ body 出现滚动条。
  - 滚动容器 2：`.study-main-stack { overflow-y: auto }` —— 同一份超高内容又被 flex 压缩收进内部滚动。
  - 嵌套成因：`.learn-view` 允许自身无限撑高 + `.study-main-stack` 同时把多余内容收进内部滚动，两个机制叠加。
  - 标签「消失」附加原因：`.orbit-stage` 用 `display: grid; place-items: center` 居中，内容超高时**顶部溢出不可达**（grid 居中溢出 bug），滚动后无法回到顶部。
  - 自动滚动代码排查：全库无 `scrollIntoView` / `scrollTo` / `scrollTop` 写入；`wordCardRef.focus({ preventScroll: true })` 已安全；唯一无 preventScroll 的是 `reinforcementInputRef.focus()`（强化输入框，影响范围在卡片内）。
- 修复（纯 CSS，无 JS 强制滚回顶部）：
  - `.learn-view`：`min-height` → 固定 `height: calc(100vh/dvh - var(--topbar-height))`，并加 `overflow-y: auto` 兜底（仅完成页/极矮屏生效，学习态子项被 flex 压缩不滚动）。
  - `.study-main-stack`：保留为学习态唯一滚动源，`scrollbar-gutter: stable` 防布局抖动。
  - `.orbit-stage`：`grid place-items: center` → `flex` + `.word-card { margin: auto }` —— 内容不超高时居中；超高时 flex 自动边距折叠为 0，顶部内容可达可滚动。
  - 移动端 ≤820px 的 `.learn-view` 同步改固定 `height: calc(100vh/dvh - 142px)`。
  - 切词后滚动位置：无需 JS——未揭示内容变矮时浏览器将 scrollTop 自然 clamp 回 0（实测确认）。
- 验证（Playwright 多视口实测）：
  - 1366×768 / 1440×900 / 1600×900 / 1920×1080：**body 恒不滚动**（before/revealed/切词后）；全页滚动容器普查仅 `.study-main-stack` 一个。
  - 词卡中心稳定性：评分切词 20 次，1920 下 spread=0px，其余视口 19/20 张完全一致（首张差异 = 开始会话后今日任务条隐藏导致内容区扩展，属预期布局重排）。
  - 揭示后滚动到底再回顶，顶部标签回到初始位置（顶部可达 bug 已修）；Space 查看释义、切词后 bodyTop/stackTop 均为 0，无自动滚动。
  - typecheck、lint 0 error / 1 个既有 warning、完整 E2E **90/90**。

## 第 75 轮追加四：学习页 Study Workspace 滚动条彻底修复（用户二次报告）

- 用户报告：双层滚动改善后，Study Workspace（`.study-main-stack`）自身仍有纵向 scrollbar，scrollTop 改变导致词卡整体上移、NEW 标签滚出。
- 定位（浏览器实测 clientHeight/scrollHeight）：
  - 产生 scrollbar 的节点 = **`.study-main-stack`**（如 1440×900：clientHeight 612 / scrollHeight 680，溢出 68px）。
  - 撑大 scrollHeight 的子元素 = **`.orbit-stage` 的装饰圆环伪元素**：`::after` 620×620、`::before` 520×520，绝对定位但**无 inset 定位**（停留在 static 位置），分别超出 stage（clientHeight 480）140px / 40px → `stage.scrollHeight = 620`；stage `overflow: visible` 将溢出传播给 main-stack（500 内容 + 180 传播 = 680 ✓ 与实测吻合）。1920 不滚仅因 stage 居中后底部留白恰好容纳溢出。**确认：装饰圆环参与布局导致**。
  - 附加发现：`.rating-bar` 不可见时（opacity 0）仍占位 ~82px，压缩 main-stack 可用高度。
- 修复（纯 CSS + 一层结构包装，无 JS 滚动）：
  1. `.rating-bar` 不可见时 `display: none`（visible 时 `display: grid` + `rating-in` 入场动画）——不占位。
  2. `.orbit-stage`：`overflow: clip` + 圆环 `position: absolute; inset: 0; margin: auto`（居中；溢出被 clip 裁剪，不产生滚动溢出、不撑大 scrollHeight）；stage `flex-shrink: 0` 防止被 main-stack 压缩。
  3. 新增 `.card-viewport` 层（page.tsx 包住 WordCard）：`margin: auto; flex-shrink: 0; display: flex`，高度由卡片内容决定——揭示后卡片超高时撑高 stage，**clip 只裁圆环、不裁卡片**。
  4. `.learn-view` 维持固定 `calc(100dvh - topbar)`，唯一滚动源语义不变；`.study-main-stack` 为学习态唯一滚动容器。
- 过程中修复的次生问题：`align-items: stretch` / `align-self: stretch` 会拉伸卡片视口至 stage 高度导致 clip 误裁卡片（e2e 词根生成按钮被 `rating-bar` 拦截指针，`intercepts pointer events`）——改用 `align-items: center` + `flex-shrink: 0`。
- 验证（Playwright 实测）：
  - 1366×768 / 1440×900 / 1600×900 / 1920×1080 **正常态 stack 溢出 0px、body 不滚、NEW 标签可见**；揭示态 1366 溢出 261 / 1440 溢出 142 / 1920 溢出 0（主内容区唯一滚动源，允许）。
  - 切 20 词卡片中心 spread=0px（全部视口）；Space 揭示、发音点击 cardTop 零位移；窗口高度 900→800→700 自适应（700 时主内容区滚动）。
  - 1280×720（e2e 默认视口）词根按钮可点击；typecheck、lint 0 error / 1 个既有 warning、完整 E2E **90/90**（此前 etymology A/B 与 learning 反馈重写 3 个用例已恢复）。
