# 第 73 轮：Canonical P2-10 考研真题例句库

日期：2026-08-12

目标：把用户提供的本地考研英语真题语料构建为可验证、可追溯、按需加载的学习卡真题例句库。

提交：`feat: 增加考研真题例句库`；提交后 STOP，不 push。

## Round 0 与保护现场

- 分支 `codex/follow-up-hardening`，起始 HEAD `537dd83e66ca4e4e313f478cbeb68f841faa8fcc`，相对 upstream ahead 10 / behind 0；tracked working tree 与 index 均干净。
- 固定端口 3000 无监听；`lib/build-info.generated.ts` 起始/HEAD blob 均为 `4410b1880754eea8e9ee2a9263d372318efac3f3`。
- Canonical SHA-256 为 `334108484E19A792F9C5DAD2E50BC644EF4F0AB3097B45EDAD43A4267C1DA90F`，本轮未修改或暂存 Canonical。
- Start Gate 只因已登记的保护文件和私有语料报告 BLOCK；独立复核没有新路径、tracked/index 漂移或端口冲突。
- 已实读红宝书真实 wordId、analysis 独立/修正关系、学习卡、sentence-index、数据版本、生产 smoke 与第 70–72 轮调用链。真题例句保持静态文件边界，不进入 sentence-index、IndexedDB、备份或用户状态。
- `1.txt`、`2.txt`、`.zcode/`、历史日志、调研/规划文档、favicon、抓取脚本和其他用户保护文件保持原样。

## 语料完整性与合规边界

- 私有输入 `scripts/kaoyan-corpus/` 只读消费；manifest 46 条、Markdown 46 份、failures 0，missing / extra / duplicate id / duplicate URL 均为 0。
- 46/46 文件均含严格标题、精确来源 URL 和 `## 整卷试卷排版（全文）` 标记；CRLF 规范为 LF 后，标记后正文长度与 `text_chars` 全部一致。
- 年份范围 1998–2026：旧卷 12 套，英语一 17 套，英语二 17 套；id、标题、URL、年份和卷型 46/46 严格一致。总字节 1,147,770。
- 输入 manifest SHA-256：`0f89e538bb57699188b0d4224c59a84f20b01b2402bf6ab2a27118dadec6c373`。本轮未运行或修复抓取器，也未访问来源站。
- 当前整理来源仅为 `https://english-exam.lazynote.cn/kaoyan/`。robots 允许访问不等于复制或再分发许可；真题版权归相关考试主管机构，懒笔记只作为当前整理来源。
- 仅用于本地个人学习，不公开发布、商业使用或提交整卷/长段落/答案/解析/范文/派生句库；不声称答案或译文是官方标准，不调用 AI 补写、翻译或修复真题。

## 构建与数据契约

- `scripts/build-kaoyan-examples.mjs` 读取语料 manifest、试卷正文、红宝书与必要的 analysis 关系；生产路径和测试夹具路径均可注入。
- 只处理全文标记后的正文；排除全卷构成、答案速查、Directions、Section/Text 标签、选项、题号、`〔n〕` 填空、图片占位、作文、解析、站点说明、Markdown/HTML 残片及不完整指令，不自动回填答案。
- 确定性切句覆盖缩写、引号、括号、小数、连续标点、跨行与 CRLF/LF。候选必须为可连续回溯的 6–40 英文 token、最多 500 字符并有终止标点的完整原句。
- 匹配只使用真实 wordId：大小写不敏感、完整词边界、支持词内撇号/连字符；不做子串命中或自制词干归并，analysis 的 correctedWord 只修正已登记错形，独立派生词仍保留独立 ID。
- 同一 wordId + 规范化原句去重，每词最多 3 条；年份降序，同年按卷型、paperId、正文偏移稳定排序；记录 ID 使用稳定内容哈希，禁止随机和时间戳。
- 输出先写临时目录，结构、计数、来源与输出哈希全部成功后才原子替换；失败回滚，不留下半套输出。连续两次构建字节一致。
- 输出为 content-addressed JSON shard 与 manifest；按首字母分片，超过 512 KiB 时支持两字符前缀继续拆分，任何最终 shard 仍超限即拒绝。
- `kaoyan:build` 显式本地生成，`kaoyan:check` 重建并逐字节核对；未接入普通 prebuild，缺少私有语料不破坏普通 build/test/CI。

### 生成 schema

每条记录为：

