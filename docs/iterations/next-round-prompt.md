# 第 57 轮待授权 Prompt：明确“清空本机学习记录”契约

## 当前现场

- 分支应为 `codex/follow-up-hardening`。
- 起始 HEAD 应为第 56 轮“让今日任务可预期、每个词来源可解释”的唯一中文提交；启动时读取实际完整 hash，不猜测自引用提交。
- 第 56 轮只增加今日任务与单词来源的纯投影、UI 和测试，没有修改持久化 schema、清空逻辑或用户数据。
- 第 56 轮验证数字只作历史背景，不能替代新 checkout 的当前证据。

## 授权门禁

这是下一轮候选 Prompt，不是自动执行授权。用户未明确授权第 57 轮或等价目标时保持等待，不修改文件、不暂存、不提交、不启动服务。

授权后先执行 Round 0：

1. 核对 branch、完整 HEAD、tracked diff、index、`lib/build-info.generated.ts` 和固定端口 3000；
2. 确认 `docs/iterations/round-57.md` 不存在；
3. 保护 `1.txt`、`.zcode/`、架构文档、Typora/历史日志和既有服务日志；
4. 完整读取 `AGENTS.md`、`docs/iterations/AUTOMATION-SOP.md`、本文件、当前清空入口、持久化实现和数据生命周期测试。

任何现场漂移、归属不明修改或非项目端口占用都立即 STOP。

## 唯一目标

明确“清空本机学习记录”的产品契约，使以下内容逐项一致：

- 设置页按钮名称和说明；
- 确认对话框文案；
- 实际清除与保留的字段；
- 清空前恢复快照；
- 刷新后的结果；
- 纯函数/浏览器行为测试。

重点审计并处理当前 `quizAttempts` 与 `activeQuiz` 的保留或清除语义。必须先从现有文案、实现和测试建立契约矩阵；若三者冲突且无法由当前产品表述判定，记录 `BUSINESS DECISION REQUIRED` 并 STOP，不自行猜测。

## 硬边界

- 一个 Round 只处理“清空本机学习记录”这一纵向目标，不顺手做容量、备份数量、非法行隔离或性能优化。
- 不读取或修改用户浏览器生产数据、真实备份和 IndexedDB。
- 不新增 schema/version/store/domain，不迁移或回填历史数据。
- 不改变 FSRS、Quiz 作答规则、评分、弱信号、推荐阈值或恢复副本数量。
- 清空前必须继续创建可恢复快照；不得以测试 fixture 冒充生产恢复证明。
- 精确暂存、一个中文提交、不 push；构建或服务改写的 `lib/build-info.generated.ts` 必须在最终暂存前恢复。

## 最低验证

1. 清空/规范化相关定向单测；
2. `npm run typecheck`；
3. `npm run lint`；
4. `npm test`；
5. 固定 3000 下运行清空记录的精选 data-lifecycle E2E，并覆盖刷新、保留项、清除项和恢复快照；
6. `git diff --check`、精确暂存与 PreCommit 门禁；
7. 更新本轮文档、项目演进和下一轮 Prompt；一个中文提交，不 push。

## 后续候选（只记录，不在第 57 轮实施）

1. 词库读取失败后的界面内重试与明确修复说明；
2. 首次使用的三步轻量引导；
3. README 补充 Windows 双击启动入口和缺失 Node/构建失败的用户化说明。
