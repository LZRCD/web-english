# 第 70 轮完成 Prompt：Canonical P1-7 AI 词根拆解与助记

## 当前状态

- Canonical P1-7 已完成：学习卡揭示区支持用户显式生成、缓存和重新生成 AI 词根拆解与记忆联想。
- 实施报告：`docs/iterations/round-70.md`。
- AI 内容明确标注“AI 助记 · 非词源考据”，不是权威历史词源、教材官方内容或真题词源。
- 单轮批次达到 1/1，STOP；不自动进入 P1-9、P1-8、P2-11、提醒、真题语料或其他目标，不 push。

## 已完成契约

1. 新增唯一 `/api/etymology`，复用现有 Provider、api-guard、超时、重试、JSON 解析和密钥缺失处理；无本地伪 AI 200 fallback。
2. 结构化内容只含 breakdown/root/affixes/mnemonic，严格 trim、裁剪、数组数量和 kind 枚举；缺少必填字段时整体拒绝缓存。
3. etymology 缓存版本固定为 schemaVersion 1、promptVersion `etymology-v1`，inputKey 确定性包含真实 wordId、word、meaning、root 和 relation 语义；旧版本、旧 prompt 或输入变化时不显示为当前结果。
4. 缓存只作为 `WordEnrichment.etymology?` 进入既有 enrichments 域；分域快照、IndexedDB、localStorage 兼容、备份导入/导出、恢复与清空保留均完整往返。
5. etymology 写入保留例句、音标、翻译、搭配、义项目标、source/verified；后续整体/单条例句生成也保留 etymology。失败与非法响应不覆盖旧合法缓存。
6. 降级顺序为当前有效 AI 缓存 → 本地 relation 词族轨道或 root-only 本地词根提示 → 无增强内容；无本地线索且 AI 失败时不生成虚构卡片。
7. 只在揭示释义后由用户点击生成，无首屏、切词、预加载、恢复或批量自动请求，无新增快捷键；原生按钮支持 Tab、Enter/Space。
8. AI 区域有稳定可访问名称与 aria-busy，失败有文本 alert，构词片段不只靠颜色；320px、200% 与 400% 缩放验证通过。
9. 未修改 FSRS、QuizMode/QuizAttempt、评分、撤销、排程、ReviewEvent/Kind、SessionKind、红宝书 root/relation、考频数据或 Provider 协议。
10. `STORAGE_VERSION = 5`、`DATABASE_VERSION = 3`、备份格式和既有 stores/domain 均未改变；`lib/storage.ts`、`lib/backup.ts` 未修改。

## 验证现场

- 红测按预期因缺少 `lib/etymology.ts` 失败；最终聚焦 74/74，typecheck 通过，lint 0 error / 1 个既有 warning，`git diff --check` 通过。
- 新 etymology E2E 3/3；etymology、learning、data-lifecycle、responsive 联跑 33/33。
- `npm test` production build 通过并识别 `/api/etymology`，全量 Node 300/300；production smoke 验证首页激活、静态资源、6550 词、音频索引和 Range 206。
- dev worker/listener PID 11076/23548，production worker/listener PID 41196/41196；两种服务均精确停止，固定端口 3000 已释放。
- build-info 已恢复为起始 HEAD blob `4410b1880754eea8e9ee2a9263d372318efac3f3`；Canonical SHA-256 保持 `334108484E19A792F9C5DAD2E50BC644EF4F0AB3097B45EDAD43A4267C1DA90F`。

## 等待规则

- P1-7 已完成并停止，当前检查点不构成 P1-9 或任何其他路线图目标的实施授权。
- P1-9 必须由用户重新授权，并从新的 Round 0 开始重新核对分支/HEAD、tracked/index、保护文件、Provider/缓存/恢复链与端口归属。