```ts
type KaoyanExample = {
  id: string;
  wordId: number;
  word: string;
  matchedText: string;
  sentence: string;
  year: number;
  paperType: "old" | "english-one" | "english-two";
  paperId: string;
  section: "reading" | "new-type" | "translation";
  sourceUrl: string;
};
```

manifest 使用 `schemaVersion: 1`，记录 contentVersion、语料来源/抓取时间、输入 manifest 与 46 个源文件哈希、内容寻址文件名、每个 shard 的 SHA-256/字节数及覆盖统计；没有每次构建时间。

## 构建统计

- 试卷：46；原始候选句：4,845；合法来源句：4,444；例句记录：8,894。
- 覆盖红宝书词：4,095；无例句词：2,455。这里仅表示静态语料覆盖，不表示学习效果、掌握度或长期记忆。
- 卷型记录：旧卷 1,180；英语一 4,224；英语二 3,490。
- section：reading 6,734；new-type 1,806；translation 354。
- 年份记录：1998 96、1999 106、2000 100、2001 70、2002 106、2003 88、2004 81、2005 136、2006 129、2007 90、2008 99、2009 79、2010 240、2011 288、2012 309、2013 255、2014 312、2015 249、2016 315、2017 353、2018 345、2019 357、2020 399、2021 408、2022 538、2023 519、2024 648、2025 809、2026 1,370。
- 过滤原因：structuralLine 2,624；instructionLine 262；tooManyTokens 181；tooFewTokens 210；incomplete 2；missingTerminalPunctuation 4；labelOrQuestion 4。
- 输出 25 个 shard，最大 shard 为 `s`，518,488 字节，小于 512 KiB（524,288 字节）。

### 三类可追溯样例

- 旧卷：wordId 3，2005，`Mr. McWhorter acknowledges that formal language is not strictly necessary, and proposes no radical education reforms – he is really grieving over the loss of something beautiful more than useful.`；来源 `https://english-exam.lazynote.cn/kaoyan/paper/2005/`。
- 英语一：wordId 4，2025-english-one，`Even when a digital object is preserved, it may only be the carrier that's saved, not the information itself.`；来源 `https://english-exam.lazynote.cn/kaoyan/paper/2025-english-one/`。
- 英语二：wordId 3，2011-english-two，`The food industry will be alarmed that such senior doctors back such radical moves, especially the call to use some of the tough tactics that have been deployed against smoking over the last decade.`；来源 `https://english-exam.lazynote.cn/kaoyan/paper/2011-english-two/`。

额外逐记录审计：8,894 个 ID 全部唯一；禁止内容命中 0；原句无法连续追溯到对应正文的记录 0。

## 来源与输出哈希

### 46 份源文件

