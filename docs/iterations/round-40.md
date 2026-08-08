# 第 40 轮：最小统一未来 sessionId 编码纵向链

日期：2026-08-09  
基线：`ae17c94`  
分支：`codex/follow-up-hardening`

## 目标与边界

- 只为未来新冲刺写入结构化 `sprint:treatment:<dimension>:<ISO>`，不回填历史。
- 旧 `sprint:<ISO>` 解析为 `unknown`，未来明确混合入口写 `generic-sprint`，两者不合并。
- 顽固词继续使用 `sprint:stubborn:<mode>:<ISO>`，统一解析为 `dimension=stubborn` 并保留子 mode。
- 不新增 schema/version/store/domain，不改评分、FSRS、每日 Quiz 门禁、备份、历史数据、阶段 A/B 指标或推荐优先级。
- slow-recall/lapse 只纳入枚举与解析能力；本轮不复制散落的画像规则，不从标签猜测唯一维度，fallback 统一写 `generic-sprint`。

## 实现

1. `lib/weak-signals.ts` 新增唯一未来编码器 `createTreatmentSprintSessionId` 和权威解析器 `parseSprintSessionId`。解析器兼容新 treatment、旧普通、旧顽固、未知维度、非法顽固 mode 与非法时间；合法尾部 ISO（含时区偏移）原样保留，非 sprint 返回 `null`。
2. `parseStubbornSprintSessionId` 改为委托统一解析器，保留既有返回形状；`buildSprintHistory` 统一从解析器取得 startedAt，非法时间不进入可排序记录或覆盖汇总。
3. 三类 Quiz 按真实 mode 写 `listening-spelling`、`chinese-to-english`、`meaning-choice`；查词主动回忆写 `lookup-recall`。顽固三阶段格式不变。
4. 考前 fallback、分册/单元限定、完成页补漏、当前仍薄弱再次处置和历史复跑都显式写 `generic-sprint`。历史复跑只按原完整 sessionId 复用原词集，不继承来源维度。
5. review、activeSession、activeQuiz、题组快照和 IndexedDB 分域继续原样保存字符串；所有 `startsWith("sprint:")` 消费者继续统一纳入新旧格式，阶段 B 的锚点、总序、下一 sprint 截断和普通随访规则不变。

## 验证

- `tests/weak-signals.test.ts`：85/85，通过。覆盖 8 个可写维度、旧普通/顽固/未知/非法格式、时区 ISO、历史排序与非法过滤、精确再跑、状态往返，以及新格式在保持链中的锚点、跨维截断、quiz/无 session 随访和同毫秒总序。
- `npm run lint`：通过。
- `npm run typecheck`：通过。
- `npm test`：205/205，通过，包含生产构建。
- `signal-flow` 已扩为一条复合纵向链：真实中译英启动、题组写盘与刷新、review 同 id、查词主动回忆启动与刷新、WordCard review 同 id、历史可见、原词集复跑及新 generic id；既有旧普通 sprint E2E 保持。
- `npx playwright test tests/e2e/signal-flow.spec.mjs --config playwright.config.mjs --reporter=line`：17/17，通过（45.6s，命令 46.8s）。父会话复用固定 3000 的项目服务执行；新增复合链与旧 16 条全部通过。
- 首次真实运行是 16/17（74.5s）：Quiz 成功 review 后旧 lookup 信号按产品规则降级，测试错误等待仍存在的 lookup 入口。修正只改变测试交互：先回首页真实再次划选 `radiate`，让查询发生在成功 review 之后并触发真实复发，再进入 lookup 专项；没有降低产品门槛或改写状态。
- 父会话已按监听证据精确停止本轮固定 3000 的项目 node PID 23804，3000/3001 复核无监听；dev 生成的 build-info 已恢复。两份本轮日志 `.codex-round40-parent-e2e.out.log/.err.log` 的显式删除被审批 usage limit 拒绝，未用变体绕过，保留为未跟踪保护项且不进提交。

## 阶段与交接

- 代码、单测、静态检查、构建和全量 Node 测试证明编码、解析、startedAt、入口、持久化、历史、成效/B 链兼容与再跑实现完整。
- 编码、解析、startedAt、真实入口写入、刷新、历史、成效/B 链兼容与再跑已形成完整纵向证据，阶段 C 完成；下一轮允许进入阶段 D，但仍禁止排名或自适应。
- 提交前仍须由同一 DeepSeek 任务复核实际 diff，并补录服务清理和最终结论。
- 工作区四个既有保护项、两份第 40 轮受限日志以及并发出现的 `.zcode/` 均未修改、未暂存。
