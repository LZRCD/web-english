import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BODY_MARKER = "## 整卷试卷排版（全文）";
const CORPUS_SOURCE = "https://english-exam.lazynote.cn/kaoyan/";
const SOURCE_URL_PREFIX = "https://english-exam.lazynote.cn/kaoyan/paper/";
const PAPER_TYPES = new Set(["old", "english-one", "english-two"]);
const SECTIONS = new Set(["reading", "new-type", "translation"]);
const PAPER_TYPE_ORDER = { old: 0, "english-one": 1, "english-two": 2 };
const ENGLISH_TOKEN = /[A-Za-z]+(?:['’\-‐‑‒–—][A-Za-z]+)*/g;
const DEFAULT_MAX_SHARD_BYTES = 512 * 1024;

export { DEFAULT_MAX_SHARD_BYTES };

function fail(message) {
  throw new Error(message);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function normalizeLf(value) {
  return value.replace(/\r\n?/g, "\n");
}

function parseJson(buffer, label) {
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch (error) {
    fail(`${label} 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`);
  }
}

function identityForPaperId(id) {
  const old = /^(199[8-9]|200[0-9])$/.exec(id);
  if (old) {
    const year = Number(old[1]);
    return {
      year,
      paperType: "old",
      title: `考研英语（旧卷） ${year}年 · 真题整卷`,
    };
  }
  const current = /^(20(?:1[0-9]|2[0-6]))-english-(one|two)$/.exec(id);
  if (!current) fail(`试卷 id 身份无效：${id}`);
  const year = Number(current[1]);
  const paperType = `english-${current[2]}`;
  return {
    year,
    paperType,
    title: `考研英语${current[2] === "one" ? "一" : "二"} ${year}年 · 真题整卷`,
  };
}

function strictString(value, label) {
  if (typeof value !== "string" || !value.trim()) fail(`${label} 必须是非空字符串`);
  return value;
}

function strictNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${label} 必须是非负安全整数`);
  return value;
}

function exactlyOnce(text, marker, label) {
  const first = text.indexOf(marker);
  if (first < 0 || text.indexOf(marker, first + marker.length) >= 0) {
    fail(`${label} 必须且只能包含一个“${marker}”标记`);
  }
  return first;
}

export async function validateCorpusInput(corpusDir) {
  const manifestPath = path.join(corpusDir, "manifest.json");
  const papersDir = path.join(corpusDir, "papers");
  let manifestBuffer;
  try {
    manifestBuffer = await readFile(manifestPath);
  } catch {
    fail(`语料 manifest 缺失：${manifestPath}`);
  }
  const manifest = parseJson(manifestBuffer, "语料 manifest");
  if (!isPlainObject(manifest)) fail("语料 manifest 顶层必须是对象");
  if (manifest.source !== CORPUS_SOURCE) fail("语料 manifest source 不符合登记来源");
  strictString(manifest.fetched_at, "语料 manifest fetched_at");
  if (!Array.isArray(manifest.papers) || !manifest.papers.length) {
    fail("语料 manifest papers 必须是非空数组");
  }
  if (!Array.isArray(manifest.failures)) fail("语料 manifest failures 必须是数组");
  if (manifest.failures.length) fail(`语料 manifest 仍有 ${manifest.failures.length} 个 failures`);

  const ids = new Set();
  const urls = new Set();
  for (const paper of manifest.papers) {
    if (!isPlainObject(paper)) fail("语料 manifest paper 必须是对象");
    const id = strictString(paper.id, "试卷 id");
    const url = strictString(paper.url, `${id} URL`);
    if (ids.has(id)) fail(`语料 manifest 存在重复 id：${id}`);
    if (urls.has(url)) fail(`语料 manifest 存在重复 URL：${url}`);
    ids.add(id);
    urls.add(url);
  }

  let filenames;
  try {
    filenames = (await readdir(papersDir)).filter((name) => name.endsWith(".md")).sort();
  } catch {
    fail(`试卷目录缺失：${papersDir}`);
  }
  const fileIds = new Set(filenames.map((name) => name.slice(0, -3)));
  const missing = [...ids].filter((id) => !fileIds.has(id));
  const extra = [...fileIds].filter((id) => !ids.has(id));
  if (missing.length) fail(`缺少试卷文件：${missing.join("、")}`);
  if (extra.length) fail(`存在额外试卷文件：${extra.join("、")}`);

  const papers = [];
  const sourceFiles = [];
  for (const source of manifest.papers) {
    const identity = identityForPaperId(source.id);
    const expectedUrl = `${SOURCE_URL_PREFIX}${source.id}/`;
    if (source.url !== expectedUrl) fail(`${source.id} URL 与 id 身份冲突`);
    if (source.title !== identity.title) fail(`${source.id} 标题与 id 身份冲突`);
    strictNonNegativeInteger(source.text_chars, `${source.id} text_chars`);

    const paperPath = path.join(papersDir, `${source.id}.md`);
    const paperBuffer = await readFile(paperPath);
    const markdown = normalizeLf(paperBuffer.toString("utf8"));
    if (!markdown.startsWith(`# ${identity.title}\n`)) fail(`${source.id} 文件标题不一致`);
    if (!markdown.includes(`- 来源：${expectedUrl}`)) fail(`${source.id} 缺少精确来源 URL`);
    const markerIndex = exactlyOnce(markdown, BODY_MARKER, source.id);
    const body = markdown.slice(markerIndex + BODY_MARKER.length).trim();
    if (body.length !== source.text_chars) {
      fail(`${source.id} 正文长度不一致：${body.length} != ${source.text_chars}`);
    }
    const sourceHash = sha256(paperBuffer);
    sourceFiles.push({
      paperId: source.id,
      sha256: sourceHash,
      bytes: paperBuffer.byteLength,
    });
    papers.push({
      id: source.id,
      sourceUrl: source.url,
      title: source.title,
      year: identity.year,
      paperType: identity.paperType,
      body,
      sha256: sourceHash,
      bytes: paperBuffer.byteLength,
    });
  }

  return {
    source: manifest.source,
    fetchedAt: manifest.fetched_at,
    failures: manifest.failures,
    corpusManifestSha256: sha256(manifestBuffer),
    sourceFiles,
    papers,
  };
}

const ABBREVIATIONS = new Set([
  "dr", "mr", "mrs", "ms", "prof", "sr", "jr", "st", "vs", "etc",
  "e.g", "i.e", "fig", "no", "nos", "dept", "inc", "ltd", "u.s", "u.k",
]);

function isDotBoundary(text, index) {
  const previous = text[index - 1] ?? "";
  const next = text[index + 1] ?? "";
  if (/\d/.test(previous) && /\d/.test(next)) return false;
  const before = text.slice(Math.max(0, index - 12), index);
  const token = before.match(/(?:[A-Za-z]\.)*[A-Za-z]+$/)?.[0]?.toLowerCase();
  if (token && ABBREVIATIONS.has(token)) return false;
  if (/^[A-Za-z]$/.test(previous) && /^[A-Za-z]$/.test(next)) return false;
  if (/(?:[A-Za-z]\.){1,}[A-Za-z]$/.test(before)) return false;
  return true;
}

function nextNonSpace(text, index) {
  for (let cursor = index; cursor < text.length; cursor += 1) {
    if (!/\s/.test(text[cursor])) return cursor;
  }
  return text.length;
}

export function splitEnglishSentences(value) {
  const text = normalizeLf(value);
  const sentences = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (![".", "!", "?"].includes(character)) continue;
    if (character === "." && !isDotBoundary(text, index)) continue;
    while (index + 1 < text.length && /[.!?]/.test(text[index + 1])) index += 1;
    while (index + 1 < text.length && /["'”’\)\]}]/.test(text[index + 1])) index += 1;
    const after = nextNonSpace(text, index + 1);
    if (after < text.length && !/["'“‘(\[{A-Z0-9]/.test(text[after])) continue;
    const sentence = text.slice(start, index + 1).trim();
    if (sentence) sentences.push(sentence);
    start = after;
    index = Math.max(index, after - 1);
  }
  const tail = text.slice(start).trim();
  if (tail) sentences.push(tail);
  return sentences;
}

function sentenceTokens(sentence) {
  return sentence.match(ENGLISH_TOKEN) ?? [];
}

function filterReason(sentence) {
  const tokens = sentenceTokens(sentence);
  if (tokens.length < 6) return "tooFewTokens";
  if (tokens.length > 40) return "tooManyTokens";
  if (sentence.length > 500) return "tooLong";
  if (!/[.!?]["'”’\)\]}]*$/.test(sentence)) return "missingTerminalPunctuation";
  if (/\〔[^〕]*\〕|_{2,}|＿{2,}|\.{4,}/.test(sentence)) return "placeholder";
  if (/\[[A-H]\]|［[A-H]］|\[图片|<\/?[A-Za-z][^>]*>|```|~~~/.test(sentence)) return "markupOrOption";
  if (/^\s*(?:\d{1,3}[.)]|Questions?\s+\d+|Section\s+[IVX]+|Part\s+[A-Z]|Text\s+\d+)/i.test(sentence)) {
    return "labelOrQuestion";
  }
  if (/\b(?:ANSWER SHEET|choose the best|mark your answer|write your answer|translate the following|read the following)\b/i.test(sentence)) {
    return "instruction";
  }
  if (/\b(?:model answer|sample essay|参考答案|解析|范文)\b/i.test(sentence)) return "answerOrAnalysis";
  const firstLetter = sentence.match(/[A-Za-z]/)?.[0];
  if (!firstLetter || firstLetter !== firstLetter.toUpperCase()) return "incomplete";
  return undefined;
}

function classifyHeading(line, current) {
  if (/^###\s+Section\s+I\b/i.test(line)) return null;
  if (/^###\s+Section\s+II\b/i.test(line)) return "reading";
  if (/^###\s+Section\s+(?:III|IV)\s+Translation\b/i.test(line)) return "translation";
  if (/^###\s+Section\s+(?:III|IV)\s+Writing\b/i.test(line)) return null;
  return current;
}

function directionSection(line, current) {
  if (/\btranslat(?:e|ion)\b/i.test(line)) return "translation";
  if (
    current === "reading"
    && /(?:41\s*[-–]\s*45|questions?\s+41|paragraphs?|subheadings?|numbered (?:gaps|items|parts)|list\s+[A-H][\s-]*[A-H]|statements?)/i.test(line)
  ) return "new-type";
  return current;
}

function isStructuralLine(line) {
  return !line
    || /^#{1,6}\s/.test(line)
    || /^\*\*(?:Text\s+\d+|Part\s+[A-Z])\*\*$/i.test(line)
    || /^\s*\d{1,3}[.)]\s/.test(line)
    || /^\s*[［\[]\s*[A-H]\s*[\]］]/.test(line)
    || /\〔[^〕]*\〕/.test(line)
    || /^>/.test(line)
    || /^```|^~~~|^\[图片/.test(line)
    || /^<[^>]+>$/.test(line);
}

function extractPaperSentencesWithStats(body) {
  const text = normalizeLf(body);
  const lines = text.split("\n");
  const blocks = [];
  const filteredReasons = {};
  let section = null;
  let offset = 0;
  let block;

  const flush = () => {
    if (block) blocks.push(block);
    block = undefined;
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (/^###\s+Section\b/i.test(trimmed)) {
      flush();
      section = classifyHeading(trimmed, section);
      offset += rawLine.length + 1;
      continue;
    }
    if (/^Directions:/i.test(trimmed)) {
      flush();
      section = directionSection(trimmed, section);
      filteredReasons.instructionLine = (filteredReasons.instructionLine ?? 0) + 1;
      offset += rawLine.length + 1;
      continue;
    }
    if (!section || isStructuralLine(trimmed)) {
      flush();
      if (trimmed) filteredReasons.structuralLine = (filteredReasons.structuralLine ?? 0) + 1;
      offset += rawLine.length + 1;
      continue;
    }
    const leading = rawLine.indexOf(trimmed);
    if (!block || block.section !== section) {
      flush();
      block = {
        section,
        offset: offset + Math.max(0, leading),
        text: rawLine.slice(Math.max(0, leading)),
      };
    } else {
      block.text += `\n${rawLine.slice(Math.max(0, leading))}`;
    }
    offset += rawLine.length + 1;
  }
  flush();

  const examples = [];
  let candidateSentenceCount = 0;
  for (const currentBlock of blocks) {
    let searchFrom = 0;
    for (const sentence of splitEnglishSentences(currentBlock.text)) {
      candidateSentenceCount += 1;
      const localOffset = currentBlock.text.indexOf(sentence, searchFrom);
      if (localOffset >= 0) searchFrom = localOffset + sentence.length;
      const reason = filterReason(sentence);
      if (reason) {
        filteredReasons[reason] = (filteredReasons[reason] ?? 0) + 1;
        continue;
      }
      examples.push({
        sentence,
        section: currentBlock.section,
        offset: currentBlock.offset + Math.max(0, localOffset),
        tokenCount: sentenceTokens(sentence).length,
      });
    }
  }
  return { examples, candidateSentenceCount, filteredReasons };
}

export function extractPaperSentences(body) {
  return extractPaperSentencesWithStats(body).examples;
}

function surfacePattern(word) {
  const normalized = word.trim();
  if (!normalized) return null;
  let source = "";
  for (const character of normalized) {
    if (/[A-Za-z0-9]/.test(character)) source += character;
    else if (/[\s]/.test(character)) source += "\\s+";
    else if (/['’]/.test(character)) source += "['’]";
    else if (/[-‐‑‒–—]/.test(character)) source += "[-‐‑‒–—]";
    else source += character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`(?<![A-Za-z0-9'’\\-])${source}(?![A-Za-z0-9'’\\-])`, "giu");
}

export function findExactSurfaceMatches(sentence, word) {
  const pattern = surfacePattern(word);
  if (!pattern) return [];
  return [...sentence.matchAll(pattern)].map((match) => match[0]);
}

function firstSurfaceToken(word) {
  return word.match(ENGLISH_TOKEN)?.[0]?.toLowerCase() ?? "";
}

async function loadRedbook(redbookPath, analysisPath) {
  const redbook = parseJson(await readFile(redbookPath), "红宝书");
  if (!isPlainObject(redbook) || !Array.isArray(redbook.words) || !redbook.words.length) {
    fail("红宝书 words 必须是非空数组");
  }
  let analysisEntries = {};
  if (analysisPath) {
    try {
      const analysis = parseJson(await readFile(analysisPath), "红宝书审计数据");
      if (!isPlainObject(analysis) || !isPlainObject(analysis.entries)) {
        fail("红宝书审计 entries 必须是对象");
      }
      analysisEntries = analysis.entries;
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        fail(`红宝书审计数据缺失：${analysisPath}`);
      }
      throw error;
    }
  }
  const ids = new Set();
  const words = redbook.words.map((item) => {
    if (!isPlainObject(item) || !Number.isSafeInteger(item.id) || item.id <= 0) {
      fail("红宝书 wordId 必须是正安全整数");
    }
    if (ids.has(item.id)) fail(`红宝书存在重复 wordId：${item.id}`);
    ids.add(item.id);
    const corrected = analysisEntries[String(item.id)]?.correctedWord;
    const word = typeof corrected === "string" && corrected.trim()
      ? corrected.trim()
      : strictString(item.word, `wordId ${item.id} word`).trim();
    return {
      id: item.id,
      word,
      firstToken: firstSurfaceToken(word),
      pattern: surfacePattern(word),
    };
  });
  return words;
}

function normalizedSentenceKey(sentence) {
  return sentence.replace(/\s+/g, " ").trim().toLowerCase();
}

function recordId(record) {
  return sha256(Buffer.from(JSON.stringify([
    record.wordId,
    normalizedSentenceKey(record.sentence),
    record.year,
    record.paperType,
    record.paperId,
    record.section,
    record.sourceUrl,
  ]))).slice(0, 24);
}

function sortRecords(first, second) {
  return second.year - first.year
    || PAPER_TYPE_ORDER[first.paperType] - PAPER_TYPE_ORDER[second.paperType]
    || first.paperId.localeCompare(second.paperId, "en")
    || first.offset - second.offset
    || first.wordId - second.wordId
    || first.sentence.localeCompare(second.sentence, "en");
}

function shardLetters(word) {
  const letters = word.toLowerCase().match(/[a-z]/g)?.join("") ?? "";
  if (!letters) fail(`词条无法生成 shard 前缀：${word}`);
  return letters.padEnd(2, letters[0]).slice(0, 2);
}

function buildShardContent(prefix, records) {
  const examplesByWordId = {};
  for (const record of records) {
    const key = String(record.wordId);
    if (!examplesByWordId[key]) examplesByWordId[key] = [];
    examplesByWordId[key].push(record);
  }
  return stableJson({ schemaVersion: 1, prefix, examplesByWordId });
}

function planShards(examples, maxShardBytes) {
  if (!Number.isSafeInteger(maxShardBytes) || maxShardBytes <= 0) {
    fail("maxShardBytes 必须是正安全整数");
  }
  const byLetter = new Map();
  for (const example of examples) {
    const prefix = shardLetters(example.word)[0];
    const current = byLetter.get(prefix) ?? [];
    current.push(example);
    byLetter.set(prefix, current);
  }
  const planned = new Map();
  for (const [letter, records] of [...byLetter.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const content = buildShardContent(letter, records);
    if (Buffer.byteLength(content) <= maxShardBytes) {
      planned.set(letter, content);
      continue;
    }
    const split = new Map();
    for (const record of records) {
      const prefix = shardLetters(record.word);
      const current = split.get(prefix) ?? [];
      current.push(record);
      split.set(prefix, current);
    }
    for (const [prefix, splitRecords] of [...split.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const splitContent = buildShardContent(prefix, splitRecords);
      const bytes = Buffer.byteLength(splitContent);
      if (bytes > maxShardBytes) {
        fail(`shard ${prefix} 拆分后仍超限：${bytes} > ${maxShardBytes}`);
      }
      planned.set(prefix, splitContent);
    }
  }
  return planned;
}

function strictExample(record) {
  if (!isPlainObject(record)) fail("例句记录必须是对象");
  if (!/^[0-9a-f]{24}$/.test(record.id)) fail("例句 id 无效");
  if (!Number.isSafeInteger(record.wordId) || record.wordId <= 0) fail("例句 wordId 无效");
  strictString(record.word, "例句 word");
  strictString(record.matchedText, "例句 matchedText");
  strictString(record.sentence, "例句 sentence");
  if (!Number.isSafeInteger(record.year) || record.year < 1998 || record.year > 2026) fail("例句 year 无效");
  if (!PAPER_TYPES.has(record.paperType)) fail("例句 paperType 无效");
  identityForPaperId(record.paperId);
  if (!SECTIONS.has(record.section)) fail("例句 section 无效");
  if (record.sourceUrl !== `${SOURCE_URL_PREFIX}${record.paperId}/`) fail("例句 sourceUrl 无效");
  return record;
}

function validateBuiltShard(content, prefix, expectedHash, expectedBytes) {
  if (Buffer.byteLength(content) !== expectedBytes) fail(`shard ${prefix} 字节数不一致`);
  if (sha256(content) !== expectedHash) fail(`shard ${prefix} 哈希不一致`);
  const shard = parseJson(Buffer.from(content), `shard ${prefix}`);
  if (!isPlainObject(shard) || shard.schemaVersion !== 1 || shard.prefix !== prefix) {
    fail(`shard ${prefix} 结构无效`);
  }
  if (!isPlainObject(shard.examplesByWordId)) fail(`shard ${prefix} examplesByWordId 无效`);
  for (const [wordId, records] of Object.entries(shard.examplesByWordId)) {
    if (!/^\d+$/.test(wordId) || !Array.isArray(records) || records.length < 1 || records.length > 3) {
      fail(`shard ${prefix} 词条列表无效`);
    }
    for (const record of records) {
      strictExample(record);
      if (String(record.wordId) !== wordId) fail(`shard ${prefix} wordId 键不一致`);
    }
  }
}

function validateReleaseObject(release) {
  if (!isPlainObject(release) || !isPlainObject(release.manifest) || !isPlainObject(release.files)) {
    fail("输出 release 结构无效");
  }
  const manifest = release.manifest;
  if (manifest.schemaVersion !== 1 || !/^[0-9a-f]{16}$/.test(manifest.contentVersion)) {
    fail("输出 manifest 版本无效");
  }
  for (const [name, content] of Object.entries(release.files)) {
    if (typeof content !== "string" && !Buffer.isBuffer(content)) {
      fail(`输出文件 ${name} 内容必须是 string 或 Buffer`);
    }
    if (path.basename(name) !== name) fail(`输出文件名无效：${name}`);
  }
  const manifestContent = release.files["manifest.json"];
  if (typeof manifestContent !== "string" || JSON.stringify(JSON.parse(manifestContent)) !== JSON.stringify(manifest)) {
    fail("输出 manifest 内容与对象不一致");
  }
  for (const [prefix, filename] of Object.entries(manifest.releaseFiles)) {
    if (!/^[a-z]{1,2}$/.test(prefix) || !new RegExp(`^${prefix}\\.[0-9a-f]{16}\\.json$`).test(filename)) {
      fail(`输出 shard 文件名无效：${filename}`);
    }
    const content = release.files[filename];
    if (typeof content !== "string") fail(`输出 shard 缺失：${filename}`);
    validateBuiltShard(content, prefix, manifest.shardHashes[prefix], manifest.shardBytes[prefix]);
  }
  const expectedNames = new Set(["manifest.json", ...Object.values(manifest.releaseFiles)]);
  const extraNames = Object.keys(release.files).filter((name) => !expectedNames.has(name));
  if (extraNames.length) fail(`输出包含未登记文件：${extraNames.join("、")}`);
}

export async function buildKaoyanRelease({
  corpusDir = path.join(root, "scripts", "kaoyan-corpus"),
  redbookPath = path.join(root, "public", "data", "redbook.json"),
  analysisPath = path.join(root, "public", "data", "redbook-analysis.json"),
  maxShardBytes = DEFAULT_MAX_SHARD_BYTES,
} = {}) {
  const corpus = await validateCorpusInput(corpusDir);
  const words = await loadRedbook(redbookPath, analysisPath);
  const wordsByFirstToken = new Map();
  for (const word of words) {
    if (!word.firstToken || !word.pattern) continue;
    const current = wordsByFirstToken.get(word.firstToken) ?? [];
    current.push(word);
    wordsByFirstToken.set(word.firstToken, current);
  }

  const rawRecords = [];
  let candidateSentenceCount = 0;
  let sourceSentenceCount = 0;
  const filteredReasons = {};
  for (const paper of corpus.papers) {
    const extracted = extractPaperSentencesWithStats(paper.body);
    candidateSentenceCount += extracted.candidateSentenceCount;
    sourceSentenceCount += extracted.examples.length;
    for (const [reason, count] of Object.entries(extracted.filteredReasons)) {
      filteredReasons[reason] = (filteredReasons[reason] ?? 0) + count;
    }
    for (const candidate of extracted.examples) {
      const firstTokens = new Set(sentenceTokens(candidate.sentence).map((token) => token.toLowerCase()));
      const possibleWords = new Map();
      for (const token of firstTokens) {
        for (const word of wordsByFirstToken.get(token) ?? []) possibleWords.set(word.id, word);
      }
      for (const word of possibleWords.values()) {
        word.pattern.lastIndex = 0;
        const match = word.pattern.exec(candidate.sentence);
        if (!match) continue;
        const internal = {
          wordId: word.id,
          word: word.word,
          matchedText: match[0],
          sentence: candidate.sentence,
          year: paper.year,
          paperType: paper.paperType,
          paperId: paper.id,
          section: candidate.section,
          sourceUrl: paper.sourceUrl,
          offset: candidate.offset,
        };
        rawRecords.push({ ...internal, id: recordId(internal) });
      }
    }
  }

  rawRecords.sort(sortRecords);
  const perWord = new Map();
  const seen = new Set();
  for (const record of rawRecords) {
    const duplicateKey = `${record.wordId}:${normalizedSentenceKey(record.sentence)}`;
    if (seen.has(duplicateKey)) continue;
    seen.add(duplicateKey);
    const current = perWord.get(record.wordId) ?? [];
    if (current.length >= 3) continue;
    current.push(record);
    perWord.set(record.wordId, current);
  }
  const examples = [...perWord.values()]
    .flat()
    .sort((first, second) => first.wordId - second.wordId || sortRecords(first, second))
    .map((record) => strictExample({
      id: record.id,
      wordId: record.wordId,
      word: record.word,
      matchedText: record.matchedText,
      sentence: record.sentence,
      year: record.year,
      paperType: record.paperType,
      paperId: record.paperId,
      section: record.section,
      sourceUrl: record.sourceUrl,
    }));

  const plannedShards = planShards(examples, maxShardBytes);
  const files = {};
  const releaseFiles = {};
  const shardHashes = {};
  const shardBytes = {};
  for (const [prefix, content] of plannedShards) {
    const hash = sha256(content);
    const filename = `${prefix}.${hash.slice(0, 16)}.json`;
    releaseFiles[prefix] = filename;
    shardHashes[prefix] = hash;
    shardBytes[prefix] = Buffer.byteLength(content);
    files[filename] = content;
  }

  const byPaperType = {};
  const byYear = {};
  for (const item of examples) {
    byPaperType[item.paperType] = (byPaperType[item.paperType] ?? 0) + 1;
    byYear[String(item.year)] = (byYear[String(item.year)] ?? 0) + 1;
  }
  const coveredWordCount = perWord.size;
  const manifestCore = {
    schemaVersion: 1,
    corpusSource: corpus.source,
    corpusFetchedAt: corpus.fetchedAt,
    corpusManifestSha256: corpus.corpusManifestSha256,
    sourceFiles: corpus.sourceFiles,
    releaseFiles,
    shardHashes,
    shardBytes,
    paperCount: corpus.papers.length,
    sourceSentenceCount,
    exampleCount: examples.length,
    coveredWordCount,
    uncoveredWordCount: words.length - coveredWordCount,
    statistics: {
      candidateSentenceCount,
      validSentenceCount: sourceSentenceCount,
      filteredReasons,
      byPaperType,
      byYear,
    },
  };
  const contentVersion = sha256(Buffer.from(JSON.stringify(manifestCore))).slice(0, 16);
  const manifest = {
    schemaVersion: 1,
    contentVersion,
    ...Object.fromEntries(Object.entries(manifestCore).filter(([key]) => key !== "schemaVersion")),
  };
  files["manifest.json"] = stableJson(manifest);
  const release = { manifest, files, examples };
  validateReleaseObject(release);
  return release;
}

async function pathExists(value) {
  try {
    await access(value);
    return true;
  } catch {
    return false;
  }
}

async function validateDirectoryAgainstRelease(directory, release) {
  validateReleaseObject(release);
  const names = (await readdir(directory)).sort();
  const expectedNames = Object.keys(release.files).sort();
  if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
    fail(`输出文件集合不一致：${names.join("、")}`);
  }
  for (const name of expectedNames) {
    const actual = await readFile(path.join(directory, name));
    const expected = Buffer.from(release.files[name]);
    if (!actual.equals(expected)) fail(`输出文件内容不一致：${name}`);
  }
}

export async function publishKaoyanRelease(outputDir, release) {
  validateReleaseObject(release);
  const parent = path.dirname(outputDir);
  await mkdir(parent, { recursive: true });
  const tempDir = await mkdtemp(path.join(parent, `.${path.basename(outputDir)}.tmp-`));
  let backupDir;
  try {
    for (const [name, content] of Object.entries(release.files)) {
      await writeFile(path.join(tempDir, name), content);
    }
    await validateDirectoryAgainstRelease(tempDir, release);
    if (await pathExists(outputDir)) {
      backupDir = `${outputDir}.backup-${process.pid}-${Date.now()}`;
      await rename(outputDir, backupDir);
    }
    try {
      await rename(tempDir, outputDir);
    } catch (error) {
      if (backupDir && await pathExists(backupDir) && !(await pathExists(outputDir))) {
        await rename(backupDir, outputDir);
        backupDir = undefined;
      }
      throw error;
    }
    if (backupDir) {
      await rm(backupDir, { recursive: true, force: true });
      backupDir = undefined;
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
    if (backupDir && await pathExists(backupDir) && !(await pathExists(outputDir))) {
      await rename(backupDir, outputDir);
    }
  }
}

export async function verifyKaoyanRelease({ outputDir, ...buildOptions } = {}) {
  if (!outputDir) fail("check 需要 outputDir");
  const expected = await buildKaoyanRelease(buildOptions);
  if (!(await pathExists(outputDir))) fail(`输出目录缺失：${outputDir}`);
  await validateDirectoryAgainstRelease(outputDir, expected);
  return expected.manifest;
}

function parseArguments(argv) {
  const options = {
    corpusDir: path.join(root, "scripts", "kaoyan-corpus"),
    redbookPath: path.join(root, "public", "data", "redbook.json"),
    analysisPath: path.join(root, "public", "data", "redbook-analysis.json"),
    outputDir: path.join(root, "public", "data", "kaoyan-examples"),
    maxShardBytes: DEFAULT_MAX_SHARD_BYTES,
    check: false,
  };
  const keys = {
    "--corpus-dir": "corpusDir",
    "--redbook": "redbookPath",
    "--analysis": "analysisPath",
    "--output-dir": "outputDir",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") {
      options.check = true;
      continue;
    }
    if (argument === "--max-shard-bytes") {
      options.maxShardBytes = Number(argv[++index]);
      continue;
    }
    const key = keys[argument];
    if (!key || !argv[index + 1]) fail(`未知或缺少参数：${argument}`);
    options[key] = path.resolve(argv[++index]);
  }
  return options;
}

function printReport(manifest, examples) {
  const maximumShardBytes = Math.max(0, ...Object.values(manifest.shardBytes));
  console.log(`真题例句库：${manifest.paperCount} 套试卷 / ${manifest.statistics.candidateSentenceCount} 个原始候选 / ${manifest.sourceSentenceCount} 个合法句`);
  console.log(`例句 ${manifest.exampleCount} 条 / 覆盖 ${manifest.coveredWordCount} 词 / 无例句 ${manifest.uncoveredWordCount} 词 / 最大 shard ${maximumShardBytes} bytes`);
  console.log(`卷型分布：${JSON.stringify(manifest.statistics.byPaperType)}`);
  console.log(`年份分布：${JSON.stringify(manifest.statistics.byYear)}`);
  console.log(`过滤原因：${JSON.stringify(manifest.statistics.filteredReasons)}`);
  if (examples) {
    for (const paperType of ["old", "english-one", "english-two"]) {
      const sample = examples.find((item) => item.paperType === paperType);
      if (sample) console.log(`追溯样例 ${paperType}：wordId=${sample.wordId} ${sample.paperId} ${sample.sourceUrl} | ${sample.sentence}`);
    }
  }
  console.log(`contentVersion=${manifest.contentVersion} corpusManifestSha256=${manifest.corpusManifestSha256}`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const { check, ...paths } = options;
  if (check) {
    const manifest = await verifyKaoyanRelease(paths);
    printReport(manifest);
    console.log("真题例句库校验通过");
    return;
  }
  const first = await buildKaoyanRelease(paths);
  const second = await buildKaoyanRelease(paths);
  if (JSON.stringify(first.files) !== JSON.stringify(second.files)) {
    fail("连续两次构建不确定");
  }
  await publishKaoyanRelease(paths.outputDir, first);
  await validateDirectoryAgainstRelease(paths.outputDir, first);
  printReport(first.manifest, first.examples);
  console.log(`真题例句库已原子发布到 ${paths.outputDir}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
