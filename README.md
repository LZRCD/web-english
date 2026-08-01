# 词环 WordLoop

面向个人使用的 2027 考研英语红宝书 AI 背词网站。词库、学习记录、错词和收藏均保存在本机，不需要公开部署。

## 当前功能

- 收录红宝书 6550 条原书词目：必考词 1856、基础词 3680、超纲词 1014
- 全量词形审计后生成 6549 个独立学习项；同源变体共享进度，独立词义仍单独学习
- 支持按分组、单元顺序学习
- 支持当前范围乱序和全书 6549 个学习项乱序
- 四档主动回忆评分映射到 FSRS（Again / Hard / Good / Easy），目标记忆率为 0.90
- 评分后提示条显示 5 秒；撤销历史保留为栈，可随时按 `Z` 或点击常驻撤销按钮撤回任意最近评分，无时间限制
- 今日任务优先安排到期复习，再补每日新词；新学、复习、完成次数和覆盖词数分别统计
- 到期积压会自动降低新词量，并支持最低新词量和关闭自适应后的手动固定目标
- 同词族新词当天自动错开；评分日志记录回忆耗时，但耗时只用于提示，不改变评分
- 个人词本、当前薄弱词与历史错词；收藏和错词均可批量复习
- 顽固词按 30 天内忘记 3 次或低评分 5 次触发，连续成功 3 次或 30 天无新低评分后自动退出
- 全局中英文查词，可从结果建立临时学习队列
- 划选任意英文即可查义：红宝书内词、已查询过的词直接显示结果，不再重复询问；红宝书词音标由内置音标索引秒级填充
- 内置 ECDICT 离线大辞典，按首字母分片按需加载；红宝书 6550 词音标单独构建为 152KB 索引，划词与学习卡即时显示音标；只有红宝书词和已加入划词集的词会进入学习队列
- 长期学习状态按评分日志、FSRS 卡片、进度、错词、收藏、位置和内容缓存分域保存在 IndexedDB；保留版本化 JSON 导入导出和自动快照
- 真实今日完成、连续学习、到期复习与 FSRS 可提取率统计；背诵日历可切换 20 周、半年或一年并查看每日详情
- 按分组、单元和乱序会话分别保存学习进度
- v5 迁移会用 `reschedule` 重放旧评分历史并重建 FSRS 卡片，不会从零开始；同时合并确认过的同源变体
- 可设置考研日期，按必考词、基础词、超纲词安排新词优先级，并预测每日工作量和复习预留期
- 学习页显示人工确认的词族轨道，AI 教练同步遵守词形关系
- DeepSeek AI 记忆教练；密钥缺失或调用失败时使用本地提示
- 可按需生成并缓存原创语境例句、翻译和常用搭配；内容补充按每个未熟练释义各生成 1 句例句（1/2/3/4 逐条对应），可反馈义项不符、单条重写，并只对反馈项或低置信项执行语义二审
- 点击单词本身即可播放发音；划词弹窗内也可直接播放查询词的读音；当前词音频后台预加载，首播即时
- 接入 66 个红宝书原始音频/视频文件的时间索引，并用 Whisper Tiny、Whisper Base、CMU 音素及全局一对一匹配逐词校对 6540 个原音频候选；6326 词使用校验后的原声，214 个低置信度词自动回退浏览器 TTS。另有必考 Unit 15 原文件未收录的末尾 6 词及两份 MP4 中 4 个声明占位词同样回退 TTS，共 224 词回退
- 设置页内置本地性能诊断：关联同一次操作的 trace，区分应用首次标签/重载、资源网络/缓存、首次/重复查词、原声/TTS、Range 206/200，显示 P50/P95、存储占用和可撤销步数；样本空闲批量落盘并跨标签合并，诊断数据不上传

## 本地运行

环境要求：Node.js `>=22.13.0`。

```bash
npm install
npm run dev
```

打开 <http://localhost:3000/>。

## 红宝书词库

原始 PDF 放在项目的 `资源/` 目录。该目录与生成后的 `public/data/redbook.json` 均被 Git 忽略，仅保留在个人电脑。

重新提取并审计词库：

```bash
npm run data:extract
npm run data:audit
```

提取脚本会校验中英文词表数量必须同时为 6550；审计脚本生成本地修正版词库、`public/data/redbook-analysis.json` 和 `docs/redbook-audit.md`。
提取时会按大小写核对分组与单元，并将 PDF 中误编码为部首字形的简体字正规化；自动测试会检查连续编号、关键专名位置及残留异常字形。

## 红宝书音频

音频仅限个人本地使用，原始文件和 `public/audio/` 均不提交或分发。安装 FFmpeg 后可重新生成时间索引：

```bash
npm run audio:index
```

脚本保留 66 个原文件，通过硬链接提供本地播放入口，并生成完整审计用的 `public/data/audio-index.json` 和页面播放用的紧凑 `public/data/audio-runtime-index.json`。逐词校对结果固化在 `public/data/audio-remap.json`，以后重建索引时会自动重新应用；无法可靠识别或切分的片段不会启用，页面自动回退浏览器 TTS。

