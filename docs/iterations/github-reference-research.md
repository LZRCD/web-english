# GitHub 同类开源项目调研与可参考方案

> 调研日期：2026-08-09 ｜ 分支：`codex/follow-up-hardening` ｜ 性质：只读调研文档
> 结论供后续迭代候选池使用；本文不代表已授权实施任何代码修改。
> 研究方法：`gh` CLI 拉取仓库文件树 + 实读核心源码，非二手资料。

---

## 0. 结论速览

- 本项目（词环 WordLoop）的薄弱画像、词级时间线、冲刺、划词、AI 判分等模块，在开源生态中均有成熟参照系：**事件溯源双表模型（Anki revlog）**、**lapse/leech 复发机制（Anki）**、**FSRS 官方 API 范式（ts-fsrs）**、**划词事件流管线（沙拉查词）**、**AI 结构化输出与防泄题（ai-vocabulary-builder）**。
- 四个中文背单词对标应用（qwerty-learner / ToastFish / WordReview / word-wind）**均无正式首次引导 onboarding**——本项目的三步引导是差异化优势，不是要删减的对标负担。
- 当前遗留问题（lean-v3-remaining-issues.md 的 ISSUE-CANDIDATE-01/04 等）可从"事件分层谓词 + 任务长度可选"两个低成本改动获得直接答案。
- 最大共性结论：**调度算法与业务事件分离、事件只增不改、统计全部事件流派生**，是全部高星项目的一致架构选择。

---

## 1. 调研对象

| 仓库 | Star | 对应本项目模块 | 核心看点 |
|---|---|---|---|
| `ankitects/anki`（官方版，Rust 核心 `rslib/`） | 28k+ | 状态机 / 事件模型 / 统计口径 / 薄弱词 | revlog 双表、next_states 四分支、lapse/leech、True Retention |
| `open-spaced-repetition/ts-fsrs` + `fsrs4anki` + `py-fsrs` | 746 / 4037 / 467 | FSRS 工程化 | repeat/next/rollback/reschedule、确定性 fuzz、deckParams 参数组 |
| `RealKai42/qwerty-learner` | 22739 | 词库管理 / UX / 统计面板 | 静态词库+声明式索引、复习会话续练、打字模式、字母级错误 |
| `crimx/ext-saladict`（沙拉查词） | 13262 | 划词 / 生词本 / 导出 | 划词事件流管线、notebook 双表、write-through 同步钩子、模板化导出 |
| `Uahh/ToastFish` | 6534 | 通知学习 / 四档评分 | SM2+ 状态机、通知内四选一测试 |
| `Benature/WordReview` | 671 | 艾宾浩斯 / 重难词队列 | "昨日重现"、四档快捷键标记、history 位串 |
| `heygsc/word-wind` | 297 | 生词本 / 导出 | 每词库独立进度、生词导出 docx |
| `piglei/ai-vocabulary-builder` | 995 | AI 例句 / 结构化输出 | pydantic/JSON 双模式、`$` 包裹目标词、多后端降级 |
| PouchDB / electric-sql / Ink&Switch local-first | — | 本地同步路线 | 快照同步 → PouchDB → CRDT 的演进路径 |

---

## 2. 词级时间线与事件模型（借鉴 Anki revlog）

### 2.1 双表事件溯源（最值得借鉴的核心）

- **`revlog`（append-only 事件流）与 `cards`（当前态投影）分离**。
  本项目当前"每词存当前状态"的做法，在新增薄弱维度/指标时会不断加字段；改为事件流 + 投影后，**新增指标永远不用改旧数据**，从事件流重算即可。
- **事件 id = 毫秒时间戳**：零冲突、天然时间序、免自增管理，单机 IndexedDB 完美匹配。
- **事件"性质"分层**：Anki 用 `has_rating_and_affects_scheduling()` 区分"影响调度的复习"与"只记账的动作（手动、cram）"。
  - 本项目映射：`review`（普通/冲刺答题，推进 FSRS）与 `lookup` / `guess_mistake`（只记账，可选触发"软重学建议"）分属两层。
  - 统计一律 `WHERE kind='review'` 过滤——这是"顺利回忆 95%"类指标不被查词/猜错污染的口径根源（对应 lean-v3 ISSUE-CANDIDATE-01）。
