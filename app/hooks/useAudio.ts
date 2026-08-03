import { useEffect, useState } from "react";
import type { Word } from "../../lib/study";
import {
  clearNextWordAudioPreload,
  nextAudioWordId,
  playWordAudio,
  preloadNextWordAudio,
  preloadWordAudio,
  stopWordAudio,
  type RuntimeAudioIndex,
} from "../../lib/word-audio";
import { useSyncedRefs } from "./useSyncedRefs";
import { fetchJsonWithDiagnostics } from "../../lib/performance-diagnostics";
import { versionedDataUrl } from "../../lib/data-version";
import { allowsBackgroundPrefetch } from "../../lib/background-prefetch";

type UseAudioOptions = {
  current: Word;
  studyWords: Word[];
  wordIndex: number;
  redbookReady: boolean;
  onNotify: (message: string, duration?: number) => void;
};

/** 音频播放：当前播放元素 + 一个有界下一词预载元素 + TTS 回退。 */
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
  const upcomingWordId = nextAudioWordId(
    studyWords,
    wordIndex,
    current.id,
  );

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

  // 首屏空闲后用独立音频元素预载下一词；不改写当前词的播放源。
  useEffect(() => {
    if (!redbookReady || upcomingWordId === undefined) {
      clearNextWordAudioPreload();
      return;
    }
    const connection = (
      navigator as Navigator & {
        connection?: EventTarget & {
          saveData?: boolean;
          effectiveType?: string;
        };
      }
    ).connection;
    const idleWindow = window as Window & {
      requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions,
      ) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    let idleId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const allowed = () => allowsBackgroundPrefetch({
      online: navigator.onLine,
      visibilityState: document.visibilityState,
      connection,
    });
    const cancelSchedule = () => {
      if (idleId !== undefined) idleWindow.cancelIdleCallback?.(idleId);
      if (timeoutId !== undefined) globalThis.clearTimeout(timeoutId);
      idleId = undefined;
      timeoutId = undefined;
    };
    const run = () => {
      idleId = undefined;
      timeoutId = undefined;
      if (!allowed()) {
        clearNextWordAudioPreload();
        return;
      }
      preloadNextWordAudio(upcomingWordId, audioIndex);
    };
    const schedule = () => {
      cancelSchedule();
      if (!allowed()) {
        clearNextWordAudioPreload();
        return;
      }
      if (idleWindow.requestIdleCallback) {
        idleId = idleWindow.requestIdleCallback(run, { timeout: 2_000 });
      } else {
        timeoutId = globalThis.setTimeout(run, 750);
      }
    };
    schedule();
    document.addEventListener("visibilitychange", schedule);
    window.addEventListener("online", schedule);
    window.addEventListener("offline", schedule);
    connection?.addEventListener("change", schedule);
    return () => {
      cancelSchedule();
      document.removeEventListener("visibilitychange", schedule);
      window.removeEventListener("online", schedule);
      window.removeEventListener("offline", schedule);
      connection?.removeEventListener("change", schedule);
    };
  }, [audioIndex, redbookReady, upcomingWordId]);

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
