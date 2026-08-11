# 第 68 轮：Canonical P0-5 文章批量提取生词

- 日期：2026-08-11
- 分支 / 起始 HEAD：`codex/follow-up-hardening` / `f5efa9f124345349802d09b7b93e666c1b07f63b`
- 批次：Canonical P0-5 独立纵向批次；第 1/1 轮
- 状态：完成，STOP

## 目标与边界

- 词本页新增“文章提词”入口，文章原文、分析报告、筛选和选择只保留在组件内存；粘贴与分析阶段不写 `lookupWords`、`lookupStats`、评分、进度、错词、会话、今日任务或 FSRS。
- 英文 tokenizer 归一大小写、ASCII/弯撇号和多种连字符，只接受单词内部连接符；去重并保留首次出现顺序。文本框上限 20,000 字符，初版只分析前 200 个不同 token，并披露真实 `truncatedCount`。
- 只复用本地红宝书、既有 lookup 与 ECDICT Range/prefix 缓存链；没有调用 `/api/lookup`、远程词典或 AI，没有加载全部 26 个分片，没有新增 NLP 依赖。
- 新增明确的 `article` SessionKind 与来源说明；不扩展 ReviewKind，不保存文章原文/历史，不新增 store/domain，不提升 schema/version。

## 候选、状态与确认口径

- 候选优先级固定为红宝书 case-insensitive 首个精确映射、既有 lookup case-insensitive 精确映射、ECDICT、本地未命中；输出始终按文章首次出现顺序。
- 红宝书直接使用真实 word ID 和原书学习内容；既有 lookup 使用 `learningWordId` 并保留原对象；新 ECDICT 在分析阶段只有 `LookupResult`，不提前分配用户 ID。
- ECDICT 查询最多 4 个并发 worker；共享既有 letter range index、prefix promise/cache、Range、单分片 fallback、数据版本 URL 和性能诊断。`null` 仅表示未命中，Range/网络/解析失败继续抛给文章解析并单列“查询失败”；部分失败保留成功候选且可重新分析。
- 候选依据真实学习 ID 显示未学习、学习中、复习中、项目内已掌握。mastered 默认隐藏且不默认选择，展开后可手动选择；状态筛选不重排候选，也不清除其他筛选下的选择。
- 确认时以同一个 `confirmedAt` 从当前 `lookupWords` 逐项调用 `upsertLookupWord`，用逐步更新的投影处理批内冲突，再从最终投影经 `lookupIdentity` / `learningWordId` 解析真实 ID；会话 ID 去重但保持文章顺序。空选择不写状态、不建空会话。

## article 会话与恢复

- 会话固定为 `kind: "article"`、标题“文章提词”，学习卡标签为“文章提词”，说明为“这个词来自你粘贴并确认的英文文章。”
- `normalizeSession` 的 kind 与 `originKind` 白名单均接受 article；IndexedDB 分域、备份导入和 reinforcement origin 沿既有状态链往返，不需要版本升级。
- E2E 证明确认后只保存选中的新 ECDICT 词，`lookupStats` 不增长；activeSession 的 id、kind、title、wordIds、index、createdAt 刷新后完全保持。
- article 会话完成后返回词本页并保留原词本 tab，不落入错词 tab；article 来源的 reinforcement 也返回原词本。

## 实现与修改文件

- 纯逻辑：`lib/word-utils.ts`、`lib/article-extraction.ts`、`lib/selection-lookup.ts`。
- 会话与状态：`lib/learning.ts`、`lib/study.ts`。
- UI 与本地词典链：`app/components/ArticleWordExtractor.tsx`、`app/components/WordbookView.tsx`、`app/hooks/useSelectionLookup.ts`、`app/page.tsx`、`app/globals.css`。
- 测试入口与行为覆盖：`package.json`、`tests/article-extraction.test.ts`、`tests/study.test.ts`、`tests/study-session.test.ts`、`tests/e2e/article-word-extraction.spec.mjs`。
- 迭代文档：`docs/iterations/round-68.md`、`docs/project-evolution.md`、`docs/iterations/next-round-prompt.md`。

## 验证

| 级别 / 命令 | 结果 | 耗时与说明 |
|---|---|---|
| 红测 / V1 四文件 | 预期失败 | 新模块不存在，article 来源和恢复白名单尚未实现；同期其余 75 项通过 |
| V1 / `tests/article-extraction.test.ts` + study/session/data-integrity | 88/88 | 测试器约 0.752 秒；覆盖 tokenizer、4 并发、乱序、失败分流、状态、选择、ID 冲突与持久化 |
| V2 / `npm run typecheck` | 通过 | 约 3.9 秒 |
| V2 / `npm run lint` | 0 error / 1 个既有 warning | 约 8.3 秒；`lib/weak-signals/projection.ts` 的未使用类型与本轮无关 |
| V2 / `npm run test:unit` | 287/287 | 测试器约 0.828 秒；文章测试已显式加入命令 |
| V0 / `git diff --check` | 通过 | 仅有 Git 的 LF/CRLF 工作区提示，无空白错误 |
| V3 / 新文章提词 E2E | 3/3 | 14.4 秒；三个唯一标题覆盖预览零写入、确认/恢复、边界/失败/响应式 |
| V3 / 文章 + activeSession + 数据生命周期 + 响应式 | 16/16 | 30.4 秒；320px、200% / 400% 缩放与原生键盘路径通过 |

- E2E 监控真实 dictionary 请求，证明只访问输入涉及的字母索引/分片而没有加载全部 26 个 shards。
- 失败场景分别构造真实未命中和被中断的 q 分片请求；成功候选继续显示，失败数与未命中数保持独立。
- 确认后使用真实“显示单词释义”和四档“认识”评分推进；刷新恢复后完成会话并通过“返回词本”主动作收尾。

## 服务、生成文件与未执行项

- Round 0 时固定端口 3000 无监听；分支与完整起始 HEAD 匹配，tracked/index 干净。Start 门禁唯一阻断为 Prompt 已登记的用户未跟踪保护基线，均保持未修改、未暂存。
- 启动 V3 前发现 Round 67 遗留 listener PID 11880 恢复监听；其启动时间与上轮记录一致且返回 WordLoop 页面。精确停止该本项目 PID 后，由统一脚本新启 worker PID 53880、listener PID 23364，独立日志 `.wordloop-runtime/rounds/dev-20260811-164544.out.log`。
- E2E 后统一脚本精确停止 worker PID 53880；最终状态 `STOPPED | port 3000 is free`，没有批量终止 Node，也没有切换 3001/3002。
- dev 将 `lib/build-info.generated.ts` 从起始 blob `4410b1880754eea8e9ee2a9263d372318efac3f3` 改为 development 内容；已恢复为起始 HEAD 内容并核对 hash，恢复后未再运行 dev/build。
- 未运行 `npm test`、production build、production smoke 或全目录 E2E：本轮未修改依赖、构建链、API、schema/version/store/domain，V1 + V2 + 指定持久化/UI V3 已覆盖授权边界。

## 提交与停止

- 精确提交信息：`feat: 支持文章批量提取生词`。
- 只暂存上述实现、测试和三份迭代文档；`1.txt`、`2.txt`、`.zcode/`、日志、Canonical/调研/架构文档、favicon 与爬取脚本保持未修改、未暂存。
- Canonical P0-5 已完成，单轮批次达到 1/1；提交后 STOP，不自动进入 P0-6，不 merge，不 push。
