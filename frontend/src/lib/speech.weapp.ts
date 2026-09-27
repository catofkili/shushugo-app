import { getStudyPreferences } from "./studyPreferences";
import { today } from "./study-core";
import { readTodayWordAudioPlanUpdate, TODAY_WORD_PLAN_UPDATED_EVENT } from "./progress-events";
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
const { requestJson, downloadFile, fileExists, makeDirectory, removeFile } = require("../../../wechat-miniprogram/src/runtime/wx-promise.js");
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
const playbackSequence: Record<AudioKind, number> = { words: 0, examples: 0 };
const pendingPlayback: Partial<Record<AudioKind, { resolve: () => void }>> = {};

const fileSystem = wx.getFileSystemManager();
let audioDirectoryDay = "";
let audioDirectorySetup: Promise<void> | null = null;
const cachedDownloads = new Map<string, Promise<void>>();
type AudioRequest =
  | { kind: "words"; key: string; day: string; kanji: string; kana: string; preferred?: string | null }
  | { kind: "examples"; key: string; day: string; sentence: string; preferred?: string | null };
const urgentAudioQueue: AudioRequest[] = [];
let planAudioQueue: AudioRequest[] = [];
let audioQueueTimer: ReturnType<typeof setTimeout> | undefined;
let audioQueueRunning = false;
let activeAudioRequest: AudioRequest | null = null;

const audioRoot = () => `${wx.env.USER_DATA_PATH}/audio`;
const dayAudioRoot = (day: string) => `${audioRoot()}/${day}`;

const readDirectory = (dirPath: string): Promise<string[]> => new Promise((resolve, reject) => {
  fileSystem.readdir({ dirPath, success: (result: { files?: string[] }) => resolve(result.files ?? []), fail: reject });
});

const removeDirectory = (dirPath: string): Promise<void> => new Promise((resolve, reject) => {
  fileSystem.rmdir({ dirPath, recursive: true, success: () => resolve(), fail: (error: any) => {
    if (/no such file|not exist/i.test(error?.errMsg ?? "")) resolve();
    else reject(error);
  } });
});

const ensureAudioDirectory = (day: string): Promise<void> => {
  if (audioDirectoryDay === day && audioDirectorySetup) return audioDirectorySetup;
  audioDirectoryDay = day;
  audioDirectorySetup = (async () => {
    await makeDirectory(audioRoot());
    const oldDays = (await readDirectory(audioRoot())).filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name) && name !== day);
    await Promise.all(oldDays.map((name) => removeDirectory(`${audioRoot()}/${name}`)));
    await makeDirectory(dayAudioRoot(day));
  })().catch((error) => {
    if (audioDirectoryDay === day) audioDirectorySetup = null;
    throw error;
  });
  return audioDirectorySetup;
};

