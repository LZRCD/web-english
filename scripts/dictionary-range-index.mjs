import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

export const DICTIONARY_RANGE_PREFIX_LENGTH = 3;

function rangePrefix(key) {
  return key.slice(0, Math.min(DICTIONARY_RANGE_PREFIX_LENGTH, key.length));
}

/**
 * 根据现有单行 JSON 分片计算 UTF-8 字节范围。页面只需 Range 读取
 * 查询词前三个字符对应的小段，无需下载整个字母分片。
 */
export function buildDictionaryRangeIndex(dictionaryDirectory) {
  const letterIndexes = Object.create(null);
  const shardHashes = Object.create(null);
  const releaseFiles = Object.create(null);
  for (const letter of "abcdefghijklmnopqrstuvwxyz") {
    const shardPath = resolve(dictionaryDirectory, `${letter}.json`);
    const raw = readFileSync(shardPath, "utf8");
    const shardHash = createHash("sha256").update(raw).digest("hex");
    const releaseName = `${letter}.${shardHash.slice(0, 16)}`;
    const releasePath = resolve(dictionaryDirectory, `${releaseName}.json`);
    copyFileSync(shardPath, releasePath);
    // 保留旧内容寻址文件，滚动升级期间旧页面仍可按旧哈希读取分片。
    shardHashes[letter] = shardHash;
    releaseFiles[letter] = releaseName;
    const ranges = Object.create(null);
    const entries = JSON.parse(raw);
    let byteOffset = 1; // 跳过对象开头的 {
    let firstEntry = true;
    let previousPrefix = "";
    let activeRange;

    for (const [key, value] of Object.entries(entries)) {
      const prefix = rangePrefix(key);
      const separator = firstEntry ? "" : ",";
      const fragment = `${separator}${JSON.stringify(key)}:${JSON.stringify(value)}`;
      const entryStart = byteOffset + Buffer.byteLength(separator);
      const entryEnd = byteOffset + Buffer.byteLength(fragment) - 1;
      if (prefix === previousPrefix && activeRange) {
        activeRange[2] = entryEnd;
      } else {
        activeRange = [letter, entryStart, entryEnd];
        (ranges[prefix] ??= []).push(activeRange);
      }
      byteOffset += Buffer.byteLength(fragment);
      previousPrefix = prefix;
      firstEntry = false;
    }

    if (byteOffset !== Buffer.byteLength(raw) - 1) {
      throw new Error(`${letter}.json 不是预期的单行 JSON 对象`);
    }
    letterIndexes[letter] = {
      version: 1,
      letter,
      ranges,
    };
  }

  return { letterIndexes, shardHashes, releaseFiles };
}

export function writeDictionaryRangeIndex(dictionaryDirectory) {
  const { letterIndexes, shardHashes, releaseFiles } =
    buildDictionaryRangeIndex(dictionaryDirectory);
  const rangeDirectory = resolve(dictionaryDirectory, "ranges");
  mkdirSync(rangeDirectory, { recursive: true });
  const rangeIndexHashes = Object.create(null);
  const rangeIndexFiles = Object.create(null);
  let prefixCount = 0;
  let rangeCount = 0;
  for (const [letter, letterIndex] of Object.entries(letterIndexes)) {
    const raw = JSON.stringify(letterIndex);
    const hash = createHash("sha256").update(raw).digest("hex");
    const releaseName = `${letter}.${hash.slice(0, 16)}`;
    writeFileSync(resolve(rangeDirectory, `${letter}.json`), raw, "utf8");
    writeFileSync(resolve(rangeDirectory, `${releaseName}.json`), raw, "utf8");
    rangeIndexHashes[letter] = hash;
    rangeIndexFiles[letter] = releaseName;
    prefixCount += Object.keys(letterIndex.ranges).length;
    rangeCount += Object.values(letterIndex.ranges)
      .reduce((total, ranges) => total + ranges.length, 0);
  }
  const index = {
    version: 4,
    prefixLength: DICTIONARY_RANGE_PREFIX_LENGTH,
    shardHashes,
    releaseFiles,
    rangeIndexHashes,
    rangeIndexFiles,
  };
  const outputPath = resolve(dictionaryDirectory, "ranges.json");
  writeFileSync(outputPath, JSON.stringify(index), "utf8");
  return { index, outputPath, prefixCount, rangeCount };
}
