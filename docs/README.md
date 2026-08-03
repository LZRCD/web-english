# 词环文档索引

> 更新日期：2026-08-03

项目文档分为“当前真源”“执行规范”和“历史记录”。判断项目当前状态时，请优先阅读当前真源，不要从历史复盘中的旧分支名、旧构建号或旧测试数量推断现在的状态。

## 当前真源

- [`current-status.md`](./current-status.md)：当前架构、验证状态、剩余风险和下一步优先级。
- 根目录 [`README.md`](../README.md)：产品能力、本地运行、数据与音频构建命令。
- 代码和 GitHub Actions：当文档与代码冲突时，以当前分支代码和最近一次成功 CI 为准。

## 仍在使用的规范

- [`learning-system-v4.md`](./learning-system-v4.md)：学习状态和 FSRS 设计。
- [`manual-experience-validation.md`](./manual-experience-validation.md)：真实设备、读屏器和长期数据验收模板。
- [`redbook-audit.md`](./redbook-audit.md)：红宝书词形审计摘要。

## 历史记录

以下文档保留决策过程和阶段性数据，但不再作为当前状态清单：

- `project-assessment.md`
- `project-evolution.md`
- `project-retrospective-and-next-actions.md`
- `future-improvement-recommendations.md`
- `performance-roadmap-gap-analysis.md`

其中的“待合并”、构建号、测试数量、性能样本和发布地址都只对应文档注明的日期。需要引用历史性能数据时，应同时核对报告中的应用构建号、数据版本、网络条件和运行模式。

## 报告文件

`reports/` 中的 JSON 是特定构建和环境下的证据，不是长期维护的项目说明。正式判断应读取报告内的构建号和条件，避免把 `latest` 文件或旧里程碑结果套用到当前代码。
