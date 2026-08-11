import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildKaoyanRelease,
  extractPaperSentences,
  findExactSurfaceMatches,
  normalizeLf,
  publishKaoyanRelease,
  splitEnglishSentences,
  validateCorpusInput,
  verifyKaoyanRelease,
} from "../scripts/build-kaoyan-examples.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const privateCorpus = path.join(root, "scripts", "kaoyan-corpus");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function paperIdentity(id) {
  const year = Number(id.slice(0, 4));
  if (/^\d{4}$/.test(id)) {
    return {
      year,
      title: `考研英语（旧卷） ${year}年 · 真题整卷`,
      paperType: "old",
    };
  }
  const one = id.endsWith("-english-one");
  return {
    year,
    title: `考研英语${one ? "一" : "二"} ${year}年 · 真题整卷`,
    paperType: one ? "english-one" : "english-two",
  };
}

function paperMarkdown({ id, body, newline = "\n" }) {
  const { title } = paperIdentity(id);
  const sourceUrl = `https://english-exam.lazynote.cn/kaoyan/paper/${id}/`;
  return [
    `# ${title}`,
    "",
    `- 来源：${sourceUrl}`,
    "- 站点：懒笔记（english-exam.lazynote.cn）",
    "",
    "## 全卷构成",
    "",
    "- Section II Reading Comprehension",
    "",
    "## 客观题参考答案速查",
    "",
    "**阅读理解**",
    "",
    "1 A · 2 B",
    "",
    "## 整卷试卷排版（全文）",
    "",
    body,
    "",
  ].join(newline);
}

async function makeFixture({ papers, words, analysisEntries = {} }) {
  const base = await mkdtemp(path.join(os.tmpdir(), "wordloop-kaoyan-test-"));
  const corpusDir = path.join(base, "corpus");
  const papersDir = path.join(corpusDir, "papers");
  const outputDir = path.join(base, "output");
  const redbookPath = path.join(base, "redbook.json");
  const analysisPath = path.join(base, "redbook-analysis.json");
  await mkdir(papersDir, { recursive: true });
  const manifestPapers = [];
  for (const paper of papers) {
    const identity = paperIdentity(paper.id);
    const newline = paper.newline ?? "\n";
    const markdown = paperMarkdown({ ...paper, newline });
    await writeFile(path.join(papersDir, `${paper.id}.md`), markdown, "utf8");
    manifestPapers.push({
      id: paper.id,
      url: `https://english-exam.lazynote.cn/kaoyan/paper/${paper.id}/`,
      title: identity.title,
      exam_type: "考研英语",
      sections: 3,
      answer_rows: 1,
      text_chars: normalizeLf(paper.body).trim().length,
      html_bytes: 1234,
    });
  }
  await writeFile(path.join(corpusDir, "manifest.json"), `${JSON.stringify({
    source: "https://english-exam.lazynote.cn/kaoyan/",
    fetched_at: "2026-08-11T21:06:46+08:00",
    robots_txt: "https://english-exam.lazynote.cn/robots.txt",
    papers: manifestPapers,
    failures: [],
  }, null, 2)}\n`, "utf8");
  await writeFile(redbookPath, `${JSON.stringify({
    metadata: { total: words.length, learningItemCount: words.length },
    words,
  }, null, 2)}\n`, "utf8");
  await writeFile(analysisPath, `${JSON.stringify({
    metadata: { auditedEntries: words.length },
    entries: analysisEntries,
  }, null, 2)}\n`, "utf8");
  return { base, corpusDir, outputDir, redbookPath, analysisPath };
}

async function cleanup(fixture) {
  await rm(fixture.base, { recursive: true, force: true });
}

const READING_BODY = [
  "# 考研英语一 · 英语一真题 · 2024年",
  "",
  "### Section I Use of English",
  "Directions: Choose the best word for each numbered blank.",
  "The market 〔1〕 rapidly while the choices remain uncertain.",
  "1. [A] expands  [B] expansion  [C] expanded  [D] expanding",
  "",
  "### Section II Reading Comprehension",
  "Directions: Read the following four texts and answer the questions.",
  "",
  "**Text 1**",
  "Dr. Smith measured 3.14 carefully. The market can't reward careless guesses.",
  "Researchers (who checked the result) agreed that evidence-based work matters!",
  "21. Which claim best summarizes the text?",
  "[A] A short option without useful context.",
  "",
  "Directions: For questions 41-45, choose the most suitable paragraph from A-G.",
  "Writer: (41)〔占位符这是等待完型填空的句子位置〕",
  "A reliable framework helps readers connect evidence across difficult passages.",
  "",
  "### Section III Translation",
  "Directions: Translate the following text into Chinese.",
  "Innovation often depends on patient research, and careful teams preserve useful evidence.",
  "",
  "### Section IV Writing",
  "Directions: Write an essay about research and innovation.",
  "A model answer must never enter the generated library.",
].join("\n");

