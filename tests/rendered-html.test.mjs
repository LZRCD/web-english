import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function requestApp(request = new Request("http://localhost/", {
  headers: { accept: "text/html" },
})) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    request,
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
  const response = await requestApp();
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

test("红宝书词库结构符合数据契约（小型 fixture 恒校验）", async () => {
  const raw = await readFile(
    new URL("./fixtures/redbook.fixture.json", import.meta.url),
    "utf8",
  );
  const data = JSON.parse(raw);
  const words = data.words;

  assert.equal(data.metadata.title, "2027考研英语红宝书");
  assert.equal(words.length, data.metadata.total);
  assert.equal(
    Object.values(data.metadata.sectionCounts).reduce((sum, count) => sum + count, 0),
    words.length,
  );
  assert.deepEqual(
    words.map((word) => word.id),
    Array.from({ length: words.length }, (_, index) => index + 1),
  );
  assert.ok(words.every((word) => word.word && word.meaning && word.section && word.unit));
  assert.ok(words.every((word) => data.metadata.sectionCounts[word.section] !== undefined));
  assert.ok(words.every((word) => !/[\u2E80-\u2EFF\u3B35]/u.test(word.meaning)));
});

// 全量词库为私有数据产物（未随仓库提交），缺失时跳过完整校验；
// 私有数据流水线（npm run data:extract && npm run data:audit）会执行全量验证。
const fullRedbookRaw = await readFile(
  new URL("../public/data/redbook.json", import.meta.url),
  "utf8",
).catch(() => null);

test(
  "本地红宝书词库包含完整的 6550 条词目",
  { skip: fullRedbookRaw === null ? "私有全量数据未检出（public/data/redbook.json 缺失）" : false },
  async () => {
    const data = JSON.parse(fullRedbookRaw);
    const words = data.words;

    assert.equal(data.metadata.title, "2027考研英语红宝书");
    assert.equal(data.metadata.total, 6550);
    assert.equal(words.length, 6550);
    assert.deepEqual(data.metadata.sectionCounts, {
      必考词: 1856,
      基础词: 3680,
      超纲词: 1014,
    });
    assert.deepEqual(words.map((word) => word.id), Array.from({ length: 6550 }, (_, index) => index + 1));
    assert.ok(words.every((word) => word.word && word.meaning && word.section && word.unit));
    assert.equal(words[5244].word, "March");
    assert.equal(words[5244].unit, 31);
    assert.equal(words[5249].word, "May");
    assert.equal(words[5249].unit, 31);
    assert.match(words[1874].meaning, /齐步走/);
    assert.ok(words.every((word) => !/[\u2E80-\u2EFF\u3B35]/u.test(word.meaning)));
  },
);

test("ECDICT 离线辞典按首字母分片并保留音标", async () => {
  const metadata = JSON.parse(await readFile(
    new URL("../public/data/dictionary/metadata.json", import.meta.url),
    "utf8",
  ));
  const shard = JSON.parse(await readFile(
    new URL("../public/data/dictionary/i.json", import.meta.url),
    "utf8",
  ));

  assert.equal(metadata.name, "ECDICT");
  assert.ok(metadata.entries > 700000);
  assert.equal(shard.intensive[0], "intensive");
  assert.ok(shard.intensive[1]);
  assert.match(shard.intensive[2], /密集|加强|强化/);
});

test("ECDICT 支持按词头读取小范围数据", async () => {
  const rangesRaw = await readFile(
    new URL("../public/data/dictionary/ranges.json", import.meta.url),
    "utf8",
  );
  const ranges = JSON.parse(rangesRaw);
  const letterRangeRaws = await Promise.all(
    [..."abcdefghijklmnopqrstuvwxyz"].map((letter) => readFile(
      new URL(`../public/data/dictionary/ranges/${letter}.json`, import.meta.url),
      "utf8",
    )),
  );
  const letterRanges = letterRangeRaws.map(JSON.parse);
  const [file, start, end] = letterRanges
    .find((item) => item.letter === "i").ranges.int[0];
  const shard = await readFile(
    new URL(`../public/data/dictionary/${file}.json`, import.meta.url),
  );
  const fragment = JSON.parse(`{${shard.subarray(start, end + 1).toString("utf8")}}`);
  const largestRange = Math.max(
    ...letterRanges.flatMap((item) => Object.values(item.ranges))
      .flat()
      .map(([, rangeStart, rangeEnd]) => rangeEnd - rangeStart + 1),
  );

  assert.equal(ranges.version, 4);
  assert.equal(ranges.prefixLength, 3);
  assert.equal(fragment.intensive[0], "intensive");
  assert.ok(rangesRaw.length < 8_000);
  assert.ok(Math.max(...letterRangeRaws.map((raw) => raw.length)) < 64_000);
  assert.ok(largestRange < 650_000);
});

