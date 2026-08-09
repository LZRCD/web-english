# 第 50 轮：阶段 F2 发布测试收敛只读审计

- 日期：2026-08-09
- 分支：`codex/follow-up-hardening`
- 起始 HEAD：`31deaf6c8d705b303737b979558778b8c81c2b1f`
- 状态：完成

## 授权与唯一目标

- 用户授权：`按 next-round-prompt.md 执行第 50 轮，严格遵循自动化迭代 SOP，完成 Round 0、审计、验证、精确提交和评估，不 push。`
- 问题：现有单测、production build 检查与 E2E 有明显重叠，但尚无一份能直接执行、覆盖发布数据链且不机械跑全目录的最小清单。
- 完成定义：从当前源码、测试源码、package scripts 与发布矩阵建立风险到测试的覆盖表；为每个保留项写清唯一理由、前置状态、期望结果及不能证明的边界；生成下一轮只执行该清单的待授权 Prompt。
- 允许范围：只读检查生产代码、测试、脚本与 Git；只修改 `docs/iterations/round-50.md`、`docs/iterations/release-readiness.md`、`docs/iterations/next-round-prompt.md`、`docs/project-evolution.md`。
- 禁止范围：业务代码、测试、fixture、配置、package scripts、schema/version/store/domain、备份格式、产品阈值、生产数据、浏览器用户 IndexedDB 和任何中风险缺口修复。
- 停止条件：基线或保护项漂移、3000/3001 非项目占用、需要读取生产数据、需要改测试才能形成清单，或无法为保留的验证给出非重复风险理由。

## Round 0 现场

- 分支与 HEAD：`codex/follow-up-hardening`；实际 HEAD 为 `31deaf6c8d705b303737b979558778b8c81c2b1f chore: 固化自动化迭代标准流程`。Prompt 记录的第 49 轮提交为 `ceab957a892ae24e981118b31d9399e44235725b fix: 保留完整测验作答历史`；两者之间唯一新增提交只加入 SOP、轮次模板、门禁脚本和演进记录，没有改产品、测试或第 50 轮 Prompt，故以实际 HEAD 登记基线，不猜测回退。
- tracked 工作区：为空；`git diff` 无输出。
- 暂存区：为空；`git diff --cached` 无输出。
- 保护项：门禁登记 25 个既有未跟踪文件，包括 `1.txt`、两份 `.zcode/` 计划、架构分析、Typora 日志及第 38/40/41/42/43/44 轮服务日志；均只读保留，未修改或暂存。
- 端口/PID：3000/3001 均无监听；本轮不启动服务。
- 既有调用链与测试入口：`package.json` 的 `npm test` 已包含 production build 和全部 Node 测试；浏览器链位于 `concurrency.spec.mjs`、`data-lifecycle.spec.mjs` 与 `signal-flow.spec.mjs`；production smoke 由 `scripts/production-smoke.mjs` 在固定 3000 自行启动、健康检查和清理项目服务。
- STOP/GO：`scripts/check-iteration-gate.ps1 -Phase Start` 通过；基线差异已由只含流程文件的提交解释，未命中范围或保护项停止条件，结论为 **GO**。

## 审计结果

### 证据链

```text
旧状态 / 备份 / localStorage / IndexedDB state-domains
  -> parseStoredState / normalizeStoredState
  -> splitStoredState / combineStoredState
  -> revision 原子写入或 fallback
  -> 页面恢复 / 导入 / 恢复副本 / activeQuiz 续答

源码契约
  -> typecheck + lint
  -> npm test（production build + Node 测试）
  -> production smoke（真实构建产物启动与客户端激活）
  -> 7 项精选 E2E（事务、刷新、失败提示与恢复）
```

### 风险到最小验证覆盖表