- **revlog type 取答题前状态**，写库前快照"新旧间隔"：回放时无需猜测事件发生时的语义。
- **事件模型设计要点**：`events` 表（id/wordId/kind/rating/intervalBefore/intervalAfter/difficultyAfter/takenMs/ts）+ `words` 表存当前态投影（state/dueAt/stability/difficulty/lapses/streak）。

### 2.2 纯函数四分支调度

- `current_state.next_states(ctx) -> {again, hard, good, easy}`：状态迁移无副作用、可单测、可回放验证；**UI 按钮上的"下次间隔"直接读预计算结果**。
- 换算法（SM-2/FSRS）只换 ctx 参数；冲刺复用同一套迁移函数。

### 2.3 过度设计（可裁剪清单）

- `due` 三态语义（队列序号/时间戳/天数）与 DayLearn/PreviewRepeat 队列：统一存 `dueAt: timestamp` 即可。
- Suspended/Buried 家族与兄弟卡埋葬：多人牌组同步场景才需要；单机一个 `paused` 布尔足够。
- Filtered/Preview/Cram 完整状态机：冲刺应建模为**事件 + 过滤查询**，不进持久状态机。
- `factor` 的 SM-2/FSRS 双重编码：JSON 字段直接存结构化难度。
- `usn/scm` 同步字段、Manual/Rescheduled 手动事件细分：本地优先不需要（保留 `updatedAt` 即可）。
- fuzz 分档（±15%/10%/5%）与负载均衡器：可整体砍掉或退化为最简单单调性约束。

---

## 3. 薄弱画像降级与复发（借鉴 Anki lapse/leech + FSRS 参数组）

### 3.1 遗忘即降级（lapse 路径）

- Review 中"忘记"（Again）→ `lapses += 1`、难度上升 → **进 Relearning 短间隔（默认 10 分钟步）** → 走完步进才回 Review（保留原 ease），间隔硬性压回 1 天（`lapse_multiplier=0` 即最小间隔）。
- "薄弱标签淡出后重现"应基于 **`lapses` 永不重置的累加器 + FSRS `difficulty/stability` 派生**，而不是单独的布尔标签。一个词多年后忘一次，lapses 从 0 变 1，立刻重新进入薄弱画像。

### 3.2 复发检测（leech）

- `lapses >= 阈值(默认8)` 且**每过半阈值再触发**（8, 12, 16, 20…）→ 打 `leech` 标签（= 薄弱词集，用户可见、可手动移除）。
- 渐进报警避免"一次性触发后无感"；默认动作是标签而非挂起。

### 3.3 薄弱画像数据模型建议

- 用 **`{lapses 总数, 最近 lapse 时间, 当前连续成功次数}` 三元组**替代单一 weakScore。
- 查词/猜错视为"软 Again"：只影响薄弱分/清零连胜，不强制重排。

### 3.4 薄弱降档 = 改配置不改数据

- fsrs4anki `deckParams`（`deckName` 前缀匹配 → 每牌组 `{w, requestRetention, maximumInterval}`）+ ts-fsrs 运行时 `request_retention` Proxy 机制（改参数立即重算 intervalModifier，**不动任何卡片记忆状态**）。
- 本项目映射：IndexedDB 存 `tagParams: { 标签 → {requestRetention, w?, maximumInterval} }`，按词所属标签构造/切换 fsrs 实例。

---

## 4. FSRS 工程化（借鉴 ts-fsrs 官方范式）

### 4.1 核心 API 与落库范式

```typescript
const f = fsrs({ request_retention: 0.9, enable_fuzz: true });
f.repeat(card, now)              // 一次算好四个评分结果（预览）
f.next(card, now, Rating.Good)   // 只算一个评分（落库用）
f.get_retrievability(card, now?) // 当前回忆概率 R(t)
f.rollback(card, log)            // 撤销误点：反推复习前状态
f.forget(card, now, resetCount?) // 重置为新卡（重学）
f.reschedule(card, reviews[], ?) // 历史 log 重放重排（参数优化后迁移）
f.useStrategy(mode, handler)     // SCHEDULER / LEARNING_STEPS / SEED 扩展点
```

