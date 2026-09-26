import { getStudyPreferences } from "./studyPreferences";
import { voiceUnlocked } from "./yuzu";

declare const require: (path: string) => any;
declare const wx: any;

export function pronunciationReading(kana: string): string {
  return kana.replace(/\[[^\]]*\]/g, "").replace(/[〜～~\s]/g, "");
}

const toKatakana = (text: string) => text.replace(/[ぁ-ゖ]/g, (char) => String.fromCodePoint((char.codePointAt(0) ?? 0) + 0x60));
const clean = (text: string) => text.replace(/\[[^\]]*\]/g, "").replace(/[〜～~\s]/g, "");
const particleSound: Record<string, string> = { は: "ワ", へ: "エ", を: "オ" };

export function speechText(kanji: string, kana: string): string {
  const reading = pronunciationReading(kana);
  if (!reading) return reading;
  const chars = [...reading];
  const last = chars[chars.length - 1];
  return chars.length > 1 && last in particleSound && clean(kanji).endsWith(last)
    ? toKatakana(chars.slice(0, -1).join("")) + particleSound[last]
    : toKatakana(reading);
}

const fnv64 = (text: string) => {
  let hash = 0xcbf29ce484222325n;
  for (const char of text) { hash ^= BigInt(char.codePointAt(0) ?? 0); hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn; }
  return hash.toString(16).padStart(16, "0");
};
export const pronunciationAudioName = (kanji: string, kana: string) => fnv64(`${kanji}|${kana}`);
export const exampleAudioName = (sentence: string) => fnv64(sentence.trim());
export type VoiceDeliveryMode = "bundled" | "remote";
export interface AudioVoice { id: string; label: string; ext: string; engine?: string; count?: number; }
type AudioIndex = { voices: AudioVoice[]; default: string | null };
type AudioKind = "words" | "examples";
export const SYSTEM_VOICE_ID = "system";

const config = require("../../../wechat-miniprogram/src/config.js");
const { requestJson } = require("../../../wechat-miniprogram/src/runtime/wx-promise.js");
const bases: Record<AudioKind, { base: string; index: string }> = {
  words: { base: config.audioBaseUrl, index: config.audioIndexUrl },
  examples: {
    base: String(config.audioBaseUrl || "").replace(/\/words\/?$/, "/examples"),
    index: String(config.audioIndexUrl || "").replace(/\/words\/index\.json$/, "/examples/index.json")
  }
};
const indexes: Partial<Record<AudioKind, AudioIndex | null>> = {};
const loading: Partial<Record<AudioKind, Promise<AudioIndex | null>>> = {};
const contexts: Partial<Record<AudioKind, any>> = {};

const loadIndex = (kind: AudioKind): Promise<AudioIndex | null> => loading[kind] ??= (async () => {
  try {
    const value = await requestJson(bases[kind].index);
    indexes[kind] = Array.isArray(value?.voices) ? value as AudioIndex : null;
  } catch { indexes[kind] = null; }
  return indexes[kind] ?? null;
})();

const preferredVoice = (): string => {
  const wanted = getStudyPreferences().voiceId;
  if (wanted === SYSTEM_VOICE_ID || !wanted) return indexes.words?.default ?? "";
  const index = indexes.words;
  try { return voiceUnlocked(wanted, index?.default ?? null) ? wanted : ""; }
  catch { return ""; }
};

const resolveVoice = (kind: AudioKind, requested?: string | null): AudioVoice | null => {
  const index = indexes[kind];
  const voices = index?.voices ?? [];
  if (!voices.length) return null;
  const wanted = requested ?? preferredVoice();
  let allowed = true;
  try { allowed = voiceUnlocked(wanted, index?.default ?? null); } catch { /* 数据库尚未准备好时退回默认声 */ }
  return voices.find((voice) => voice.id === (allowed ? wanted : ""))
    ?? voices.find((voice) => voice.id === index?.default)
    ?? voices[0];
};

