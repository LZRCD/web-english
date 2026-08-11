# 第 70 轮：Canonical P1-7 AI 词根拆解与助记

- 日期：2026-08-11
- 分支 / 完整起始 HEAD：`codex/follow-up-hardening` / `8fab50e14d36858e7c51ae2cc82cbc9ac296cc5c`
- 批次：Canonical P1-7 独立纵向批次；第 1/1 轮
- 状态：完成，STOP

## Round 0 与实施边界

- 分支、完整 HEAD、ahead 7、tracked working tree、index、build-info 与 Canonical SHA-256 均符合 Prompt 基线；固定端口 3000 无监听。
- Start 门禁唯一阻断是 Prompt 已登记的 37 个用户未跟踪保护路径展开后仍被脚本报告为 unexpected；没有保护范围外新文件，全部保持原样、只读、未暂存。
- 只实施 P1-7：独立结构化解析/缓存、单一 API route、现有 `enrichments` 可选字段、学习卡显式交互、测试与迭代文档。未进入 P1-9、P1-8、P2-11、提醒、真题语料或全站 AI 重构。
- 当前红宝书数据实读为 0 个 `root` 字段、70 个已审计 `relation`；实现仍支持 root-only 的“本地词根提示”，E2E 的真实本地线索使用现有 relation 词条 `saving`。

## API 与结构化内容契约

- 新增 `POST /api/etymology`；请求只发送 `word`、`meaning`、`root` 与 `relation.kind/label/note/lemma/independent/confidence`，不发送 wordId、学习历史或其他状态。
- 成功只返回 `{ breakdown, root, affixes[], mnemonic }`。`breakdown/root/mnemonic` 上限为 320/120/500 字符；affixes 最多 8 项，`form/meaning` 上限为 40/120，kind 仅允许 prefix/root/suffix/other。
- 字符串统一 trim 后裁剪；非数组 affixes 归为空数组，非法项逐条丢弃；三个必填正文任一缺失则整体无效，不缓存 Markdown 围栏或模型原文。
- 路由复用唯一 `getProviderConfig`、`chatCompletion`、`parseJsonContent`、`withRetry` 与 `readJsonBody/boundedText/beginApiRequest`；策略为独立名称 `etymology`、20 次/分钟、最大并发 3、请求 32 KiB、响应 2 MiB、20 秒、最多 2 次、temperature 0.2、JSON object。
- 未配置密钥返回 503，缺少 word/meaning 返回 400，Provider 或结构失败返回 502；403/413/429 沿 api-guard 返回。没有本地模板 200 fallback，也未记录 API key、请求头或模型原文。
- 系统提示明确本内容只作助记、不是权威历史词源；不得冲突本地 root/relation，不确定时不得捏造年代/语言来源/学术结论，不引用或改写受版权保护的教材原句。

## 缓存身份、持久化与双向合并

- `schemaVersion = 1`、`promptVersion = "etymology-v1"`；缓存同时保存确定性 `inputKey`、结构化 content、ISO `generatedAt` 与 `source: "ai"`。
- inputKey 使用固定属性顺序 JSON 序列化，包含功能版本、真实 wordId、英文词、真实释义、本地 root，以及 relation 的 kind/label/note/lemma/independent/confidence；不使用时间、随机数、哈希或 React 渲染次数。同输入刷新稳定，任一语义变化都会失效。
- `WordEnrichment.etymology?` 复用现有 `enrichments` 域；`STORAGE_VERSION = 5`、`DATABASE_VERSION = 3`、`BACKUP_FORMAT = wordloop-backup` 与既有 stores/domain 列表均未改变，未修改 `lib/storage.ts`、`lib/backup.ts`。
- 旧状态无 etymology 正常读取；非法版本、来源、时间、输入键或 content 只移除 etymology，同 enrichment 的音标、例句、翻译、搭配、义项与元数据继续保留。
- 现有 `splitStoredState/combineStoredState`、备份导出/导入规范化、IndexedDB 分域和 localStorage 兼容链自然承载该可选字段；清空学习记录继续保留整个 enrichment。
- `mergeWordEnrichment` 只覆盖响应中实际存在的字段。etymology 成功按请求开始时捕获的 wordId 函数式合并写回；例句整体生成也改为合并写回，单条例句重写原本就展开当前 enrichment。测试证明两个方向都不互相覆盖。
- 云端失败、非法响应或重新生成失败不执行缓存写入；旧合法 AI 缓存、例句、音标、搭配与义项考频均保留。切词后旧请求结果只能写入原 wordId。

## 学习卡、降级与可访问性

