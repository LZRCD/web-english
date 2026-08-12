# 第 74 轮执行 Prompt：Canonical P2-11 leech 渐进阈值

你是 WordLoop 当前实施 Agent。工作目录：`D:\me\小东西\单词`。
本 prompt 由用户在第 73 轮 STOP 后明确索取；获得用户确认后才进入实施，prompt 本身不是执行授权。

## Round 0 快照（只读，已核对）

- 分支 / 起始 HEAD：`codex/follow-up-hardening` / `afbce435f7d7148a2ee3c0bd58be335deba153b7`
- 上轮提交：`feat: 增加考研真题例句库`（P2-10，14 个文件，已完成）
- tracked 工作区：除本 prompt 文件外应无未暂存改动；未跟踪遗留 `.zcode/`、`1.txt`、`2.txt`、历轮日志与未确认研究文档存在，但不得进入本轮提交。
- 端口 3000 当前无监听；实施期间固定复用 3000，禁止换端口。
- 全库当前无 `leech` 字样；`lib/weak-signals/` 已派生 `lapse`（`review.rating === 0`）信号与时间线，`WeakThresholds` 含 `lookupWeak / lookupPriority / slowRecallMs` 并走设置归一化。

## 唯一目标

在既有 `lib/weak-signals/` projection 中增加 leech 渐进阈值：纯派生复发检测 + 用户可见可移除标签。不新增第二套数据源，不复制已有薄弱画像存储。

## 契约（完成定义）

1. **派生三元组**：对每个 wordId，从既有 `reviews` 派生 `lapses`（`rating === 0` 事件总数）、`latestLapseAt`（最近一次 `rating === 0` 时间，无则 null）、`currentStreak`（最近一次 lapse 之后 `rating > 0` 的连续次数，无 lapse 则 null）。三元组只派生不持久化，不新写 review/quiz/FSRS。
2. **leech 标签规则**：累计 `lapses >= 8` 打 `leech` 标签，档位为 `leech 8`；此后每跨过 `8 + 4k`（k≥1，即 12/16/20…）重新触发并更新档位文案（`leech 12`…）。同词同档位只显示一次。
3. **自动解除**：`currentStreak >= 3` 时标签消失，累计 lapses 保留；后续再次 lapse 若已跨过下一档位则重新点亮。
4. **手动移除**：词卡 leech 标签与词本薄弱词展示处提供“不再提醒”操作；点击后写入持久化静默集合（仅存 wordId，`leechMuted`），当前档位不再显示 leech；累计 lapses 再跨过下一档位时自动解除静默并重新点亮。持久化按既有可选字段模式扩展 `StoredState`，沿用现有 settings 分域、备份导入/导出与恢复副本链路，不提升 `STORAGE_VERSION` / `DATABASE_VERSION` / `BACKUP_FORMAT`。
5. **展示**：leech 并入 `WeakWordProfile.signals`（固定顺序置于既有 `lapse` 之后），词卡标签区与词本薄弱词展示跟随现有 signals 渲染路径，不新增第五个词本 tab；标签显示档位文案（如 `leech 12`），时间线来源复用 `buildWordSignalTimeline`。
6. **默认阈值**：起点 8 纳入 `WeakThresholds`（新增 `leechLapses`，默认 8，归一化下限 1、上限 99）；设置页不新增输入 UI，仅保留默认值与现有设置归一化路径。
7. **诚实口径**：leech 是“累计遗忘次数达到档位”的薄弱信号，不是掌握度/恢复/长期记忆结论；UI 与文档不得使用后述措辞。档位按累计 lapses 单调推进，不因成功清除而回退。

## 边界

- 允许修改：`lib/weak-signals/*`、`lib/study.ts` 的 `WeakThresholds` 与归一化、`StoredState` 可选字段与迁移兼容、`app/page.tsx` 派生入口、`app/components/WordCard.tsx` 与 `WordbookView.tsx` 标签/移除交互、`tests/weak-signals.test.ts` 及必要 E2E、`docs/iterations/round-74.md`、`docs/iterations/next-round-prompt.md`（本文件已预写，直接随轮暂存）、必要时 `docs/project-evolution.md` 与 `package.json` 脚本（仅确需时）。
- 禁止修改：真题语料与 `public/data/kaoyan-examples/`、红宝书、Canonical、`lib/backup.ts` 的 store/domain、Quiz/FSRS 调度语义、`daily-cloze` / `daily-sentence` / `etymology`、`STORAGE_VERSION` / `DATABASE_VERSION` / `BACKUP_FORMAT` 提升、`.zcode/` 与私有文件。
- 既有 daily-cloze 跨 UTC/本地日期边界缺陷不得修复（越界）；不得降低或改写其断言。
- Delta Gate：实施前重跑只读 Round 0，HEAD/tracked/端口/保护项均须与上方快照一致；任何偏差先停下说明，再决定是否继续。

## 验证（V1–V4）

- V1 红测：`node --test tests/weak-signals.test.ts` 先跑既有用例确认基线，再补 leech 新用例：8/12/16/20 触发档位、跨档文案、streak 解除、muted 静默与跨档复活、纯派生零写入断言。
- V2 聚焦：新用例全绿；typecheck 通过；lint 0 error（仅允许既有 1 个 `projection.ts` 未使用类型 warning）。
- V3 联动：leech 相关 UI 若改动，跑 weak-signals + learning + wordbook 相关 E2E 链；不做全量无关回归扩圈。
- V4 全量：`npm test` 的 Node 单测全绿、production build 通过；若改动 UI 则 production smoke 验证首页与数据通路；全部通过后再进入提交门。
- 服务：固定端口 3000，独立唯一日志文件并记录 PID；验证结束精确停止，端口释放。
- 生成文件：所有 build/dev/smoke 结束后，将 `lib/build-info.generated.ts` 恢复为 HEAD blob `4410b1880754eea8e9ee2a9263d372318efac3f3`，恢复后不再运行生成命令。

## 提交门

- 只逐路径暂存本轮授权文件（含本 prompt、`docs/iterations/round-74.md`）；不使用 `git add .` / `git add -A`；`1.txt`、`2.txt`、`.zcode/`、日志、研究文档、真题语料与派生句库均不得进入 index。
- `git diff --check` 通过；无未暂存 tracked diff；cached 集合精确等于授权文件集。
- PreCommit/Finish Gate 若仅因既有保护文件报告 BLOCK，以 exact cached set、tracked diff 为空、保护项暂存为 0 独立验收。
- 创建唯一单父中文提交，标题建议 `feat: 增加leech渐进阈值标签`（实际以改动内容定）；不 push。
- 完成后写 `docs/iterations/round-74.md` 并 STOP；P2-12“每日学习提醒”仍须用户重新授权并执行新的 Round 0。