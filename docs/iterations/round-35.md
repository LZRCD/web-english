# 第 35 轮：当场达标口径诚实化

日期：2026-08-08
只读基线：`a1db0ae`
分支：`codex/follow-up-hardening`

## 只读审计

- 修改前工作区只有用户未跟踪的 `1.txt`，无其他 diff；固定端口 3000 无监听。
- `buildSprintEffectiveness.resolvedCount` 是本周 `sprint:*` review 中 `rating≥2` 的 wordId 去重词数；`buildSprintCompletionSummary.resolvedCount` 与冲刺历史 `successCount` 是单次冲刺 session 的同口径去重词数。
- 这些派生都只能证明冲刺期间至少一次当场评分达标，不能证明问题已解决、词已恢复、长期掌握或后续保持。
- 完成页“仍需关注”来自当前统一薄弱画像，与当场达标的数据源不同，因此两者可以重叠。

## 唯一目标

- 周报标题、指标、4 周说明、每周卡片、完成页和冲刺历史成功率共 6 个用户可见入口统一使用“当场达标词数/当场达标”。
- 保留内部兼容字段 `resolvedCount`、`rating≥2` 条件、wordId 去重和全部数值断言。
- 保留“仍需关注”及当前画像语义；不处理非配对回忆耗时。

## 验收证据

- 定向 `node --experimental-strip-types --test tests/weak-signals.test.ts`：75/75。
- `npm run lint`：通过。
- `npm run typecheck`：通过。
- `npm test`：192/192，0 失败、0 跳过，含生产构建。
- `npx playwright test tests/e2e/signal-flow.spec.mjs --config playwright.config.mjs --reporter=line`：15/15。
- E2E 覆盖本周冲刺成效、4 周趋势、冲刺完成页和冲刺历史卡的新文案；既有 15 条纵向链语义不减少。

## 边界与清理

- 未新增 schema/version/store/domain；未修改评分、FSRS、每日 Quiz 门禁、备份、package scripts、历史 reviews/quizAttempts、薄弱画像或再冲刺行为。
- 未声称恢复、掌握、长期保持或因果效果；回忆“提升/降幅”的非配对口径留给下一独立轮次。
- 近 7 天全局“成功率”统计所有评分事件，与冲刺历史当场达标率数据源不同；已登记后续审计，本轮不混改。
- E2E 只使用固定端口 3000；验证后仅清理本轮确认归属的 PID 和日志，端口无监听。
- `1.txt` 未修改、未暂存。
