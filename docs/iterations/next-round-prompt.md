# 第 68 轮完成 Prompt：Canonical P0-5 文章批量提取生词

## 当前状态

- Canonical P0-5 已完成：词本页可粘贴英文文章，纯本地分析并按来源/学习状态预览、筛选和选择；用户确认后才保存选中的新 ECDICT 词并创建可恢复的 article 学习会话。
- 实施报告：`docs/iterations/round-68.md`。
- 单轮批次达到 1/1，STOP；不自动进入 Canonical P0-6，不 push。

## 已完成契约

1. tokenizer 归一大小写、ASCII/弯撇号和不同连字符，去重并保留首次出现顺序；文本框最多 20,000 字符，只分析前 200 个不同 token，并披露真实截断数。
2. 候选固定按红宝书、既有 lookup、ECDICT、未命中解析；最多 4 个并发 ECDICT 查询，复用既有 Range/prefix/fallback/版本/诊断链，未命中和词典故障分开统计。
3. 预览显示未学习、学习中、复习中、项目内已掌握；mastered 默认隐藏且不默认选择，可展开手选；筛选不重排候选或清除其他选择。
4. 分析阶段不写 lookupWords、lookupStats、评分、进度、错词、activeSession、今日任务或 FSRS；不调用 API/AI，不保存文章原文、分析历史或候选选择。
5. 确认时从当前 lookupWords 做一次逐步投影，只保存选中的新 ECDICT 候选，并沿既有身份链取得真实 ID；article 会话 wordIds 去重且保持文章顺序。
6. article 会话与 reinforcement origin 可经规范化、IndexedDB 分域和备份恢复；学习卡来源准确，刷新保持完整会话快照，完成后返回词本。
7. 未改变 ReviewKind、FSRS、四档评分、今日任务、schema/version/store/domain、红宝书/ECDICT 源数据或其他路线图目标。

## 验证现场

- V1 88/88，typecheck 通过，lint 0 error / 1 个既有 warning，Node 287/287，`git diff --check` 通过。
- 新文章提词 E2E 3/3；文章提词、activeSession 恢复、数据生命周期与响应式联跑 16/16。
- 真实覆盖预览零写入、新旧候选混合确认、ECDICT 排除项、真实评分、刷新恢复、失败/未命中分流、200 token 截断、非全分片请求、320px、200% / 400% 缩放与键盘路径。
- 固定端口 3000 已释放；worker PID 53880 / listener PID 23364 已精确停止；dev 生成的 build-info 已恢复。

## 等待规则

- P0-5 已完成并停止，不自动进入 P0-6 图表或其他目标。
- 后续目标需要用户重新授权并执行新的 Round 0；不得顺带修改统计口径、FSRS、评分、提醒、推荐、队列或用户学习数据。