## DeepSeek

复制 `.env.example` 为 `.env.local`，填写本地密钥：

```env
DEEPSEEK_API_KEY=
OPENAI_BASE_URL=https://api.deepseek.com
OPENAI_MODEL=deepseek-v4-flash
```

不要把真实密钥写入 `.env.example` 或提交到 Git。

## 离线辞典

划词后会直接显示红宝书词目、已查记录和缓存结果；陌生内容确认后先查 ECDICT 离线辞典，未命中或主动选择“结合当前语境辨义”时才调用 DeepSeek Flash。查询结果会加入划词集，并可单独建立学习队列。红宝书 6550 条词目均有本地音标，ECDICT 首次查询按前三个字符做 Range 小范围读取，避免下载整个首字母分片。

ECDICT 数据采用 MIT 许可证。需要从上游 CSV 重建分片时：

```bash
npm run dictionary:build -- path/to/ecdict.csv
npm run dictionary:ranges
```

## 数据版本与性能基线

词典分片、Range 索引、音标、红宝书和音频运行时索引均使用 SHA-256 内容哈希生成版本 URL，数据升级后不会误读旧浏览器缓存。任何数据构建完成后运行：

```bash
npm run data:manifest
```

`npm run build` 会先校验 59 个运行时数据文件的大小和哈希；Range v4 的 5KB 根映射随构建清单内嵌，首次查词只按首字母懒加载对应索引，并同时绑定词典分片和字母索引的 SHA-256。响应范围或版本不一致时自动回退整分片；清单过期时构建失败并要求重新生成，不会静默覆盖。

生成数据来源、工具版本、音标覆盖率和 Range 片段统计报告：

```bash
npm run data:report
```

报告写入 `reports/data-build-report.json`，已绑定 `scripts/data-provenance.json`：ECDICT commit/CSV 哈希经 26 个分片重建比对，Whisper Tiny/Base 分别记录 snapshot commit 与 `model.safetensors` 哈希，FFmpeg 记录版本和二进制哈希。生成报告时可通过 `ECDICT_SOURCE`、`ECDICT_UPSTREAM_COMMIT`、`FFMPEG_PATH` 和 `WHISPER_MODEL_PATHS` 对本机文件现场复核；三类证据全部匹配时 `provenance.liveVerification.complete` 才为 `true`。内容数据不写实时构建时间，构建报告支持 `SOURCE_DATE_EPOCH`。

独立核对本机固定来源与 provenance（缺失或哈希不一致会失败）：

```bash
npm run data:verify
```

命令会自动定位 `tmp/ecdict-upstream/ecdict.csv`、Hugging Face snapshot 缓存和 WinGet FFmpeg，并写入 `reports/data-provenance-verification.json`。也可使用 `--ecdict`、`--ffmpeg` 和 `DATA_VERIFY_WHISPER_PATHS` 显式指定；ECDICT 不在本机时可执行 `npm run data:verify -- --download-ecdict`，下载地址固定到 provenance 中记录的 commit。

固定端口 3000 已有服务时，可自动运行 30 轮真实冷/热、首次/重复和四类 Range 路径，输出统一基线与拆分建议：

```bash
npm run perf:baseline
```

可用 `PERF_ROUNDS=50` 提高到 50 轮。修正分析逻辑后可运行 `npm run perf:reanalyze`，直接用已有样本重算首次查词 Range 占比，不会重开浏览器。报告会区分未拆分的 `evaluate-split` 与已完成首字母拆分的 `split-applied-monitor`，避免重复提出同一改造。设置页会限量保存每组最近 80 条样本；构建号同时包含 Git commit 和运行时代码指纹，后续同一变体的 P95 同时增加 20% 且超过 20ms 时只显示提醒，不阻断 CI。

发布或重大数据结构调整后，使用一键生产验证：

```bash
npm run perf:production
```

它会在固定端口 3000 启动当前生产构建，正式运行 30 轮，再分别用高延迟、受控慢速网络和预热缓存各复核 5 轮；每次启动使用独立日志和 PID，健康检查成功后才测量，结束时自动关闭服务。报告按运行标签分开保存，并与上一份基线逐项输出 P50/P95 绝对变化、百分比变化及是否超过 20% 且 20ms 的告警门槛。Windows 下项目生产启动器同时修复 vinext 0.0.50 静态路径分隔符问题，并为本地生产服务提供标准单 Range `206`。

三条 AI API 会在 JSON 解析前限制请求体字节数，并执行同源校验、进程内限流、并发限制及输入输出字段上限。仅本机部署时可设置 `WORDLOOP_LOCAL_ONLY=1`；跨来源部署需显式配置 `WORDLOOP_ALLOWED_ORIGINS`。

## 检查命令

```bash
npm run lint
npm run typecheck
npm run build
npm test
npm run test:e2e
```

GitHub Actions 的 `Quality` 在普通 push/PR 固定执行 lint、typecheck 和测试；完整 Playwright 位于独立的 `Release browser verification`，只在手动触发、`v*` 发布标签或其他发布工作流调用时运行。
