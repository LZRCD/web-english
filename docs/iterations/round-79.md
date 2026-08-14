# 第 79 轮：全量生成义项考频、释义例句与词根拆解助记私有数据

- 日期：2026-08-14
- 分支 / 起始 HEAD：`codex/follow-up-hardening` / `9020283`
- 批次：第 79 轮；单轮完成
- 状态：完成（三套数据 100% 处理；义项考频 3880 条、释义例句 1106 条、词根助记 188 条待真实人工复核）

## 目标与边界

- 问题与完成定义：为全部 6549 个主学习词（25340 个义项）一次性、可断点续跑地生成三套私有学习数据——义项考频（25340 条）、原创释义例句（25340 条）、诚实词根拆解与助记（6549 条）；经完整性与质量校验后作为只读私有基础数据接入现有应用，使「生成义项考频提示」「生成释义例句 / 按未熟练义项重写」「生成 AI 词根拆解与助记」三个逐词入口优先命中预生成结果。完成定义：处理数精确、缺失/重复/错配 = 0、静默截断 = 0、强制猜测考频 = 0、强制伪造词根 = 0、语义不符却标记通过 = 0、复制或近似改写真题 = 0、伪人工核验 = 0、三套 manifest/shard 全过、测试全绿、一个中文提交、不 push。
- 允许修改：`.gitignore`、`package.json`、新增离线生成脚本与 `scripts/lib/*`、`lib/sense-datasets.ts`、`lib/private-datasets.ts` 及三个 dataset loader、`lib/merged-senses.ts`、`lib/study.ts`（义项缓存上限 8/12 → 20，仅限内容缓存上限）、`app/api/sense-frequency/route.ts`、`app/api/enrich/route.ts`（义项上限 6/8 → 显式 18）、`app/hooks/useAiCoach.ts`、`app/hooks/usePrivateDatasets.ts`、`app/page.tsx`、`app/components/WordCard.tsx`、`app/components/SelectionLookupPopup.tsx`（仅数据来源）、`tests/sense-datasets.test.ts`、`tests/e2e/private-datasets.spec.mjs` 及为屏蔽预生成数据而微调的既有 E2E（`helpers/etymology/learning`）、`reports/private-datasets-report.json`。
- 禁止修改（未触犯）：`public/data/redbook.json`、`scripts/kaoyan-corpus/**`、`public/data/kaoyan-examples/**`、FSRS / 排程 / 学习记录字段、IndexedDB schema、`STORAGE_VERSION`、备份格式、词库源数据、`1.txt`、`2.txt`、`.zcode/`、历史日志与截图、本轮开始前用户对 `lib/build-info.generated.ts` 的既有修改（SHA256 `171E60CD…`，测试后逐字节恢复）。
- Delta Gate：起始 HEAD `9020283` 比参考快照前进 1 个提交（`fix: 放宽释义例句生成与归一化限制`），判定为正常数据升级；规模基线现场重算全部吻合（6550/6549/6177→2506/25340/543/6006/339/17/46 套/4444/8894/4095/70 条），未触发完整 Round 0 重放。

## 改动

### 离线流水线（`scripts/`，全部经 `node --experimental-strip-types` 运行，复用真实 `lib` 拆分逻辑）