| paperId | bytes | SHA-256 |
|---|---:|---|
| 1998 | 22775 | `0fd8f52a85860e6e546c9bf3c8b806b235c68c84976956d31b67c07749ef3a47` |
| 1999 | 24381 | `c04bc380d9cc33a9a3524a0686a47557bd70badc8d25c305b0fa33c8ef238dec` |
| 2000 | 23060 | `e3b38eff69976c7ea65e93d253b80e90a907ccf51d0a55039b73467c658d5b9a` |
| 2001 | 24785 | `fd855ad3dc7f9ab54d0136dca1fd6220e971e8da95d4efb27a7a5d34a3f20ae3` |
| 2002 | 21472 | `87284e8241e588c5cb9fd0972aec2589865742140cd014b347af94f8fd532f27` |
| 2003 | 21784 | `a111cf3814db1b75f4779fc9974b66f885902317a3c142d6fec588e1079063b8` |
| 2004 | 21471 | `35333f021525c925d451f1607f7ee459c161d50e42efe671d991fa3cea47879f` |
| 2005 | 25797 | `5df8fcd525ce89a29e76a0a35ce0cb4e6bfe17ff854133f221b23221cf9d9c2b` |
| 2006 | 26669 | `41f1809f3083d49133be533362afbe2d03b6f2868345d645c431a0bccf87e63f` |
| 2007 | 27008 | `258b7d7194fb4c0496ca179a400baa86643d6db3835eada58c36d49912625b52` |
| 2008 | 25659 | `2eb5cf1421ba71e25d18a4cacbeeed80e3af2d9b45f3fab50758f92f4ced8492` |
| 2009 | 24934 | `b8c146c3233160e4b6865226cf22218193bb159dd0e114f43a7fb6c6d46d7300` |
| 2010-english-one | 27472 | `567286f26a164dffc1b15ee2eb18634d4e62f1cb7015bef68b0d18bf7155483e` |
| 2010-english-two | 24463 | `19fb701ffcfbb6b049e36c1e735882bad5285ba07981fd75a15057e2fdf6adef` |
| 2011-english-one | 26583 | `24116de4122bb436c34cc758fb9e50daf65d747c2af54c65b7500ed888b3b036` |
| 2011-english-two | 24225 | `196e203508fc414658b88002f62d5d31d0af7a876fed143ef699dc3c728e8762` |
| 2012-english-one | 26250 | `e77e8701528d9907056b3c3e55fbf98cc986935e6e3db7f6d315e7d443239220` |
| 2012-english-two | 24234 | `36d8fec7e910fbf7cce6c825103118eb3ec87872d6aa140845bda1b6a0c9c1ae` |
| 2013-english-one | 25307 | `a680465a4567bdfeda1c9266da2c95f0df0997ed618409f3280931d89bf78b96` |
| 2013-english-two | 22224 | `4b4f28667a21bea1152295fabe882cff235b4c24c8e9a8806d29fc90cac99e9d` |
| 2014-english-one | 27410 | `3df2d9cc14872d3ac6d6719c45b41ebaca9518cb0c53e7a3fa62818313469162` |
| 2014-english-two | 23621 | `cd800b8e7d868ea91cd7e5dd3c19fccfce351c4ace51a020f139579720eba5d7` |
| 2015-english-one | 26006 | `601ada9044f383d8f52a09a0afbf36c306e5d29aa60a3ea01ad1fe19dd90f651` |
| 2015-english-two | 23857 | `fc8ce9ea2977a472ae4febc2cd8f854dbe4df4187a354f4cf3db8c0a701ae1c3` |
| 2016-english-one | 25724 | `3420aa36831982ddb1a91b38d2bfe238e4dfa9bbe48c92d2130947a734626b01` |
| 2016-english-two | 24178 | `59e02e5d5bbaa0b2dc8290f823307464c34830e9553d25daf2dcc5de8685af2c` |
| 2017-english-one | 26363 | `1abf731f210fd70f95f1e1c6cde8c2f346e55f9bcd40255e6bd0738dd00813a8` |
| 2017-english-two | 23906 | `558365092d94499f01ef804c37c894949031a398aaf70ba3cf7168e6cdbd28e7` |
| 2018-english-one | 26032 | `e095c04838766901c0362ba2c58ee21988eedf69bfaa775bc8816b4cb017cf70` |
| 2018-english-two | 23500 | `b694c358f126a7cbf6891f032b56e165f554f720f566f2ae5c0b0e41980f238a` |
| 2019-english-one | 26048 | `883f82191594cca6802604245f32298dd8c4f71e78c1d4389e2974548a95bbe0` |
| 2019-english-two | 23772 | `05cc5a0b61989245ea53ff4d58794b503a714ca8fcf81ccb049280ed709aa10b` |
| 2020-english-one | 26161 | `473129cd779f34ff70abcf19a2ba05d5ea0c591c6bceb0578a350e5c6dd3d102` |
| 2020-english-two | 23592 | `5c63a97c83170761b4e87079c6f453776c351a1d673750289204c5468fdd5e2e` |
| 2021-english-one | 25998 | `e874455207bea191c6f54257c4050be5df000dcc892d80c56be93e2be367e829` |
| 2021-english-two | 23961 | `ce4a3be5857852cbd585f782a602184e0f2f915c9a885eceee8edebfad6d811e` |
| 2022-english-one | 27328 | `20f537e00044b0d69353b17d4621198fd106ddfbb1cee0e9995cfc6baee864a6` |
| 2022-english-two | 24124 | `1282c1129d9869fa3b29bc330ea95533390f8380031a310bead45c49c2b951de` |
| 2023-english-one | 27190 | `a18a71686831a67d2a1d9e7ef2ba6de8f427ef9c812121c75e6b3cb4c0fc2ecd` |
| 2023-english-two | 24057 | `c3ab653850b16a7eae163e182a86553479666f81a89a5bd5e82ba74f3edc215a` |
| 2024-english-one | 27341 | `cd96c4554573faaf2b347b7ff155ce67efe8a9ebbb039032cba442e8ca3b8d8c` |
| 2024-english-two | 24217 | `62a1f4a57b1c999558c034aeb60315fb0672daa664c4af453af2acbd77a40350` |
| 2025-english-one | 27366 | `29c61a160e9544999d195ba42678ff9868cca38e41c6bf7dd7dd4dae9b37bbbf` |
| 2025-english-two | 24296 | `58707c001547ab0065d8e7c2003e5c0ae2122f133c2a5ad7e1f8fc61d2a344df` |
| 2026-english-one | 27189 | `413b835c0f93cd55ceb71c1bbf365929f293873a3178a2a02402077252326c1f` |
| 2026-english-two | 23980 | `7a189e42ac318ff1ef3d651af4d27e8f2ba9fe2ac26016bed9ae64e3e47dffe2` |

