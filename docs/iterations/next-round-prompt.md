# 第 51 轮待授权 Prompt：阶段 F3 最小发布验证执行

## 当前真实现场

- 当前分支应为 `codex/follow-up-hardening`。
- 第 50 轮起始基线为 `31deaf6c8d705b303737b979558778b8c81c2b1f`；第 50 轮完成后，HEAD 应为唯一中文文档提交 `docs: 收敛最小发布验证清单`。启动时用 `git rev-parse HEAD` 与 `git log -1` 登记实际完整 hash，不猜测自引用提交。
- 第 50 轮只读审计批准静态/Node 3 项、production smoke 1 项与 7 项精选 E2E；未运行 typecheck、lint、test、smoke 或 E2E，不得冒充当前证据。
- activeSession 孤儿 ID、非法记录行级隔离、重复 quizAttempt ID、activeQuiz 非法时间、清空语义、自动备份/恢复副本容量与真实长历史性能仍保持中风险或当前不可证明。
- 起始 tracked 工作树和 index 应为空；继续保护实际未跟踪项、`1.txt`、`.zcode/`、架构笔记与历史日志。
- 3000/3001 应无监听；未 push。

## 授权门禁

这是阶段 F3 的待授权 Prompt，不是自动执行指令。

- 若用户没有明确授权第 51 轮或等价指令：只核对当前状态并报告等待授权，不修改文件、不暂存、不提交、不启动服务。
- 若用户明确授权：才按下述唯一目标执行。
- 任何生产数据读取/改写、用户浏览器 IndexedDB 访问、业务修复、测试修复、阈值调整、schema/version/store/domain/备份格式变化都超出本授权，立即停止请求另行授权。

## 唯一目标

只执行第 50 轮审计批准的最小发布验证清单，记录当前 checkout 下每项实际通过/失败、能证明与不能证明的边界，并据此评估阶段 F 是否可收尾。

本轮不修复任何失败，不新增或修改测试/fixture，不修改业务代码、package scripts 或配置；不得用 fixture、历史 checkpoint 或合成数据冒充生产证据。

## 唯一执行清单

1. 运行 Round 0 门禁，核对实际 HEAD、分支、tracked/index、保护项、3000/3001 和已有 PID 记录。
2. 依次运行：
   - `npm run typecheck`
   - `npm run lint`
   - `npm test`
3. 审查 `npm test` 生成的 `lib/build-info.generated.ts` diff，登记生成内容后在最终文档暂存前恢复为 HEAD；不得把它提交。
4. 运行 `npm run smoke:production`；确认固定 3000 的健康检查、真实构建产物 HTTP surface、客户端激活、日志/PID 和脚本清理结果。若私有 `redbook.json` 缺失而跳过 6550 词检查，必须明确记录缺失证据。
5. 按项目服务 SOP 在固定 3000 启动一个本项目 dev 服务：启动前识别端口/PID，使用独立唯一日志并记录 PID，HTTP 200 后启动命令立即返回；不得自动换端口。
6. 只运行以下 7 项 Playwright：
   - `双标签并发写入时旧 revision 不会覆盖新数据`
   - `导入备份会替换状态，并在刷新后保持`
   - `可从多份恢复副本中恢复指定副本，并保留其余副本`
   - `IndexedDB 被禁用时使用 localStorage 兼容存储`
   - `IndexedDB 损坏异常时载入兼容副本且不覆盖原记录`
   - `IndexedDB 不可用且 localStorage 配额耗尽时暂停写入`
   - `信号联动：维度化 Quiz、主动回忆、刷新、历史与 generic 复跑纵向贯通`
7. 结束后精确关闭本轮记录的项目 PID，确认 3000/3001 无监听；复核生成文件、tracked diff、index、保护项及运行日志。

精确 Playwright 命令：

```powershell
npx playwright test tests/e2e/concurrency.spec.mjs tests/e2e/data-lifecycle.spec.mjs tests/e2e/signal-flow.spec.mjs --config playwright.config.mjs --grep "^(双标签并发写入时旧 revision 不会覆盖新数据|导入备份会替换状态，并在刷新后保持|可从多份恢复副本中恢复指定副本，并保留其余副本|IndexedDB 被禁用时使用 localStorage 兼容存储|IndexedDB 损坏异常时载入兼容副本且不覆盖原记录|IndexedDB 不可用且 localStorage 配额耗尽时暂停写入|信号联动：维度化 Quiz、主动回忆、刷新、历史与 generic 复跑纵向贯通)$"
```

禁止运行全目录 `npm run test:e2e`、`test:e2e:production`，禁止追加聚焦单测、单独 build 或性能基线作为“更多证据”。

## 建议修改边界

- `docs/iterations/round-51.md`
- `docs/iterations/release-readiness.md`
- `docs/iterations/next-round-prompt.md`
- `docs/project-evolution.md`

除上述验证文档外不得修改其他 tracked 文件；`lib/build-info.generated.ts` 只能恢复为 HEAD，不得暂存。

## 停止条件

- 任一检查或测试失败且一次可归因的原命令重试后仍失败；不得在本轮修代码或测试。
- 需要读取用户生产数据、浏览器 IndexedDB 或真实备份才能得出结论。
- 需要修改业务代码、测试、fixture、配置、package scripts 或产品语义。
- 发现范围外 tracked diff、保护文件变化或非项目进程占用固定 3000。
- 服务/浏览器验证连续两次失败；按 SOP 停止服务重试，保留已完成的静态证据并记录恢复入口。
- 无法区分当前回归与既有基线失败。

## 获授权后的交付

- 一份逐项实际结果表，包含命令、通过/失败数量、前置状态、能证明与不能证明的边界。
- `release-readiness.md` 只把实际运行结果写入 F3 证据状态；不改变仍未解除的中风险结论。
- 若全部通过，评估是阶段 F 收尾还是仍需单独处理阻断；不得写“全部发布就绪”。若任一失败，进入 STOP 并生成单一诊断候选 Prompt，不自动修复。
- 精确暂存实际修改的验证文档，创建一次中文文档提交；不 merge，不 push。