- `build-sense-inventory.mjs` + `lib/sense-inventory.mjs`：三套流水线共享的统一义项库存；senseKey = `wordId:senseIndex:fnv1a32(义项文本)`，与运行时 `splitWordSenses` 逐字断言一致；inputDataHash 覆盖红宝书、词族分析、拆分器源码三者哈希，任一变化即失效。
- `lib/offline-ai.mjs`：复用 `.env.local` provider 配置（本轮切换为 opencode go 订阅 `deepseek-v4-flash`，网关返回 `cost:"0"`）；并发池、429/5xx 指数退避、每项有限重试、JSON 检查点、`--resume` 不重复调用、失败队列两轮自动重跑、每 100 词 / 5 分钟进度。
- `lib/dataset-shards.mjs`：content-addressed shard（`<前缀>.<sha256前16位>.json`）+ manifest 原子发布（tmp+rename）、无引用旧 shard 清理、双发布字节一致校验。
- `lib/corpus-search.mjs`：46 套真题的确定性词形检索（复用 `build-kaoyan-examples.mjs` 的句子级解析与 `sentence-index` 的词形规则）；证据只存私有指针（paperId/年份/卷型/小节/上下文哈希），每词上下文显式上限 12（完整计数保留）。
- `lib/example-quality.mjs`：例句确定性质检——目标词形命中（屈折双向）、结构/长度/模板/元语言检测、同词串义、5-gram 近似重复（阈值 0.6，冻结）。
- `build-sense-frequency.mjs`：语料上下文两轮独立盲判 + 打乱义项顺序稳定性检查 + 分歧裁决；无语料义项走模型共识多轮推断（盲判×2 + 稳定性）；冻结阈值（≥8 卷 high / ≥3 卷 medium）；不稳定一律 `level=null + needs_review`。
- `build-sense-examples.mjs`：整词义项作为共同语义上下文、每批 ≤8 义项分块生成（每批仍见全量义项）；第一次语义审查 + 第二次独立审查 + 对抗式审查并行执行；未通过仅重写该义项（带同词已通过例句与失败原因），最多重写 2 次；`--fix-duplicates` 以全库为参考定向重写近重复记录。
- `build-etymology.mjs`：真实性别四模式（`verified_morphology` / `surface_form` / `mnemonic_only` / `needs_review`），允许 `root=null`、`affixes=[]`；独立事实声明核查 + 释义相关性核查 + 构词片段完整性/本地 relation 冲突/跨词模板（12 字符连续串 ≥3 词）确定性质检；`--retry-flagged` 定向重跑带未解决标记的记录。
- `build-datasets-report.mjs`：生成 tracked 汇总报告（只含计数、比例、版本、哈希与错误分类，不含任何私有释义/例句/真题/助记正文）。

### 运行时接入（`lib/`、`app/`）

- `lib/sense-datasets.ts`：三套数据集 schema、稳定键与条目校验（生成器与运行时同实现）。
- `lib/private-datasets.ts` + `lib/sense-frequency-dataset.ts` + `lib/sense-examples-dataset.ts` + `lib/etymology-dataset.ts`：只读 loader——manifest 字段白名单、contentVersion 重算、shard 字节数与 SHA-256 校验、wordId/senseIndex/senseKey/inputKey 与当前真实输入逐一校验；缺失、损坏、过期一律返回 undefined 安全降级，不阻塞学习流程。
- `lib/merged-senses.ts`：个人缓存（含二审状态）→ 模型复核通过的基础例句 → 待复核基础例句，按单个义项合并；个人只重写一个义项时其余基础例句完整保留；`usablePersonalSenseExamples` 保证二审失败例句不进入强化与生成参考上下文。
- `app/hooks/usePrivateDatasets.ts`：逐词加载、shard Promise 缓存、切词旧异步不覆盖新词。
- `app/page.tsx` / `app/components/WordCard.tsx` / `app/components/SelectionLookupPopup.tsx` / `app/hooks/useAiCoach.ts` / 两个 API route / `lib/study.ts`：三级解析优先级（个人缓存 → 基础数据 → 逐词生成入口）；UI 如实标注「AI 原创 · 模型二审 · 未人工核验」「AI 原创 · 待人工复核 · 未人工核验」；词根模块保留「AI 助记仅用于记忆联想，不是权威词源考据。」并显示四模式标签；待复核基础例句不进入强化语境与 sentence-index；逐词生成入口义项上限从 6/8 提升为显式 18（覆盖最大 17 义项）。

## 验证