| 风险面 | 最小验证 | 已有重叠与取舍 | 执行通过后能证明 | 不能证明 |
|---|---|---|---|---|
| schema / normalize | `npm test` 中 `study.test.ts` 与 `data-integrity.test.ts` | 已覆盖无版本 v1、v2、v4、当前 v5、非法/未来版本及损坏 FSRS；不再单独跑同文件 | 当前 checkout 的既有迁移、拒绝和逐词重建断言通过 | 没有独立 v3 形状 fixture；不证明真实旧库 |
| 当前状态分域往返 | `npm test` 中 `study.test.ts`、`weak-signals.test.ts` | 深比较完整状态与 activeSession/activeQuiz/sessionId 专项都已包含在全量 Node 套件 | `splitStoredState -> combineStoredState -> normalizeStoredState` 的确定性往返 | 不证明浏览器事务或新增字段的运行时自动报警 |
| 备份格式与长 attempts 往返 | `npm test` 中 `study.test.ts`、`data-integrity.test.ts` | 备份格式/版本、5001 条分域和备份往返均包含；不重复定向运行 | fixture 的格式拒绝、normalize、分域和备份往返 | 不证明真实大备份、浏览器配额、设备性能或已丢历史 |
| revision 与跨标签原子写入 | `npm test` 的 revision helper + 精选 E2E `双标签并发写入时旧 revision 不会覆盖新数据` | Node 只能证明纯判定；第二条“性能样本按 ID 合并”不属于状态 revision 风险，删除 | 旧标签写入被拒、权威值不被覆盖、失败提示与恢复副本存在、刷新回到权威值 | 不证明 BroadcastChannel 可用时的所有浏览器组合 |
| 导入与恢复 | 精选 E2E `导入备份会替换状态，并在刷新后保持`、`可从多份恢复副本中恢复指定副本，并保留其余副本` | 导入与恢复都创建保护副本，但前者不证明从恢复集合恢复，后者不证明文件导入，二者不可互删 | 导入替换/刷新、导入前自动备份、指定副本恢复、其余副本保留 | 不证明用户真实备份、超大备份或自动备份 5 份容量是否足够 |
| IndexedDB / fallback / 配额失败 | 精选 E2E `IndexedDB 被禁用…`、`IndexedDB 损坏异常…`、`IndexedDB 不可用且 localStorage 配额耗尽…` | 三项分别覆盖能力缺失、open 异常读取和 fallback 写失败，结果不同，不合并冒充 | 兼容存储成功写入、损坏库加载兼容副本、双存储不可写时阻断且旧值不变 | 不证明 Safari、无 Web Locks、真实大状态容量或实际损坏库 |
| activeQuiz 刷新 | `npm test` 的题组 normalize/恢复纯函数 + 精选 E2E `信号联动：维度化 Quiz、主动回忆、刷新、历史与 generic 复跑纵向贯通` | 该 E2E 后半段有信号流重叠，但它是现有测试中唯一断言题序、索引、答对数、答案、seed、startedAt 与 sessionId 刷新恢复的浏览器链；不跑 signal-flow 全组 | fixture 上进行中 Quiz 跨刷新续答并保持完整题组快照，完成后 review 关联同一 sessionId | 不证明所有题均被删除时的用户提示，也不证明生产状态 |
| production build 与启动 | `npm test` + `npm run smoke:production` | 不再单独 `npm run build`；Node 的 production-server helper 不能替代真实服务启动 | production build 成功，首页/JS/音频索引/Range 206 可访问且客户端激活无 page error | 私有红宝书数据缺失时 smoke 会明确跳过 6550 词完整性；不证明全部交互 |
| build-info 漂移与现场保护 | build 后只审查 `lib/build-info.generated.ts`，在最终文档暂存前恢复 HEAD，并复跑门禁 | 生成文件变化是 build 副作用，不作为产品 diff 提交 | 最终 index 只含授权文档，生成文件与保护项无残留漂移 | 不证明构建元数据应长期跟随本轮文档提交 |

### 7 项 E2E 的前置状态与非重复边界