- **四结果预览 + afterHandler 扁平化落库**：`repeat()` 在渲染评分按钮时调用，用户点击后取对应 `RecordLogItem`，`card + log` 原子写入 IndexedDB；`afterHandler` 把 `Date` 转 number，避免序列化坑。
- **状态流转**：New→任意评分→Learning（分钟级 step：Again=1m / Hard=首个step×1.5 / Good=下一步）；step 走完或 ≥1 天 → Review；Review+Again → post-lapse 降稳定性 + Relearning + `lapses+=1`；Hard/Good/Easy 保持 Review，间隔约束 hard≤good、easy≥good+1。
- **确定性 fuzz seed 绑定词 ID**：`GenSeedStrategyWithCardId('id')`——同卡同次复习结果稳定，刷新/多端渲染到期日不变，幂等写入安全。
- **四档评分直接映射官方语义**：忘记=Again(1)、模糊=Hard(2)、认识=Good(3)、熟练=Easy(4)。FSRS-6 中 Hard 有稳定性惩罚（w[15]）、Easy 有加成（w[16]），模糊与认识在算法层真实区分（对比 SM-2 的 Again/Hard/Good 首次间隔完全相同）。

### 4.2 冲刺会话 = 参数快照（不是另一套调度）

- 进入冲刺：保存参数快照 → `get_retrievability` R 阈值或指定词本选词 → 每词 `next()` 提交并写 `session_id` 扩展字段 → 冲刺中 Again 的词自然进 Relearning 短间隔 → 结束恢复快照。
- 提前复习完全合法：`elapsed_days` 按实际 `last_review` 计算，官方算法对早/晚复习都稳健。
- 会话级可临时调低 `request_retention`（少排远期）或关 `enable_fuzz`。

### 4.3 时间线与撤销

- `ReviewLog` 本身就是事件源（含 `Rating.Manual` 事件类型：`forget()`/`reschedule()` 产出）；`reschedule()` 可整条时间线重放校验；`rollback()` 是"改评分/撤销误点"的现成基础。
- 业务元数据（会话 ID、练习模式）通过 `afterHandler`/扩展字段追加，类型开放。

---

## 5. 划词查词（借鉴沙拉查词事件流管线）

### 5.1 划词触发链（直接可抄）

- **鼠标模式**：监听 `mouseup`（capture 捕获阶段）→ `delay(10)` 等浏览器清空选区 → 取 `window.getSelection()`。比直接监听 `selectionchange` 更稳。
- **触摸模式**：`selectionchange` + `mousedown/touchstart` 状态位；键盘选区 400ms debounce。
- **悬浮取词**：`document.caretPositionFromPoint(x,y)` 定位文本节点 + 词边界正则（`[-_a-z]+$` / `[\u4e00-\u9fa5]`）+ `selection.modify('word')` 扩展；单词 rect 必须包含鼠标坐标防误判。
- **噪声过滤（多层）**：面板内选区豁免、输入框/textarea/contentEditable/monaco 豁免、Unicode 语言白名单正则、`distinctUntilChanged`（text+context 去重）、纯标点数字丢弃。
- **双击检测**：click 周期计数流（timer+scan），用于"双击才查"模式。
- 做成独立 `useSelectionStream()` hook，语言白名单换成词库语言检测即可。

### 5.2 生词本数据结构

```typescript
interface Word {
  date: number      // 主键，UNIX 毫秒
  text: string      // 单词
  context: string   // 所在句子（例句）
  title: string     // 来源页面标题
  url: string       // 来源页面 URL
  favicon: string
  trans: string     // 翻译（可编辑）
  note: string      // 自定义笔记
}
```

- notebook + history 双表（Dexie 封装 IndexedDB），主键 `date`，索引 `text/context/url`，`equalsIgnoreCase(text)` 判重。
- **write-through 同步钩子**：写库同时触发同步动作（ADD/DELETE），本地与同步解耦，以后插拔 WebDAV/PouchDB 不动业务代码。
- 本项目落地：主键改稳定 UUID + `updatedAt`（为将来同步预留），保留 text/context/url 索引。

### 5.3 词典/AI 结果统一标准化（provider 模式）

- `DictSearchResult = { result, audio?, catalog? }` + 每来源一个目录（engine.ts / config.ts / View.tsx）；结果按 `lex | machine | related` 判型分派渲染。
- 统一错误码：`handleNoResult() / handleNetWorkError() / handleManualVerification()`。
- 并行查询、单个失败不影响其他；HTML 一律 DOMPurify 消毒。
- 本项目映射：`interface ResultProvider { search(text, config): Promise<ProviderResult> }`，实现 `localDictProvider / remoteDictProvider / aiExampleProvider`。

