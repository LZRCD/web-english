# 第 60 轮：补全 Windows 本地启动与失败处理说明

- 日期：2026-08-09
- 分支 / 起始 HEAD：`codex/follow-up-hardening` / `67deb3b34fd1f0914d560f7dc12446a9638dc644`
- 批次：首次引导、Windows 启动说明与会话失效恢复；第 2/3 轮
- 状态：完成

## 目标与边界

- 完成定义：README 明确 Windows 双击与命令行入口、固定 3000，以及缺失 Node、依赖、构建和端口冲突的可执行处理。
- 事实来源：逐行核对 `package.json`、`package-lock.json`、`启动词环网站.cmd`、`scripts/launch-wordloop.ps1` 与 launcher 直接测试。
- 禁止修改：启动器、依赖、package scripts、构建链、服务脚本、业务代码、测试、schema/version/store/domain 和用户数据。

## 改动

- 双击路径：说明首次 `npm install`、根目录 CMD 入口、PowerShell 7 / Windows PowerShell 回退、固定 3000 和浏览器地址。
- 命令行路径：区分前台 `npm run dev` 与调用既有生产启动器，不虚构后台管理或自动换端口。
- 失败处理：给出 Node/npm 版本检查、依赖安装、手动 build、最新 build/server 错误日志读取、3000 PID 识别和精确停止命令。
- 明确否定启动器不存在的能力：不会自动安装 Node/依赖、不会自动修复构建、重建数据、清缓存或恢复学习记录。

## 验证

- V0：README 内文件名、脚本名、npm 命令、参数、日志目录、构建条件与固定端口均和当前文件逐项核对。
- `git diff --check`：提交前执行。
- 未运行 lint/typecheck/test/build/E2E，也未启动服务：本轮为纯文档，不把第 59 轮证据冒充本轮结果。

## 提交与判断

- 精确暂存 README 与本轮 3 份迭代文档；保护项、运行日志和生成文件不暂存。
- 提交：本文件不预猜自身提交 hash；中文提交信息为 `docs: 补全 Windows 本地启动排障说明`。
- 继续判断：边界未扩大、现场无漂移；下一目标是已授权的 activeSession 失效词条恢复，按 Delta Gate 进入第 61 轮。
- push：未执行。