- 只在揭示释义后显示“生成 AI 词根拆解与助记”，无首屏、切词、预加载、恢复或批量自动请求，也未新增快捷键；无有效 wordId 时按钮禁用，同功能请求由同步 ref 锁防重复。
- 有效缓存直接显示标题、拆解、核心词根、可读构词片段和记忆联想，并明确标注“AI 助记 · 非词源考据”；显式重新生成成功才覆盖。
- 降级顺序为：当前真实输入命中的 AI 缓存 → 红宝书本地 relation 词族轨道或 root-only 本地词根提示 → 无增强内容。AI 失败且无本地线索时只显示诚实错误与重试，不生成虚构卡片，也不调用 `buildLocalCoach` 冒充结果。
- 原生按钮支持 Tab、Enter/Space；稳定 region 名称为“AI 词根拆解与助记”，加载区有 `aria-busy`，失败有 `role=alert`，构词片段包含“前缀/词根/后缀/构词片段”文字而非只靠颜色。
- 新 E2E 验证 320px 下 document/body 无横向溢出，以及 200% / 400% 缩放下标题、免责声明、拆解与重新生成入口可达。

## 实际修改文件

- 数据与 API：`lib/etymology.ts`、`lib/learning.ts`、`lib/study.ts`、`lib/enrichment.ts`、`lib/ai-provider.ts`、`app/api/etymology/route.ts`。
- 状态与 UI：`app/hooks/useAiCoach.ts`、`app/page.tsx`、`app/components/WordCard.tsx`、`app/globals.css`。
- 测试：`tests/api-guard.test.ts`、`tests/study.test.ts`、`tests/e2e/etymology.spec.mjs`。
- 文档：`docs/iterations/round-70.md`、`docs/project-evolution.md`、`docs/iterations/next-round-prompt.md`。

## 红测、修复与验证

| 级别 / 命令 | 结果 | 耗时与说明 |
|---|---|---|
| 红测 / api-guard + study | 预期失败 2/2 | 约 0.13 秒；`lib/etymology.ts` 尚不存在 |
| V1 / api-guard + study | 74/74 | 最终测试器约 0.31 秒 |
| V2 / `npm run typecheck` | 通过 | 约 3.7 秒 |
| V2 / `npm run lint` | 0 error / 1 个既有 warning | 约 8.9 秒；`lib/weak-signals/projection.ts` 未使用类型未改 |
| V0 / `git diff --check` | 通过 | 仅 Git LF/CRLF 工作区提示 |
| V3 / 新 etymology E2E | 3/3 | 约 11.9 秒；三个标题唯一 |
| V3 / etymology + learning + lifecycle + responsive | 33/33 | 约 65.1 秒 |
| V4 / `npm test` | build 通过；unit 300/300 | 命令约 8.8 秒；构建识别 `/api/etymology` |
| V4 / `npm run smoke:production` | 通过 | 首页激活、静态资源、6550 词、音频索引、Range 206 均有效 |

- 新 E2E 场景 A 证明加载/揭示零请求、显式单请求、真实 body、旧例句与新缓存合并、刷新命中零新增请求，以及重新生成失败保留旧合法缓存。
- 场景 B 证明旧 prompt 缓存不显示、503 时真实 relation 仍显示、例句/义项考频不丢失；无线索词失败时不出现虚构拆解。
- 场景 C 证明 Tab + Enter、可访问加载态、可读片段、320px 与 200% / 400% 缩放。

## 服务、生成文件与保护现场

- dev 首次在受限沙箱内启动因 CIM 权限被拒，未占用端口；获准后在固定 `127.0.0.1:3000` 启动唯一实例：worker PID 11076、listener PID 23548，日志 `.wordloop-runtime/rounds/dev-20260811-183832.out.log` / `.err.log`，脚本健康状态为 200。
- V3 完成后精确停止 worker PID 11076，listener 随服务退出；最终脚本显示 `STOPPED | port 3000 is free`，未切换 3001/3002，未批量终止 Node。
- production smoke 复核现场：worker/listener PID 均为 41196；日志 `.wordloop-runtime/smoke-20260811T104224Z.out.log` / `.err.log`；脚本自行停止，最终端口 3000 无监听。
- dev/build 将 `lib/build-info.generated.ts` 改为临时 production blob `65dda636243155765f7e53dd3d5412191ae50126`；所有服务与构建完成后已恢复为起始/HEAD blob `4410b1880754eea8e9ee2a9263d372318efac3f3`，恢复后未再运行会改写它的命令。其他 tracked 生成文件无漂移。
- Canonical 前后 SHA-256 均为 `334108484E19A792F9C5DAD2E50BC644EF4F0AB3097B45EDAD43A4267C1DA90F`，未修改、未暂存。
- `1.txt`、`2.txt`、`.zcode/`、历史日志、架构/竞品/规划文档、favicon 与爬取脚本等用户保护文件均保持原样、未暂存。

## 提交与停止

- 精确提交信息：`feat: 增加AI词根拆解与助记`。
- 只精确暂存本轮实现、测试和三份迭代文档；不 merge、不 push。
- Canonical P1-7 已完成，第 1/1 轮后立即 STOP；不自动进入 P1-9、P1-8、P2-11 或其他目标。
