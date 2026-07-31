/** 单词音频播放：预录音频片段 + TTS 回退。
 * 使用模块级共享 <audio> 元素，划词弹窗与学习卡共用同一实例，
 * 避免重复建音频对象造成的延迟。 */

export type AudioClip = { file: string; start: number; end: number };
export type AudioIndexMap = Record<string, AudioClip>;

let sharedAudio: HTMLAudioElement | null = null;
let loadedClipKey = "";

function clipKey(clip: AudioClip) {
  return `${clip.file}#t=${clip.start},${clip.end}`;
}

/** 预加载指定录音片段（不播放），使首次点击更即时 */
function ensureLoaded(clip: AudioClip) {
  const key = clipKey(clip);
  if (loadedClipKey === key && sharedAudio) return;
  const audio = sharedAudio ?? new Audio();
  sharedAudio = audio;
  audio.pause();
  audio.preload = "auto";
  audio.src = key;
  loadedClipKey = key;
}

/** 浏览器 TTS 播放，返回是否成功开始 */
export function speakWithTts(word: string, rate = 0.82): boolean {
  if (!("speechSynthesis" in window)) return false;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = "en-US";
  utterance.rate = rate;
  window.speechSynthesis.speak(utterance);
  return true;
}

/** 播放单词发音：优先原声片段，缺失时回退 TTS */
export function playWordAudio(
  word: string,
  wordId: number | undefined,
  audioIndex: AudioIndexMap,
): boolean {
  const clip = wordId === undefined ? undefined : audioIndex[String(wordId)];
  if (!clip) return speakWithTts(word);
  window.speechSynthesis?.cancel();
  ensureLoaded(clip);
  const audio = sharedAudio;
  if (!audio) return speakWithTts(word);
  audio.currentTime = clip.start;
  // 片段播放到 end 即停，避免越过本词继续读同一音轨的后续词
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

/** 后台预加载某词的录音片段，供播放时秒开 */
export function preloadWordAudio(
  wordId: number | undefined,
  audioIndex: AudioIndexMap,
) {
  const clip = wordId === undefined ? undefined : audioIndex[String(wordId)];
  if (!clip) return;
  ensureLoaded(clip);
}

/** 停止当前播放并清理共享资源 */
export function stopWordAudio() {
  sharedAudio?.pause();
  window.speechSynthesis?.cancel();
}
