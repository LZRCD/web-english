export const REDBOOK_SOURCE_TOTAL = 6550;

export type RedbookLoadGuidance = {
  title: string;
  detail: string;
};

/** 把已知词库加载失败转换为不泄露内部错误的用户修复说明。 */
export function buildRedbookLoadGuidance(error: unknown): RedbookLoadGuidance {
  const message = error instanceof Error ? error.message : "";
  const localFileUnavailable = error instanceof SyntaxError
    || message === "redbook data empty"
    || message === "redbook analysis incomplete"
    || /^请求失败：(404|410)$/.test(message);

  if (localFileUnavailable) {
    return {
      title: "本地词库文件缺失或不完整",
      detail: "请重新启动词环；若仍失败，请确认安装目录完整，或重新构建本地词库数据后再试。",
    };
  }

  return {
    title: "暂时无法读取本地词库",
    detail: "请确认词环仍在运行，然后重试。若仍失败，请重新启动应用并确认安装目录完整。",
  };
}

const CANONICAL_WORD_IDS: Record<number, number> = {
  6177: 2506,
};

export function canonicalWordId(wordId: number) {
  if (!Number.isFinite(wordId)) return wordId;
  return CANONICAL_WORD_IDS[wordId] ?? wordId;
}

export function isPrimaryLearningWord(wordId?: number) {
  return wordId === undefined || canonicalWordId(wordId) === wordId;
}
