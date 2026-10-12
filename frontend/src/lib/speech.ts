import { audioClip } from "./speech-packs";
import { clipKey } from "./audio-pack-format";
import { exampleAudioName, pronunciationAudioName, speechText } from "./speech-audio";
export { exampleAudioName, pronunciationAudioName, pronunciationReading, speechText } from "./speech-audio";
export { availableVoices, defaultVoiceId, loadVoices, prefetchExample, prefetchExamples, prefetchPronunciation, prefetchVoicePreviews, prefetchWordPlanAudio, prepareVoice, SYSTEM_VOICE_ID, voiceDeliveryMode } from "./speech-packs";
export type { AudioVoice, WordAudioPlanItem, VoiceDeliveryMode } from "./speech-packs";

let audioElement: HTMLAudioElement | null = null;
let objectUrl: string | null = null;
let sequence = 0;
/** The system voice remains the fallback for user-imported content or unavailable cloud audio. */
function speakWithSynthesis(text: string): void {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ja-JP";
  utterance.rate = 0.88;
  window.speechSynthesis.speak(utterance);
}
async function play(key: string, text: string, voice?: string | null, preview = false): Promise<void> {
  const current = ++sequence;
  audioElement?.pause();
  window.speechSynthesis?.cancel();
  try {
    const bytes = await audioClip(key, voice, preview);
    if (current !== sequence) return;
    if (!bytes) { speakWithSynthesis(text); return; }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: "audio/aac" }));
    audioElement ??= new Audio();
    audioElement.src = objectUrl;
    audioElement.onended = () => { if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = null; };
    await audioElement.play();
  } catch { if (current === sequence) speakWithSynthesis(text); }
}
export async function playPronunciation(kanji: string, kana: string, preferred?: string | null): Promise<void> {
  const text = speechText(kanji, kana);
  if (text) await play(clipKey("words", pronunciationAudioName(kanji, kana)), text, preferred);
}
export async function playExample(sentence: string, preferred?: string | null): Promise<void> {
  const text = sentence.trim();
  if (text) await play(clipKey("examples", exampleAudioName(text)), text, preferred);
}
export const previewVoice = (voiceId: string) => play(clipKey("words", pronunciationAudioName("勉強", "べんきょう")), "ベンキョウ", voiceId, true);