### 派生输出

- contentVersion：`17a1ba71786ba203`
- `manifest.json` SHA-256：`00ff9c3a694453f8f1756f61496e4e9be779cffecfe8264e0ac8cc44cc808827`

| prefix | bytes | SHA-256 |
|---|---:|---|
| a | 337949 | `5884d9271282ff9d2630389aefc0410f1be7f9e478685e5e048b7d05d65c8fc5` |
| b | 223848 | `4529a7cc6107405dea908be51653203778a4922a0095817f6dc716daf52e17a6` |
| c | 455091 | `b99a49a13c12087a233135af9ac467df4a5ff06085bcbe7eb79b3199a5e62572` |
| d | 253084 | `7c5f4de42f14245f72ae1bb4611c4089d3fe1c58f22aa011fc873393f8eda346` |
| e | 271106 | `59f7a87438878dfb7642dfcbb94280c9adbfef730b97b5b9d9f90cda51ff39e0` |
| f | 227981 | `236c6048e0d3f899e8f905f113d8e837d06c451aee27e764dbe5fe68c6386900` |
| g | 121878 | `b53d893d1e7bdbe3394f2413cb70fa647115828e77c8a9ddecf140c5e1ffc724` |
| h | 142449 | `5921061d460075f2275a6a3706034c64321e1018608633fd0213d4b223b38e83` |
| i | 246774 | `eaf00455148af271d3431e0e87ecd5550a6d0324bd484683bddbf67b8a1bb0f5` |
| j | 28843 | `3402ce89b91bfc2e2a3e676a1861aa10609b4a3cb95b572f02eb3622435f11b1` |
| k | 14775 | `2d9b75831f3bbe6b6f9d47ebf0c7cc74667847766244c846544548f3cb4f1d91` |
| l | 165651 | `3e2d3ebb8a89f24e2cc3ff453ca6a045faf29ad79fbb30e6940b967a3b698d49` |
| m | 239684 | `2bade2af75ca98800e5b0b62e45214ec5a8387f55f30dca21587c67e8b494925` |
| n | 109481 | `23c40ddcfbb7ebe5dc6e69ade0ea117d3cc47d8e29ceae7de93eeb4f6f4eb75c` |
| o | 137014 | `a773a01afaea8808ac435e0e1746aa25f802f435f786029227e2121d0e8700c8` |
| p | 387533 | `60645150c48dcd580f90b3f3e6823bb36d01b4580c67896adde9f0c9ad922de2` |
| q | 17544 | `96c2d34c29f21bb9c5c2edd977dfe7e25736d3b87b30c27337c50ae38456ddcb` |
| r | 268888 | `c94672781167d6afe89c65f83393e66f7ba46721de50d51b1045f7414a579c6a` |
| s | 518488 | `6bde14f4a2072254deb0ba90a1aed7065092d55a11e558c751925afef4d934e8` |
| t | 222086 | `66c5f0f65a34e3c38667fce96b6bdcb7bd8504ebdcae99577c6cb06b98886195` |
| u | 101411 | `c317ec0df71f1c98f0f8039d9b8372a40f1c92ae8875119c780d21af573917da` |
| v | 75730 | `685b6cf3a504b9305598604e3153d896cf5cd236337d715f69c5cd590dfadb3d` |
| w | 152598 | `3dd5ce2f58d4eac34a1174031ab2f46fac97b55a4a4fe517c36eb5b0c738bc05` |
| y | 15862 | `bf33a15eea48c266b3dc930cd68bdcc274f64afe779bd4a807db9c4ae4ae51bc` |
| z | 5791 | `caf1767b9484ae8019d03c47339fddbc8c303bfafcf308d78d201beacaa89573` |

