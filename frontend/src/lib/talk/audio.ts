import * as speech from "../speech";
import { exampleAudioName } from "../speech-audio";

// 只由实验页面引用，关着编译期开关时连同音频一起摇掉；public/ 做不到这一点。
const files = import.meta.glob<string>("../../assets/talk-audio/voicevox-8/*.aac", {
  eager: true, query: "?url", import: "default"
});
const urls = Object.fromEntries(Object.entries(files).map(([path, url]) => [path.split("/").pop()!, url]));
let current: HTMLAudioElement | null = null;
let generation = 0;

export const canPlayTalkAudio = async (text: string): Promise<boolean> =>
  Boolean(urls[`${exampleAudioName(text)}.aac`])
  || (typeof window !== "undefined" && typeof window.speechSynthesis?.speak === "function");

export function stopTalkAudio(): void {
  generation += 1;
  if (current) {
    current.onerror = null;
    current.pause();
    current.currentTime = 0;
    current = null;
  }
  if (typeof window !== "undefined") window.speechSynthesis?.cancel();
}

export async function playTalkAudio(text: string): Promise<void> {
  stopTalkAudio();
  if (!text.trim()) return;
  const playing = generation;
  const url = urls[`${exampleAudioName(text)}.aac`];
  let fallbackTask: Promise<void> | null = null;
  const fallback = (): Promise<void> => fallbackTask ??= (async () => {
    if (playing !== generation) return;
    if (current) {
      current.onerror = null;
      current.pause();
      current = null;
    }
    // 强制系统退路：不让共享例句播放器异步查索引后在换卡/离页时又开口。
    await speech.playExample(text, speech.SYSTEM_VOICE_ID);
  })();
  if (!url) return fallback();
  try {
    const audio = new Audio(url);
    current = audio;
    // play() 已 resolve 后也可能解码失败，仍须退回系统语音。
    audio.onerror = () => { void fallback(); };
    await audio.play();
  } catch {
    await fallback();
  }
}
