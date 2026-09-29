import { voiceUnlocked } from "./yuzu";
import { exampleAudioName, pronunciationAudioName, speechText } from "./speech-audio";
export { exampleAudioName, pronunciationAudioName, pronunciationReading, speechText } from "./speech-audio";

/**
 * 音频放在哪:默认跟着页面走(public/audio/,打进包里);设了 VITE_AUDIO_BASE_URL
 * 就从那里拉(R2 公开域名),包里一个字节不带,用户磁盘上只有他听过的。
 * ⚠️ 跨域时 index.json 是 fetch 出来的,R2 桶要开 CORS(GET, *);<audio> 本身不需要。
 */
// 函数而不是常量:生成脚本在 Node 里 import 这个文件取哈希函数,那里没有 import.meta.env。
const audioBase = (): string =>
  ((import.meta.env.VITE_AUDIO_BASE_URL as string | undefined) || `${import.meta.env.BASE_URL}audio/`).replace(/\/*$/, "/");

export type VoiceDeliveryMode = "bundled" | "remote";

/**
 * 开发版 / 未配 CDN 的 App 直接读包内 public/audio；配了独立音频域名的发布版按需联网。
 * 只比 origin，不拿 URL 文本猜，Capacitor 的 https://localhost 和网页子路径都能正确判断。
 */
export const audioDeliveryMode = (baseUrl: string, pageUrl: string): VoiceDeliveryMode =>
  new URL(baseUrl, pageUrl).origin === new URL(pageUrl).origin ? "bundled" : "remote";

export const voiceDeliveryMode = (): VoiceDeliveryMode => audioDeliveryMode(audioBase(), window.location.href);

/**
 * 音频库的索引(由 scripts/build-word-audio.mjs 写出)。没跑过生成脚本时它不存在,
 * 这时一个音频请求都不发,直接走系统语音 —— 否则每个词都要白撞一次 404。
 *
 * 一个声音一个子目录,索引汇总有哪些声音可选。扩展名也记在里面:
 * VOICEVOX 出 .aac(ADTS —— 片段太短,m4a 的容器头比音频还大),Google 出 .mp3。
 */
export interface AudioVoice {
  id: string;
  label: string;
  ext: string;
  engine?: string;
  count?: number;
}

interface AudioIndex {
  voices: AudioVoice[];
  default: string | null;
}

type AudioKind = "words" | "examples";
const audioIndex: Record<AudioKind, AudioIndex | null> = { words: null, examples: null };
const audioIndexLoading: Partial<Record<AudioKind, Promise<void>>> = {};
const voicePreparation = new Map<string, Promise<void>>();

const loadAudioIndex = (kind: AudioKind): Promise<void> => {
  audioIndexLoading[kind] ??= fetch(`${audioBase()}${kind}/index.json`)
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      // 开发服务器对不存在的路径会回 index.html,所以要验一下拿到的确实是索引
      audioIndex[kind] = Array.isArray(data?.voices) && data.voices.length ? (data as AudioIndex) : null;
    })
    .catch(() => {
      audioIndex[kind] = null;
    });
  return audioIndexLoading[kind];
};

/** 已生成的声音列表(设置页据此列选项);没有音频库时为空数组。 */
export const availableVoices = (): AudioVoice[] => audioIndex.words?.voices ?? [];
/** 索引里标的默认声音(免费那一个) */
export const defaultVoiceId = (): string | null => audioIndex.words?.default ?? null;

/** 预热索引,好让设置页能立刻列出可选声音。 */
export const loadVoices = async (): Promise<AudioVoice[]> => {
  await loadAudioIndex("words");
  return availableVoices();
};

/** 选哪个声音:用户选过就用他选的(且确实存在),否则用默认。
 *  例句库可能只做了一个声音,用户选的那个没有就退到例句库自己的默认。 */
function resolveVoice(kind: AudioKind, preferred?: string | null): AudioVoice | null {
  const index = audioIndex[kind];
  const voices = index?.voices ?? [];
  if (!voices.length) return null;
  // 默认那个声音免费,别的要在柚子商店买过。以前选过、后来没买的退回默认。
  let unlocked = true;
  try { unlocked = voiceUnlocked(preferred ?? "", index?.default ?? null); } catch { /* 没有库(测试)就不设门 */ }
  const wanted = unlocked ? preferred : null;
  return voices.find((voice) => voice.id === wanted) ?? voices.find((voice) => voice.id === index?.default) ?? voices[0];
}

/** 预生成音频的地址。索引没加载、音频库不存在、或选了系统语音时返回 null。 */
export function pronunciationAudioUrl(kanji: string, kana: string, preferredVoice?: string | null): string | null {
  if (preferredVoice === SYSTEM_VOICE_ID) return null;
  const voice = resolveVoice("words", preferredVoice);
  if (!voice) return null;
  return `${audioBase()}words/${voice.id}/${pronunciationAudioName(kanji, kana)}${voice.ext}`;
}

export function exampleAudioUrl(sentence: string, preferredVoice?: string | null): string | null {
  if (preferredVoice === SYSTEM_VOICE_ID) return null;
  const voice = resolveVoice("examples", preferredVoice);
  if (!voice) return null;
  return `${audioBase()}examples/${voice.id}/${exampleAudioName(sentence)}${voice.ext}`;
}

