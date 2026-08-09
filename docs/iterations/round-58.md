# 第 58 轮：词库读取失败后可在界面内重试

- 日期：2026-08-09
- 分支 / 起始 HEAD：`codex/follow-up-hardening` / `0876c53079913d428b81afa26f097c9a11550cc3`
- 批次：词库读取失败恢复；第 1/1 轮
- 状态：完成

## 目标与边界

- 问题与完成定义：词库首次加载失败后，在原学习卡内显示安全、可执行的修复说明和键盘可用重试；再次失败仍可重试，成功后恢复正常学习；320px 无横向溢出。
- 允许修改：既有红宝书加载状态、错误说明纯函数、学习卡失败 UI、直接单测/E2E 和本轮文档。
- 禁止修改：词库内容、数据 manifest、网络 fallback、缓存清理、schema/version/store/domain、FSRS、推荐、首次引导和 README。
- Round 0：实际 HEAD 比第 57 轮多一个用户提交；只读确认它正是本次点名的 SOP v2 流程升级，Prompt 已纳入该 HEAD，产品代码无混入。Start gate、tracked/index、保护项、`build-info` 和端口 3000 均通过。

## 改动

- `lib/redbook.ts`：新增纯错误映射；只把自有 404/410、JSON 解析和明确数据校验失败归为“本地文件缺失或不完整”，其他错误统一给通用修复步骤，不展示状态码、堆栈或内部错误。
- `app/page.tsx`：以 attempt 触发原有同一 `Promise.all + fetchJsonWithDiagnostics` 加载路径；重试不创建第二套 loader、缓存或数据源。
- `app/components/WordCard.tsx` / `app/globals.css`：学习卡内新增 `role=alert` 的错误区和原生按钮，失败保留入口、成功自动移除；文案可换行，按钮有可见键盘焦点。
- `tests/study.test.ts` / `tests/e2e/redbook-retry.spec.mjs`：覆盖可靠分类、通用回退、失败→键盘重试失败→320px 再重试成功。
- 范围外发现：无；首次引导和 README 启动说明仅保留为后续候选。

## 验证

| 级别 / 命令 | 结果 | 证据边界 |
|---|---|---|
| V1 / 定向错误映射测试 | 1/1，0.7 秒 | 已知分类、通用回退和不泄露内部信息；不证明 UI |
| V2 / `npm run typecheck` | 通过，3.6 秒 | TypeScript 状态和 Props 契约；不证明浏览器网络重试 |
| V2 / `npm run lint` | 0 error / 1 个既有 warning，7.7 秒 | 本轮无 lint error；未处理既有 `projection.ts` warning |
| 批次最终 / `npm test` | production build + Node 240/240，8.4 秒 | 构建与完整 Node 套件；不证明真实加载失败交互 |
| V3 / 新增 E2E `--list` | 1 文件 / 1 项 | 精确选择，没有运行相邻 E2E |
| V3 / 新增 E2E | 1/1，3.6 秒 | 503 通用说明、内部错误不展示、键盘重试失败后入口保留、320px 无溢出、再次重试成功恢复学习；不证明生产安装损坏或其他浏览器 |

- 服务：SOP v2 脚本启动固定 3000，worker PID 46640、listener PID 44376，日志 `.wordloop-runtime/rounds/dev-20260809-150928.out.log`；测试后同脚本停止，3000 空闲。
- 生成文件：`lib/build-info.generated.ts` 已恢复为起始 HEAD 内容。

## 提交与判断

- 实际修改 / 精确暂存：产品 4 文件、纯逻辑 1 文件、测试 2 文件和 3 份迭代文档；保护项、运行日志和生成文件不暂存。
- `git diff --check` / PreCommit：提交前执行。
- 提交：本文件不预猜自身提交 hash。
- 下一步：批次达到 1/1，完成评估后等待新授权；不自动实施首次引导或 README。
- push：未执行。
