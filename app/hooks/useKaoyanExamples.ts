import { useEffect, useState } from "react";
import {
  loadKaoyanExamples,
  type KaoyanExample,
} from "../../lib/kaoyan-examples";

/** 当前词的静态真题例句；切词时先清空并忽略旧异步结果。 */
export function useKaoyanExamples(
  wordId: number | undefined,
  word: string,
  enabled: boolean,
) {
  const requestKey = enabled && wordId !== undefined && word.trim()
    ? `${wordId}:${word}`
    : "";
  const [loaded, setLoaded] = useState<{
    key: string;
    examples: KaoyanExample[];
  }>({ key: "", examples: [] });

  useEffect(() => {
    let active = true;
    if (!requestKey || wordId === undefined) return () => { active = false; };
    void loadKaoyanExamples(wordId, word).then((items) => {
      if (active) setLoaded({ key: requestKey, examples: items });
    });
    return () => { active = false; };
  }, [requestKey, word, wordId]);

  return loaded.key === requestKey ? loaded.examples : [];
}