/**
 * 商店试听:直接按 voice id 播一个词,**不过购买那道门**(没买的当然要能试听)。
 * 用例句库那句听得出语调,单词库一个词太短;例句库只做了一个声音时退回单词。
 */
/** 网页的读音是随包 / 同源的静态文件，试听本来就快；小程序版在这里预下载（speech.weapp.ts）。 */
export async function prefetchVoicePreviews(): Promise<void> {}

export async function previewVoice(voiceId: string): Promise<void> {
  await Promise.all([loadAudioIndex("words"), loadAudioIndex("examples")]);
  const ex = audioIndex.examples?.voices.find((v) => v.id === voiceId);
  const sentence = "毎日少しずつ、日本語を勉強しています。";
  if (ex) return playFileOrSpeak(`${audioBase()}examples/${ex.id}/${exampleAudioName(sentence)}${ex.ext}`, sentence);
  const w = audioIndex.words?.voices.find((v) => v.id === voiceId);
  const [kanji, kana] = ["勉強", "べんきょう"];
  return playFileOrSpeak(w ? `${audioBase()}words/${w.id}/${pronunciationAudioName(kanji, kana)}${w.ext}` : null, speechText(kanji, kana));
}

/**
 * 购买确认开始时预热声音索引和第一条真实音频。任务放在模块级 Map 里，离开商店组件
 * 不会取消；远程发布版之后按学习进度继续走 HTTP 缓存，不在一次结账里硬拉一万多个小文件。
 */
export function prepareVoice(voiceId: string): Promise<void> {
  const running = voicePreparation.get(voiceId);
  if (running) return running;
  const task = (async () => {
    await loadAudioIndex("words");
    const voice = audioIndex.words?.voices.find((item) => item.id === voiceId);
    if (!voice) throw new Error("声音资源暂不可用");
    const url = `${audioBase()}words/${voice.id}/${pronunciationAudioName("勉強", "べんきょう")}${voice.ext}`;
    await fetch(url, { mode: "no-cors" }).then((response) => response.arrayBuffer());
  })().catch((error) => {
    voicePreparation.delete(voiceId);
    throw error;
  });
  voicePreparation.set(voiceId, task);
  return task;
}

/** 设置里选「系统语音」时用这个 id —— 表示不用预生成音频,直接交给设备合成。 */
export const SYSTEM_VOICE_ID = "system";

// 索引里有、但单个文件缺失的词(生成中断过)记下来,别每次点都再撞一次。
const missingAudio = new Set<string>();
let audioElement: HTMLAudioElement | null = null;

/** 退路:设备自带的语音合成。喂片假名,音素锁死,但语调听天由命。 */
function speakWithSynthesis(text: string): void {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ja-JP";
  utterance.rate = 0.88;
  window.speechSynthesis.speak(utterance);
}

/** 有文件播文件,没有(或播不了)退回系统语音。文件 404 时 play() 以 NotSupportedError 拒绝,
 *  正好当作"这条没音频"的信号记下来,别每次点都再撞一次。 */
async function playFileOrSpeak(url: string | null, fallbackText: string): Promise<void> {
  if (!url || missingAudio.has(url)) {
    speakWithSynthesis(fallbackText);
    return;
  }
  try {
    window.speechSynthesis?.cancel();
    audioElement ??= new Audio();
    audioElement.src = url;
    await audioElement.play();
  } catch {
    missingAudio.add(url);
    speakWithSynthesis(fallbackText);
  }
}

/**
 * 播放读音:有预生成音频就播文件(读音和语调都确定),没有就退回系统语音合成。
 * 没跑过生成脚本时全部走退路,行为和以前一致。
 */
export async function playPronunciation(
  kanji: string,
  kana: string,
  preferredVoice?: string | null
): Promise<void> {
  const text = speechText(kanji, kana);
  if (!text) return;
  if (preferredVoice !== SYSTEM_VOICE_ID) await loadAudioIndex("words");
  await playFileOrSpeak(pronunciationAudioUrl(kanji, kana, preferredVoice), text);
}

/** 播例句。退路直接喂原文(汉字混排):整句有上下文,系统引擎读句子比读孤立词靠谱。 */
export async function playExample(sentence: string, preferredVoice?: string | null): Promise<void> {
  const text = sentence.trim();
  if (!text) return;
  if (preferredVoice !== SYSTEM_VOICE_ID) await loadAudioIndex("examples");
  await playFileOrSpeak(exampleAudioUrl(text, preferredVoice), text);
}

/** 例句框一出现就把文件拉进 HTTP 缓存,点播放时不用等网络。no-cors:R2 上没配 CORS 也能缓存。 */
export async function prefetchExample(sentence: string, preferredVoice?: string | null): Promise<void> {
  if (preferredVoice === SYSTEM_VOICE_ID) return;
  await loadAudioIndex("examples");
  const url = exampleAudioUrl(sentence.trim(), preferredVoice);
  if (!url || missingAudio.has(url)) return;
  await fetch(url, { mode: "no-cors" }).then((response) => response.arrayBuffer()).catch(() => undefined);
}

export type WordAudioPlanItem = { kanji: string; kana: string; example: string };
// 网页音频已在本地包或浏览器缓存中，只有小程序需要 USER_DATA_PATH 预下载。
export const prefetchWordPlanAudio = (_items: readonly WordAudioPlanItem[]): void => {};
export const prefetchPronunciation = async (_kanji: string, _kana: string, _preferred?: string | null): Promise<void> => {};
