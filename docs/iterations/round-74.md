# 第 74 轮：Canonical P2-11 leech 渐进阈值标签

日期：2026-08-12

目标：在既有 `lib/weak-signals/` projection 中增加 leech 渐进阈值——纯派生复发检测 + 用户可见可移除标签。不新增第二套数据源，不复制已有薄弱画像存储。

提交：`feat: 增加leech渐进阈值标签`；提交后 STOP，不 push。

## Round 0 与保护现场

- 分支 `codex/follow-up-hardening`，起始 HEAD `afbce435f7d7148a2ee3c0bd58be335deba153b7`，相对 upstream ahead 11 / behind 0；tracked working tree 仅 `docs/iterations/next-round-prompt.md`（预写文件，随轮暂存），index 干净。
- 固定端口 3000 无监听；`lib/build-info.generated.ts` 起始/HEAD blob 均为 `4410b1880754eea8e9ee2a9263d372318efac3f3`。
- Start Gate 只因已登记的保护文件报告 BLOCK；独立复核无新路径、无 tracked/index 漂移、无端口冲突。`1.txt`、`2.txt`、`.zcode/`、历史日志、调研/规划文档、favicon、抓取脚本、Canonical 与真题语料保持原样。
- 全库产品代码无 `leech` 字样（仅预写 prompt 与未跟踪研究文档命中）；`lib/weak-signals/` 已派生 lapse 信号与时间线，lapse 时间线口径为 `review.rating === 0`；`WeakThresholds` 含 `lookupWeak / lookupPriority / slowRecallMs` 并走设置归一化；`StoredState` 有可选字段先例（weakThresholds）；词卡标签区与词本四 tab 共用 signals 渲染路径；词本 tab 数为 4。
- Delta Gate 全项通过：`scripts/kaoyan-corpus/` 与 `public/data/kaoyan-examples/` 仍被 `.gitignore` 忽略；不运行任何抓取器、不访问任何外部域名。

## 用户裁决：leechMuted 携带静默档位

Prompt 5.4/5.5 要求静默集合「仅存 wordId」，但「累计 lapses 跨过下一档位时自动解除静默并重新点亮」在纯派生下需要知道静默发生时的档位，二者不可同时精确实现（纯派生输入只有 reviews 与集合成员关系；仅存 wordId 无法区分「同档位静默中」与「已跨档」）。已向用户说明并与 Canonical 文档既有裁决（「手动移除且到下一阈值再提醒」需要可持久化的确认阈值字段）对齐，用户确认采用：

- `leechMuted?: { wordId: number; tier: LeechTier }[]`：条目携带静默时档位；当前档位等于静默档位时静默生效，跨过下一档位后派生 `muted=false` 自动复活（刷新后仍正确）。
- 派生纯函数 `deriveLeechDerivation(reviews, wordId, leechMuted, thresholds)`：输入相同则输出逐字节相同。
- 应用层对过期条目（静默档位低于当前档位）做幂等维护写入 `pruneExpiredLeechMutes`（无过期条目时不触发写盘）。

## 派生契约与档位规则

- 三元组（与 lapse 时间线同一数据源，`review.rating === 0`）：`lapses` 事件总数；`latestLapseAt` 最近一次 lapse 时间（无则 null）；`currentStreak` 最近一次 lapse 之后 `rating > 0` 连续次数（无 lapse 则 null，有 lapse 无后续成功为 0）。排序口径为 `(reviewedAt, id)` 升序，与 `normalizeStoredState` 一致，输入乱序结果确定；同一词同日多次事件逐条计数不合并。
- 档位序列 `LEECH_TIERS = [8, 12, 16, 20]`（8 + 4k；类型按 Prompt 示例收敛，超过 20 的累计 lapses 停在 `leech 20`）；档位只由累计 lapses 决定，单调推进，不因成功清除回退。
- 触发起点 `WeakThresholds.leechLapses`（默认 8，归一化下限 1、上限 99，走既有设置归一化路径；设置页不新增输入 UI）。
- 自动解除（同档位只显示一次）：`currentStreak >= 3`（即跨档触发点之后出现过连续 ≥3 次 `rating > 0`）后标签消失，累计 lapses 保留；未跨档的再次 lapse 不重新点亮；跨过下一档位后重新点亮并显示新档位文案。
- 静默：词卡与词本两处「不再提醒」按钮写入 `leechMuted`（`upsertLeechMute` 幂等，同词替换档位不产生重复条目）；静默只影响显示，lapses / streak / tier 照常推进；跨档自动复活并恢复按钮。
- 时间线复用 `buildWordSignalTimeline`：在累计 lapse 命中档位系列（且不低于 leechLapses）的评分事件处新增 `type: "leech"` 事件，文案 `leech 8 触发（累计遗忘 8 次）`；时间线本身仍为纯派生、不持久化。

## 诚实口径

leech 是「累计遗忘次数达到档位」的薄弱信号，不是掌握度/恢复/长期记忆结论。UI 与文档未使用「掌握」「恢复」「长期记忆」「精通」等措辞；档位文案只表示累计遗忘计数档位，不表示任何评分变化。标签不替换红宝书原句、不自动成为强化填空题、不改变猜义语境、不覆盖 AI 例句缓存、不改写学习排程。

