# 第 67 轮：Canonical P0-4 今日任务会话分段

- 日期：2026-08-11
- 分支 / 起始 HEAD：`codex/follow-up-hardening` / `4ef807542d4c9ec923aaa94ddea15c4b9c5e3019`
- 批次：Canonical P0-4 独立纵向批次；第 1/1 轮
- 状态：完成，STOP

## 目标与边界

- 今日任务继续由既有 `buildTodayTaskPreview` 生成唯一完整剩余队列；新增每批 5 / 10 / 15 / 20 词设置，默认 10，只控制一次会话长度。
- 批次只从完整队列头部截取，不复制到期、补漏、新词的排序或配额规则；完整队列非空时只表示“本批已完成”，完整队列清空后才表示“今日任务已完成”。
- 当前 `activeSession` 保存创建时的真实 word ID、顺序和 index；批中刷新或修改设置都不重排、扩容或缩短当前批次，设置只影响下一批。
- 未修改 FSRS、四档评分、每日新词目标、考频、弱信号、红宝书源数据或其他会话来源；未新增 store/domain，未提升状态版本。

## 队列、跨批与兼容口径

- `buildTodaySessionBatch` 只对完整预览的 `wordIds` 做一次 `slice(0, sessionBatchSize)`，并以本批真实长度估算时间；完整剩余数量与完成态仍来自预览。
- 已在当天评分的精确 word ID 不再因进度投影短暂落后而重新进入新词候选；同词族当天错开规则保持。每日剩余新词目标为 0 时不再额外加入一个新词。
- 旧状态缺少 `sessionBatchSize`、字段类型错误或值不在 5 / 10 / 15 / 20 时统一回退到 10；合法值经 IndexedDB 分域、备份、导入、恢复副本、兼容存储和清空保留链往返。
- 今日会话进行期间不再动态追加新到期词，以保证批次快照稳定；完成当前批后，下一批重新从同一个完整队列派生，届时才纳入最新剩余事实。

## 实现与修改文件

- `lib/learning.ts`：批次类型与纯派生函数、当天已评分精确排除、零新词上限修正和剩余队列文案。
- `lib/study.ts`、`lib/storage.ts`：设置默认值、合法值归一化及既有分域/备份持久化链。
- `app/page.tsx`：完整剩余与本批双层预览、按批创建今日会话、下一批动作和当前批稳定性。
- `app/components/SettingsView.tsx`、`app/components/SessionCompleteView.tsx`、`app/globals.css`：每批设置、本批/今日完成语义和窄屏布局。
- `tests/study.test.ts`、`tests/data-integrity.test.ts`：默认值、边界、跨批、不重复、快照与持久化纯行为覆盖。
- `tests/e2e/today-session-batches.spec.mjs` 及相关 fixture/helper/预览/恢复/并发/数据生命周期用例：真实交互和兼容回归。
- `docs/iterations/round-67.md`、`docs/project-evolution.md`、`docs/iterations/next-round-prompt.md`：本轮证据与停止检查点。

## 验证

| 级别 / 命令 | 结果 | 耗时与说明 |
|---|---|---|
| V1 / `node --experimental-strip-types --test tests/study.test.ts tests/study-session.test.ts tests/data-integrity.test.ts` | 76/76 | 测试器约 0.761 秒；覆盖批次、默认值、跨批、快照与持久化 |
| V1 / `npm run typecheck` | 通过 | 最终约 3.1 秒 |
| V2 / `npm run lint` | 0 error / 1 个既有 warning | 最终约 8.2 秒；`projection.ts` 未使用类型 warning 与本轮无关 |
| V2 / `npm run test:unit` | 275/275 | 测试器约 0.846 秒 |
| V3 / `tests/e2e/today-session-batches.spec.mjs` | 3/3 | 最终约 11.7 秒；默认 10、5 词跨批、批中刷新与设置变化均通过 |
| V3 / 今日任务 + 恢复 + 并发 + 数据生命周期 | 16/16 | 31.6 秒；旧定位器因新增说明文字产生歧义后收紧到精确标题，未改变产品语义或阈值 |
| V3 / `tests/e2e/responsive.spec.mjs` | 4/4 | 5.9 秒；320px、200% / 400% 缩放与学习顶栏通过 |
| V0 / `git diff --check` | 通过 | 仅有 Git 的 LF/CRLF 工作区提示，无空白错误 |

- E2E 使用真实“揭示答案”与四档评分按钮完成两批，证明批间 word ID 不重复，第一批后显示真实剩余，最后一批后才显示今日完成。
- 默认 10 词创建的批次实际只含 10 个 word ID；选择 5 后两批各为 5，320px 设置页与完成页均无横向溢出。
- 批中评分到 index 2 后改设置并刷新，原 word ID、顺序、index、createdAt 均保持；完成后下一批才采用新设置。
- 并发用例证明较旧标签页写入不会覆盖权威设置；导入、恢复副本、IndexedDB 异常与 localStorage 兼容路径均保留合法批次设置。

## 服务、生成文件与未执行项

- Round 0 确认固定端口 3000 无监听；分支与起始 HEAD 精确匹配，tracked/index 干净。门禁只列出既知受保护未跟踪文件，均保持未修改、未暂存。
- 统一脚本启动 worker PID 37568、listener PID 11880，独立日志 `.wordloop-runtime/rounds/dev-20260811-154822.out.log`；E2E 后精确停止 worker，最终状态为 `STOPPED | port 3000 is free`。
- dev 改写的 `lib/build-info.generated.ts` 已恢复为起始 HEAD 内容，未进入本轮 diff。
- 未运行 `npm test`、production build、production smoke 或全目录 E2E：本轮没有依赖、构建链、API、schema/version/store/domain 变化，V1 + V2 + 针对持久化与 UI 风险的精选 V3 已覆盖本轮边界。

## 提交与停止

- 只精确暂存上述产品代码、测试和三份迭代文档；`1.txt`、`2.txt`、`.zcode/`、日志、调研/Canonical/架构文档、favicon 与爬取脚本保持未修改、未暂存。
- 中文提交信息：`feat: 支持今日任务分批学习`；不在提交前预猜 hash。
- Canonical P0-4 已完成，单轮批次达到 1/1；提交后 STOP，不自动进入 P0-5，不 push。
