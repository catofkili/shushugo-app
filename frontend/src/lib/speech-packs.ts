import { createAudioPackClient } from "./audio-pack-platform";
import { clipKey, type AudioPackVoice } from "./audio-pack-format";
import { exampleAudioName, pronunciationAudioName } from "./speech-audio";
import { getStudyPreferences } from "./studyPreferences";
import { voiceUnlocked } from "./yuzu";
import { readTodayWordAudioPlanUpdate, TODAY_WORD_PLAN_UPDATED_EVENT } from "./progress-events";

export interface AudioVoice { id: string; label: string; ext: string; engine?: string; count?: number }
export type WordAudioPlanItem = { kanji: string; kana: string; example: string };
export type VoiceDeliveryMode = "remote";
export const SYSTEM_VOICE_ID = "system";
const client = createAudioPackClient();
export const voiceDeliveryMode = (): VoiceDeliveryMode => "remote";
export const availableVoices = (): AudioVoice[] => client.voices();
export const defaultVoiceId = () => client.index?.default ?? null;
export const loadVoices = async () => { await client.load(); return availableVoices(); };

function resolveVoice(preferred = getStudyPreferences().voiceId): AudioPackVoice | null {
  if (preferred === SYSTEM_VOICE_ID) return null;
  const voices = client.voices();
  let allowed = false;
  try { allowed = voiceUnlocked(preferred, defaultVoiceId()); } catch { /* Before DB initialization use the free voice. */ }
  return voices.find(v => v.id === (allowed ? preferred : "")) ?? voices.find(v => v.id === defaultVoiceId()) ?? null;
}
export async function audioClip(key: string, preferred?: string | null, preview = false): Promise<Uint8Array | null> {
  if (preferred === SYSTEM_VOICE_ID) return null;
  await client.load();
  const voice = preview ? client.voices().find(v => v.id === preferred) : resolveVoice(preferred ?? undefined);
  return voice ? client.clip(voice, key) : null;
}
const OFFLINE_NOTICE_EVENT = "shushugo-audio-offline";
const noticeStorage = () => (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage;
const studyDayKey = () => { const date = new Date(); if (date.getHours() < 4) date.setDate(date.getDate() - 1); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };
const notifyOfflineOnce = () => {
  const day = studyDayKey();
  const key = `shushugo-audio-offline:${day}`;
  const wxStore = (globalThis as typeof globalThis & { wx?: { getStorageSync?: (key: string) => unknown; setStorageSync?: (key: string, value: unknown) => void } }).wx;
  try {
    const storage = noticeStorage();
    if (storage?.getItem(key) || wxStore?.getStorageSync?.(key)) return;
    storage?.setItem(key, "1");
  } catch { /* Storage can be unavailable in private mode; event remains best effort. */ }
  wxStore?.setStorageSync?.(key, "1");
  const isWeapp = Boolean((globalThis as typeof globalThis & { wx?: unknown }).wx);
  globalThis.dispatchEvent?.(new CustomEvent(OFFLINE_NOTICE_EVENT, { detail: { isWeapp } }));
};
export const AUDIO_OFFLINE_NOTICE_EVENT = OFFLINE_NOTICE_EVENT;

export async function prefetchWordPlanAudio(items: readonly WordAudioPlanItem[], tomorrow: readonly WordAudioPlanItem[] = []): Promise<void> {
  await client.load();
  const voice = resolveVoice();
  if (!voice) return;
  await client.selectVoice(voice.id).catch(() => undefined);
  const keys = items.flatMap(w => [clipKey("words", pronunciationAudioName(w.kanji, w.kana)), ...(w.example.trim() ? [clipKey("examples", exampleAudioName(w.example))] : [])]);
  const todayOk = await client.prefetch(voice, keys, true).catch(() => false);
  const tomorrowKeys = tomorrow.flatMap(w => [clipKey("words", pronunciationAudioName(w.kanji, w.kana)), ...(w.example.trim() ? [clipKey("examples", exampleAudioName(w.example))] : [])]);
  if (tomorrowKeys.length) await client.prefetch(voice, tomorrowKeys).catch(() => false);
  if (!todayOk) notifyOfflineOnce();
}
export async function prefetchExamples(sentences: readonly string[], preferred?: string | null): Promise<void> {
  await client.load();
  const voice = resolveVoice(preferred ?? undefined);
  if (voice) await client.prefetch(voice, sentences.filter(s => s.trim()).map(s => clipKey("examples", exampleAudioName(s)))).catch(() => undefined);
}
export const prefetchExample = (sentence: string, preferred?: string | null) => prefetchExamples([sentence], preferred);
export async function prefetchPronunciation(kanji: string, kana: string, preferred?: string | null): Promise<void> {
  await client.load();
  const voice = resolveVoice(preferred ?? undefined);
  if (voice && kana) await client.prefetch(voice, [clipKey("words", pronunciationAudioName(kanji, kana))]).catch(() => undefined);
}
const previewKey = () => clipKey("words", pronunciationAudioName("勉強", "べんきょう"));
export async function prefetchVoicePreviews(): Promise<void> {
  await client.load();
  await Promise.all(client.voices().map(v => client.prefetch(v, [previewKey()])));
}
export async function prepareVoice(voiceId: string): Promise<void> {
  await client.load();
  const voice = client.voices().find(v => v.id === voiceId);
  if (!voice || !await client.clip(voice, previewKey())) throw new Error("声音资源暂不可用");
}
if (typeof window !== "undefined") {
  window.addEventListener?.(TODAY_WORD_PLAN_UPDATED_EVENT, () => { void prefetchWordPlanAudio(readTodayWordAudioPlanUpdate()); });
}
