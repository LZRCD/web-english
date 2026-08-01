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

let sharedAudio: HTMLAudioElement | null = null;
let loadedClipKey = "";
let activePlaybackCancel: (() => void) | undefined;
let activePreloadCancel: (() => void) | undefined;

function clipKey(clip: AudioClip) {
  return `${clip.file}#t=${clip.start},${clip.end}`;
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

/** 预加载指定录音片段（不播放），使首次点击更即时 */
function ensureLoaded(clip: AudioClip) {
  const key = clipKey(clip);
  if (loadedClipKey === key && sharedAudio) {
    return { audio: sharedAudio, key, reused: true };
  }
  const audio = sharedAudio ?? new Audio();
  sharedAudio = audio;
  audio.pause();
  audio.preload = "auto";
  audio.src = key;
  loadedClipKey = key;
  return { audio, key, reused: false };
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
  const loaded = ensureLoaded(clip);
  const audio = loaded.audio;
  activePlaybackCancel?.();
  if (!loaded.reused) activePreloadCancel?.();
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

/** 后台预加载某词的录音片段，供播放时秒开 */
export function preloadWordAudio(
  wordId: number | undefined,
  audioIndex: RuntimeAudioIndex,
) {
  const clip = resolveClip(wordId, audioIndex);
  if (!clip) return;
  const traceId = createPerformanceTrace("audio-preload");
  const preloadTimer = startPerformanceTimer("audio.preload.ready", { traceId });
  const metadataTimer = startPerformanceTimer(
    "audio.preload.loadedmetadata",
    { traceId },
  );
  const loadedDataTimer = startPerformanceTimer(
    "audio.preload.loadeddata",
    { traceId },
  );
  const canPlayTimer = startPerformanceTimer(
    "audio.preload.canplay",
    { traceId },
  );
  const loaded = ensureLoaded(clip);
  const audio = loaded.audio;
  if (loaded.reused && audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    const tags = { cacheHit: true, readyState: audio.readyState };
    metadataTimer.end(tags);
    loadedDataTimer.end(tags);
    canPlayTimer.end(tags);
    preloadTimer.end(tags);
    return;
  }
  activePreloadCancel?.();
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
    if (activePreloadCancel === cancelPreload) activePreloadCancel = undefined;
    const transfer = resourceTransferDetails(clip.file);
    const tags = {
      cacheHit: transfer?.cacheHit ?? loaded.reused,
      resourceCache: transfer?.resourceCache,
      transferBytes: transfer?.transferBytes,
      readyState: audio.readyState,
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
      cacheHit: transfer?.cacheHit ?? loaded.reused,
      resourceCache: transfer?.resourceCache,
      transferBytes: transfer?.transferBytes,
      readyState: audio.readyState,
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
  activePreloadCancel = cancelPreload;
  audio.addEventListener("loadedmetadata", onMetadata, { once: true });
  audio.addEventListener("loadeddata", onLoadedData, { once: true });
  audio.addEventListener("canplay", onCanPlay, { once: true });
  audio.addEventListener("error", onError, { once: true });
  const preloadTimeout = window.setTimeout(
    () => finish("error", "preload-timeout"),
    15_000,
  );
}

/** 停止当前播放并清理共享资源 */
export function stopWordAudio() {
  activePlaybackCancel?.();
  activePreloadCancel?.();
  sharedAudio?.pause();
  window.speechSynthesis?.cancel();
}