test("私有语料硬门：当前输入为 46/46 且正文长度、身份和来源一致", {
  skip: !(await import("node:fs")).existsSync(privateCorpus),
}, async () => {
  const validated = await validateCorpusInput(privateCorpus);
  assert.equal(validated.papers.length, 46);
  assert.equal(validated.failures.length, 0);
  assert.equal(validated.sourceFiles.length, 46);
  assert.equal(validated.sourceFiles.reduce((sum, item) => sum + item.bytes, 0), 1_147_770);
  assert.equal(validated.corpusManifestSha256, "0f89e538bb57699188b0d4224c59a84f20b01b2402bf6ab2a27118dadec6c373");
  assert.deepEqual(
    validated.papers.reduce((counts, paper) => ({
      ...counts,
      [paper.paperType]: (counts[paper.paperType] ?? 0) + 1,
    }), {}),
    { old: 12, "english-one": 17, "english-two": 17 },
  );
});

test("语料校验拒绝缺失、额外、重复和 URL/ID 身份冲突", async (t) => {
  const fixture = await makeFixture({
    papers: [{ id: "2024-english-one", body: READING_BODY }],
    words: [{ id: 1, word: "research", meaning: "研究" }],
  });
  t.after(() => cleanup(fixture));

  const manifestPath = path.join(fixture.corpusDir, "manifest.json");
  const original = JSON.parse(await readFile(manifestPath, "utf8"));
  await rm(path.join(fixture.corpusDir, "papers", "2024-english-one.md"));
  await assert.rejects(() => validateCorpusInput(fixture.corpusDir), /缺少试卷文件/);

  await writeFile(
    path.join(fixture.corpusDir, "papers", "2024-english-one.md"),
    paperMarkdown({ id: "2024-english-one", body: READING_BODY }),
    "utf8",
  );
  await writeFile(path.join(fixture.corpusDir, "papers", "extra.md"), "extra", "utf8");
  await assert.rejects(() => validateCorpusInput(fixture.corpusDir), /额外试卷文件/);
  await rm(path.join(fixture.corpusDir, "papers", "extra.md"));

  await writeFile(manifestPath, JSON.stringify({
    ...original,
    papers: [original.papers[0], original.papers[0]],
  }), "utf8");
  await assert.rejects(() => validateCorpusInput(fixture.corpusDir), /重复.*id/i);

  await writeFile(manifestPath, JSON.stringify({
    ...original,
    papers: [{
      ...original.papers[0],
      url: "https://english-exam.lazynote.cn/kaoyan/paper/2024-english-two/",
    }],
  }), "utf8");
  await assert.rejects(() => validateCorpusInput(fixture.corpusDir), /URL.*身份|身份.*URL/i);
});

test("正文边界、CRLF/LF、句子切分和过滤规则保持确定", () => {
  assert.equal(normalizeLf("a\r\nb\rc"), "a\nb\nc");
  assert.deepEqual(
    splitEnglishSentences("Dr. Smith measured 3.14 carefully. \"Results improved!\" (Teams agreed.)"),
    [
      "Dr. Smith measured 3.14 carefully.",
      "\"Results improved!\"",
      "(Teams agreed.)",
    ],
  );
  const lf = extractPaperSentences(READING_BODY);
  const crlf = extractPaperSentences(READING_BODY.replaceAll("\n", "\r\n"));
  assert.deepEqual(crlf, lf);
  assert.ok(lf.some((item) => item.section === "reading" && item.sentence.includes("can't reward")));
  assert.ok(lf.some((item) => item.section === "new-type" && item.sentence.startsWith("A reliable framework")));
  assert.ok(lf.some((item) => item.section === "translation" && item.sentence.startsWith("Innovation often")));
  for (const item of lf) {
    assert.doesNotMatch(item.sentence, /Directions:|\〔[^〕]*\〕|^\d+\.|^\[[A-D]\]|model answer/i);
    assert.ok(READING_BODY.includes(item.sentence));
    assert.ok(item.tokenCount >= 6 && item.tokenCount <= 40);
  }
});

test("词条匹配只接受完整表面词形，保留撇号和连字符，不做词干归并", () => {
  assert.deepEqual(findExactSurfaceMatches(
    "Research can't replace careful re-search, and researchers remain distinct.",
    "research",
  ), ["Research"]);
  assert.deepEqual(findExactSurfaceMatches("Teams can't co-operate without trust.", "can't"), ["can't"]);
  assert.deepEqual(findExactSurfaceMatches("Teams can co-operate without shortcuts.", "co-operate"), ["co-operate"]);
  assert.deepEqual(findExactSurfaceMatches("Researchers researched it.", "research"), []);
});

