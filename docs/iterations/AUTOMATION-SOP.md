# WordLoop 自动化迭代标准流程

## 目的与边界

本流程把每一轮迭代作为一个可恢复、可审计、可停止的事务。自动化只负责在授权范围内推进，不扩大产品语义、不猜测历史、不修改生产数据，也不以轮数代替价值判断。

每轮必须满足：一个纵向目标、一套与风险匹配的证据、一次精确暂存、一个中文提交、不 push。

## 状态机

| 状态 | 必须完成 | 退出条件 |
|---|---|---|
| `WAIT_AUTH` | 读取当前 Prompt，确认用户授权 | 未授权保持等待；已授权进入 `ROUND_0` |
| `ROUND_0` | 核对分支、HEAD、工作区、暂存区、保护项、相关调用链与服务现场 | 基线可信进入 `GO_NO_GO`；否则 `STOP` |
| `GO_NO_GO` | 写清唯一目标、允许范围、验证档位和停止条件 | 满足全部前置条件才 `GO` |
| `EXECUTE` | 只读审计或最小实现，禁止顺手修复范围外问题 | 目标完成进入 `VERIFY`；范围扩大则 `STOP` |
| `VERIFY` | 按风险执行最小但充分的验证，记录能证明与不能证明的边界 | 必需验证通过进入 `REVIEW`；无法归因则 `STOP` |
| `REVIEW` | 复核 diff、生成文件、文档、保护项和暂存范围 | 无阻断进入 `COMMIT` |
| `COMMIT` | 精确暂存实际授权文件，创建一次中文提交，不 push | 提交成功进入 `EVALUATE` |
| `EVALUATE` | 评估价值、风险和剩余缺口，生成下一轮 Prompt | 选择继续、转向、收尾或等待授权 |
| `STOP` | 立即记录已完成、未完成、停止原因和恢复点 | 获得新授权或现场恢复后重新从 `ROUND_0` 开始 |

状态不得跳过。历史报告和历史测试只能作为线索，不能代替当前 checkout 的证据。

## Round 0 启动门禁

1. 运行门禁检查器，登记实际分支和完整 HEAD：

   ```powershell
   & .\scripts\check-iteration-gate.ps1 -Phase Start
   ```

2. 检查 `git status --short --branch`、`git diff`、`git diff --cached` 和最近提交。
3. 将 `1.txt` 仅作为需求读取；不得修改或暂存。
4. 保留未跟踪的 `.zcode/`、架构分析、轮次日志和 Typora 日志。
5. 恢复中断轮时，重新验证当前 diff、测试和提交，不继承“已完成”口头结论。
6. 涉及浏览器验证时检查固定端口 `3000` 和已记录 PID；不得批量结束 `node` 进程，也不得自动切换端口。

## 唯一目标契约

每轮开始前填写：

- **问题**：一个用户可见问题、风险或待证伪判断。
- **完成定义**：能够明确判定通过或失败的结果。
- **允许范围**：可以修改的精确文件或职责边界。
- **禁止范围**：不得修改的业务语义、数据、schema 或相邻缺口。
- **停止条件**：需要新授权、证据不足或现场漂移的具体情形。

只读审计与实现必须拆成不同轮次。审计发现的新问题进入下一轮候选池，不能在本轮顺手修复。

## 验证矩阵

| 变更类型 | 最低验证 | 证据边界 |
|---|---|---|
| 只读审计 | 源码、测试源码、Git 与文档交叉核对 | 不宣称当前运行、浏览器或生产数据已验证 |
| 纯文档/流程 | 链接与命令核对、脚本语法、`git diff --check` | 不运行无关产品测试 |
| 纯逻辑 | 聚焦单测、`npm run typecheck`、`npm run lint`、`npm test` | 纯函数通过不等于浏览器交互通过 |
| UI 或信号流 | 纯逻辑档全部验证，加相关 Playwright E2E | 仅覆盖明确列出的交互路径 |
| 持久化/备份/迁移 | 往返、边界、兼容性测试和 production build | fixture 与合成数据不冒充真实用户数据 |
| 发布/性能 | 经审计收敛的发布清单、production smoke；必要时性能基线 | 明确设备、数据规模和采样边界 |

命令连续两分钟无输出时中断，检查原因后重试。浏览器验证连续两次仍失败时停止服务重试，改用静态验证并明确缺失证据。

## 提交门禁

1. 验证完成后更新本轮报告、`docs/project-evolution.md` 和下一轮 Prompt。
2. 若 dev/build 改写 `lib/build-info.generated.ts`，在最终暂存前恢复；最终暂存后不再运行会改写它的命令。
3. 只使用精确文件名暂存，禁止 `git add .`、`git add -A` 和 `git commit -am`。
4. 暂存后运行：

   ```powershell
   $roundFiles = @(
     "docs/iterations/round-N.md"
     "docs/project-evolution.md"
     "docs/iterations/next-round-prompt.md"
   )
   & .\scripts\check-iteration-gate.ps1 -Phase PreCommit -AllowedPath $roundFiles
   ```

5. `PreCommit` 必须通过，且 `git diff --cached` 与唯一目标逐行对应。
6. 每轮只创建一个中文提交，不 merge，不 push。

## 自动停止条件

- 未获得当前轮次或等价目标的明确授权。
- 当前 HEAD、分支、tracked 工作区或暂存区与 Prompt 不一致。
- 需要扩大产品语义、修改生产数据或引入 schema/version/store/domain 变化。
- 无法区分本轮回归与既有基线失败。
- 需要猜测历史归因、伪造样本或降低产品门槛才能通过。
- 发现范围外问题，或本轮验证不足以支持完成声明。
- 自动启动时固定端口 `3000` 被非本项目进程占用。
- 连续两次浏览器服务验证失败。
- 每五轮方向复核认为继续迭代的价值不足，或阶段目标已经闭环。

停止时必须立即报告：已完成、未完成、停止原因、当前文件/Git 状态和恢复入口。

## 固定交付物

- `docs/iterations/round-N.md`：本轮完整证据，使用 `round-template.md` 创建。
- `docs/project-evolution.md`：只登记已经完成的阶段事实。
- `docs/iterations/next-round-prompt.md`：下一轮唯一目标、授权门禁与停止条件。
- 一个中文 Git 提交：仅包含本轮授权文件。

每五轮追加一次方向复核。不得为了完成预设轮数机械继续。