test(
  "红宝书 6550 条词目均可取得音标",
  { skip: fullRedbookRaw === null ? "私有全量数据未检出（public/data/redbook.json 缺失）" : false },
  async () => {
    const [redbookRaw, phoneticRaw] = await Promise.all([
      Promise.resolve(fullRedbookRaw),
      readFile(new URL("../public/data/phonetic-index.json", import.meta.url), "utf8"),
    ]);
    const words = JSON.parse(redbookRaw).words;
    const phonetics = JSON.parse(phoneticRaw);
    const missing = words.filter((word) =>
      !(word.phonetic || phonetics[word.word.trim().toLowerCase()]));

    assert.equal(missing.length, 0);
    assert.ok(Object.keys(phonetics).length >= 6548);
  },
);

test("全量审计保留 6550 条来源并生成 6549 个学习项", async () => {
  const raw = await readFile(
    new URL("../public/data/redbook-analysis.json", import.meta.url),
    "utf8",
  );
  const analysis = JSON.parse(raw);

  assert.equal(analysis.metadata.auditedEntries, 6550);
  assert.equal(analysis.metadata.learningItemCount, 6549);
  assert.equal(analysis.metadata.unresolvedConfirmedSourceConflicts, 0);
  assert.equal(analysis.metadata.normalizedSourceGlyphs, 878);
  assert.equal(analysis.entries["68"].relation.kind, "grammar");
  assert.equal(analysis.entries["68"].relation.independent, true);
  assert.equal(analysis.entries["2506"].correctedWord, "passersby");
  assert.equal(analysis.entries["6177"].correctedWord, "passer-by");
  assert.equal(analysis.entries["6177"].relation.canonicalId, 2506);
  assert.equal(analysis.entries["6177"].relation.independent, false);
});

