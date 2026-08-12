# 第 76 轮执行 Prompt：Canonical P2-12 每日学习提醒

你是 WordLoop 当前实施 Agent。

工作目录：

D:\me\小东西\单词

日期：2026-08-12。

本 Prompt 由用户在第 74 轮 STOP 后明确索取；获得用户确认后才进入实施，prompt 本身不是执行授权。

一、唯一目标与授权边界
本轮只实施一个纵向目标：

Canonical P2-12：在设置页新增「学习提醒」区块——开关 + 时间选择 + Notification 权限申请（用户手势触发）；页面打开期间到点弹本地通知，点击聚焦窗口并跳转学习页。纯本地 Web 应用，不新增 API route、不请求任何外部域名。

本 Prompt 在用户确认后构成 P2-12 的实施授权，但不授权：

通知内快速测试（ToastFish 式，规划文档已标记为远期项）；
修改真题语料与 public/data/kaoyan-examples/；
修改红宝书源数据；
修改 Canonical；
修改 lib/backup.ts 的 store/domain；
修改 Quiz/FSRS 调度语义；
修改 daily-cloze / daily-sentence / etymology；
提升 STORAGE_VERSION / DATABASE_VERSION / BACKUP_FORMAT；
新增 AI API、调用 DeepSeek 翻译或修复真题；
修改 .zcode/ 与私有文件；
抓取、补抓或更新网络语料；
push、merge 或发布。
完成一个中文提交后立即 STOP。

指定提交信息：

feat: 增加每日学习提醒

（如实际改动内容与标题不符可微调，但必须是唯一单父中文提交）

禁止 push。

二、当前只读基线
预期现场：

分支：codex/follow-up-hardening
起始 HEAD：a1ff9485f7386628f5c769aba304c97d7df688b4
上轮提交：feat: 增加leech渐进阈值标签（P2-11，17 个文件，已完成）
相对 upstream：第 74 轮实测 ahead 12 / behind 0；本轮预期 ahead 13 / behind 0，以 Round 0 实测为准
tracked working tree：除本 prompt 文件外应无未暂存改动
index：干净
固定端口 3000：无监听；实施期间固定复用 3000，禁止换端口
lib/build-info.generated.ts workspace/HEAD blob： 4410b1880754eea8e9ee2a9263d372318efac3f3
未跟踪遗留 .zcode/、1.txt、2.txt、历轮日志与未确认研究文档存在，但不得进入本轮提交
未跟踪 Canonical 文档（第 74 轮登记 SHA-256 以实测为准）：保持原样，不读取不修改
预期 git log -8：

text
a1ff948 feat: 增加leech渐进阈值标签
afbce43 feat: 增加考研真题例句库
537dd83 feat: 增加长难句每日一句
51bbfc3 feat: 增加每日短文填词
5861425 feat: 增加AI词根拆解与助记
8fab50e feat: 增加复习趋势与30天压力图
9a34248 feat: 支持文章批量提取生词
f5efa9f feat: 支持今日任务分批学习
（其后为更早既有提交，以实测为准）
代码现场：

全库当前无 Notification API 使用（grep 零命中），本轮为首次引入；
setInterval 仅 useClock 的 60 秒时钟刷新一个先例，无其他高频定时器；
SettingsView 已有分区化区块结构（examDate 用 type="date" 输入）与 h2/h3 标题先例，设置写入路径走 page.tsx 状态 + useStudyPersistence 持久化；
StoredState 已有可选字段扩展先例（weakThresholds、leechMuted），settings 分域、备份导入/导出与恢复副本链路会携带该分域全部字段；
既有 daily-cloze 跨 UTC/本地日期边界缺陷已在文档登记，属越界项，本轮不得修复；
红宝书、真题句库属本地私有数据，P2-12 应沿用同类边界，只读不触碰。
三、Round 0：严格只读
实施前必须重新执行完整 Round 0，不得直接相信上述快照。

3.1 Git 与保护现场
检查：

powershell
git status --short --branch
git rev-parse HEAD
git branch --show-current
git rev-list --left-right --count '@{upstream}...HEAD'
git diff --name-only
git diff --cached --name-only
git log -8 --oneline --decorate
确认：