## 展示与交互

- leech 并入 `WeakWordProfile.signals`（固定顺序置于既有 `lapse` 之后），词卡标签区与词本四 tab 跟随既有 signals 渲染路径；无当前档位（含静默中/已解除）时完全不渲染，不保留空白占位。
- 词卡与词本薄弱词展示处均提供「不再提醒」按钮：键盘可访问、`aria-label` 如「不再提醒：leech 12」；点击后当前档位标签即时隐藏并写入 `leechMuted`，不触发任何网络请求、不改变任何学习数据；写入失败不假装成功（沿用既有错误处理风格）。
- 320px 无横向溢出、200%/400% 缩放可操作、长标签不溢出；非颜色依赖的信息表达（文案本身携带语义）。

## 持久化边界

- 唯一新增持久化是 `leechMuted`（settings 分域可选字段），随既有 settings 分域进入备份导入/导出与恢复副本链路；不提升 `STORAGE_VERSION` / `DATABASE_VERSION` / `BACKUP_FORMAT`，不新增 object store / domain，不修改 `lib/backup.ts`。
- `normalizeStoredState` 对 `leechMuted` 归一化：只保留合法 wordId 与档位系列成员，同词去重保留最后一条；旧数据缺省为空数组。
- 浏览、加载、切换、展开、移除或点击不写入或改变 reviews、quizAttempts、wordProgress、FSRS cards、activeSession、activeQuiz、dailyCloze、dailySentence、enrichments、senseFrequency、weak-signals 画像、favorites、mistakes、lookupStats（除用户真实划词）与今日任务。

## 红测与 V1–V4

- 红测：`node --test tests/weak-signals.test.ts` 既有基线 93/93 全绿；补 leech 新用例后 0 pass / 1 fail，首个真实失败为 `The requested module '../lib/weak-signals.ts' does not provide an export named 'deriveLeechDerivation'`（缺失实现，非环境错误）。
- V1 新用例覆盖：空/无 lapse 三元组、latestLapseAt 取最近、currentStreak 只统计最近 lapse 后、8/12/16/20 各档触发点与文案、同档位不重触发与档位单调推进、streak≥3 自动解除且未跨档不点亮/跨档重新点亮、muted 静默与 upsert 幂等、跨档自动解除（派生 muted=false + prune 移除）、时间线档位触发点、纯派生零写入（reviews/quizAttempts/wordProgress 前后不变）、leechLapses 归一化 1/99、归一化去重/分域往返/备份导入导出保留 leechMuted、画像带派生字段且 muted 时 signals 不含 leech。
- V2：聚焦 `node --test tests/weak-signals.test.ts` 107/107；typecheck 通过；lint 0 error / 1 个既有 warning（`lib/weak-signals/projection.ts` 未使用 `SprintHistoryRecord`）。
- V3（固定端口 3000）：新 leech E2E 5/5（`tests/e2e/leech-signals.spec.mjs`：8 次标签与跨档 12 文案、连续 3 次成功解除且刷新仍消失、不再提醒即时隐藏/词本同步/刷新保持/跨档复活、静默只写 leechMuted 学习数据零写入且 4 个 tab 无第五个、按钮键盘访问 + 320px 无横向溢出 + 200%/400% 缩放可操作 + 全程无 /api/ 请求）；signal-flow + learning + responsive 联跑 41/41。既有「薄弱阈值分域写盘」用例的期望值随本轮归一化补全 `leechLapses: 8`（断言增强，非降级）。
- V4：`npm test` production build 通过，Node 单测 341/341（`tests/study.test.ts` 既有阈值断言同步补全 `leechLapses: 8`）；production smoke 通过：首页已激活，静态资源、6,550 词数据、真题例句分片、音频索引和 Range 206 均有效。
- `git diff --check` 通过。

## 服务、生成物与提交门

- 最终 dev worker PID 49388、listener PID 48648；日志 `.wordloop-runtime/rounds/dev-20260812-032040.out.log`（同 stem `.err.log`）；已精确停止。
- production smoke PID 32548；日志 `.wordloop-runtime/smoke-20260812T052532Z.out.log` / `.err.log`；脚本自停并清理 pid 文件。
- 所有 build/dev/smoke 结束后，已恢复 `lib/build-info.generated.ts` 为 HEAD blob `4410b1880754eea8e9ee2a9263d372318efac3f3`；恢复后不再运行生成命令，端口 3000 空闲。
- 派生/档位统计：纯派生不持久化、无生产画像可统计；单测覆盖 8/12/16/20 各档位触发点与文案，E2E 覆盖 wordId 1（radiate）8 → 12 跨档、静默/复活全链路与静默条目持久化。
- 真题语料与派生句库暂存数均为 0，保护文件暂存数为 0；只逐路径暂存本轮实现、测试与文档；不使用 `git add .` / `git add -A`。
- PreCommit Gate 若仅因已登记保护项报告 BLOCK，以 exact cached set、tracked diff 为空和保护暂存为 0 独立验收。
- 创建唯一单父中文提交 `feat: 增加leech渐进阈值标签`；不 push，不进入 P2-12（每日学习提醒需用户重新授权并执行新的 Round 0），完成后 STOP。
