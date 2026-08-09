# 第 56 轮：让今日任务可预期、每个词来源可解释

- 日期：2026-08-09
- 分支：`codex/follow-up-hardening`
- 起始 HEAD：`3b7571b4c0384458080c5840621312c78d8ad55c`
- 状态：完成实现与验证，等待提交

## 授权与唯一目标

- 用户授权：实施一个严格串行、单目标的用户体验迭代。
- 用户问题：开始今日任务前不知道真实任务量和预计耗时；进入学习后也不清楚当前单词为什么会在队列中。
- 完成定义：今日任务预览与实际会话共享同一份派生队列，展示互斥拆分、粗略耗时和目标原因；学习卡为今日来源及全部既有会话类型显示可访问的来源说明；不新增持久化字段、不改变排程或队列规则。
- 允许范围：今日队列纯投影、学习页预览、学习卡来源说明、响应式样式、直接单测/E2E 与本轮文档。
- 禁止范围：schema/version/store、第二套推荐规则、FSRS、评分、弱信号阈值、队列顺序、历史归因和上一批次残余结构断言。

## Round 0 现场

- 分支与 HEAD：`codex/follow-up-hardening` / `3b7571b4c0384458080c5840621312c78d8ad55c`。
- tracked 工作区与 index：均为空；`lib/build-info.generated.ts` 与 HEAD 一致；`round-56.md` 不存在。
- 保护项：`1.txt`、`.zcode/`、架构文档、Typora 日志和历史 `.codex-*.log` 均保持未跟踪，未修改、未暂存。
- 固定端口：3000 无监听；Start gate 通过。
- 既有事实：`buildTodayQueue` 已统一到期、补漏、新词的去重与顺序；`StudySession.kind` 已覆盖全部会话入口，因此本轮只增加纯展示投影，不改会话结构。
- STOP/GO：全部开始门禁满足，结论为 **GO**。

## 实施

### 今日任务共享预览

- `lib/learning.ts` 把既有队列计算收敛到同一个内部 `buildTodayQueueParts`；原 `buildTodayQueue` 继续返回相同 `wordIds`，未改变到期 → 补漏 → 新词顺序、同词族错开或去重规则。
- 新增 `buildTodayTaskPreview`，从同一分区结果派生总数、到期数、补漏数、新词数、约 45 秒/词的粗略分钟数、空任务状态和新词目标说明。
- `app/page.tsx` 只计算一次 `todayTaskPreview`；预览展示和 `startTodaySession()` 直接复用其 `wordIds`，避免两套计算。
- 到期积压降低目标时明确写出“从 X 调整到 Y”；今日新词已完成时只安排到期和补漏；空队列按钮禁用并显示已完成状态。

### 学习卡来源说明

- 新增纯函数 `buildStudyWordSource`，只读取现有 `StudySession.kind/title`、当前进度、到期时间和划词补漏信号。
- 今日任务内按现有优先级解释为今日到期、反复查词补漏、今日新词或手动加入；无法可靠细分时回退“今日任务”通用说明。
- 会话级覆盖错词强化、顽固词专项、划词集学习、收藏复习、搜索专项、薄弱冲刺、本轮再强化；无会话时显示“当前词书额外练习”。
- `WordCard` 顶部新增可见标签与一句说明，`role=note` 和完整 `aria-label` 保持辅助技术可读；不持久化来源。

### 响应式与键盘

- 今日任务预览继续使用原生 `button`，空任务使用原生 `disabled`，键盘与焦点语义无需另建事件层。
- 预览采用可换行网格，320px 下切换为两列/多行；学习卡来源说明使用可收缩说明列并允许文本换行，避免横向溢出。
- signal-flow 首轮暴露桌面端额外顶部留白会把划词弹窗推到视口外；移除桌面整体下移，只保留移动端预览空间后复验通过。

## 验证

| 命令或检查 | 结果 | 能证明 | 不能证明 |
|---|---|---|---|
| `node --experimental-strip-types --test tests/study.test.ts` | 43/43 | 预览与队列同源、互斥计数、目标/空状态说明及全部来源回退 | 浏览器布局与持久化 |
| `npm run typecheck` | 通过 | 当前 TypeScript 契约成立 | 运行时行为 |
| `npm run lint` | 0 error / 1 个既有 warning | 本轮未引入 lint error | 既有 `projection.ts` warning 未处理 |
| `npm test` | production build + Node 238/238 | 当前构建与完整 Node 套件通过；基线 235 + 新增 3 | 浏览器交互与生产用户数据 |
| 新增 `today-task-preview.spec.mjs` | `--list` 精确 2 项；2/2 | 空白状态预览、实际会话 20 词、今日新词来源、到期/补漏拆分与逐词来源、320px 无横向溢出 | 其他浏览器与真实长期状态 |
| `signal-flow.spec.mjs` 首轮 | 17/18；1 项弹窗按钮因桌面下移越界 | 定位到本轮布局回归，不是业务断言失败 | 不能作为最终通过证据 |
| 失败项定向复验 | 1/1 | 移除桌面整体下移后，划词弹窗恢复可操作 | 其余 signal-flow |
| `signal-flow.spec.mjs` 完整复验 | 18/18 | 既有信号联动、Quiz、冲刺、查词和刷新链未回归 | 全目录 E2E、生产数据与其他浏览器 |
| 最终紧凑样式复验 | 新增 E2E 2/2；signal-flow 18/18 | 最终提交版桌面/320px 预览与既有信号链共同通过 | 其他浏览器与真实设备 |

- 所有命令均在两分钟内返回。
- 服务：首次验证日志 `.codex-round56-dev-20260809-140848.{out,err}.log`，链 `powershell 36968 -> cmd 60292 -> node 26932 -> cmd 49040 -> node 58200`；最终样式复验日志 `.codex-round56-final-20260809-141610.{out,err}.log`，链 `powershell 42696 -> cmd 43344 -> node 60432 -> cmd 49200 -> node 5244`。
- 清理：两次验证后均按叶到根精确关闭对应项目 PID；3000 最终无监听，未批量结束 Node。
- 生成文件：build/dev 改写的 `lib/build-info.generated.ts` 已恢复为起始 HEAD 内容。

## 提交前复核

- 实际修改文件：`lib/learning.ts`、`app/page.tsx`、`app/components/WordCard.tsx`、`app/globals.css`、`tests/study.test.ts`、`tests/e2e/today-task-preview.spec.mjs`、本轮文档、项目演进和下一轮 Prompt。
- `git diff --check`、精确暂存集合和 PreCommit 门禁在最终提交前执行。
- 保护项及本轮服务日志保持未跟踪且不暂存。
- 不 push，不修改用户数据，不新增 schema/version/store/domain。

## 评估与下一轮

- 用户价值：开始前能看见真实任务量、互斥来源拆分、目标原因和粗略耗时；进入学习后每张词卡都能解释来源。
- 行为兼容：队列顺序、FSRS、评分、弱信号、历史归因和持久化格式均未改变。
- 下一轮只选择 P1：明确“清空本机学习记录”契约，使按钮、确认文案、实际清除字段、恢复快照和测试一致，重点处理 `quizAttempts` 与 `activeQuiz`；不在本轮顺手实施。
