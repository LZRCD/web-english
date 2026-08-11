/** 单词音频播放：预录音频片段 + TTS 回退。
 * 使用模块级共享 <audio> 元素，划词弹窗与学习卡共用同一实例，
 * 避免重复建音频对象造成的延迟。 */

import {
  createPerformanceTrace,
  resourceTransferDetails,
  startPerformanceTimer,
} from "./performance-diagnostics.ts";

export type AudioClip = { file: string; start: number; end: number };
export type RuntimeAudioIndex = {
  files: string[];
  entries: Record<string, [fileIndex: number, start: number, end: number]>;
};

export const AUDIO_PRELOAD_ELEMENT_LIMIT = 2;

let sharedAudio: HTMLAudioElement | null = null;
let loadedClipKey = "";
let activePlaybackCancel: (() => void) | undefined;
let activePreloadCancel: (() => void) | undefined;
let nextPreloadAudio: HTMLAudioElement | null = null;
let nextPreloadClipKey = "";
let activeNextPreloadCancel: (() => void) | undefined;

function clipKey(clip: AudioClip) {
  return `${clip.file}#t=${clip.start},${clip.end}`;
}

/** 从当前学习位置寻找下一个不同且有稳定 ID 的词，队列末尾按原学习顺序循环。 */
export function nextAudioWordId(
  words: ReadonlyArray<{ id?: number }>,
  currentIndex: number,
  currentId?: number,
) {
  if (words.length < 2) return undefined;
  const baseIndex = ((Math.trunc(currentIndex) % words.length) + words.length)
    % words.length;
  for (let offset = 1; offset < words.length; offset += 1) {
    const candidateId = words[(baseIndex + offset) % words.length]?.id;
    if (candidateId !== undefined && candidateId !== currentId) {
      return candidateId;
    }
  }
  return undefined;
}

function resolveClip(
  wordId: number | undefined,
  audioIndex: RuntimeAudioIndex,
): AudioClip | undefined {
  if (wordId === undefined) return undefined;
  const entry = audioIndex.entries[String(wordId)];
  if (!entry) return undefined;
  const file = audioIndex.files[entry[0]];
  return file ? { file, start: entry[1], end: entry[2] } : undefined;
}

function releaseAudio(audio: HTMLAudioElement | null) {
  if (!audio) return;
  audio.pause();
  audio.ontimeupdate = null;
  audio.removeAttribute("src");
  audio.load();
}

/** 取得播放元素；下一词已在独立元素中预载时直接提升为当前播放元素。 */
function ensureLoaded(clip: AudioClip) {
  const key = clipKey(clip);
  if (loadedClipKey === key && sharedAudio) {
    return { audio: sharedAudio, key, reused: true };
  }
  if (nextPreloadClipKey === key && nextPreloadAudio) {
    const audio = nextPreloadAudio;
    activePlaybackCancel?.();
    activePreloadCancel?.();
    activeNextPreloadCancel?.();
    if (sharedAudio && sharedAudio !== audio) releaseAudio(sharedAudio);
    sharedAudio = audio;
    loadedClipKey = key;
    nextPreloadAudio = null;
    nextPreloadClipKey = "";
    activeNextPreloadCancel = undefined;
    return { audio, key, reused: true };
  }
  activePlaybackCancel?.();
  activePreloadCancel?.();
  const audio = sharedAudio ?? new Audio();
  sharedAudio = audio;
  audio.pause();
  audio.ontimeupdate = null;
  audio.preload = "auto";
  audio.src = key;
  loadedClipKey = key;
  return { audio, key, reused: false };
}

export function readAudioPreloadDiagnostics() {
  const nextReadyState = nextPreloadAudio?.readyState ?? 0;
  return {
    elementCount: Number(Boolean(sharedAudio)) + Number(Boolean(nextPreloadAudio)),
    elementLimit: AUDIO_PRELOAD_ELEMENT_LIMIT,
    nextStatus: !nextPreloadAudio
      ? "empty" as const
      : nextReadyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        ? "ready" as const
        : "loading" as const,
    nextReadyState,
  };
}

