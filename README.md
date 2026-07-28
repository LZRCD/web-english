# 词环 WordLoop

面向个人使用的 2027 考研英语红宝书 AI 背词网站。词库、学习记录、错词和收藏均保存在本机，不需要公开部署。

## 当前功能

- 收录红宝书 6550 条原书词目：必考词 1856、基础词 3680、超纲词 1014
- 全量词形审计后生成 6549 个独立学习项；同源变体共享进度，独立词义仍单独学习
- 支持按分组、单元顺序学习
- 支持当前范围乱序和全书 6549 个学习项乱序
- 四档主动回忆评分，低评分自动进入错词记录
- 个人词本、错词重学和本地学习轨迹
- 真实今日完成、连续学习、到期复习统计；背诵日历可切换 20 周、半年或一年并查看每日详情
- 按分组、单元和乱序会话分别保存学习进度
- v3 版本化本地数据迁移，自动清理旧示例记录并合并确认过的同源变体
- 学习页显示人工确认的词族轨道，AI 教练同步遵守词形关系
- DeepSeek AI 记忆教练；密钥缺失或调用失败时使用本地提示

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

## DeepSeek

复制 `.env.example` 为 `.env.local`，填写本地密钥：

```env
DEEPSEEK_API_KEY=
OPENAI_BASE_URL=https://api.deepseek.com
OPENAI_MODEL=deepseek-v4-flash
```

不要把真实密钥写入 `.env.example` 或提交到 Git。

## 检查命令

```bash
npm run lint
npm run build
npm test
```
