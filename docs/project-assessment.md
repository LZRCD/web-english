# 词环 WordLoop 项目评估

> 评估日期：2026-07-29

## 总体评价

个人项目里做得非常扎实。数据持久层、FSRS 间隔复习、音频管线、测试覆盖远超个人项目平均水平。

---

## 技术栈

| 层 | 技术 | 版本 |
|---|---|---|
| 框架 | Next.js (App Router) | 16.2.6 |
| UI | React (client components) | 19.2.6 |
| 样式 | Tailwind CSS | 4.2.1 |
| 语言 | TypeScript (strict) | 5.9.3 |
| 构建 | Vite → Vinext | 8.0.13 |
| 部署 | Cloudflare Workers | - |
| FSRS | ts-fsrs | 5.4.1 |
| 测试 | Node test runner + Playwright | 1.62.0 |
| AI | DeepSeek API | - |
| 音频 | 浏览器 SpeechSynthesis + MP3 片段 | - |
| 存储 | IndexedDB（主）+ localStorage（备） | - |
| 词典 | ECDICT（离线，按首字母分片） | - |

---

## 架构

单页客户端渲染（`"use client"`），API 路由仅用于 DeepSeek 代理调用。

### 目录结构

```
├── app/
│   ├── page.tsx                  # 主页面（2041行，50+ useState）
│   ├── globals.css               # 全部样式（3345行）
│   ├── layout.tsx                # 根布局
│   ├── api/                      # coach / enrich / lookup
│   ├── components/               # 9个组件
│   └── hooks/                    # 4个自定义 hook
├── lib/                          # 纯函数业务逻辑
│   ├── learning.ts               # FSRS 引擎、学习会话
│   ├── study.ts                  # 数据模型、存储解析、迁移
│   ├── storage.ts                # IndexedDB 抽象
│   ├── backup.ts                 # 版本化 JSON 备份
│   ├── recovery.ts               # 恢复副本管理
│   └── ...
├── tests/                        # 7个单元测试 + 4个 E2E
├── scripts/                      # 数据管线（红宝书提取/审计/音频索引）
├── public/data/                  # 静态数据
├── docs/                         # 设计文档
└── worker/                       # Cloudflare Worker
```

---

## 亮点

### 1. 数据可靠性（做得最好）

- IndexedDB + localStorage 双轨写入，单调递增 revision 版本号乐观锁
- 写入前读取 revision、写入时 double-check、冲突时保存恢复副本
- `parseStoredState` 逐字段完整性校验：日期合法性、数值范围、语义约束（lapses ≤ reps）、FSRS 卡片一致性
- 损坏卡片的**选择性重建**，不影响其他正常数据
- 跨标签页 BroadcastChannel 同步 + 顺序写入队列防竞态
- localStorage 回退使用 Web Locks API 保证原子写入
- 自动备份（最多5个，轮转），导入/重置前自动保护快照

### 2. 学习算法

- `ts-fsrs` v5.4.1，目标记忆保留率 0.90
- 四种评分：忘记（1分钟）/ 模糊（6分钟）/ 认识（10分钟）/ 熟练（8天）——仅首次，FSRS 后续动态调整
- 今日任务队列：到期复习优先 → 新词填充（跳过今日已学的同词族词）
- 自适应新词量：复习积压超阈值时自动减少新词，设有最低下限
- 顽固词检测：30天内 3次"忘记"或 5次低评分 → 自动标记；连续3次成功或30天无低评分解除
- 考研日期规划：四阶段（基础期→强化期→冲刺期→临考期），最后15%天数纯复习
- 支持撤销评分（Z键），5秒内完整状态恢复

### 3. 音频处理

- 66个红宝书原版 MP3/MP4 逐词切割，生成 6326 个音频片段
- Whisper Tiny + Base + CMU 音素三级交叉验证
- 224个低置信度/缺失单词 → 浏览器 TTS 自动回退
- `#t=start,end` 片段 URL + `ontimeupdate` 精确播放控制

### 4. 功能完整度

- 6种学习模式：顺序、单元乱序、全书乱序、今日任务、强化复习、自由学习
- 个人词本：收藏 / 错词 / 顽固词 / 划词集
- 全局搜索：中英文 + ID 匹配，多选创建专项学习
- AI 记忆教练（DeepSeek）+ 单词富化（例句/搭配），失败时本地回退
- 划词查词：离线 ECDICT → 红宝书 → AI 三级回退
- 学习轨迹：日历热力图 + 详细记录 + 连续学习追踪
- 学习洞察：7日正确率、平均回忆时间、复习预测
- 完全离线可用（核心学习不依赖服务器）
- 响应式布局（侧栏/底部栏切换）

### 5. 测试覆盖

- 7个单元测试套件（~1600行）：评分/撤销/迁移/数据完整性/并发/备份/会话
- 4个 Playwright E2E：学习流程/跨标签页冲突/数据导入恢复/视觉回归
- 红宝书数据完整性测试（6550词、异体字规范化、字典结构）

---

## 需关注的问题

| 问题 | 严重度 | 说明 |
|------|--------|------|
| `page.tsx` 1689行（原2041） | ⚠️→🟢 改善中 | 已提取 4 个 hook（useAiCoach/useAudio/useSearch/useClock）、2 个组件（WordCard/RatingBar），减少 352 行 |
| `globals.css` 3345行 | ⚠️ 中 | 无组件级样式隔离。Tailwind 已安装可用，新组件计划使用 utility class |
| ref 同步手工维护 | 🟢 已修复 | ✅ 已创建 `useSyncedRefs` 泛型工具 hook，消除 12 个手动 ref + 1 个 useLayoutEffect |
| `tsconfig.tsbuildinfo` 145KB | 🟢 已修复 | ✅ `.gitignore` 已有 `*.tsbuildinfo` |
| API 路由无输入校验 | 🔵 低 | 仅 DeepSeek 代理，个人使用无风险 |

---

## 改进记录（2026-07-29）

### 已完成 ✅

1. **拆分 `page.tsx`**：提取了 6 个独立模块
   - `app/hooks/useSyncedRefs.ts` — 泛型 ref 同步工具
   - `app/hooks/useClock.ts` — 每分钟更新的时钟
   - `app/hooks/useSearch.ts` — 搜索面板状态 + 焦点陷阱
   - `app/hooks/useAudio.ts` — 音频播放（预录音频 + TTS 回退）
   - `app/hooks/useAiCoach.ts` — AI 记忆教练状态 + API 调用
   - `app/components/RatingBar.tsx` — 评分按钮栏（纯展示）
   - `app/components/WordCard.tsx` — 单词卡片（~230 行 JSX 提取）
   - page.tsx: 2041 → 1689 行

2. **ref 同步机械化**：`useSyncedRefs` 泛型工具，消除手动 ref 同步模式

3. **tsconfig.tsbuildinfo**：`.gitignore` 已包含 `*.tsbuildinfo`

### 待定

- **CSS 模块化**：Tailwind v4 已安装可用，现有语义化 class + CSS 自定义属性方案稳定，大规模迁移性价比不高。新组件可渐进使用 Tailwind 工具类。
