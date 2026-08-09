# 第 60 轮执行 Prompt：补全 Windows 本地启动与失败处理说明

## 当前授权

- 本轮属于用户已授权的连续批次第 2/3 轮；第 59 轮提交后通过 Delta Gate 即可继续，不重新执行完整 Round 0。
- 唯一目标是补全 README 的 Windows 本地启动与失败处理说明；本轮只修改文档。

## 完成定义

- 明确现有 Windows 双击入口 `启动词环网站.cmd`、PowerShell/命令行启动方式和固定端口 `3000`。
- 为 Node 缺失、依赖未安装、构建失败和端口冲突提供用户可执行的检查与修复步骤。
- 所有命令必须与当前 `package.json`、`启动词环网站.cmd`、`scripts/launch-wordloop.ps1` 和实际文件一致；不虚构自动安装、端口切换或数据恢复能力。

## 边界与验证

- 禁止修改启动器、依赖、package scripts、构建链、服务脚本、业务代码、测试、schema/version/store/domain 或用户数据。
- 按 V0 核对链接、文件名和命令，运行 `git diff --check`；不启动服务、不运行 build/test/E2E。
- 精确暂存、一个中文提交、不 push；完成后通过 Delta Gate 进入已授权的第 61 轮 activeSession 失效恢复。