export const availableVoices = (): AudioVoice[] => indexes.words?.voices ?? [];
export const defaultVoiceId = (): string | null => indexes.words?.default ?? null;
export const loadVoices = async (): Promise<AudioVoice[]> => { await loadIndex("words"); return availableVoices(); };
export const audioDeliveryMode = (_base: string, _page: string): VoiceDeliveryMode => "remote";
export const voiceDeliveryMode = (): VoiceDeliveryMode => "remote";

export function pronunciationAudioUrl(kanji: string, kana: string, preferred?: string | null): string | null {
  const voice = resolveVoice("words", preferred);
  return voice && bases.words.base ? `${bases.words.base.replace(/\/$/, "")}/${encodeURIComponent(voice.id)}/${pronunciationAudioName(kanji, kana)}${voice.ext}` : null;
}
export function exampleAudioUrl(sentence: string, preferred?: string | null): string | null {
  const voice = resolveVoice("examples", preferred);
  return voice && bases.examples.base ? `${bases.examples.base.replace(/\/$/, "")}/${encodeURIComponent(voice.id)}/${exampleAudioName(sentence)}${voice.ext}` : null;
}

async function playFile(url: string | null): Promise<void> {
  if (!url) throw new Error("云端音频索引或音色暂不可用，请检查网络后重试。");
  const kind: AudioKind = url.includes("/examples/") ? "examples" : "words";
  const context = contexts[kind] ??= wx.createInnerAudioContext();
  context.stop();
  context.src = url;
  await new Promise<void>((resolve, reject) => {
    context.offCanplay?.(); context.offError?.();
    context.onCanplay(resolve);
    context.onError(() => reject(new Error("这条云端音频暂不可用，请稍后重试。")));
    context.play();
  });
}

export async function playPronunciation(kanji: string, kana: string, preferred?: string | null): Promise<void> {
  if (!speechText(kanji, kana)) return;
  await loadIndex("words");
  await playFile(pronunciationAudioUrl(kanji, kana, preferred));
}
export async function playExample(sentence: string, preferred?: string | null): Promise<void> {
  const text = sentence.trim();
  if (!text) return;
  await loadIndex("examples");
  await playFile(exampleAudioUrl(text, preferred));
}
export async function previewVoice(voiceId: string): Promise<void> {
  await Promise.all([loadIndex("words"), loadIndex("examples")]);
  const sentence = "毎日少しずつ、日本語を勉強しています。";
  const examples = indexes.examples?.voices.find((voice) => voice.id === voiceId);
  if (examples) return playFile(exampleAudioUrl(sentence, voiceId));
  return playFile(pronunciationAudioUrl("勉強", "べんきょう", voiceId));
}
const prepared = new Set<string>();
export async function prepareVoice(voiceId: string): Promise<void> {
  if (prepared.has(voiceId)) return;
  await loadIndex("words");
  const voice = indexes.words?.voices.find((item) => item.id === voiceId);
  if (!voice) throw new Error("云端音色暂不可用。");
  const url = pronunciationAudioUrl("勉強", "べんきょう", voiceId);
  const cloud = require("../../../wechat-miniprogram/src/runtime/cloud.js");
  if (url && cloud.isCloudFile(url)) await cloud.downloadCloudFile(url);
  else if (url) await new Promise<void>((resolve, reject) => wx.downloadFile({ url, success: () => resolve(), fail: reject }));
  prepared.add(voiceId);
}
export async function prefetchExample(sentence: string, preferred?: string | null): Promise<void> {
  await loadIndex("examples");
  const url = exampleAudioUrl(sentence.trim(), preferred);
  if (!url) return;
  try {
    const cloud = require("../../../wechat-miniprogram/src/runtime/cloud.js");
    if (cloud.isCloudFile(url)) await cloud.downloadCloudFile(url);
    else await new Promise((resolve) => wx.downloadFile({ url, success: resolve, fail: resolve }));
  } catch { /* 预取失败只影响缓存，播放会显示真实音频错误 */ }
}