## 运行时、UI 与零写入证明

- 运行时严格校验 manifest、contentVersion、自描述哈希、来源字段、统计、shard 结构、字节数、SHA-256 和内容寻址文件名；manifest 只请求一次，当前词仅按前缀加载一个 shard，同 contentVersion/prefix 复用 Promise 缓存。
- 404、缺文件、hash 或结构非法均静默返回空列表；不请求外部域名、不新增 API route，也不阻塞普通词库和学习卡。hook 使用 requestKey/stale guard，切词后旧异步结果不能串到新词。
- 学习卡揭示区按“真题原句 → 现有释义/红宝书例句”的顺序展示。每条只显示英文原句、真实年份/卷型/section 和记录内精确 sourceUrl；链接为新标签页且带 `noopener noreferrer`。
- 区块稳定披露“真题版权归相关考试主管机构；本站仅用于个人学习，来源页用于核对。”；无数据完全不渲染。320px、200%/400% 缩放、长词换行、键盘链接和现有划词均覆盖。
- 加载、浏览、切换和来源链接没有任何写入调用；未修改 STORAGE_VERSION、DATABASE_VERSION、BACKUP_FORMAT、store/domain、backup、learning、quiz、FSRS、ReviewEvent、QuizAttempt、weak-signals、红宝书或 Canonical。
- reviews、quizAttempts、wordProgress、cards、activeSession、activeQuiz、dailyCloze、dailySentence、enrichments、senseFrequency、favorites、mistakes、今日任务在静态加载前后保持不变；只有用户真实执行既有划词查询时，原有 lookupStats 语义照旧。

## 红测与 V1–V4

- 红测：`node --test tests/kaoyan-examples.test.mjs` 为 0 pass / 1 fail；首个真实失败是缺少 `scripts/build-kaoyan-examples.mjs` 导致 `ERR_MODULE_NOT_FOUND`，不是环境错误。
- 聚焦构建器：8/8；`kaoyan:build`、`kaoyan:check` 均通过且连续两次输出字节一致。
- typecheck 通过；lint 0 error / 1 个既有 warning（`lib/weak-signals/projection.ts` 未使用 `SprintHistoryRecord`）。
- 新真题 E2E 3/3；新真题 + learning + selection lookup 联跑 22/22；data lifecycle + responsive 11/11。
- etymology + daily cloze + daily sentence 联跑 10/11：其中既有 daily-cloze B 用例在亚洲上海凌晨跨 UTC 日期边界时，将本地同日历史事件按 UTC 前一日读取，导致重复调度门禁断言失败；已独立重现两次。该缺陷与本轮真题代码无调用链关系，且修复会越界修改 Quiz/FSRS，因此本轮不降断言、不改业务范围并停止继续重试；同组 etymology 3/3、daily sentence 4/4、daily cloze 3/4。
- `npm test`：production build 通过，Node 单测 327/327。
- production smoke 通过：首页、静态资源、6,550 词数据、真题 manifest/内容寻址 shard/JSON/hash、音频索引和 Range 206 均有效。
- `git diff --check` 通过。

## 服务、生成物与提交门

- 最终 dev worker PID 59008、listener PID 50216；日志 `.wordloop-runtime/rounds/dev-20260812-021832.out.log`（同 stem `.err.log`）；已精确停止。
- production smoke PID 21204；日志 `.wordloop-runtime/smoke-20260811T181224Z.out.log` / `.err.log`；已精确停止。
- 所有 build/dev/smoke 结束后，只恢复 `lib/build-info.generated.ts` 为 HEAD blob `4410b1880754eea8e9ee2a9263d372318efac3f3`；恢复后不再运行生成命令，端口 3000 空闲。
- `.gitignore` 精确忽略 `/scripts/kaoyan-corpus/` 与 `/public/data/kaoyan-examples/`。私有输入和派生句库暂存数均为 0，保护文件暂存数为 0。
- 只逐路径暂存本轮构建器、运行时、UI、测试、smoke 和三份文档；不使用 `git add .` / `git add -A`。PreCommit Gate 若仅因已登记保护项报告 BLOCK，则以 exact cached set、tracked diff 为空和保护暂存为 0 独立验收。
- 创建唯一单父中文提交 `feat: 增加考研真题例句库`；不 push，不进入 P2-11/P2-12，完成后 STOP。
