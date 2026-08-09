# 自动化迭代提速 v2

日期：2026-08-09。

## 调整结果

- 完整 Round 0 从“每轮重做”改为“批次首次执行”；后续默认只核对 HEAD、tracked/index、保护项和服务归属的增量门禁。
- 验证改为 V0～V4 风险阶梯；`test:unit` 提供不构建的 Node 测试入口，`npm test` 仍作为 production build + 全部 Node 测试的最终入口。
- 固定 3000 dev 服务由 `scripts/manage-dev-server.ps1` 统一 Start/Status/Stop；一个批次可复用，PID 状态和日志集中到已忽略的 `.wordloop-runtime/rounds/`。
- 门禁默认只显示保护项数量，需要定位时使用 `-Detailed`，机器消费使用 `-Json`。
- 普通轮次报告缩短；项目演进和下一轮 Prompt 只在结论或目标实际变化时更新。

## 不变的安全边界

- 每轮仍只有一个纵向目标、一次精确暂存和一个中文提交，不 merge、不 push。
- `1.txt`、`.zcode/`、架构文档、Typora/历史日志和用户数据仍受保护。
- 固定端口被非管理进程占用、现场漂移、授权扩大或证据无法归因时仍立即 STOP。
- dev/build 产生的 `lib/build-info.generated.ts` 漂移必须在最终暂存前恢复。

## 预期收益

流程减少重复构建、重复全量测试、重复服务启动和重复文档抄写。它不承诺固定耗时；高风险产品变更与批次最终验收仍会升级到完整验证。

## 本次验收

- `npm run test:unit`：239/239，通过；不触发 build。
- `npm test`：production build 通过，随后复用 `test:unit`，239/239。
- PowerShell 7 脚本解析、Windows PowerShell 5.1 `Status`、门禁 compact/JSON 输出均通过。
- 固定 3000 生命周期通过：首次启动健康、状态可读、二次 Start 复用同一 PID、日志非空，Stop 后状态文件移除且端口释放。
- 两次实测发现并修复 CIM startup 属性兼容和中文路径 ASCII 损坏；最终状态文件使用 UTF-8。
