# 第 36 轮：同词配对回忆变化

日期：2026-08-09
只读基线：`c41418d`
分支：`codex/follow-up-hardening`

## 只读审计

- 修改前工作区只有用户未跟踪的 `1.txt`，无其他 diff；固定端口 3000 无监听。历史 `.pid` 中部分 PID 已被 QQ、steamservice、svchost 复用，均未清理或触碰。
- 旧 `buildSprintEffectiveness` 用周内冲刺事件总体均值，对比覆盖词在该周首次冲刺前的全部非冲刺历史事件总体均值；两侧事件分母和同词权重可能不同。
- 旧 `buildSprintCompletionSummary` 用本 session 事件总体均值，对比 `session.createdAt` 前全部历史事件总体均值；基线还会混入历史冲刺，和周报不是同一规则。
- 现有 `reviews[].wordId/reviewedAt/recallMs/sessionId` 足以形成同词配对，不需要新增 schema/version 或伪造历史测时。

## 唯一目标与实现

- 新增共享纯函数 `buildPairedRecallChange`：目标侧按词汇总全部合法测时并先取词内均值；基线侧只取严格早于边界的最近一条非冲刺合法测时；同毫秒基线候选按 `review.id` 字典序稳定择一；两侧都有样本才进入配对，最终跨词等权。
- 返回 `pairedWordCount`、配对基线均值、配对目标均值和 `pairedChangeMs`；变化定义为“目标 − 基线”，负值表示目标侧更快、正值表示更慢。无配对时 count 为 0，其余三项为 `null`，不填 0。
- 周报与 4 周逐周目标集为对应本地周窗内全部冲刺 review，边界为该窗首个冲刺事件；完成页目标集为完整 session review，边界为 `session.createdAt`。两入口共享算法，同时保留真实观察窗差异。
- 删除两派生类型的旧非配对均值/提升字段；周报、4 周和完成页统一展示“同词配对回忆变化”、配对词数、较此前快/慢或无配对样本。完成页历史基线排除 `sprint:*`，不再把冲刺内测时称为“冲刺后”。
- E2E seed 为两个目标词补入真实非冲刺历史 `recallMs`，验证本周、4 周和完成页三个入口的配对文案与样本数；没有减少既有 15 条纵向链语义。

## 验收证据

- `node --experimental-strip-types --test tests/weak-signals.test.ts`：77/77。
- `npm run lint`：通过。
- `npm run typecheck`：通过。
- `npm test`：194/194，0 失败、0 跳过，含生产构建。
- `npx playwright test tests/e2e/signal-flow.spec.mjs --config playwright.config.mjs --reporter=line`：15/15（37.4s）。
- 纯函数覆盖同词两侧、目标侧同词多事件词内聚合、跨词等权、最近非冲刺基线、历史冲刺排除、无配对、缺失/非法测时、严格时间边界和乱序输入；周报、4 周与完成页有集成覆盖。

## 边界与清理

- 未新增 schema/version/store/domain；未修改当场达标、薄弱画像、评分、FSRS、每日 Quiz 门禁、备份、package scripts、历史 reviews/quizAttempts、再冲刺或后续正常复习保持；未进入维度归因。
- 历史测时覆盖不足只会形成更少的配对词或显示“无配对样本”，没有补写或造数；所有“快/慢”均为观察描述，不声称训练因果、恢复或长期保持。
- 固定端口 3000 健康检查返回 HTTP 200。首次 `Start-Process` 的重定向句柄未立即返回，已中止启动边界；第二次用隐藏 `cmd /c` 在同端口启动。E2E 后精确关闭本轮根进程、监听进程及按同一启动时刻和项目路径确认的 npm/vinext/workerd 子进程，未批量终止 node；本轮 4 个唯一日志均删除，3000 已释放。
- `npm test` / dev 生成的 `lib/build-info.generated.ts` 工作树噪声已恢复到只读基线，未纳入本轮业务 diff。
- `1.txt` 未修改、未暂存。

## 阶段判断

- 阶段 A 列出的冲刺活动量、当场达标、配对回忆观察和截至当前仍薄弱指标已收敛。
- 项目仍展示近 7 天全局“成功率”：它实际是全部评分事件中 `rating≥2` 的事件占比，且当前窗无评分时返回 0%。这是仍然可见的高价值口径缺口，因此阶段 A 暂不宣告完成。
- 下一轮只审计并诚实化该全局评分事件占比，再决定阶段 A 是否完成；不直接进入阶段 B 的首次正常复习保持。

## DeepSeek 提交前复核

- 父会话已把本轮实际 diff、测试数字、工作区、端口和边界交回同一 `opencode/zen-v4-flash` 任务。结论为可提交、无阻断；独立确认算法分子/分母、目标减基线符号、严格边界、最近非冲刺、词内聚合/跨词等权、乱序稳定、无配对 `null`、周窗/完整 session 差异、三入口文案、旧字段清理、E2E seed 和 12 文件范围均正确。
- DeepSeek 只读复验 weak-signals 77/77、session-summary 6/6、lint 与 typecheck 通过。
- 非阻断建议处理：同毫秒 `review.id` tie-break 已补充到本轮文档；`daysAgo(1)` 在周一可能跨周的既有 E2E 脆弱性已登记到下一 prompt；内部兼容类型/测试名中的“成效”不属于用户可见旧语义，为保持唯一目标不扩改。