### 5.4 模板化导出 + 挖空生成

- 占位符模板：`%text% %trans% %context% %contextCloze% %note% %date%`，支持换行转义（`\n`/`<br>`/`<p>`/空格）、HTML 转义开关。
- **`%contextCloze%` 自动把例句中目标词替换成等长下划线**（正则转义 + `gi` 全替换）——一条功能同时解决"生词导出到 Anki/Excel"和"站内挖空练习"。

---

## 6. AI 判分与例句（借鉴 ai-vocabulary-builder + 沙拉查词）

### 6.1 结构化输出

- pydantic/JSON **双模式**，按模型供应商自动降级（DeepSeek 等不支持 function call 用 JSON 模式）；返回后代码层二次清洗（word 强制小写、`$` 分隔再拆分）。
- 系统提示词明令"只输出译文，不要任何额外解释"。
- prompt 里**明确 JSON 的 key 名字**保证格式稳定（AI-Quiz-Generator 做法）。

### 6.2 防泄题三件套（对应本项目"低分强化反馈泄题"修复）

1. 例句中目标词用 `$` 包裹、程序化替换为 `____`——题目界面答案永不直接出现；
2. 判分/反馈 prompt 显式**禁止回显目标词或给出正确答案**，只给方向性建议（"换个更地道的动词搭配"）；
3. 低分反馈走**模板化建议**而非逐字点评，避免 LLM 复述答案。

### 6.3 判分策略：先比对后 LLM

- MCQ/拼写类：确定性规则（答案键比对、编辑距离、关键词命中）先判，零成本零延迟；
- LLM 只判自由文本（造句、释义）：prompt 带 rubric（目标词用对、语法、自然度），输出结构化 `{score, feedback, errors[]}`。

### 6.4 三层降级（AI 是可选增强层，不是数据通路）

- `LLM → IndexedDB 缓存（AI 结果按词缓存，离线可复习）→ 本地模板/规则（预置例句库 `$word$` 占位符、判分退回比对法）`；
- 所有 AI 调用包统一错误，UI 只展示"生成失败，已用内置内容"；
- AI 结果落库附 `source: 'ai' | 'cache' | 'local'` 标记。

---

## 7. UX 与统计（借鉴 qwerty-learner 等四应用）

### 7.1 各仓库横向对比

| 维度 | qwerty-learner | ToastFish | WordReview | word-wind |
|---|---|---|---|---|
| 词书管理 | 最完善：120+ 词库、category/tags、20 词/章、声明式索引 | 词书=SQLite 表 | Books + List 层级 | 7 本固定下拉 |
| 进度存储 | IndexedDB 三表（单词/章节/复习会话） | SQLite 每词 status | MySQL history 位串 | localStorage 位置指针 |
| 统计面板 | 热力图/折线/错误字母 Top/错题本 | 仅进度+日志 | list 记忆率+艾宾浩斯日历 | 无 |
| 首次引导 | 可关闭开始卡片 | 线性三步（选书→数量→开始） | 无 | 无 |
| 离线 | 半 PWA（有 manifest 无 SW） | 全本地 | 服务器型 | 无 |
| 学习模式 | 打字 + 默写 | 通知推送 + 四选一 | 键盘复习 + 重现 | 卡片浏览回忆 |

### 7.2 值得借鉴的 10 项（本项目缺失/可强化）