| 级别 / 命令 | 结果 | 证据边界 |
|---|---|---|
| 库存 dry-run（`build-sense-inventory.mjs --plan/--check`） | 通过；6549 词 / 25340 义项 | 库存与真实拆分器逐字一致；不能证明义项质量 |
| 三套 `--plan` → 试点（3/2/2 词）→ 全量 `--run`（断点续跑） | 通过；0 永久失败 | 检查点语义、失败队列有效；不能证明内容质量 |
| 三套 `--publish` + `--check` + 连续两次发布字节一致 | 通过；各 27 个文件 | manifest/shard 哈希与记录校验全过；不能替代人工内容复核 |
| `npm run test:unit` | 362/362（含新增 `sense-datasets.test.ts` 14 例） | 键稳定性、schema、合并优先级、确定性质检、词形匹配 |
| `npx playwright test`（完整套件） | 115/115（含新增 `private-datasets.spec.mjs` 5 例：三套命中零 API、单套缺失只回退该套、shard 损坏降级、个人缓存优先不被覆盖、待复核例句不进强化） | 运行时 E2E 行为；数据内容仍需人工抽查 |
| `npm run lint` / `npx tsc --noEmit` | 0 error / 通过 | — |
| `npm test`（build + unit） | 通过 | 生产构建无编译回归 |

- 服务：复用固定端口 `3000` 的 `vinext dev`（PID 17660）完成 E2E 后按记录关闭并清理本轮日志文件；未批量终止 Node、未换端口。
- 生成文件：`npm test` 构建改写 `lib/build-info.generated.ts` 后，已逐字节恢复为本轮开始前用户版本（SHA256 `171E60CD3572298921D78BBE54FB8A84A362A9F03EEA263A45D0D28DF31C17DB`，与 Round 0 记录一致）。

## 产出规模（tracked 口径）

- 义项考频：6549 词 / 25340 条；有标签 21460（corpus_supported 7833、model_consensus 13627；high 6458 / medium 7344 / low 7658）；待复核 3880；contentVersion `aee3d10a9577498b`。
- 释义例句：25340 条；模型二审通过 24234（95.6%）；待复核 1106（4.4%）；全库完全重复 0、近似重复 0、通过但缺失目标词形 0、伪人工核验 0；contentVersion `5c05e717aec35815`。
- 词根助记：6549 条；verified_morphology 402 / surface_form 2553 / mnemonic_only 3406；待复核 188（2.9%）；强制伪造 root 0、伪人工核验 0；contentVersion `0b3082a3f4e42f5c`。
- 模型用量（opencode go 订阅，响应计费字段为 0）：26,472 + 35,171 + 26,881 = 88,524 次调用；输入约 29.4M token、输出约 10.7M token；三套并行约 2.5 小时，全程可断点。
- 私有输出路径：`public/data/sense-frequency/`、`public/data/sense-examples/`、`public/data/etymology/`（manifest + content-addressed shard）；工作区 `.wordloop-data/`（库存、检查点、原始响应与失败队列）；均已加入 `.gitignore`，零暂存。

## 提交与判断

- 实际修改 / 精确暂存：31 个文件（代码 + 脚本 + 测试 + `reports/private-datasets-report.json`），逐文件精确 `git add`；`lib/build-info.generated.ts` 用户既有修改未暂存。
- `git diff --check` / PreCommit：通过；staged 内容无密钥、无私有数据路径。
- 提交：`137092a feat: 全量生成义项考频例句与词根助记数据`；本迭代文档另行提交（本文件不预猜自身提交 hash）。
- 下一步：待真实人工复核 3880 条考频、1106 条例句、188 条词根记录（复核 Prompt 见下）；复核通过后可把 `humanReviewed` 由真实用户逐条置 true；输入数据变化后用 `npm run datasets:check` 检测失效并按需 `--resume` 重跑。
- push：未执行。

## 复核 Prompt（可直接交给人类复核员或全新 Agent）

### 复核 A：涉及文件（代码复核）