const localAudioPath = (url: string, day = today()): string | null => {
  const match = url.match(/\/(words|examples)\/([^/?#]+)\/([^/?#]+)(?:[?#].*)?$/);
  if (!match) return null;
  let voice = match[2];
  try { voice = decodeURIComponent(voice); } catch { /* Keep a valid path segment. */ }
  return `${dayAudioRoot(day)}/${match[1]}/${voice}/${match[3]}`;
};

const copyFile = (srcPath: string, destPath: string): Promise<void> => new Promise((resolve, reject) => {
  fileSystem.copyFile({ srcPath, destPath, success: () => resolve(), fail: reject });
});

const cacheAudioUrl = async (url: string, day = today()): Promise<void> => {
  const path = localAudioPath(url, day);
  if (!path) return;
  const running = cachedDownloads.get(path);
  if (running) return running;
  const task = (async () => {
    await ensureAudioDirectory(day);
    if (await fileExists(path)) return;
    const slash = path.lastIndexOf("/");
    await makeDirectory(path.slice(0, slash));
    const temporaryPath = await downloadFile(url, { retries: 1 });
    try {
      await copyFile(temporaryPath, path);
    } catch (error) {
      await removeFile(path).catch(() => undefined);
      throw error;
    } finally {
      await removeFile(temporaryPath).catch(() => undefined);
    }
  })().finally(() => cachedDownloads.delete(path));
  cachedDownloads.set(path, task);
  return task;
};

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

const requestUrl = async (request: AudioRequest): Promise<string | null> => {
  await loadIndex(request.kind);
  return request.kind === "words"
    ? pronunciationAudioUrl(request.kanji, request.kana, request.preferred)
    : exampleAudioUrl(request.sentence, request.preferred);
};

const scheduleAudioQueue = (delay = 0) => {
  if (audioQueueRunning || (!urgentAudioQueue.length && !planAudioQueue.length)) return;
  if (audioQueueTimer) clearTimeout(audioQueueTimer);
  audioQueueTimer = setTimeout(() => {
    audioQueueTimer = undefined;
    const request = urgentAudioQueue.shift() ?? planAudioQueue.shift();
    if (!request) return;
    if (request.day !== today()) { scheduleAudioQueue(); return; }
    audioQueueRunning = true;
    activeAudioRequest = request;
    void requestUrl(request)
      .then((url) => url ? cacheAudioUrl(url, request.day) : undefined)
      .catch(() => undefined)
      .finally(() => {
        audioQueueRunning = false;
        activeAudioRequest = null;
        scheduleAudioQueue(80);
      });
  }, delay);
};

const enqueueUrgentAudio = (request: AudioRequest) => {
  if (activeAudioRequest?.key === request.key || urgentAudioQueue.some((item) => item.key === request.key)) return;
  const planned = planAudioQueue.findIndex((item) => item.key === request.key);
  if (planned >= 0) planAudioQueue.splice(planned, 1);
  urgentAudioQueue.push(request);
  scheduleAudioQueue();
};

export type WordAudioPlanItem = { kanji: string; kana: string; example: string };

/** 主页空闲后调用。把今日未完成任务按 order_index 排队，下载顺序与计划一致。 */
export function prefetchWordPlanAudio(items: readonly WordAudioPlanItem[]): void {
  const day = today();
  void ensureAudioDirectory(day).catch(() => undefined);
  const seen = new Set<string>();
  planAudioQueue = items.flatMap((item): AudioRequest[] => {
    const requests: AudioRequest[] = item.kana ? [{
      kind: "words", key: `w:${item.kanji}|${item.kana}`, day, kanji: item.kanji, kana: item.kana
    }] : [];
    const sentence = item.example.trim();
    if (sentence) requests.push({ kind: "examples", key: `e:${sentence}`, day, sentence });
    return requests.filter((request) => {
      if (seen.has(request.key) || activeAudioRequest?.key === request.key || urgentAudioQueue.some((queued) => queued.key === request.key)) return false;
      seen.add(request.key);
      return true;
    });
  });
  scheduleAudioQueue();
}

/** 首屏预算出的下一张优先入队；其它队列中的相同读音会被挪到队首。 */
export async function prefetchPronunciation(kanji: string, kana: string, preferred?: string | null): Promise<void> {
  if (!speechText(kanji, kana)) return;
  enqueueUrgentAudio({ kind: "words", key: `w:${kanji}|${kana}`, day: today(), kanji, kana, preferred });
}

const interruptPlayback = (kind: AudioKind): number => {
  const sequence = ++playbackSequence[kind];
  pendingPlayback[kind]?.resolve();
  pendingPlayback[kind] = undefined;
  const context = contexts[kind];
  context?.offCanplay?.(); context?.offError?.();
  try { context?.stop(); } catch { /* A stopped context is already idle. */ }
  return sequence;
};

async function playFile(url: string | null, kind: AudioKind, sequence = interruptPlayback(kind)): Promise<void> {
  if (sequence !== playbackSequence[kind]) return;
  if (!url) throw new Error("云端音频索引或音色暂不可用，请检查网络后重试。");
  const context = contexts[kind] ??= wx.createInnerAudioContext();
  const cachedPath = localAudioPath(url);
  const source = cachedPath && await fileExists(cachedPath) ? cachedPath : url;
  if (sequence !== playbackSequence[kind]) return;
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      if (sequence !== playbackSequence[kind]) { resolve(); return; }
      pendingPlayback[kind] = undefined;
      context.offCanplay?.(); context.offError?.();
      if (error) reject(error); else resolve();
    };
    pendingPlayback[kind] = { resolve: () => finish() };
    context.onCanplay(() => finish());
    context.onError(() => finish(new Error("这条云端音频暂不可用，请稍后重试。")));
    try {
      context.src = source;
      context.play();
    } catch {
      finish(new Error("这条云端音频暂不可用，请稍后重试。"));
    }
  });
}

export async function playPronunciation(kanji: string, kana: string, preferred?: string | null): Promise<void> {
  if (!speechText(kanji, kana)) return;
  const sequence = interruptPlayback("words");
  await loadIndex("words");
  await playFile(pronunciationAudioUrl(kanji, kana, preferred), "words", sequence);
}
export async function playExample(sentence: string, preferred?: string | null): Promise<void> {
  const text = sentence.trim();
  if (!text) return;
  const sequence = interruptPlayback("examples");
  await loadIndex("examples");
  await playFile(exampleAudioUrl(text, preferred), "examples", sequence);
}
export async function previewVoice(voiceId: string): Promise<void> {
  await Promise.all([loadIndex("words"), loadIndex("examples")]);
  const sentence = "毎日少しずつ、日本語を勉強しています。";
  const examples = indexes.examples?.voices.find((voice) => voice.id === voiceId);
  if (examples) return playFile(exampleAudioUrl(sentence, voiceId), "examples");
  return playFile(pronunciationAudioUrl("勉強", "べんきょう", voiceId), "words");
}
const prepared = new Set<string>();
export async function prepareVoice(voiceId: string): Promise<void> {
  if (prepared.has(voiceId)) return;
  await loadIndex("words");
  const voice = indexes.words?.voices.find((item) => item.id === voiceId);
  if (!voice) throw new Error("云端音色暂不可用。");
  const url = pronunciationAudioUrl("勉強", "べんきょう", voiceId);
  if (url) await cacheAudioUrl(url);
  prepared.add(voiceId);
}
export async function prefetchExample(sentence: string, preferred?: string | null): Promise<void> {
  const text = sentence.trim();
  if (text) enqueueUrgentAudio({ kind: "examples", key: `e:${text}`, day: today(), sentence: text, preferred });
}

window.addEventListener(TODAY_WORD_PLAN_UPDATED_EVENT, () => {
  prefetchWordPlanAudio(readTodayWordAudioPlanUpdate());
});
