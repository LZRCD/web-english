export function buildDurableRemap(proposal) {
  const files = Object.fromEntries(
    Object.entries(proposal.files).map(([file, data]) => [
      file,
      {
        entries: data.accepted.map((item) => ({
          id: item.targetWordId,
          word: item.targetWord,
          recognized: item.recognized,
          score: item.score,
          start: item.start,
          end: item.end,
        })),
        excludedWords: data.missingWords,
      },
    ]),
  );

  return {
    metadata: {
      version: 1,
      method: "Whisper Tiny + Whisper Base + CMU 音素 + 全局一对一匹配",
      acceptScore: proposal.metadata.acceptScore,
      sourceReport: proposal.metadata.sourceReport,
      fileCount: Object.keys(files).length,
    },
    files,
  };
}

export function applyAudioRemap(index, remap) {
  const affectedFiles = new Set(Object.keys(remap.files));
  index.entries = Object.fromEntries(
    Object.entries(index.entries).filter(([, clip]) => !affectedFiles.has(clip.file)),
  );

  for (const [file, data] of Object.entries(remap.files)) {
    for (const entry of data.entries) {
      index.entries[String(entry.id)] = {
        file,
        start: entry.start,
        end: entry.end,
        confidence: "asr-verified",
      };
    }

    const fileRecord = index.metadata.files.find((item) => item.file === file);
    if (!fileRecord) continue;

    const excludedById = new Map(
      (fileRecord.excludedWords ?? []).map((item) => [item.id, item]),
    );
    for (const word of data.excludedWords) {
      excludedById.set(word.id, {
        ...word,
        reason: "Whisper Tiny 与 Base 均未达到可靠匹配，使用 TTS 回退",
      });
    }

    fileRecord.indexedWordCount = data.entries.length;
    fileRecord.confidence = "asr-verified";
    fileRecord.alignment = "whisper-tiny-base-global-bipartite";
    fileRecord.excludedWords = [...excludedById.values()];
  }

  const remapFiles = Object.values(remap.files);
  const indexedWordCount = Object.keys(index.entries).length;
  index.metadata.version = Math.max(5, index.metadata.version ?? 0);
  index.metadata.indexedWordCount = indexedWordCount;
  index.metadata.validation.fallbackWordCount =
    index.metadata.sourceWordCount - indexedWordCount;
  index.metadata.asrValidation = {
    method: remap.metadata.method,
    acceptScore: remap.metadata.acceptScore,
    checkedWordCount: remapFiles.reduce(
      (total, file) => total + file.entries.length + file.excludedWords.length,
      0,
    ),
    verifiedOriginalCount: remapFiles.reduce(
      (total, file) => total + file.entries.length,
      0,
    ),
    lowConfidenceFallbackCount: remapFiles.reduce(
      (total, file) => total + file.excludedWords.length,
      0,
    ),
  };

  return index;
}
