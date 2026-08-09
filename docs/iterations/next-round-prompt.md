# 第 52 轮待授权 Prompt：固定 3000 dev 后台生命周期只读诊断

## 当前真实现场

- 当前分支应为 `codex/follow-up-hardening`。
- 第 51 轮起始 HEAD 为 `3d8a8a8e695a1e0d3d75d4bcd4337ea880437200`；第 51 轮完成后应为唯一中文文档提交 `docs: 记录第51轮验证停止现场`。启动时登记实际完整 hash，不猜测自引用提交。
- 第 51 轮当前证据：typecheck 通过；lint 0 error / 1 个既有 warning；production build 与 Node 235/235 通过；production smoke 的客户端激活、真实 6550 词、音频索引和 Range 206 通过。
- 第 51 轮固定 3000 dev 服务首次实际返回 HTTP 200，但启动调用未立即返回；一次后台化重试没有形成可复用稳定实例。按停止条件，7 项精选 E2E 未运行。
- `lib/build-info.generated.ts` 已恢复为 HEAD；3000/3001 最终无监听；两份 Round 51 启动日志作为未跟踪证据保留；未 push。

## 授权门禁

这是诊断候选 Prompt，不是自动执行指令。

- 用户未明确授权第 52 轮或等价目标时：只核对状态并等待，不修改文件、不暂存、不提交、不启动服务。
- 用户授权后，只诊断 Codex 执行单元、Windows 进程树、固定端口与项目 dev 启动生命周期；不得修复业务、测试或启动脚本。
- 需要修改脚本、配置、测试、产品代码或系统权限时立即停止并请求另行授权。

## 唯一目标

只读解释第 51 轮为何无法让固定 3000 dev 服务同时满足：

1. 独立唯一日志；
2. 健康检查 HTTP 200 后启动命令立即返回；
3. 稳定记录启动 PID 与实际监听 PID；
4. 后续命令可复用该唯一实例；
5. 结束时只精确关闭本项目进程。

产出一个可证伪的根因结论和下一轮唯一启动契约，不修复、不执行第 51 轮剩余 E2E。

## 允许范围

- Round 0：Git、保护项、3000/3001、旧 PID 与 Round 51 日志。
- 只读检查 `package.json`、`playwright.config.mjs`、项目启动/production 脚本、历史轮次服务命令与当前 Windows 进程父子关系。
- 最多一次固定 3000 的受控诊断探针；仅在静态证据无法区分根因时运行，必须独立日志、记录全部 PID、HTTP 200 后立即清理，不运行 Playwright。
- 只修改 `docs/iterations/round-52.md`、`docs/iterations/next-round-prompt.md`、`docs/project-evolution.md`；如确有必要，可只更新 `docs/iterations/release-readiness.md` 的诊断状态。

## 禁止范围

- 不读取生产数据、用户浏览器 IndexedDB 或真实备份。
- 不修改业务代码、测试、fixture、package scripts、启动脚本、配置、schema/version/store/domain、备份格式、阈值或系统权限。
- 不运行 typecheck、lint、`npm test`、production smoke、任何 E2E、单独 build 或性能基线；第 51 轮已完成证据不得机械重复。
- 不把诊断探针的 HTTP 200 冒充 7 项 E2E 通过，不修复发现的问题，不 push。

## 停止条件

- Round 0 基线、保护项或范围漂移；3000 被非项目进程占用。
- 静态证据已经能解释根因时，不为“更多证据”启动服务。
- 诊断探针无法登记完整 PID 所有权、无法在 30 秒内健康或无法精确清理；立即 STOP，不再做第二次探针。
- 需要扩大权限、改脚本或运行产品验证才能得出结论。
- 无法区分 Codex 执行器生命周期、PowerShell 启动语义与项目自身服务失败。

## 获授权后的交付

- 一份根因树：已证实、已排除、仍未知。
- 一个下一轮可直接执行且带 PID/端口/日志/清理断言的唯一启动契约；如需代码或脚本变化，只写成待授权候选，不实施。
- 精确暂存实际修改的诊断文档，创建一次中文文档提交；不 merge，不 push。
