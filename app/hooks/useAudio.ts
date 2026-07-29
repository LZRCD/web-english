import { useEffect, useRef, useState } from "react";
import type { Word } from "../../lib/study";
import { useSyncedRefs } from "./useSyncedRefs";

type AudioClip = { file: string; start: number; end: number };
type AudioIndexData = { entries: Record<string, AudioClip> };

type UseAudioOptions = {
  current: Word;
  studyWords: Word[];
  wordIndex: number;
  redbookReady: boolean;
  onNotify: (message: string, duration?: number) => void;
};

/** 音频播放：预录音频片段 + TTS 回退 */
export function useAudio({
  current,
  studyWords,
  wordIndex,
  redbookReady,
  onNotify,
}: UseAudioOptions) {
  const [audioIndex, setAudioIndex] = useState<Record<string, AudioClip>>({});
  const recordedAudioRef = useRef<HTMLAudioElement>(null);

  // 用 ref 保持 studyWords/wordIndex 最新，供 speakNext 闭包使用
  const { studyWords: swRef, wordIndex: wiRef } = useSyncedRefs({
    studyWords,
    wordIndex,
  });

  // 加载音频索引
  useEffect(() => {
    let active = true;
    fetch("/data/audio-index.json")
      .then((response) => {
        if (!response.ok) throw new Error("audio index missing");
        return response.json() as Promise<AudioIndexData>;
      })
      .then((audio) => {
        if (active) setAudioIndex(audio.entries);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // 组件卸载时清理音频资源
  useEffect(() => () => {
    recordedAudioRef.current?.pause();
    window.speechSynthesis?.cancel();
  }, []);

  function speakWithTts(word: Word) {
    if (!("speechSynthesis" in window)) {
      onNotify("当前浏览器不支持语音播放", 2400);
      return false;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word.word);
    utterance.lang = "en-US";
    utterance.rate = 0.82;
    window.speechSynthesis.speak(utterance);
    return true;
  }

  function playRecordedWord(word: Word) {
    const clip =
      word.id === undefined ? undefined : audioIndex[String(word.id)];
    if (!clip) return false;
    window.speechSynthesis?.cancel();
    const audio = recordedAudioRef.current ?? new Audio();
    recordedAudioRef.current = audio;
    audio.pause();
    audio.preload = "auto";
    audio.src = `${clip.file}#t=${clip.start},${clip.end}`;
    audio.currentTime = clip.start;
    audio.ontimeupdate = () => {
      if (audio.currentTime >= clip.end) {
        audio.pause();
        audio.currentTime = clip.start;
      }
    };
    let fallbackUsed = false;
    const fallback = () => {
      if (fallbackUsed) return;
      fallbackUsed = true;
      audio.pause();
      speakWithTts(word);
    };
    audio.onerror = fallback;
    audio.play().catch(fallback);
    return true;
  }

  function speak() {
    if (!redbookReady) return;
    if (!playRecordedWord(current)) speakWithTts(current);
  }

  /** 预读下一个单词，在评分后调用 */
  function speakNext() {
    const words = swRef.current;
    const idx = wiRef.current;
    const nextWord = words[(idx + 1) % Math.max(1, words.length)];
    if (nextWord && !playRecordedWord(nextWord)) speakWithTts(nextWord);
  }

  return { audioIndex, speak, speakNext, recordedAudioRef } as const;
}
