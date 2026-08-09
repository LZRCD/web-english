# 第 48 轮：阶段 F 发布准备只读审计

日期：2026-08-09
起始基线：`2715dd41caf2cc42021c890cee6e6a97742790da`
分支：`codex/follow-up-hardening`
状态：完成只读审计；唯一终局 B，停止自动串行并等待单独修复授权。

## 启动 stop/go 核对

- `HEAD` 为 `2715dd41caf2cc42021c890cee6e6a97742790da`，提交为 `docs: 评估自适应推荐数据门槛`；分支符合 Prompt。
- tracked 工作树和 index 均为空，没有触发“发现 tracked diff 立即停止”。
- 受保护未跟踪项按实际 `git status` 建立，共 25 个实际文件：`1.txt`、`docs/architecture-analysis-2026-08-09.md`、`.zcode/`、第 38/40/41/42/43/44 轮日志，以及 `docs/iterations/Typora_Hook_Log.txt`。基线内容清单 SHA-256 为 `993A323F8E8B2C2D1D0EE68FD372978F721E8046E51E25438231AFC9FF37DB92`；全部只读保护。
- 3000/3001 均无监听；本轮未启动服务或浏览器，未访问 IndexedDB，未 push。
- 启动条件满足，结论为 **GO**，随后才开始代码与既有测试证据审计。

## 发布面调用图

```text
旧状态 / IndexedDB state-domains / localStorage fallback / 备份文件
  -> envelope 与 schema/version 校验
  -> normalizeStoredState
       -> reviews 去重、排序、FSRS 逐词修复
       -> activeSession / activeQuiz / quizAttempts 清洗
  -> hydrate 页面状态
  -> 150ms 自动保存或权威立即写入
       -> revision 比对 + 单事务分域写入
       -> BroadcastChannel / storage event 跨标签同步
       -> 冲突或失败时 blocked + 恢复副本
  -> 自动备份 / 手动导出 / 导入恢复
```

恢复子链：

```text
activeQuiz.questionWordIds + seed
  -> 删除词过滤 -> 题组重建 -> 恢复后索引夹紧

activeSession.wordIds + index
  -> normalize 仅做格式清洗
  -> 页面按现行 wordById 过滤删除词
  -> 完成与进度仍按原 wordIds 计算
```

## 审计结论摘要

- 旧状态、未来版本拒绝、FSRS 逐词重建、当前 StoredState 分域投影、revision 原子写入、导入前快照、恢复副本、activeQuiz 题组恢复、fallback 和跨标签冲突均已有明确代码护栏及对应测试源码。
- 既有 fixture/E2E 只作为行为证据；本轮没有运行测试，也没有读取用户浏览器数据，不能宣称生产备份、生产规模或当前提交的全套发布检查已通过。
- reviews 会完整保留、去重并排序；已有 10010 条完整性单测，但没有生产规模 SLA，长历史性能仍是“当前不可证明”。
- activeSession 不会按当前词库重写持久化 ID。页面过滤删除词后，索引/完成仍按原列表计算，可能让有效词重复展示与评分；登记为中风险明确缺口。
- 非法事件被过滤而没有原始行级隔离报告；quizAttempt 重复 ID 在恢复判定外没有统一去重；清空学习记录保留 quizAttempts/activeQuiz。三项均登记为中风险，不在本轮自动修复。

完整逐项证据、风险、状态与解除条件见 `docs/iterations/release-readiness.md`。

## 决定性高风险缺口

`quizAttempts` 存在两处无提示的固定裁剪：

- `normalizeQuizAttempts` 在状态加载、分域合并、恢复副本解析和备份导入规范化时执行 `.slice(-5000)`。
- `recordQuizResult` 每次追加作答时执行 `[...items, attempt].slice(-5000)`。

因此第 5001 条以后，最早的合法测验作答会从内存状态、后续分域写入、自动备份和手动导出中消失；含更多历史的合法备份导入后也只写入最后 5000 条。当前没有告警、原始隔离副本或超过 5000 条的无损测试，已经丢失的数据也不能从规范化状态恢复。

## 唯一终局：B

选择 **B：存在需单独授权的发布阻断/高风险缺口**。

- 该缺口直接涉及合法历史数据与备份导入一致性，满足 Prompt 的终局 B 条件。
- 本轮不修改 `lib/study.ts`、`app/page.tsx`、备份、schema、store/domain、测试或用户数据。
- 自动串行在第 48 轮提交后停止；下一轮只建议防止未来 quizAttempts 静默丢失，不回填历史，不顺带处理其他中风险项。
- 只有用户明确授权第 49 轮修复后才能继续；否则保持停止。

## 验证边界

- 本轮只修改四个获授权文档文件。
- 未运行 lint、typecheck、build、`npm test` 或 E2E；第 45 轮 study 35/35、230/230、learning 17/17、signal-flow 18/18 仅是历史 checkpoint，不冒充第 48 轮结果。
- `git diff --check -- docs/iterations/round-48.md docs/iterations/release-readiness.md docs/iterations/next-round-prompt.md docs/project-evolution.md`：通过，仅有 Git 的 LF/CRLF 提示，无 whitespace error。
- 提交前 `git status --short` 仅有四个授权文档和基线保护项；`git diff --cached --name-only` 为空，没有预存暂存项。
- 复算 25 个既有保护文件的内容清单 SHA-256 仍为 `993A323F8E8B2C2D1D0EE68FD372978F721E8046E51E25438231AFC9FF37DB92`；3000/3001 仍无监听。
