import { useEffect, useState } from "react";
import { loadSenseFrequencyDataset } from "../../lib/sense-frequency-dataset";
import { loadSenseExamplesDataset } from "../../lib/sense-examples-dataset";
import { loadEtymologyDataset } from "../../lib/etymology-dataset";
import type { SenseFrequencyDatasetEntry } from "../../lib/sense-datasets";
import type { SenseExampleDatasetEntry } from "../../lib/sense-datasets";
import type { EtymologyDatasetEntry } from "../../lib/sense-datasets";
import type { Word } from "../../lib/study";

export type PrivateDatasetsState = {
  key: string;
  frequency: SenseFrequencyDatasetEntry[] | undefined;
  examples: SenseExampleDatasetEntry[] | undefined;
  etymology: EtymologyDatasetEntry | undefined;
};

const EMPTY: PrivateDatasetsState = {
  key: "",
  frequency: undefined,
  examples: undefined,
  etymology: undefined,
};

function datasetIdentityKey(word: Word | undefined) {
  if (!word || word.id === undefined) return "";
  const relation = word.relation;
  return [
    word.id,
    word.word,
    word.meaning,
    word.part ?? "",
    word.root ?? "",
    relation?.kind ?? "",
    relation?.label ?? "",
    relation?.note ?? "",
    relation?.lemma ?? "",
    String(relation?.independent ?? ""),
    relation?.confidence ?? "",
  ].join("\u0000");
}

/**
 * 按当前词加载三套预生成数据集（并行、缓存 shard Promise）。
 * 切词时旧异步结果不覆盖新词；任一套缺失/损坏/过期都返回 undefined，
 * 由调用方安全降级到个人缓存或逐词生成入口，不阻塞核心学习流程。
 */
export function usePrivateDatasets(word: Word | undefined): PrivateDatasetsState {
  const requestKey = datasetIdentityKey(word);
  const [loaded, setLoaded] = useState<PrivateDatasetsState>(EMPTY);

  useEffect(() => {
    let active = true;
    if (!requestKey || word?.id === undefined) {
      return () => { active = false; };
    }
    const wordId = word.id;
    const currentWord = word;
    void Promise.all([
      loadSenseFrequencyDataset(wordId, currentWord),
      loadSenseExamplesDataset(wordId, currentWord),
      loadEtymologyDataset(wordId, currentWord),
    ]).then(([frequency, examples, etymology]) => {
      if (active) {
        setLoaded({ key: requestKey, frequency, examples, etymology });
      }
    });
    return () => { active = false; };
  }, [requestKey, word]);

  return loaded.key === requestKey ? loaded : EMPTY;
}