分支、HEAD 与上述基线一致；
tracked diff 和 index 均为空（除本 prompt 文件）；
现有 1.txt、2.txt、.zcode/、历史日志、调研/规划文档、favicon、爬取脚本、真题语料与派生句库等保护项保持原样；
scripts/kaoyan-corpus/ 与 public/data/kaoyan-examples/ 仍处于 .gitignore 忽略状态，未跟踪未暂存；
若出现基线之外的 tracked 修改，STOP。
运行 Start Gate。若它仅因已登记保护文件报 BLOCK，可记录后继续只读核对；若出现新的非登记路径或 tracked/index 漂移，STOP。

3.2 端口与生成文件
检查固定端口 3000、PID 归属和 build-info blob 是否与基线一致。本阶段不启动服务。

3.3 现状硬门（Delta Gate）
本轮无新语料输入，但实施前必须只读验证以下现状，缺一项即停下说明，不进入产品代码：

全库 grep 无 Notification 字样（排除 node_modules、dist、.git、生成文件）；
SettingsView 存在分区化区块结构与设置写入路径（开关类控件有先例）；
StoredState 存在可选字段扩展先例（weakThresholds、leechMuted，settings 分域、备份导入/导出与恢复副本链路）；
setInterval 仅有 useClock 时钟先例，无其他定时器模式；
page.tsx 存在视图切换入口（activeView）与 toast 提示先例；
tests/ 存在与设置/持久化相关的单测与 E2E，断言风格与既有一致；
daily-cloze 跨日期缺陷已在第 70–74 轮文档登记为越界项；
不运行任何抓取器、不访问任何外部域名。
3.4 真实调用链
至少实读：

app/components/SettingsView.tsx（区块结构、开关/输入控件与写入回调）
app/page.tsx（设置状态、activeView 视图切换、toast 提示）
app/hooks/useClock.ts（时钟节奏）
app/hooks/useStudyPersistence.ts（持久化保存/加载路径）
lib/study.ts（StoredState、可选字段归一化）
lib/storage.ts（settings 分域、备份/恢复）
lib/backup.ts（只读，确认 store/domain 列表）
scripts/manage-dev-server.ps1（服务脚本既有约定）
docs/iterations/round-71.md、round-72.md、round-73.md、round-74.md
确认现状：

设置区块的开关/输入回调走 page.tsx 状态 + 持久化保存，有可跟随的实现；
StoredState 可选字段扩展不提升版本号，备份导入/导出与恢复副本链路会携带该分域全部字段；
页面打开期间可复用的时钟节奏真实存在（useClock 60 秒）；
视图切换入口（activeView）真实存在，通知点击可复用它跳转学习页；
全库无 Notification 使用，权限申请与通知弹窗为全新代码，无既有断言依赖。
四、合规与数据保护硬约束
4.1 纯本地与零写入
提醒设置（开关、时间）是用户显式设置，唯一新增持久化字段为 studyReminder；
studyReminder 只存 { enabled: boolean; time: string }（time 为 HH:mm 本地时刻），按既有可选字段模式扩展 StoredState，沿用现有 settings 分域、备份导入/导出与恢复副本链路；
不提升 STORAGE_VERSION / DATABASE_VERSION / BACKUP_FORMAT；
不新增 object store / domain；
不请求任何外部域名，不新增 API route，不使用 Service Worker 或后台推送；
到点检查、弹通知、点击通知不写入或改变 reviews / quizAttempts / wordProgress / FSRS cards / activeSession / activeQuiz / dailyCloze / dailySentence / enrichments / senseFrequency / weak-signals（含 leechMuted）/ favorites / mistakes / lookupStats / 今日任务。
4.2 Git 边界
禁止暂存或提交：真题语料与派生句库、红宝书源数据、Canonical、.zcode/、1.txt、2.txt、历轮日志、未确认研究文档、favicon、爬取脚本；
提交只能包含本轮实际代码、测试和授权文档；
如果实现必须修改上述禁止项才能工作，STOP，报告授权缺口；不得自行扩大授权。
五、提醒契约
5.1 设置页区块
设置页新增「学习提醒」区块，包含：

