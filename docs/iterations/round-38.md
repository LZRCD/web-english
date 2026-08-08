# 第 38 轮：冲刺后首次正常复习保持观察

日期：2026-08-09
只读基线：`2059922`
分支：`codex/follow-up-hardening`

## 只读审计

- 初始工作区仅有用户未跟踪 `1.txt` 与并发只读产物 `docs/architecture-analysis-2026-08-09.md`；两者均未修改、未暂存。固定端口 3000 初查无监听。
- `ReviewEvent` 已有 `id/wordId/reviewedAt/rating/sessionId/recallMs`，足以用稳定总序连接成功冲刺与后续正常评分；`quizAttempts` 独立存储，纯函数只消费 reviews，天然不会把 attempt 当 review。
- `sessionId.startsWith("sprint:")` 是既有统一冲刺识别；因此非 sprint review 包含 `quiz:*` review、today 等普通 session 以及无 sessionId 的旧记录。排除 quiz review 会漏掉真实评分，不能采用。
- B1/B2/B3 可纯派生闭环，无需新增 schema/version/store/domain，也无需推断或回填历史。

## 唯一目标与实现

- `lib/weak-signals.ts` 新增唯一权威 `buildSprintRetentionSeries`：窗口为当前本地周一之前最近 4 个完整周，按时间升序输出，空 cohort 周为 `null`。
- 每个 wordId 只取窗口内 `(reviewedAtMs,id)` 总序上最近一次 `rating≥2` sprint review 为锚点并归入其所在周。输入乱序不影响结果；无效或未来时间排除。
- 锚点后按同一总序找首条 review：若为任意下一 sprint review 则截断且仍属未观察；否则首条非 sprint review 为随访。quiz review 和无 sessionId review 均可随访，下一 sprint 之后的普通 review 不跨越配对。
- 每周分别披露 cohort、已观察、未观察、截断、覆盖率、保持词与保持率；保持仅以已观察词为分母，未观察不算失败。已观察词的锚点到随访间隔按词等权平均。
- 只有锚点和随访两侧均有有限且 `>=0` 的 recallMs 才进入独立测时分母；报告样本数、冲刺/随访两侧词等权均值和“随访 − 冲刺”变化。无样本返回 `null`，合法 0 保留。
- `page.tsx` 用 `useMemo` 单点派生并传给 `HistoryView`；页面在当前仍薄弱区后新增“冲刺后首次正常复习保持 4 周”，使用观察性文案，不声称导致、恢复、掌握或维度因果。

## 验收证据

- `node --experimental-strip-types --test tests/weak-signals.test.ts`：81/81。新增 4 条复合用例覆盖成功/失败随访、无后续、下一 sprint 成功/失败截断、最近锚点跨周只归一次、同 session 多事件、quiz review 答对/答错、quiz 与下一 sprint 先后、只有 quizAttempt、同毫秒 id tie-break、乱序、非法/未来时间、空 cohort、零观察、合法/非法测时与双分母独立。
- `npm run lint`：通过。
- `npm run typecheck`：通过。
- `npm test`：201/201，0 失败、0 跳过，含生产构建。
- `tests/e2e/signal-flow.spec.mjs` 新增第 17 条稳定本地周 seed，设计覆盖保持成功/失败、未观察、成功下一 sprint 截断、覆盖率/保持率、1.5 天间隔、空保持分母、paired recall、`quiz:*` review 与 quizAttempt 不干扰；既有 16 条测试未删改。
- `npx playwright test tests/e2e/signal-flow.spec.mjs --config playwright.config.mjs --reporter=line`：17/17（42.8s）。新增第 17 条使用稳定本地完整周 seed，覆盖保持成功/失败、未观察、成功下一 sprint 截断、50% 覆盖/保持、1.5 天间隔、空保持分母、paired recall、`quiz:*` review 与 quizAttempt 不干扰；既有 16 条语义全部通过。

## 边界与清理

- 未新增 schema/version/store/domain；未改评分、FSRS、每日 Quiz 门禁、备份、package scripts、历史 reviews/quizAttempts、阶段 A 指标、冲刺写入、当场达标、当前仍薄弱或再冲刺。
- 未进入维度归因、分维度报告或自适应；未伪造历史样本、未把未观察算失败、未跨下一冲刺、未使用因果文案。
- 两次错误落到 3001 的本轮服务执行单元均已终止。构建生成的 `lib/build-info.generated.ts` 已恢复只读基线。
- 启动管理事件：首次 01:06:45 `Start-Process` 实例已在固定 3000 健康运行，但启动执行单元没有及时返回；中止执行单元没有带走底层服务，导致后两次重复启动落到 3001。父会话只读确认 PID 43492 的 `127.0.0.1:3000` 返回 HTTP 200；随后直接复用该唯一健康实例完成 E2E。因此没有浏览器失败，也未触发连续失败停止门槛。
- 父会话已按已确认创建时间/日志精确停止 PID 31764/43492/42640/43196/25716；`netstat` 确认 3000/3001 无 LISTENING，仅余 E2E 连接的 TIME_WAIT，且上述 PID 均已消失，未批量停止无关 Node。
- `.codex-round38-20260809-010645.err.log` 与 `.codex-round38-20260809-010645.out.log` 仍存在；删除命令被审批系统因用量限制拒绝，按约束不绕过重试。两份本轮日志保留为未跟踪且不暂存，最终交接明确列名。

## 阶段判断

- 阶段 B 的 B1/B2/B3 已由同一纯函数、页面入口与单元/集成测试闭环：cohort/截断、覆盖/保持和配对测时各自边界完整。
- 下一轮进入阶段 C，但只做“未来处置维度归因”只读审计；必须严格复用现有结构化 sprint sessionId，先验证可辨识性，不新增 schema、不回填历史、不提前做分维度结论或自适应。
- 未触发停止门槛；第 38 轮提交后可自动串行进入第 39 轮阶段 C 只读审计，但不得把审计提前扩成分维度实现。

## DeepSeek 提交前复核

- 父会话已把本轮实际 10 文件 diff、81/81 定向、lint/typecheck、201/201 全量、signal-flow 17/17、保护文件、残留日志、端口清理和红线交回同一 `opencode/zen-v4-flash` 任务。
- 复核结论：可提交，无阻断。独立确认最近成功锚点、`(reviewedAtMs,id)` 总序、下一 sprint 截断、`quiz:*` review 随访、未观察不进失败分母、覆盖/保持/null/真实 0、实际间隔与独立 paired recall 口径正确；UI 保持观察性且间隔显示明确“天/小时/分钟”单位。
- 独立确认单测/E2E 覆盖、10 文件范围、阶段 B 完成和第 39 轮仅先做阶段 C 只读审计的边界正确；两份本轮日志继续保持未跟踪，不进入提交。