| E2E | 前置状态 | 期望结果 | 唯一风险理由与不重复边界 |
|---|---|---|---|
| 双标签 revision | 默认 fixture；屏蔽 BroadcastChannel；两页读取同一 revision；第一页先把 dailyGoal 写为 30，第二页再尝试写 50 | 第二页显示冲突和保存失败，50 被存入恢复副本；权威设置保持 30，刷新后仍为 30 | 唯一验证真实 IDB 事务的 stale revision abort；Node helper、导入和 fallback 均不能替代 |
| 导入备份 | 初始 favorite=2；导入 dailyGoal=50、favorite=1 的 v5 fixture 并确认替换 | 域记录替换、导入前自动备份存在；刷新后 dailyGoal=50 且 favorite=1 | 唯一验证文件导入到权威分域及刷新；恢复副本测试不经过文件解析/导入入口 |
| 指定恢复副本 | 默认状态；localStorage 中预置 dailyGoal=30/50 两份可解析恢复副本；选择第二份并确认 | 权威状态变为 50、只消耗目标副本、另一份保留、保护备份存在，刷新后仍为 50 | 唯一验证恢复集合的目标选择与剩余副本；导入测试不从 recovery collection 恢复 |
| IndexedDB 被禁用 | localStorage 有默认 fixture；启动前令 `indexedDB` 不可用；设置 dailyGoal=30 | 显示兼容存储成功，localStorage 权威值变为 30 | 唯一验证无 IDB 时 fallback 成功写入；损坏和配额用例分别是读取异常与写失败 |
| IndexedDB 损坏异常 | localStorage 有 dailyGoal=30；`indexedDB.open()` 抛 `UnknownError` | 应用载入 30 并显示数据库不可用、已载入兼容副本 | 唯一验证 open 异常后的只读恢复；“被禁用”不经过异常分支，本用例也不证明后续写入 |
| 双存储配额失败 | localStorage 有 dailyGoal=20；禁用 IDB；令 `Storage.setItem` 抛 `QuotaExceededError`；尝试设置 30 | 显示保存失败，旧权威值仍为 20 | 唯一验证 IDB 与 fallback 都不可写时阻断且不伪装成功；前两项只覆盖可恢复路径 |
| activeQuiz 刷新 | 两个薄弱词 fixture；启动中译英处置 Quiz，完成第一题并进入第二题后刷新 | 刷新前后 id/mode/seed/questionWordIds/startedAt 相同，index=1、correctCount=1、已有答案=1；完成后两条 review 关联同一 sessionId | 唯一验证浏览器中完整 activeQuiz 快照续答；Node 纯函数不经过持久化/刷新，其他 6 项不进入 Quiz |

### 下一轮批准的最小执行清单

1. 启动门禁：实际 HEAD/分支、tracked/index、25 个保护项、3000/3001 与既有 PID。
2. `npm run typecheck`：只证明 TypeScript 静态契约；`npm test` 不替代它。
3. `npm run lint`：只证明 ESLint 规则；既有 warning 单独记录，不顺手修复。
4. `npm test`：一次完成 production build 与全部 Node 测试；不得再跑聚焦单测或单独 build 冒充新增证据。
5. `npm run smoke:production`：固定 3000 验证真实构建产物的 HTTP surface 与客户端激活，并核对脚本清理 PID/端口。
6. 按项目服务 SOP 在固定 3000 启动一个独立日志、记录 PID 的本项目 dev 服务，健康检查 200 后只运行下列 7 项 Playwright，再精确关闭该 PID：
   - `双标签并发写入时旧 revision 不会覆盖新数据`
   - `导入备份会替换状态，并在刷新后保持`
   - `可从多份恢复副本中恢复指定副本，并保留其余副本`
   - `IndexedDB 被禁用时使用 localStorage 兼容存储`
   - `IndexedDB 损坏异常时载入兼容副本且不覆盖原记录`
   - `IndexedDB 不可用且 localStorage 配额耗尽时暂停写入`
   - `信号联动：维度化 Quiz、主动回忆、刷新、历史与 generic 复跑纵向贯通`
7. 审查并恢复 `lib/build-info.generated.ts`，复核 tracked diff、index、保护项、3000/3001 和日志/PID；只把当前通过结果写入下一轮文档。

精确 Playwright 命令：

```powershell
npx playwright test tests/e2e/concurrency.spec.mjs tests/e2e/data-lifecycle.spec.mjs tests/e2e/signal-flow.spec.mjs --config playwright.config.mjs --grep "^(双标签并发写入时旧 revision 不会覆盖新数据|导入备份会替换状态，并在刷新后保持|可从多份恢复副本中恢复指定副本，并保留其余副本|IndexedDB 被禁用时使用 localStorage 兼容存储|IndexedDB 损坏异常时载入兼容副本且不覆盖原记录|IndexedDB 不可用且 localStorage 配额耗尽时暂停写入|信号联动：维度化 Quiz、主动回忆、刷新、历史与 generic 复跑纵向贯通)$"
```

### 明确删除的重复项

- 不单独跑 `study.test.ts`、`data-integrity.test.ts`、`weak-signals.test.ts`：已包含在 `npm test`。
- 不单独跑 `npm run build`：`npm test` 已先执行 production build。
- 不跑 `npm run test:e2e` 或 `test:e2e:production`：会机械包含视觉、响应式、音频、查词和大量信号流，不能增加本轮发布数据链的唯一证据。
- 不跑 concurrency 的“性能样本按 ID 合并”、data-lifecycle 的清空记录/旧缓存清理及其他 E2E：分别属于性能诊断、尚未定义的清空语义或无关缓存风险。
- 不跑 `perf:baseline` / `perf:production`：当前 runner 使用空 reviews/quizAttempts 的合成 `createState`，不能回答真实长历史性能；没有批准 SLA 或可比真实基线时运行只会制造无效数字。