开关（启用/停用提醒）；
时间选择（type="time"，本地时刻，缺省 20:00）；
权限状态与引导文案（未申请/已授权/被拒/浏览器不支持）；
「启用提醒」按钮：用户手势触发 Notification.requestPermission() 申请。
开关与时间变化立即写入 studyReminder（沿用既有设置写入路径，不做额外 debounce 发明）。

5.2 持久化字段与归一化
lib/study.ts StoredState 新增可选字段（沿用既有可选字段模式）：

ts
// lib/study.ts StoredState 新增可选字段
studyReminder?: { enabled: boolean; time: string }; // time 为 HH:mm 本地时刻
归一化要求：

enabled 只接受布尔值，非法回退 false；
time 必须匹配 /^([01]\d|2[0-3]):[0-5]\d$/，非法或缺失回退默认 "20:00"；
旧数据无该字段时完全按默认值兼容，不迁移不报错。
5.3 权限申请
权限申请必须由用户手势触发（点击「启用提醒」按钮），不得在页面加载时自动申请；
申请结果（granted / denied / default / 浏览器不支持 Notification）如实反映到区块状态文案；
重复点击申请幂等，不重复弹浏览器授权框（浏览器自身保证）。
5.4 到点检查
页面打开期间按分钟级检查（复用 useClock 的时钟节奏，不新增独立高频定时器）；
本地时刻（时:分）等于 studyReminder.time 且 enabled 时触发：
当天尚未提醒过则弹通知，同日不重复；
跨本地自然日自动重置（允许再次提醒）；
浏览器后台节流或定时器延迟导致错过整点分钟时，按「当前时刻已到达当日提醒时间且当日未提醒」判定，不追溯补弹。
5.5 通知与点击
通知标题/正文只表述中性提醒（如「到学习时间了」+ 当日待办概览不得包含掌握度结论）；
点击通知 → 聚焦窗口（window.focus()）并跳转学习页（复用 activeView 切换，无路由跳转）；
通知不可用（权限被拒/浏览器不支持）时不在页面内假装修复，区块状态如实展示；
弹通知失败不写任何学习数据，不假装成功。
5.6 权限被拒与诚实引导
权限被拒/不支持时区块显示诚实引导文案，必须包含：

纯本地应用，提醒仅在浏览器打开时生效；
浏览器可能限制后台通知，关闭页面后无法提醒；
不提供开启浏览器通知的操作指导之外的任何效果承诺。
5.7 诚实口径
提醒是「本地时刻到点提醒」，不是学习效果/掌握度/预测指标；
UI 与文档不得使用「坚持」「养成」「效果提升」「自律」等效果承诺措辞；
不得把提醒表述为后台推送、离线提醒或跨设备同步。
六、展示与交互契约
6.1 设置页区块
「学习提醒」区块标题与相邻区块一致，开关/时间/按钮均有明确标签与 aria-label；
开关状态与时间值刷新后保持（持久化生效）；
权限状态文案随真实权限变化更新，不缓存假状态。
6.2 键盘与焦点
开关、时间输入、权限按钮均可键盘访问；
焦点管理沿用设置页既有约定（Tab 顺序自然可达）。
6.3 可访问性与响应式
320px 宽度下区块内控件不横向溢出；
200% / 400% 缩放下布局不破坏；
非颜色依赖的信息表达（文案本身携带语义）；
时间输入在窄屏下可操作（浏览器原生控件降级可接受）。
6.4 误导文案禁止
不得显示：

「官方标准答案」「官方译文」；
AI 生成的中文翻译；
「已掌握」「已恢复」「长期记忆」「精通」等掌握度结论；
效果承诺（坚持/养成/提升）或来源数据没有提供的统计结论。
七、学习数据零写入边界
浏览、加载、切换、展开、到点、弹通知、点击通知或关闭提醒不得写入或改变：

reviews、quizAttempts、wordProgress、FSRS cards；
activeSession、activeQuiz、dailyCloze、dailySentence；
enrichments、senseFrequency、weak-signals（含 leechMuted）；
favorites、mistakes、lookupStats（除用户真实执行既有划词查询外）；
今日任务。
不得修改：

