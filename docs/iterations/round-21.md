# 第 21 轮报告：普通复习进入词级时间线

> 执行日期：2026-08-08 ｜ 分支：`codex/follow-up-hardening`

## 目标

修复咬合表第 4 项“复习 → 时间线记录”：复用既有 review 日志，让所有评分动作有明确、不重复且稳定排序的时间线表达，同时保持慢回忆、查词、冲刺等既有事件语义。

## 核实结论

- 评分 0/1/2/3 对应“忘记/模糊/认识/熟练”；可靠事件时间来自 review 的 `reviewedAt`。
- 冲刺身份来自既有 `sessionId.startsWith("sprint:")`；UI 继续由学习卡薄弱信号区的多行悬停文本展示时间线。
- “猜错”只有 `guessMistakes` 累计次数，没有时间戳或其他可靠事件时间。本轮严格不伪造时间、不新增持久化 schema，继续列为缺口。

## 文件与关键改动

- `lib/weak-signals.ts`：新增普通 review 时间线事件；`rating=0` 复用既有 lapse，1~3 显示对应评分，冲刺显示“冲刺复习”；相同 review ID 只派生一次，保留慢回忆、测验、查词和顽固词事件及原升序。
- `tests/weak-signals.test.ts`：覆盖四档评分、普通/冲刺文案、原有 rating=0/慢回忆语义、review ID 去重、排序与空输入。
- `lib/build-info.generated.ts`：刷新生产构建信息，修正旧构建标识漂移。
- `docs/iterations/direction-review-20.md`、`docs/iterations/occlusion-table.md`、`docs/project-evolution.md`：校正猜错时间源判断，标记核心第 4 项于第 21 轮补齐，并记录本轮演进。

## 验证

- `node --experimental-strip-types --test tests/weak-signals.test.ts`：45/45 通过。
- `npm run lint`：通过。
- `npm run typecheck`：通过。
- `npm test`：162/162 通过，含生产构建成功。
- `npx playwright test tests/e2e/signal-flow.spec.mjs`：既有 8/8 通过（17.6s），未修改其语义。
- 固定端口 3000：启动前无监听，健康检查 200；结束后精确关闭本轮父 PID 9008 与监听 PID 37452，端口释放，日志与 PID 文件已清理。

## 提交

- 提交信息：`fix: 补齐普通复习时间线`
- 提交：本提交（真实 hash 见最终回报）。

## 遗留与决策

- 核心 8 项咬合现为 8 ✅ / 0 ❌ / 0 ⚠️。
- “猜错”时间线仍是明确缺口：现有 state 无可靠事件时间；除非未来自然获得真实时间源，否则不接入。
- 非查词类薄弱消除后的正向“已稳定”反馈仍待下一轮价值评估。