test("红宝书原声音频经逐词 ASR 校对并对低置信度片段使用 TTS 回退", async () => {
  const [raw, runtimeRaw] = await Promise.all([
    readFile(
      new URL("../public/data/audio-index.json", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../public/data/audio-runtime-index.json", import.meta.url),
      "utf8",
    ),
  ]);
  const index = JSON.parse(raw);
  const runtimeIndex = JSON.parse(runtimeRaw);
  const entries = Object.entries(index.entries);

  assert.equal(index.metadata.scope, "2027 红宝书全套配套音频");
  assert.equal(index.metadata.sourceFileCount, 66);
  assert.equal(index.metadata.sourceWordCount, 6550);
  assert.equal(index.metadata.indexedWordCount, 6326);
  assert.equal(index.metadata.validation.needsReviewFileCount, 0);
  assert.equal(index.metadata.validation.fallbackWordCount, 224);
  assert.equal(index.metadata.asrValidation.checkedWordCount, 6540);
  assert.equal(index.metadata.asrValidation.verifiedOriginalCount, 6326);
  assert.equal(index.metadata.asrValidation.lowConfidenceFallbackCount, 214);
  assert.equal(entries.length, 6326);
  assert.equal(entries[0][1].file, "/audio/redbook/required-unit-01.mp3");
  assert.ok(entries.every(([, clip]) => clip.start < clip.end));
  assert.ok(entries.every(([, clip]) => clip.end - clip.start <= 6));
  assert.ok(entries.every(([, clip]) => clip.confidence === "asr-verified"));
  assert.equal(index.entries["295"], undefined);
  assert.equal(index.entries["296"], undefined);
  assert.equal(index.entries["2551"], undefined);
  assert.equal(index.entries["2552"], undefined);
  assert.equal(index.entries["1036"].file, "/audio/redbook/required-unit-15.mp3");
  assert.equal(index.entries["1114"].file, "/audio/redbook/required-unit-15.mp3");
  assert.equal(index.entries["1169"], undefined);
  assert.equal(index.entries["1174"], undefined);
  assert.equal(
    index.metadata.files.find(
      (file) => file.file === "/audio/redbook/required-unit-15.mp3",
    ).lastIndexedWord,
    "exclusive",
  );
  assert.equal(runtimeIndex.files.length, 66);
  assert.equal(Object.keys(runtimeIndex.entries).length, 6326);
  assert.ok(runtimeRaw.length < raw.length / 4);
  for (const wordId of ["1", "1036", "1114"]) {
    const [fileIndex, start, end] = runtimeIndex.entries[wordId];
    assert.deepEqual(
      { file: runtimeIndex.files[fileIndex], start, end },
      {
        file: index.entries[wordId].file,
        start: index.entries[wordId].start,
        end: index.entries[wordId].end,
      },
    );
  }
});

test("全书乱序与本地状态保存已接入学习流程", async () => {
  const [
    page,
    study,
    persistenceHook,
    enrich,
    historyView,
    settingsView,
    searchPanel,
    wordCard,
    ratingBar,
    wordAudio,
  ] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/study.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/hooks/useStudyPersistence.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/enrich/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/HistoryView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/SettingsView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/SearchPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/WordCard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/RatingBar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/word-audio.ts", import.meta.url), "utf8"),
  ]);
  const ui = [page, historyView, settingsView, searchPanel].join("\n");

  assert.match(study, /type StudyScope = "selection" \| "all"/);
  assert.match(page, /function startAllBookShuffle/);
  assert.match(page, /setStudyScope\("all"\)/);
  assert.match(page, /已打乱 \$\{learningItemCount\} 个学习项/);
  assert.match(page, /redbook-analysis\.json/);
  assert.match(wordCard, /word-relation/);
  assert.match(page, /useStudyPersistence/);
  assert.match(persistenceHook, /loadStoredState\(/);
  assert.match(persistenceHook, /persistStateSnapshot\(state\)/);
  assert.match(persistenceHook, /saveStoredState\(state\)/);
  assert.match(historyView, /buildActivityCalendar\(reviews, activityRange/);
  assert.match(page, /activityRangeLabels/);
  assert.match(historyView, /selectedActivityDate/);
  assert.match(historyView, /回到今天/);
  assert.match(study, /STORAGE_VERSION = 5/);
  assert.match(page, /function startTodaySession/);
  assert.match(page, /function startFavoriteSession/);
  assert.match(page, /function startMistakeSession/);
  assert.match(page, /buildExamPlan/);
  assert.match(wordCard, /记忆牢固度/);
  assert.match(wordCard, /下次复习/);
  assert.doesNotMatch(page, /词表来源/);
  assert.match(wordAudio, /playWordAudio/);
  assert.match(wordCard, /浏览器 TTS 回退/);
  assert.match(wordCard, /onReveal\(\);\s*onSpeak\(\);/);
  assert.match(wordCard, /aria-keyshortcuts="E"/);
  assert.match(ui, /<kbd>E<\/kbd> 内容补充/);
  assert.match(page, /function submitReinforcement/);
  assert.match(wordCard, /趁答案还在短时记忆里，再主动提取一次/);
  assert.match(ratingBar, /rating-bar visible/);
  assert.match(ui, /全局查词/);
  assert.match(ui, /导出备份/);
  assert.match(enrich, /未配置云端模型/);
  assert.match(enrich, /collocations/);
  assert.doesNotMatch(page, /CET-6|IELTS|GRE|示例词表|算法动态安排/);
});

test("详情态保留释义隐藏门控与焦点语义", async () => {
  const wordCard = await readFile(
    new URL("../app/components/WordCard.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    wordCard,
    /className="meaning-panel study-detail"[\s\S]*?tabIndex=\{-1\}/,
  );
  assert.match(wordCard, /aria-label="播放发音"/);
  assert.match(
    wordCard,
    /statusParts\.length > 0 && \(\s*<p className="detail-summary-status">/,
  );
  assert.match(
    wordCard,
    /\{\(!hideSenses \|\| sensesExpanded\) && \(\s*<>\s*\{guessFeedback\?\.kind === "correct"[\s\S]*?<div className="meaning-main">[\s\S]*?className="meaning-collapse"[\s\S]*?收起释义[\s\S]*?<\/\>\s*\)\}\s*\{kaoyanExamples\.length/,
  );
});

test("轨迹页源码顺序与渐进披露边界不依赖 CSS order", async () => {
  const [historyView, styles] = await Promise.all([
    readFile(new URL("../app/components/HistoryView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  const markers = [
    'aria-labelledby="current-status-title"',
    'aria-labelledby="weekly-report-title"',
    'aria-labelledby="review-forecast-title"',
    'aria-label="薄弱集中区"',
    'aria-labelledby="activity-title"',
    'id="recent-history-title"',
    'aria-label="近 7 日详细指标"',
    'aria-label="详细学习分析"',
  ];
  const positions = markers.map((marker) => historyView.indexOf(marker));

  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual(positions, [...positions].sort((first, second) => first - second));
  assert.match(historyView, /const recentReviews = \[\.\.\.reviews\]\.reverse\(\)\.slice\(0, 5\)/);
  assert.match(historyView, /<details className="metrics-details" aria-label="近 7 日详细指标">/);
  assert.match(historyView, /<details className="trace-details" aria-label="详细学习分析">/);
  assert.doesNotMatch(
    styles,
    /(?:\.current-status|\.weekly-report|\.forecast-panel|\.weak-concentration|\.activity-panel|\.history-panel|\.metrics-details|\.trace-details)\s*\{\s*order:/,
  );
});

test("轨迹页排程摘要、日历语义与详细指标标题去重结构守卫", async () => {
  const [historyView, styles] = await Promise.all([
    readFile(new URL("../app/components/HistoryView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  // 未来排程摘要：四个独立语义单元 + 更新后的标签文案
  assert.match(historyView, /className="forecast-summary-item"/);
  assert.match(historyView, /当前已到期/);
  assert.match(historyView, /今日待复习（含逾期）/);
  assert.match(historyView, /今起 7 个自然日待复习/);
  assert.match(historyView, /下一个复习高峰/);

  // 详细指标：summary 保留唯一标题，展开区不再有同名 h2，
  // section 通过 aria-labelledby 引用标题与时间窗口说明
  assert.match(historyView, /<span id="insights-title">近 7 日详细指标<\/span>/);
  assert.match(historyView, /aria-labelledby="insights-title insights-window-note"/);
  assert.match(historyView, /<h2 id="insights-window-note">近 7 天截至目前<\/h2>/);
  assert.doesNotMatch(historyView, /<h2 id="insights-title">/);

  // 日历格子诚实表达“不同单词数”，日期详情区分事件数与不同单词数
  assert.match(historyView, /学习 \$\{day\.count\} 个不同单词/);
  assert.match(historyView, /个不同单词 · \$\{selectedWeakCount\} 个薄弱/);

  // 布局与可访问样式守卫
  assert.match(styles, /\.forecast-summary \{[\s\S]*?repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.activity-body \{[\s\S]*?grid-template-columns: minmax\(0, max-content\) max-content/);
  assert.match(styles, /\.activity-heatmap-region \{/);
  assert.match(styles, /\.activity-heatmap-scroll \{/);
  assert.match(styles, /\.activity-grid \{[\s\S]*?grid-template-columns: repeat\(var\(--activity-columns\), minmax\(0, 12px\)\)/);
  assert.match(styles, /@media \(max-width: 1279px\) \{[\s\S]*?grid-template-columns: minmax\(0, max-content\)/);
  assert.match(styles, /@media \(max-width: 767px\) \{[\s\S]*?\.activity-heatmap-scroll \{[\s\S]*?overflow-x: auto/);
  assert.match(styles, /\.activity-scroll \{[\s\S]*?padding: 24px 26px 20px;[\s\S]*?\}/);
  assert.doesNotMatch(styles, /\.activity-scroll \{\s*[^}]*overflow-x: auto/);
  assert.match(historyView, /className="activity-heatmap-region"/);
  assert.match(historyView, /className="activity-heatmap-scroll"/);
  assert.match(historyView, /--activity-columns/);
  assert.match(historyView, /const activityColumns = Math\.ceil\(activityDays\.length \/ 7\)/);
  assert.match(styles, /\.activity-cell:focus-visible \{/);
  assert.match(styles, /\.weak-concentration-row \{[\s\S]*?grid-template-columns: 96px minmax\(0, 1fr\) 190px 96px/);
  assert.match(styles, /\.activity-detail-head > button \{[\s\S]*?width: 40px/);
});