STORAGE_VERSION、DATABASE_VERSION、BACKUP_FORMAT；
object store/domain 列表；
lib/backup.ts；
lib/learning.ts、lib/quiz.ts；
FSRS、评分或指标口径；
daily-cloze / daily-sentence / etymology 的实现与断言。
唯一允许的写入路径：用户在设置页修改开关/时间时写入 studyReminder（enabled + time）。该字段随既有 settings 分域进入备份导入/导出与恢复副本链路，不提升任何版本号。

八、测试必须先红后绿
8.1 V1 红测
先跑既有基线：

powershell
node --experimental-strip-types --test tests/study.test.ts
确认既有用例全绿后，再补 studyReminder 新用例（先只新增断言，不新增实现，或按既有文件风格随实现同轮补齐但必须先出现真实失败），至少覆盖：

归一化：缺失字段按默认值（enabled=false、time="20:00"）；
归一化：非法 time（"25:00" / "9:5" / 非字符串）回退默认值，合法边界 "00:00" / "23:59" 保留；
归一化：enabled 非布尔回退 false；
旧数据（无 studyReminder）兼容，不迁移不报错；
分域往返：splitStoredState / combineStoredState 保留 studyReminder；
备份导出包含 studyReminder 且导入/恢复副本链路可还原；
同日不重复：同一本地自然日已提醒后不再次触发；
跨日重置：次日可再次触发；
开关切换零写入：修改 studyReminder 前后 reviews / quizAttempts / wordProgress / FSRS / 画像存储均不变。
记录红测命令、失败数量和首个真实失败原因。不得把环境错误冒充产品红测。

8.2 V2 聚焦
实现后先跑：

powershell
node --experimental-strip-types --test tests/study.test.ts
npm run typecheck
npm run lint
验收：

新用例全绿；
typecheck 通过；
lint 0 error（仅允许既有 1 个 projection.ts 未使用类型 warning）。
8.3 V3 联动 E2E
提醒相关 UI 若改动，跑 settings + 学习页跳转相关 E2E 链；不做全量无关回归扩圈。固定端口 3000，使用 scripts/manage-dev-server.ps1。

新 E2E 至少覆盖：

设置页「学习提醒」区块渲染：开关、时间输入、权限按钮存在且可键盘访问；
开关/时间修改后刷新保持（持久化生效）；
权限被拒路径：模拟 Notification.permission 为 denied 时显示诚实引导文案（含「浏览器打开时生效」）；
权限不支持路径：模拟 Notification 不存在时显示不支持文案；
到点触发：注入提醒时间后页面内出现提醒（toast 或通知），同日不重复；
点击提醒跳转学习页：activeView 切到学习视图；
320px、200% / 400% 缩放无横向溢出；
全程无外部域名请求、无 API route 调用；
开关/时间/提醒操作前后 reviews / wordProgress / FSRS / QuizAttempt 不变；
既有 settings、learning 相关 E2E 不回归。
若整组两分钟无输出，按 SOP 拆分，不降低断言。

8.4 V4 全量

powershell
npm test
npm run build
Node 单测全绿；
production build 通过；
若改动 UI，则 production smoke 验证首页与数据通路；
既有 daily-cloze 跨 UTC/本地日期边界缺陷不得修复（越界）；不得降低或改写其断言。
8.5 服务与生成文件
固定端口 3000，独立唯一日志文件并记录 PID；
验证结束精确停止本项目 PID，确认端口 3000 空闲；
所有 build/dev/smoke 完成后，将 lib/build-info.generated.ts 恢复为 HEAD blob 4410b1880754eea8e9ee2a9263d372318efac3f3；
恢复后不得再运行会生成它的命令；
不得因视觉复核阻塞已经通过自动检查的任务交付。
九、预期代码范围
允许的最大代码/文档范围：