1. **静态词库格式 + 声明式索引 + 分章加载**（qwerty-learner）：`public/dicts/*.json` 纯数组 `{name, trans[], usphone, ukphone}` + 索引注册 `{id, name, category, tags, url, length, language}`；红宝书可拆"核心/低频/超纲"按需加载。
2. **复习会话续练**（qwerty-learner `reviewRecords`）：`{words, index, isFinished, createTime}` 持久化，中断可"继续当前进度"——本地应用最大流失点是"复习到一半关掉重来"。
3. **打字/默写模式 + 字母级错误**（qwerty-learner）：`timing[]`（每字母耗时）、`mistakes: {字母下标: 按错的键}`——给"拼写薄弱"维度提供客观信号，与四档主观评分互补；默写成绩折算评分档位（全对=Good、错1次=Hard、错2次+=Again）。
4. **错词加权队列**（qwerty-learner）：`错误次数(0.6) + 最近错误时间(0.4)` 加权排序生成复习列表；与薄弱画像互补（画像产出"哪些词弱"，加权队列产出"下次先练哪些"）。
5. **免费发音方案**（qwerty-learner）：`https://dict.youdao.com/dictvoice?audio={word}&type=1/2` 无需密钥 + Web SpeechSynthesis 兜底。
6. **配置 schema 演进**（qwerty-learner `atomForConfig`）：localStorage 默认值对象缺失字段自动合并补齐、类型不匹配整体重置。
7. **"昨日重现"**（WordReview）：近 N 天忘词聚合复习，与 FSRS 到期队列互补。
8. **词库独立进度 + 生词导出 docx**（word-wind）。
9. **通知/提醒学习**（ToastFish）：Web 上退化为"每日提醒 + 通知内快速测试"。
10. **数据导出**（qwerty-learner dexie-export-import + ToastFish 会话日志）：设置页放"导出学习数据 JSON"与"导出本周生词"。

### 7.3 统计口径（借鉴 Anki stats）

- **True Retention**：仅计 `has_rating_and_affects_scheduling()` 且（Review 类型或 lastIvl≥1 天）的事件；`ease==1` 记失败其余成功；**young(<21天) / mature(≥21天) 分桶**；分 today/yesterday/week/month/year/all 窗口。
- **`daily_load = Σ 1/interval`**：一行算出未来每日复习负载，冲刺排期直接可用。
- **日历热力图** = 每日 learn/relearn/young/mature/filtered 五类计数之和。
- **retrievability 分布**：FSRS `current_retrievability(state, elapsed_days, decay)`，按词聚合取均值。
- 全部是 `readonly` 派生查询，IndexedDB 只存原始事件，零物化存储负担。

---

## 8. 本地优先同步路线

| 方案 | 机制 | 冲突处理 | 离线体验 | 适配判断 |
|---|---|---|---|---|
| A. 全量快照（saladict WebDAV 模式） | 单文件 `{timestamp, words[]}` + ETag 304 | LWW：时间戳新的覆盖 | 完全离线 | **起步推荐**：零后端（坚果云/gist 即可），几十行实现 |
| B. PouchDB + CouchDB 协议 | changes feed + rev 树增量复制 | 确定性 LWW，败者保留可查（`_conflicts`） | 内置离线优先 | 明确要快速多端时直接用；需要 CouchDB 兼容服务端 |
| C. CRDT（Automerge/Yjs） | 操作日志交换、确定性合并 | 无冲突概念 | 最佳 | 结构化低频数据偏重；适合将来协同时再上 |
| D. Electric（Postgres 逻辑复制 + Shapes） | 服务端增量流出 + 局部订阅 | 需自定 LWW | 依赖网络 | 强制 Postgres 服务端，最重，不匹配纯前端起步 |

- **落地建议**：起步选 A；数据模型按 B 的迁移条件预留（稳定 UUID id + `updatedAt`），将来接 PouchDB/CRDT 只加映射层，不改业务代码。
- 关键原则（Ink & Switch 同款）：**本地为主、同步为辅；写库与同步解耦（write-through 钩子）**。

---

## 9. 对当前遗留问题（lean-v3-remaining-issues.md）的参考答案

| 遗留问题 | 参考方案 | 来源 |
|---|---|---|
| ISSUE-CANDIDATE-01：评分语义与"顺利回忆"指标不清 | 评分区明确"依据看答案前回忆状态"；统计口径用事件分层谓词（只计影响调度的复习事件），把查词/猜错排除在成功率之外 | Anki `has_rating_and_affects_scheduling` + True Retention |
| ISSUE-CANDIDATE-02：首次引导可能提前消失 | 四款对标应用均无 onboarding，属本项目差异化；先严格复现（全新 profile + 延迟数据加载）再改，勿按单次观察重写 | 四个背单词应用横向对比 |
| ISSUE-CANDIDATE-03：未解释英文与缩写 | 只盘点核心流程首次出现、承载关键含义的词优先补中文；不做全站机械翻译 | 各应用文案实践 |
| ISSUE-CANDIDATE-04：首次任务 20 词偏长 | "任务长度可选"（5/10/15/20）是已验证低成本方案（ToastFish 默认如此）；复习会话续练降低中断放弃成本 | ToastFish / qwerty-learner |
| 独立"测验"入口验证 | 选择题模式（ToastFish 通知内四选一、qwerty-learner choice mode）为现成参考；AI 出题在 prompt 指定 JSON key 名即可稳定 | ToastFish / AI-Quiz-Generator |
| 低分强化反馈泄题（已修复） | 防泄题三件套：`$` 包裹目标词、判分 prompt 禁回显、模板化低分反馈 | ai-vocabulary-builder + 沙拉查词 %contextCloze% |