> 你是 WordLoop 第 79 轮的独立代码复核员。只做只读复核，不修改任何文件。
> 工作目录：`D:\me\小东西\单词`；复核对象为提交 `137092a`（`git show 137092a --stat` 列出的 31 个文件）。
> 逐项回答 PASS / FAIL 并给出行号证据：
> 1. 离线流水线：`scripts/build-sense-{inventory,frequency,examples,etymology}.mjs` 与 `scripts/lib/*` 是否存在任何 `.slice(0,6)`、`.slice(0,8)` 式静默截断；`--resume` 是否会重复调用已完成词；失败队列是否有限重试；发布是否为原子替换。
> 2. 数据契约：`lib/sense-datasets.ts` 的 `buildSenseKey` 是否与运行时 `splitWordSenses` 严格一致；三套 loader 是否校验 manifest 字段白名单、contentVersion、shard 字节数与 SHA-256、wordId/senseIndex/senseKey/inputKey；任何校验失败是否安全降级为 undefined。
> 3. 诚实性字段：所有数据记录 `humanReviewed` 是否只能为 false；考频非空 level 是否必有 basis；例句 `model_passed` 是否必有 `reviewConfidence`；词根 `verified_morphology` 是否必含非空 root 与 affixes。
> 4. 运行时优先级：`app/page.tsx` 与 `lib/merged-senses.ts` 是否严格实现「个人缓存 → 基础数据 → 逐词生成入口」；个人单条重写是否只覆盖对应义项；待复核基础例句是否被排除在强化填空与 `sentence-index` 之外。
> 5. UI 语义：`WordCard` 是否对基础例句标注「AI 原创 · 模型二审 · 未人工核验」、对待复核标注「待人工复核」；是否不存在「已验证」「人工核验通过」「词典内容」「真题原句」的错标；词根模块是否保留「AI 助记仅用于记忆联想，不是权威词源考据。」。
> 6. 安全与边界：提交中是否存在任何 API 密钥、私有数据路径（`public/data/sense-*`、`.wordloop-data`）、真题原文；是否修改了 FSRS、IndexedDB schema、学习记录字段或 `STORAGE_VERSION`。
> 输出：逐项结论表 + 发现的每个问题的文件/行号/风险等级；无问题则明确写「全部 PASS」。

### 复核 B：输出内容（三套私有数据抽查）

> 你是 WordLoop 第 79 轮的独立内容复核员（人类或 Agent 均可）。复核对象为三套已发布的私有数据：
> - `public/data/sense-frequency/`（contentVersion `aee3d10a9577498b`，25340 条，待复核 3880）
> - `public/data/sense-examples/`（contentVersion `5c05e717aec35815`，25340 条，待复核 1106）
> - `public/data/etymology/`（contentVersion `0b3082a3f4e42f5c`，6549 条，待复核 188）
> 说明：数据是私有的，只在你本机复核，不得把任何释义/例句/助记正文复制到可提交的文件或聊天摘要中；结论只允许输出计数、抽样结果与问题分类。
> 复核方法：先按字母分片随机抽 100 词；再对每套数据的 `needs_review` 记录按随机抽样至少 50 条逐一复核。每套逐项回答 PASS / FAIL：
> 1. 义项考频：`level` 与 `basis` 是否一致（`corpus_supported` 必须有非空 evidence 指针与 paperCount；`needs_review` 不得有 level）；note 是否出现「必考」「官方」「教育部」等超范围表述；`humanReviewed` 是否全为 false。
> 2. 释义例句：英文句是否真实包含目标词或其合法屈折形式；语境是否唯一指向该义项（不能自然读成该词其他义项）；翻译是否与英文和义项一一对应、不添加英文没有的信息；同词不同义项例句是否句型雷同；是否与真题原句/红宝书例句构成复制或近似改写；`model_passed` 例句是否真的经得起双审与对抗审；`needs_review` 例句是否有明确 reasonCodes。
> 3. 词根助记：mode 与内容是否一致（`surface_form` 不得出现语言来源/年代表述；`mnemonic_only` 必须 root=null 且 affixes=[]；`verified_morphology` 的根与片段是否广为人知、可追溯）；affixes 的 form 是否真实出现在单词词形中；是否捏造拉丁/希腊/法语来源、年代、语音演变或学术结论；是否与本地 relation（派生/屈折/变体 lemma）冲突；跨词助记是否存在明显模板污染。
> 4. 任何一条 FAIL：记录 `datasetId + 分片 + wordId + senseIndex + 问题分类`（不得复制正文），不得擅自修改数据文件——修正只能通过对应流水线重跑（`npm run datasets:<name> -- --resume` 与 `--fix-duplicates` / `--retry-flagged`）。
> 5. 人工核验：只有真实用户逐条确认无误后，才允许把对应记录的 `humanReviewed` 置 true；本复核本身不得批量置 true。
> 输出：每套数据的抽样规模、PASS/FAIL 计数、问题分类分布与「是否可宣布该套数据进入人工核验阶段」的结论。
