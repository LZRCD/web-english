# 第 66 轮：Canonical P0-2 词汇量测试

- 日期：2026-08-11
- 分支 / 起始 HEAD：`codex/follow-up-hardening` / `055dc706bb839abbe784db35e5f0e3eeba0fcaae`
- 批次：Canonical P0-2 独立纵向批次；第 1/1 轮
- 状态：完成，STOP

## 目标与边界

- 从首次欢迎页和词本页顶部进入纯本地词汇量测试，通过红宝书词序分层、自适应选层和“认识 / 不认识”自评估算三个分册及总词汇量。
- 结果中的“不认识”只保存在当前测试组件内存；只有用户点击“一键补漏学习”后，才以真实红宝书 word ID 创建 `vocab-test` 临时学习会话。
- 不调用 AI/API，不持久化测试答案或报告，不新增 schema/version/store/domain，不改 FSRS、评分、今日队列、考频或红宝书源数据。

## 抽样、自适应与估算口径

- 候选只取 `isPrimaryLearningWord` 认可的红宝书主学习项。原书仍有 6550 条来源，经既有合并规则后实际可抽样学习项为 6549；不伪造缺失候选。
- 必考、基础、超纲各自保持现有词序，每 100 个学习项一层；每个访问层按可注入 seed 确定性抽 3 个不同 ID。三个分册最多访问 6 / 11 / 3 层，对应 18 / 33 / 9 题，正常共 60 题；小分册与不足 3 词的末层按真实数据降级。
- 每个分册从中间层开始。同层至少 2 个“认识”时从更高的未访问层继续，否则从更低的未访问层继续；方向耗尽后选择最接近当前估算边界的未访问层。会话内层和 word ID 均不重复。
- 分册估算以已访问层的实际答案寻找误差最小的单调掌握边界，再按分册层数映射到 1856 / 3680 / 1014，并分别夹取到官方对照范围；总量夹取到 0～6550。该数字只表示分层抽样自评估算，不表示学习完成、FSRS 掌握或考研达标。

## 实现与修改文件

- `lib/vocab-test.ts`：分层、固定 seed 抽样、自适应选层、会话推进、估算与“不认识”ID 去重的纯函数。
- `app/components/VocabTestView.tsx`：只显示英文词的覆盖测试视图、进度、两键作答、结果、重测、退出和补漏入口。
- `app/components/WelcomeScreen.tsx`、`app/components/WordbookView.tsx`、`app/page.tsx`、`app/globals.css`：双入口、焦点恢复、背景 inert、320px 响应式与页面集成。
- `lib/learning.ts`、`lib/study.ts`：新增兼容旧数据的 `vocab-test` 会话来源与恢复白名单，来源显示“词汇量测试补漏”。
- `tests/vocab-test.test.ts`、`tests/e2e/vocab-test.spec.mjs`、`package.json`：纯行为单测、精选 E2E 和显式单测入口。
- `docs/iterations/round-66.md`、`docs/project-evolution.md`、`docs/iterations/next-round-prompt.md`：本轮记录与停止检查点。

## 验证

| 级别 / 命令 | 结果 | 耗时与说明 |
|---|---|---|
| V1 / `node --experimental-strip-types --test tests/vocab-test.test.ts tests/study.test.ts tests/study-session.test.ts tests/session-summary.test.ts` | 70/70 | 测试器约 0.304 秒；覆盖抽样、自适应、估算、恢复和来源 |
| V1 / `npm run typecheck` | 通过 | 最终约 3.3 秒 |
| V2 / `npm run lint` | 0 error / 1 个既有 warning | 最终约 7.8 秒；`projection.ts` 未使用类型 warning 与本轮无关 |
| V2 / `npm run test:unit` | 269/269 | 测试器约 0.849 秒；新文件已加入显式列表 |
| V3 / `tests/e2e/vocab-test.spec.mjs` | 2/2 | 最终 9.0 秒；首次 1/2 仅因测试 locator 固定欢迎页第一步标题，改用稳定容器后通过，未改产品语义 |
| V3 / onboarding + responsive + vocab-test | 8/8 | 17.2 秒；欢迎页、词本四 tab、学习页与 320px 回归通过 |

- E2E 证明欢迎页进入测试不会完成引导或生成会话；作答前只显示英文词；60 题后展示三分册与总估算、免责声明和真实补漏数量。
- 点击补漏前 reviews、word-progress、mistakes 均为 0；点击后创建 `vocab-test` 会话且学习卡来源准确，用户评分前仍不产生 FSRS 或薄弱证据。
- 退出测试恢复欢迎页或原词本 tab，并把焦点还给原触发按钮；测试题、结果页和词本入口在 320px 下 document/body 均无横向溢出。

## 服务、生成文件与未执行项

- Round 0 的受限只读检查显示 3000 无监听；实际启动时提升后的统一脚本发现旧项目 `vinext dev` 监听 PID 47404，但无当前管理状态。核对命令行与父链后只清理本项目旧 PID 47404 / 8500 / 7408 / 44844，没有批量结束 Node。
- 统一脚本随后启动 worker PID 37560、listener PID 21796，日志 `.wordloop-runtime/rounds/dev-20260811-142724.out.log`；E2E 后由同一脚本精确停止，最终 3000 空闲。
- dev 改写的 `lib/build-info.generated.ts` 已恢复为起始 HEAD 内容，未进入本轮 diff。
- 未运行 `npm test`、production build、production smoke 或全目录 E2E：本轮没有依赖、构建链、API、schema 或持久化结构变化，V1 + V2 + 精选 V3 已覆盖本轮风险边界。

## 提交与停止

- 只精确暂存上述产品代码、测试、必要 CSS/package 脚本和三份迭代文档；`1.txt`、`2.txt`、`.zcode/`、日志、调研/Canonical/架构文档、favicon 与爬取脚本保持未修改、未暂存。
- 中文提交信息：`feat: 增加本地词汇量测试`；不在提交前预猜 hash。
- Canonical P0-2 已完成，单轮批次达到 1/1；提交后 STOP，不自动进入 P0-3 每日学习提醒，不 push。
