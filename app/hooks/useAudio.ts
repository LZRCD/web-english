import { useEffect, useState } from "react";
import type { Word } from "../../lib/study";
import {
  playWordAudio,
  preloadWordAudio,
  stopWordAudio,
  type RuntimeAudioIndex,
} from "../../lib/word-audio";
import { useSyncedRefs } from "./useSyncedRefs";
import { fetchJsonWithDiagnostics } from "../../lib/performance-diagnostics";
import { versionedDataUrl } from "../../lib/data-version";

type UseAudioOptions = {
  current: Word;
  studyWords: Word[];
  wordIndex: number;
  redbookReady: boolean;
  onNotify: (message: string, duration?: number) => void;
};

/** 音频播放：预录音频片段 + TTS 回退（共享全局音频元素） */
export function useAudio({
  current,
  studyWords,
  wordIndex,
  redbookReady,
  onNotify,
}: UseAudioOptions) {
  const [audioIndex, setAudioIndex] = useState<RuntimeAudioIndex>({
    files: [],
    entries: {},
  });

  // 用 ref 保持 studyWords/wordIndex 最新，供 speakNext 闭包使用
  const { studyWords: swRef, wordIndex: wiRef } = useSyncedRefs({
    studyWords,
    wordIndex,
  });

  // 加载音频索引
  useEffect(() => {
    if (!redbookReady) return;
    let active = true;
    const controller = new AbortController();
    fetchJsonWithDiagnostics<RuntimeAudioIndex>(
      versionedDataUrl("/data/audio-runtime-index.json"),
      "audio.index",
      { signal: controller.signal },
    )
      .then(({ data: audio }) => {
        if (active) setAudioIndex(audio);
      })
      .catch(() => {});
    return () => {
      active = false;
      controller.abort();
    };
  }, [redbookReady]);

  // 当前词切换时预加载录音片段，让点击播放更即时
  useEffect(() => {
    if (!redbookReady) return;
    preloadWordAudio(current.id, audioIndex);
  }, [audioIndex, current.id, redbookReady]);

  // 组件卸载时清理音频资源
  useEffect(() => () => {
    stopWordAudio();
  }, []);

  function speak() {
    if (!redbookReady) return;
    const played = playWordAudio(current.word, current.id, audioIndex);
    if (!played) onNotify("当前浏览器不支持语音播放", 2400);
  }

  /** 预读下一个单词，在评分后调用。此时 wordIndex 已被 rateWord 推进到新词，直接读即可 */
  function speakNext() {
    const words = swRef.current;
    const idx = wiRef.current;
    const nextWord = words[idx % Math.max(1, words.length)];
    if (!nextWord) return;
    preloadWordAudio(nextWord.id, audioIndex);
    if (!playWordAudio(nextWord.word, nextWord.id, audioIndex)) {
      onNotify("当前浏览器不支持语音播放", 2400);
    }
  }

  /** 播放任意单词（供划词弹窗等场景使用） */
  function speakWord(word: string, wordId?: number) {
    if (!redbookReady) return;
    if (!playWordAudio(word, wordId, audioIndex)) {
      onNotify("当前浏览器不支持语音播放", 2400);
    }
  }

  const hasRecordedAudio = current.id !== undefined
    && Boolean(audioIndex.entries[String(current.id)]);

  return { hasRecordedAudio, speak, speakNext, speakWord } as const;
}