/** 浏览器 TTS 播放，返回是否成功开始 */
export function speakWithTts(
  word: string,
  rate = 0.82,
  fallbackReason = "direct",
  playbackTimer = startPerformanceTimer("audio.play.start", {
    traceId: createPerformanceTrace("audio"),
    requestedSource: "tts",
  }),
): boolean {
  if (!("speechSynthesis" in window)) {
    playbackTimer.end({ source: "tts", fallbackReason }, "error");
    return false;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = "en-US";
  utterance.rate = rate;
  let settled = false;
  const fallbackTimeout = window.setTimeout(() => {
    if (settled) return;
    settled = true;
    playbackTimer.end({
      source: "tts",
      fallbackReason,
      startEvent: false,
    }, "error");
  }, 2000);
  utterance.onstart = () => {
    if (settled) return;
    settled = true;
    window.clearTimeout(fallbackTimeout);
    playbackTimer.end({
      source: "tts",
      fallbackReason,
      startEvent: true,
    });
  };
  utterance.onerror = () => {
    if (settled) return;
    settled = true;
    window.clearTimeout(fallbackTimeout);
    playbackTimer.end({ source: "tts", fallbackReason }, "error");
  };
  try {
    window.speechSynthesis.speak(utterance);
    return true;
  } catch {
    settled = true;
    window.clearTimeout(fallbackTimeout);
    playbackTimer.end({ source: "tts", fallbackReason }, "error");
    return false;
  }
}

export type TextSpeechOptions = {
  rate?: number;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: () => void;
};

/** 长文本浏览器朗读能力检测；不读取单词录音索引。 */
export function supportsTextSpeech() {
  return typeof window !== "undefined"
    && "speechSynthesis" in window
    && Boolean(window.speechSynthesis)
    && typeof SpeechSynthesisUtterance !== "undefined";
}

/** 朗读任意英文文本；每次开始前取消旧 utterance，便于安全重播。 */
export function speakText(
  text: string,
  options: TextSpeechOptions = {},
) {
  if (!supportsTextSpeech() || !text.trim()) return false;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = options.rate ?? 0.8;
  utterance.onstart = () => options.onStart?.();
  utterance.onend = () => options.onEnd?.();
  utterance.onerror = () => options.onError?.();
  try {
    window.speechSynthesis.speak(utterance);
    return true;
  } catch {
    options.onError?.();
    return false;
  }
}

export function pauseTextSpeech() {
  if (!supportsTextSpeech()) return false;
  window.speechSynthesis.pause();
  return true;
}

export function resumeTextSpeech() {
  if (!supportsTextSpeech()) return false;
  window.speechSynthesis.resume();
  return true;
}

export function cancelTextSpeech() {
  if (!supportsTextSpeech()) return false;
  window.speechSynthesis.cancel();
  return true;
}

/** 播放单词发音：优先原声片段，缺失时回退 TTS */
export function playWordAudio(
  word: string,
  wordId: number | undefined,
  audioIndex: RuntimeAudioIndex,
): boolean {
  const traceId = createPerformanceTrace("audio");
  const playbackTimer = startPerformanceTimer("audio.play.start", {
    traceId,
    requestedSource: "recorded",
  });
  const clip = resolveClip(wordId, audioIndex);
  if (!clip) {
    return speakWithTts(word, 0.82, "missing-recording", playbackTimer);
  }
  window.speechSynthesis?.cancel();
  activePlaybackCancel?.();
  const loaded = ensureLoaded(clip);
  const audio = loaded.audio;
  let finished = false;
  const seekTimer = startPerformanceTimer("audio.seek", {
    traceId,
    preloadHit: loaded.reused,
  });
  const onSeeked = () => seekTimer.end();
  const onPlaying = () => {
    if (finished) return;
    finished = true;
    seekTimer.end({ settledBy: "playing" });
    const transfer = resourceTransferDetails(clip.file);
    playbackTimer.end({
      source: "recorded",
      preloadHit: loaded.reused,
      readyState: audio.readyState,
      transferBytes: transfer?.transferBytes,
      cacheHit: transfer?.cacheHit,
      resourceCache: transfer?.resourceCache,
    });
    cleanup();
  };
  function cleanup() {
    window.clearTimeout(playbackTimeout);
    audio.removeEventListener("seeked", onSeeked);
    audio.removeEventListener("playing", onPlaying);
    audio.removeEventListener("error", onError);
    if (activePlaybackCancel === cancelPlayback) activePlaybackCancel = undefined;
  }
  function cancelPlayback() {
    if (finished) return;
    finished = true;
    cleanup();
    seekTimer.end({ cancelled: true }, "aborted");
    invokeTimer.end({ cancelled: true }, "aborted");
    playbackTimer.end({ source: "recorded", cancelled: true }, "aborted");
  }
  const fallback = (reason: string) => {
    if (finished) return;
    finished = true;
    cleanup();
    seekTimer.end({ fallbackReason: reason }, "error");
    invokeTimer.end({ fallbackReason: reason }, "error");
    audio.pause();
    speakWithTts(word, 0.82, reason, playbackTimer);
  };
  const onError = () => fallback("audio-error");
  const invokeTimer = startPerformanceTimer("audio.play.invoke", {
    traceId,
    preloadHit: loaded.reused,
  });
  activePlaybackCancel = cancelPlayback;
  audio.addEventListener("seeked", onSeeked, { once: true });
  audio.addEventListener("playing", onPlaying, { once: true });
  audio.addEventListener("error", onError, { once: true });
  const playbackTimeout = window.setTimeout(
    () => fallback("playback-timeout"),
    12_000,
  );
  try {
    audio.currentTime = clip.start;
  } catch {
    fallback("seek-error");
    return true;
  }
  // 片段播放到 end 即停，避免越过本词继续读同一音轨的后续词
  audio.ontimeupdate = () => {
    if (audio.currentTime >= clip.end) {
      audio.pause();
      audio.currentTime = clip.start;
    }
  };
  audio.play()
    .then(() => invokeTimer.end())
    .catch((error) => {
      const reason = error instanceof DOMException && error.name === "NotAllowedError"
        ? "autoplay-blocked"
        : "play-rejected";
      invokeTimer.end({ fallbackReason: reason }, "error");
      fallback(reason);
    });
  return true;
}

function observeAudioPreload(
  clip: AudioClip,
  audio: HTMLAudioElement,
  reused: boolean,
  target: "current" | "next",
) {
  const traceId = createPerformanceTrace("audio-preload");
  const timerTags = { traceId, preloadTarget: target };
  const preloadTimer = startPerformanceTimer("audio.preload.ready", timerTags);
  const metadataTimer = startPerformanceTimer(
    "audio.preload.loadedmetadata",
    timerTags,
  );
  const loadedDataTimer = startPerformanceTimer(
    "audio.preload.loadeddata",
    timerTags,
  );
  const canPlayTimer = startPerformanceTimer(
    "audio.preload.canplay",
    timerTags,
  );
  if (reused && audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    const tags = {
      cacheHit: true,
      readyState: audio.readyState,
      preloadTarget: target,
      poolEntries: readAudioPreloadDiagnostics().elementCount,
      poolLimit: AUDIO_PRELOAD_ELEMENT_LIMIT,
    };
    metadataTimer.end(tags);
    loadedDataTimer.end(tags);
    canPlayTimer.end(tags);
    preloadTimer.end(tags);
    return undefined;
  }
  let settled = false;
  const finish = (
    outcome: "ok" | "error" | "aborted",
    failureReason?: string,
  ) => {
    if (settled) return;
    settled = true;
    window.clearTimeout(preloadTimeout);
    audio.removeEventListener("loadedmetadata", onMetadata);
    audio.removeEventListener("loadeddata", onLoadedData);
    audio.removeEventListener("canplay", onCanPlay);
    audio.removeEventListener("error", onError);
    const transfer = resourceTransferDetails(clip.file);
    const tags = {
      cacheHit: transfer?.cacheHit ?? reused,
      resourceCache: transfer?.resourceCache,
      transferBytes: transfer?.transferBytes,
      readyState: audio.readyState,
      preloadTarget: target,
      poolEntries: readAudioPreloadDiagnostics().elementCount,
      poolLimit: AUDIO_PRELOAD_ELEMENT_LIMIT,
      failureReason,
    };
    metadataTimer.end(tags, outcome);
    loadedDataTimer.end(tags, outcome);
    canPlayTimer.end(tags, outcome);
    preloadTimer.end(
      tags,
      outcome,
    );
  };
  const eventTags = () => {
    const transfer = resourceTransferDetails(clip.file);
    return {
      cacheHit: transfer?.cacheHit ?? reused,
      resourceCache: transfer?.resourceCache,
      transferBytes: transfer?.transferBytes,
      readyState: audio.readyState,
      preloadTarget: target,
      poolEntries: readAudioPreloadDiagnostics().elementCount,
      poolLimit: AUDIO_PRELOAD_ELEMENT_LIMIT,
    };
  };
  const onMetadata = () => metadataTimer.end(eventTags());
  const onLoadedData = () => {
    loadedDataTimer.end(eventTags());
    preloadTimer.end(eventTags());
  };
  const onCanPlay = () => {
    canPlayTimer.end(eventTags());
    finish("ok");
  };
  const onError = () => finish("error", "audio-error");
  const cancelPreload = () => finish("aborted", "cancelled");
  audio.addEventListener("loadedmetadata", onMetadata, { once: true });
  audio.addEventListener("loadeddata", onLoadedData, { once: true });
  audio.addEventListener("canplay", onCanPlay, { once: true });
  audio.addEventListener("error", onError, { once: true });
  const preloadTimeout = window.setTimeout(
    () => finish("error", "preload-timeout"),
    15_000,
  );
  try {
    audio.load();
  } catch {
    finish("error", "load-error");
  }
  return cancelPreload;
}

/** 预加载当前词录音片段，继续复用主播放元素。 */
export function preloadWordAudio(
  wordId: number | undefined,
  audioIndex: RuntimeAudioIndex,
) {
  const clip = resolveClip(wordId, audioIndex);
  if (!clip) return;
  const loaded = ensureLoaded(clip);
  activePreloadCancel = observeAudioPreload(
    clip,
    loaded.audio,
    loaded.reused,
    "current",
  );
}

/** 用第二个、受上限约束的浏览器音频元素预载下一词，不改写当前播放源。 */
export function preloadNextWordAudio(
  wordId: number | undefined,
  audioIndex: RuntimeAudioIndex,
) {
  const clip = resolveClip(wordId, audioIndex);
  if (!clip) {
    clearNextWordAudioPreload();
    return;
  }
  const key = clipKey(clip);
  if (key === loadedClipKey) {
    clearNextWordAudioPreload();
    return;
  }
  if (key === nextPreloadClipKey && nextPreloadAudio) return;
  clearNextWordAudioPreload();
  const audio = new Audio();
  audio.preload = "auto";
  audio.src = key;
  nextPreloadAudio = audio;
  nextPreloadClipKey = key;
  activeNextPreloadCancel = observeAudioPreload(
    clip,
    audio,
    false,
    "next",
  );
}

export function clearNextWordAudioPreload() {
  activeNextPreloadCancel?.();
  activeNextPreloadCancel = undefined;
  releaseAudio(nextPreloadAudio);
  nextPreloadAudio = null;
  nextPreloadClipKey = "";
}

/** 停止当前播放并清理共享资源 */
export function stopWordAudio() {
  activePlaybackCancel?.();
  activePreloadCancel?.();
  clearNextWordAudioPreload();
  releaseAudio(sharedAudio);
  sharedAudio = null;
  loadedClipKey = "";
  activePlaybackCancel = undefined;
  activePreloadCancel = undefined;
  window.speechSynthesis?.cancel();
}