---

## 10. 优先级建议

| 优先级 | 事项 | 借鉴来源 | 预计价值 |
|---|---|---|---|
| P0 | 事件溯源双表改造（events + words 投影）+ 事件分层谓词 | Anki revlog | 薄弱画像、统计诚实化、时间线的共同地基 |
| P1 | 薄弱画像改 `lapses 累加器 + leech 阈值复发`；冲刺改参数快照 | Anki / ts-fsrs | 降级/复发闭环、冲刺复用官方 API |
| P2 | 划词事件流管线；复习会话续练；AI 三层降级与模板化防泄题 | 沙拉查词 / qwerty-learner / ai-vocabulary-builder | 划词质量、流失率、AI 稳定性 |
| P3 | 打字/默写模式；通知提醒；PWA 真离线；全量快照同步 | qwerty-learner / ToastFish / saladict | 客观信号、触达、离线、多端 |

---

## 11. 参考源码索引（按仓库文件路径，便于后续深挖）

- **Anki**：`rslib/src/storage/schema11.sql`（revlog/cards 表）、`rslib/src/revlog/mod.rs`（事件模型+过滤谓词）、`rslib/src/card/mod.rs`（CardType/CardQueue/FsrsMemoryState）、`rslib/src/scheduler/states/*.rs`（状态机与 fuzz）、`rslib/src/scheduler/answering/*.rs`（答题主流程）、`rslib/src/deckconfig/schema11.rs`（lapse/leech 默认值）、`rslib/src/stats/graphs/{retention,reviews,future_due,retrievability}.rs`（指标口径）、`ts/routes/graphs/CalendarGraph.svelte`（热力图）
- **ts-fsrs**：`packages/fsrs/src/models.ts`（类型）、`fsrs.ts`（API 主入口）、`impl/basic_scheduler.ts`（状态机）、`algorithm.ts`（fuzz/retention/公式）、`reschedule.ts`（重放）、`help.ts`（fuzz 分段）
- **fsrs4anki**：`fsrs4anki_scheduler.js`（Anki 集成调度器）、`fsrs4anki_optimizer.ipynb`（参数优化）
- **py-fsrs**：README（参数/优化器/Streamlit 可视化 `interactive-forgetting-curve`）
- **沙拉查词**：`src/selection/select-text.ts`、`src/selection/instant-capture.ts`、`src/_helpers/record-manager.ts`、`src/background/database/{core,index}.ts`、`src/background/sync-manager/services/webdav/index.ts`、`src/content/redux/epics/searchStart.epic.ts`、`src/components/dictionaries/helpers.ts`、`src/components/WordPage/ExportModal/index.tsx`
- **qwerty-learner**：`src/resources/dictionary.ts`（词库索引）、`src/utils/db/`（IndexedDB 三表）、`src/store/atomForConfig.ts`（schema 演进）、`src/utils/db/review-record.ts`（错词加权队列）、`src/pages/Analysis/hooks/useWordStats.ts`（统计口径）
- **ToastFish**：`Model/SM2plus/Card.cs`（四档评分状态机）
- **WordReview**：`apps/review/models.py`（Words/Review/Books/BookList、history 位串）、`views.py`（EBBINGHAUS_DAYS）
- **ai-vocabulary-builder**：`voc_builder/builder/ai_svc.py`、`voc_builder/learn/ai_svc.py`、`voc_builder/infras/ai.py`

---

## 12. 边界与保护项

- 本文为只读调研结论，未修改任何产品代码、测试、schema、配置或用户数据。
- 后续若选择其中任一方案实施，需按自动化迭代 SOP 重新授权并执行 Round 0。
- `1.txt`、`.zcode/`、架构文档、Typora 日志和历史运行日志保持保护项，不得暂存或修改。
