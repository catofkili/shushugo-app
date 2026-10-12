import { audioClip } from "./speech-packs";
import { clipKey } from "./audio-pack-format";
import { exampleAudioName, pronunciationAudioName, speechText } from "./speech-audio";
export { exampleAudioName, pronunciationAudioName, pronunciationReading, speechText } from "./speech-audio";
export { availableVoices, defaultVoiceId, loadVoices, prefetchExample, prefetchExamples, prefetchPronunciation, prefetchVoicePreviews, prefetchWordPlanAudio, prepareVoice, SYSTEM_VOICE_ID, voiceDeliveryMode } from "./speech-packs";
export type { AudioVoice, WordAudioPlanItem, VoiceDeliveryMode } from "./speech-packs";

declare const wx: any;
type Kind = "words" | "examples";
const contexts: Partial<Record<Kind, any>> = {};
const sequence: Record<Kind, number> = { words: 0, examples: 0 };
const pending: Partial<Record<Kind, () => void>> = {};
function interrupt(kind: Kind): number {
  const current = ++sequence[kind];
  pending[kind]?.(); delete pending[kind];
  contexts[kind]?.offCanplay?.(); contexts[kind]?.offError?.(); contexts[kind]?.stop();
  return current;
}
async function play(kind: Kind, hash: string, voice?: string | null, preview = false): Promise<void> {
  const current = interrupt(kind);
  const bytes = await audioClip(clipKey(kind, hash), voice, preview);
  if (current !== sequence[kind]) return;
  if (!bytes) throw new Error("这条云端音频暂不可用，请稍后重试。");
  // Only two transient AAC files exist outside the pack LRU; each is overwritten on the next playback.
  const path = `${wx.env.USER_DATA_PATH}/audio-playing-${kind}.aac`;
  await new Promise<void>((resolve, reject) => wx.getFileSystemManager().writeFile({ filePath: path, data: bytes.slice().buffer, success: resolve, fail: reject }));
  if (current !== sequence[kind]) return;
  const context = contexts[kind] ??= wx.createInnerAudioContext();
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      if (current !== sequence[kind]) { resolve(); return; }
      delete pending[kind]; context.offCanplay?.(); context.offError?.();
      if (error) reject(error); else resolve();
    };
    pending[kind] = () => resolve();
    context.onCanplay(() => finish());
    context.onError(() => finish(new Error("这条云端音频暂不可用，请稍后重试。")));
    context.src = path; context.play();
  });
}
export async function playPronunciation(kanji: string, kana: string, preferred?: string | null): Promise<void> {
  if (speechText(kanji, kana)) await play("words", pronunciationAudioName(kanji, kana), preferred);
}
export async function playExample(sentence: string, preferred?: string | null): Promise<void> {
  if (sentence.trim()) await play("examples", exampleAudioName(sentence), preferred);
}
export async function previewVoice(voiceId: string): Promise<void> {
  interrupt("examples");
  await play("words", pronunciationAudioName("勉強", "べんきょう"), voiceId, true);
}
