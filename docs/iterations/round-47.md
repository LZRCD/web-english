# 第 47 轮：阶段 E 自适应推荐可行性只读评估

日期：2026-08-09
起始基线：`a07e81d4acc20b6af086ab7eea8d47703c253f2b`
分支：`codex/follow-up-hardening`
状态：完成只读评估；唯一终局 B，不进入自适应推荐实现。

## 启动 stop/go 核对

- `HEAD` 为 `a07e81d4acc20b6af086ab7eea8d47703c253f2b`，提交为 `docs: 审计划词 I/O 状态机边界`；分支符合 Prompt。
- tracked 工作树和 index 均为空，没有触发“发现 tracked diff 立即停止”。
- 受保护未跟踪项按实际 `git status` 建立：`1.txt`、`docs/architecture-analysis-2026-08-09.md`、`.zcode/`、第 38/40/41/42/43/44 轮日志，以及现场额外出现的 `docs/iterations/Typora_Hook_Log.txt`。共 25 个实际文件，基线内容清单 SHA-256 为 `993A323F8E8B2C2D1D0EE68FD372978F721E8046E51E25438231AFC9FF37DB92`；全部只读保护。
- 3000/3001 均无监听；本轮未启动服务或浏览器。
- 启动条件满足，结论为 **GO**，随后才开始证据审计。

## 审计范围与调用图

本轮只读追踪：

```text
WeakSignalInput
  -> buildSprintTreatmentRecommendation（固定专项顺序）
  -> activeSession / activeQuiz
  -> rateWord / recordQuizResult
  -> applyRating -> reviews / wordProgress
  -> IndexedDB 分域
  -> buildSprintRetentionSeries
  -> buildDimensionObservationReport
  -> HistoryView 观察性披露
```

- 固定推荐原样为：听音拼写 -> 中译英 -> 释义辨析 -> 划词主动回忆 -> 顽固多模式 -> 通用冲刺。
- 三类 Quiz 以最近两次同模式有效正确恢复，新错误复发；lookup 以最后查询是否被成功评分覆盖降级，真实再次划词复发；顽固阶段只由真实 review 推进。
- `createTreatmentSprintSessionId` / `parseSprintSessionId`、`activeSession/activeQuiz`、review 写入与 IndexedDB 分域能保存未来结构化 id；旧普通 sprint 永远是 unknown，generic 单列，顽固子 mode 不扁平。
- 保持链使用全局最近成功锚点、任意下一 sprint 截断、已观察分母、覆盖率、实际间隔与同词配对测时；未观察不算失败。
- 分维报告先全局选择每词唯一锚点，再归维；活动允许跨维重复但不可合计，锚点系每词唯一，全部口径保持非因果。

完整证据与路径见 `docs/iterations/adaptive-recommendation-readiness.md`。

## 真实样本结论

- 仓库 fixture 与 E2E seed 只证明算法/交互行为，不证明真实生产样本量。
- 生产历史位于用户浏览器 IndexedDB；本轮按 Prompt 未读取或改写。
- 项目支持把完整 `StoredState` 导出为备份，但用户本轮未提供只读导出文件。
- 因此真实生产样本量、各维样本数、覆盖率与随访间隔分布均不可获得。
- 产品没有批准“足够样本”、最低覆盖率、随访区间或稳健性标准，不能自行编造阈值。

## E2 门槛摘要

| 门槛 | 状态 | 核心原因 |
|---|---|---|
| 各维度有真实结构化归因 | 未满足 | slow-recall/lapse 真实入口仍写 generic，且无生产导出证明各维有记录 |
| 有足够后续正常复习样本 | 当前不可证明 | 无生产样本，且“足够”无批准阈值 |
| 随访覆盖率透明 | 已满足 | 覆盖/未观察/截断/实际间隔及独立分母均已披露 |
| 不同模式样本差异可解释 | 当前不可证明 | 固定优先级、用户选择、入口与随访间隔造成偏差，无可比性标准 |
| 规则可回退 | 未满足 | 只有硬编码固定推荐与 generic fallback，没有自适应层的回退契约 |
| 不改 FSRS | 已满足 | 推荐只选训练入口，评分与排程仍由既有边界控制 |
| 用户可以关闭 | 未满足 | 没有自适应冲刺推荐开关或恢复固定默认契约 |
| 不需要伪造历史数据 | 已满足 | unknown/generic 分离，缺失/未观察保持诚实，不需回填 |

## 唯一终局：B

任一门槛未满足或当前不可证明就必须选择 B；本轮存在多项明确缺口，因此：

- 维持固定优先级，不新增权重、阈值、排名、模式胜负或自适应规则草案。
- 不修改推荐逻辑、UI、评分、FSRS、每日 Quiz 门禁、备份、schema/version/store/domain、package scripts 或历史数据。
- 不生成自适应推荐实施 Prompt；下一轮转阶段 F“发布准备只读审计”，只建立发布缺口清单。

## 验证边界

- 本轮只修改四个获授权文档文件。
- 未运行 lint、typecheck、build、`npm test` 或 E2E；第 45 轮的 study 35/35、230/230、learning 17/17、signal-flow 18/18 只作为历史基线，不冒充本轮结果。
- `git diff --check -- docs/iterations/round-47.md docs/iterations/adaptive-recommendation-readiness.md docs/iterations/next-round-prompt.md docs/project-evolution.md`：通过，仅有 Git 的 LF/CRLF 提示，无 whitespace error。
- 提交前 `git status --short` 仅有四个授权文档和基线保护项；`git diff --cached --name-only` 为空，没有预存暂存项。
- 复算 25 个既有保护文件的内容清单 SHA-256 仍为 `993A323F8E8B2C2D1D0EE68FD372978F721E8046E51E25438231AFC9FF37DB92`，确认未改写保护内容。
