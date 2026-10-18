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
const lastPath: Partial<Record<Kind, string>> = {};
let counter = 0;
let sweep: Promise<void> | undefined;
const root = () => wx.env.USER_DATA_PATH as string;
const fs = () => wx.getFileSystemManager();
const discard = (filePath: string) => new Promise<void>(resolve => fs().unlink({ filePath, success: () => resolve(), fail: () => resolve() }));
/** 每个进程第一次播放前，清掉上一次进程（或旧版固定文件名）留下的临时文件。 */
const sweepPlaying = () => new Promise<void>(resolve => fs().readdir({
  dirPath: root(),
  success: ({ files = [] }: { files?: string[] }) => { void Promise.all(files.filter(f => f.startsWith("audio-playing-")).map(f => discard(`${root()}/${f}`))).then(() => resolve()); },
  fail: () => resolve()
}));
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
  if (!bytes) { console.warn("[audio] 没取到音频", kind, hash, voice); throw new Error("这条云端音频暂不可用，请稍后重试。"); }
  // 每次播放换一个新文件名，播完下一次再删上一个。不能固定路径覆盖写：InnerAudioContext 对「src 没变」的赋值
  // 不会重新读文件，表现就是一直重放第一个词（2026-10-18 按症状+代码对照定位，尚未在真机上验证）。
  await (sweep ??= sweepPlaying());
  const path = `${root()}/audio-playing-${kind}-${Date.now()}-${++counter}.aac`;
  await new Promise<void>((resolve, reject) => fs().writeFile({ filePath: path, data: bytes.slice().buffer, success: resolve, fail: reject }));
  const stale = lastPath[kind]; lastPath[kind] = path;
  if (stale) void discard(stale);
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