### 仍保持原结论的缺口

- activeSession 孤儿 ID、非法记录行级隔离、重复 quizAttempt ID、activeQuiz 非法 startedAt、清空语义、自动备份 5 份/恢复副本 10 份容量与真实长历史性能仍为中风险或当前不可证明；本轮不新增测试、不修复、不降级风险。
- schema v3 没有独立代表 fixture，但现实现只有 `<4` 分支，现有 v2 已覆盖同一代码分支；这只是分支证据，不等于 v3 真实备份兼容证据。
- production smoke 若本地缺少私有 `redbook.json` 会按脚本明确跳过 6550 词检查；必须记录为缺失证据，不能写成通过全量数据校验。

## 验证

| 命令或检查 | 结果 | 能证明 | 不能证明 |
|---|---|---|---|
| `scripts/check-iteration-gate.ps1 -Phase Start` | 通过 | 启动分支、实际 HEAD、tracked/index、保护项与 3000 基线可信 | 不证明产品行为 |
| `git show` / `git diff ceab957..31deaf6` | 通过；仅流程文件 | Prompt 预期值与实际 HEAD 的差异可归因 | 不证明流程脚本未来无缺陷 |
| `package.json`、相关源码与测试源码交叉核对 | 完成 | 清单中每项都有当前源码入口和测试断言，删除项有重叠理由 | 不表示这些测试在本轮运行通过 |
| package scripts、脚本路径和 E2E 标题核对 | 通过；4 个命令入口、3 个相关文件存在，7 个标题各唯一出现 1 次 | 下一轮清单可直接定位当前测试 | 不表示测试实际通过 |
| `git diff --check` | 通过 | 文档 diff 无空白错误 | 不证明清单内产品命令运行成功 |

- 超时/重试：首次并行 Round 0 端口检查脚本因 PowerShell 空管道语法失败，修正为先收集 `$rows` 后立即重跑通过；没有命令静默超过两分钟。
- 浏览器服务：未启动；3000/3001 启动与最终核对均无监听。
- 历史证据：第 49 轮 235/235 仅作测试规模背景，不冒充本轮运行证据。

## 提交前复核

- `git diff --check`：通过。
- 实际修改文件：`docs/iterations/round-50.md`、`docs/iterations/release-readiness.md`、`docs/iterations/next-round-prompt.md`、`docs/project-evolution.md`。
- 精确暂存文件：同上四项；未使用通配暂存。
- `scripts/check-iteration-gate.ps1 -Phase PreCommit ...`：通过；index 仅含四份授权文档，固定 3000 无监听。
- 保护项和范围外文件：25 个既有未跟踪文件保持未暂存；内容清单聚合 SHA-256 为 `993a323f8e8b2c2d1d0ee68fd372978f721e8046e51e25438231afc9ff37db`，最终复核一致；`1.txt` 仅在 Round 0 读取。
- 生成文件：本轮未运行 build，无生成漂移。

## 评估与交付

- 完成状态：只读审计目标完成；最小执行清单已形成，当前尚无第 50 轮产品测试或浏览器通过证据。
- 用户价值：将全量 Node 测试、production smoke 与 7 个不可互相替代的浏览器链分层，删除重复验证，同时保留数据安全、恢复与失败提示的发布证据。
- 剩余风险：清单通过也只能证明当前 checkout 与合成 fixture；不能把 activeSession、隔离、重复 ID、清空语义、容量和真实长历史性能标记为发布就绪。
- 第 50 轮方向复核：继续机械加功能的价值低；当前最高价值是先执行一次经审计的发布证据链。若清单通过，阶段 F 仍只能进入“已验证护栏 + 明确中风险”的收尾判断，不能宣称全部发布就绪；若失败，停止并单独授权诊断或修复。
- 提交：使用一次中文文档提交 `docs: 收敛最小发布验证清单`；完整 hash 由下一轮启动登记，不在本提交内自引用。
- push：未执行。

## 下一轮

- 决策：等待授权。
- 唯一候选目标：第 51 轮只执行上述最小清单并记录当前证据，不修测试或产品。
- 启动基线与停止条件：写入 `docs/iterations/next-round-prompt.md`；任何失败、范围漂移、非项目 3000 占用或需要改代码均停止请求新授权。
