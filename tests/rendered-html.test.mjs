import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("服务端渲染词环红宝书加载页", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /<title>词环 WordLoop｜2027 红宝书 AI 伴学<\/title>/);
  assert.match(html, /正在读取 6550 个考研词汇/);
  assert.match(html, /全书/);
  assert.doesNotMatch(
    html,
    /\b(?:CET-6|IELTS|GRE)\b|Starter Project|Your site is taking shape/i,
  );
});

test("本地红宝书词库包含完整的 6550 条词目", async () => {
  const raw = await readFile(
    new URL("../public/data/redbook.json", import.meta.url),
    "utf8",
  );
  const data = JSON.parse(raw);
  const words = data.words;

  assert.equal(data.metadata.title, "2027考研英语红宝书");
  assert.equal(data.metadata.total, 6550);
  assert.equal(words.length, 6550);
  assert.deepEqual(data.metadata.sectionCounts, {
    必考词: 1856,
    基础词: 3680,
    超纲词: 1014,
  });
  assert.equal(new Set(words.map((word) => word.id)).size, 6550);
  assert.ok(words.every((word) => word.word && word.meaning && word.section && word.unit));
});

test("全量审计保留 6550 条来源并生成 6549 个学习项", async () => {
  const raw = await readFile(
    new URL("../public/data/redbook-analysis.json", import.meta.url),
    "utf8",
  );
  const analysis = JSON.parse(raw);

  assert.equal(analysis.metadata.auditedEntries, 6550);
  assert.equal(analysis.metadata.learningItemCount, 6549);
  assert.equal(analysis.metadata.unresolvedConfirmedSourceConflicts, 0);
  assert.equal(analysis.entries["68"].relation.kind, "grammar");
  assert.equal(analysis.entries["68"].relation.independent, true);
  assert.equal(analysis.entries["2506"].correctedWord, "passersby");
  assert.equal(analysis.entries["6177"].correctedWord, "passer-by");
  assert.equal(analysis.entries["6177"].relation.canonicalId, 2506);
  assert.equal(analysis.entries["6177"].relation.independent, false);
});

test("全书乱序与本地状态保存已接入学习流程", async () => {
  const [page, study, coach] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/study.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/coach/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(study, /type StudyScope = "selection" \| "all"/);
  assert.match(page, /function startAllBookShuffle/);
  assert.match(page, /setStudyScope\("all"\)/);
  assert.match(page, /已打乱 \$\{learningItemCount\} 个学习项/);
  assert.match(page, /redbook-analysis\.json/);
  assert.match(page, /word-relation/);
  assert.match(page, /localStorage\.setItem\(STORAGE_KEY/);
  assert.match(page, /buildActivityCalendar\(reviews, activityRange/);
  assert.match(page, /activityRangeLabels/);
  assert.match(page, /selectedActivityDate/);
  assert.match(page, /回到今天/);
  assert.match(study, /STORAGE_VERSION = 3/);
  assert.match(coach, /AbortSignal\.timeout\(15000\)/);
  assert.doesNotMatch(page, /CET-6|IELTS|GRE|示例词表|算法动态安排/);
});