test("构建结果使用真实 wordId，按年份/卷型/偏移排序并去重限三条", async (t) => {
  const sentence = (label) => `${label} research helps careful teams preserve reliable evidence across difficult projects.`;
  const papers = [
    { id: "2008", body: `### Section II Reading Comprehension\n${sentence("Old")}` },
    { id: "2023-english-two", body: `### Section II Reading Comprehension\n${sentence("Two")}` },
    { id: "2024-english-one", body: `### Section II Reading Comprehension\n${sentence("One")}\n${sentence("One")}` },
    { id: "2025-english-two", body: `### Section III Translation\n${sentence("Newest")}` },
  ];
  const fixture = await makeFixture({
    papers,
    words: [
      { id: 7, word: "research", meaning: "研究" },
      { id: 8, word: "researchers", meaning: "研究人员" },
      { id: 9, word: "preserve", meaning: "保存" },
    ],
  });
  t.after(() => cleanup(fixture));
  const release = await buildKaoyanRelease(fixture);
  const research = release.examples.filter((item) => item.wordId === 7);
  assert.equal(research.length, 3);
  assert.deepEqual(research.map((item) => item.year), [2025, 2024, 2023]);
  assert.deepEqual(research.map((item) => item.paperType), ["english-two", "english-one", "english-two"]);
  assert.ok(research.every((item) => item.word === "research" && item.matchedText.toLowerCase() === "research"));
  assert.equal(release.examples.filter((item) => item.wordId === 8).length, 0);
  assert.ok(release.examples.some((item) => item.wordId === 9));
  assert.ok(release.examples.every((item) => /^[0-9a-f]{24}$/.test(item.id)));
});

test("连续构建字节一致，来源与输出哈希可校验", async (t) => {
  const fixture = await makeFixture({
    papers: [{ id: "2024-english-one", body: READING_BODY }],
    words: [
      { id: 1, word: "research", meaning: "研究" },
      { id: 2, word: "evidence", meaning: "证据" },
      { id: 3, word: "innovation", meaning: "创新" },
    ],
  });
  t.after(() => cleanup(fixture));
  const first = await buildKaoyanRelease(fixture);
  const second = await buildKaoyanRelease(fixture);
  assert.deepEqual(first.files, second.files);
  for (const [name, content] of Object.entries(first.files)) {
    if (name === "manifest.json") continue;
    const prefix = Object.entries(first.manifest.releaseFiles).find(([, file]) => file === name)?.[0];
    assert.equal(sha256(content), first.manifest.shardHashes[prefix]);
    assert.equal(Buffer.byteLength(content), first.manifest.shardBytes[prefix]);
  }
  await publishKaoyanRelease(fixture.outputDir, first);
  const checked = await verifyKaoyanRelease(fixture);
  assert.equal(checked.contentVersion, first.manifest.contentVersion);
});

test("首字母 shard 超限时拆为两字符前缀且每片仍受上限约束", async (t) => {
  const body = [
    "### Section II Reading Comprehension",
    "Alpha research gives careful readers enough evidence to compare difficult claims.",
    "Amber research gives patient readers enough evidence to evaluate difficult claims.",
    "Beta research gives cautious readers enough evidence to assess difficult claims.",
  ].join("\n");
  const fixture = await makeFixture({
    papers: [{ id: "2024-english-one", body }],
    words: [
      { id: 1, word: "alpha", meaning: "alpha" },
      { id: 2, word: "amber", meaning: "amber" },
      { id: 3, word: "beta", meaning: "beta" },
    ],
  });
  t.after(() => cleanup(fixture));
  const release = await buildKaoyanRelease({ ...fixture, maxShardBytes: 900 });
  assert.equal(release.manifest.releaseFiles.a, undefined);
  assert.ok(release.manifest.releaseFiles.al);
  assert.ok(release.manifest.releaseFiles.am);
  assert.ok(Object.values(release.manifest.shardBytes).every((bytes) => bytes <= 900));
});

test("发布失败不会留下半套输出，check 会拒绝篡改后的分片", async (t) => {
  const fixture = await makeFixture({
    papers: [{ id: "2024-english-one", body: READING_BODY }],
    words: [{ id: 1, word: "research", meaning: "研究" }],
  });
  t.after(() => cleanup(fixture));
  const release = await buildKaoyanRelease(fixture);
  await publishKaoyanRelease(fixture.outputDir, release);
  const manifestBefore = await readFile(path.join(fixture.outputDir, "manifest.json"), "utf8");
  await assert.rejects(
    () => publishKaoyanRelease(fixture.outputDir, {
      ...release,
      files: { ...release.files, "broken.json": undefined },
    }),
    /输出|内容|buffer|string/i,
  );
  assert.equal(await readFile(path.join(fixture.outputDir, "manifest.json"), "utf8"), manifestBefore);

  const shardName = Object.values(release.manifest.releaseFiles)[0];
  await writeFile(path.join(fixture.outputDir, shardName), "{}\n", "utf8");
  await assert.rejects(() => verifyKaoyanRelease(fixture), /哈希|不一致|determin/i);
});