app/components/SettingsView.tsx（仅新增「学习提醒」区块）
lib/study.ts（仅 StoredState 可选字段与归一化）
lib/storage.ts（仅 settings 分域字段）
app/page.tsx（仅提醒调度与跳转入口）
必要时 app/hooks/useStudyReminder.ts（提醒检查/通知封装，仅确需时）
tests/study.test.ts 及必要 E2E
docs/iterations/round-75.md
docs/iterations/next-round-prompt.md（本文件已预写，直接随轮暂存）
必要时 docs/project-evolution.md 与 package.json 脚本（仅确需时）
不应修改：

scripts/kaoyan-corpus/、public/data/kaoyan-examples/
红宝书源数据
Canonical
lib/backup.ts（store/domain）
lib/learning.ts、lib/quiz.ts
Quiz/FSRS 调度语义
daily-cloze / daily-sentence / etymology
STORAGE_VERSION / DATABASE_VERSION / BACKUP_FORMAT
.zcode/ 与私有文件
通知内快速测试（ToastFish 式，远期项）
如实际实现需要超出允许范围，STOP 并报告原因，不自行扩大。

十、文档
新增：

docs/iterations/round-75.md

记录：

Round 0（git/端口/build-info/Delta Gate 实测）；
提醒契约（区块、权限、到点检查、通知点击、诚实口径）；
持久化边界与归一化；
红测、V1–V4（命令、失败数、首个失败原因、通过数）；
dev/production PID 与日志；
保护文件未暂存证明；
commit 与 STOP。
更新：

docs/project-evolution.md（如确需）
docs/iterations/next-round-prompt.md（已预写，直接随轮暂存；不得改动其「后续轮次需用户重新授权和新的 Round 0」结论）
不得修改未跟踪 Canonical。

十一、精确暂存与提交
暂存前检查：

powershell
git diff --check
git diff --name-only
git diff --cached --name-only
git status --short
必须证明：

没有未暂存 tracked diff；
cached 集合精确等于本轮实际代码、测试和授权文档；
scripts/kaoyan-corpus/** 暂存数为 0；
public/data/kaoyan-examples/** 暂存数为 0；
红宝书、Canonical、.zcode/、1.txt、2.txt、日志、研究材料、favicon、爬取脚本暂存数为 0；
lib/build-info.generated.ts 与 HEAD 一致；
端口 3000 无监听。
禁止：

powershell
git add .
git add -A
只能逐路径精确 git add -- ...。

运行 PreCommit Gate。若它只因已登记保护文件报 BLOCK，必须再用 cached exact-set、tracked diff 为空和保护暂存数为 0 独立证明；出现其他 BLOCK 则停止。

创建唯一提交：

powershell
git commit -m "feat: 增加每日学习提醒"
提交后运行 Finish Gate，并确认：

起始 HEAD 到当前恰好 1 个提交；
单父提交，不是 merge；
tracked working tree 和 index 干净；
私有语料、派生句库及保护文件仍未跟踪或被忽略；
没有 push；
固定端口 3000 空闲。
十二、强制 STOP 条件
出现任一项立即 STOP：

HEAD/tracked/端口与快照不符且无法说明（Delta Gate）；
需要写 review、QuizAttempt、FSRS 或 weak-signals 画像之外的持久化（studyReminder 除外）；
需要提升 STORAGE_VERSION / DATABASE_VERSION / BACKUP_FORMAT；
需要修改 lib/backup.ts 的 store/domain；
需要修改 daily-cloze / daily-sentence / etymology；
需要进入通知内快速测试或其他未授权功能；
build-info 无法恢复；
测试只能靠降低断言通过；
保护文件被修改或暂存；
需要提交真题语料、红宝书或 Canonical；
需要新增 API route、Service Worker 或访问外部域名。
最终报告必须先给结论，再给：

commit（单父中文提交哈希与标题）；
测试计数（红测失败数及首个原因、V1–V4 通过数）；
提醒统计（如可测：当日触发次数、权限状态路径，无则如实说明）；
暂存集合（exact cached set）；
服务 PID/日志（dev/production，均已停止）；
保护现场（build-info 恢复、保护项未暂存、语料未动）；
no push；
STOP（后续轮次需用户重新授权并执行新的 Round 0）。
