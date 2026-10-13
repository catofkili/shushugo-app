import { beforeEach, expect, it, vi } from "vitest";
import { AudioPackClient, type AudioPackStore } from "./audio-pack-cache";
import { clipKey, decodeAudioPack, encodeAudioPack, type AudioPackVoice } from "./audio-pack-format";
import { exampleAudioName, pronunciationAudioName } from "./speech-audio";

const state = vi.hoisted(() => ({ client: null as unknown as AudioPackClient, voiceId: "", unlocked: false }));
vi.mock("./audio-pack-platform", () => ({ createAudioPackClient: () => state.client }));
vi.mock("./studyPreferences", () => ({ getStudyPreferences: () => ({ voiceId: state.voiceId }), PREFERENCES_EVENT: "prefs" }));
vi.mock("./yuzu", () => ({ voiceUnlocked: (id: string, free: string) => id === free || state.unlocked }));

const plan = { kanji: "勉強", kana: "べんきょう", example: "日本語を勉強します。" };
const word = clipKey("words", pronunciationAudioName(plan.kanji, plan.kana));
const example = clipKey("examples", exampleAudioName(plan.example));
const bytes = encodeAudioPack(new Map([[word, new Uint8Array([1, 2])], [example, new Uint8Array([3, 4])]]));
const pack = vi.fn();
beforeEach(() => {
  vi.resetModules(); vi.stubGlobal("window", new EventTarget());
  state.voiceId = "voicevox-8"; state.unlocked = false; pack.mockReset().mockResolvedValue(bytes);
  const data = new Map<string, Uint8Array>();
  const store: AudioPackStore = { list: async () => [], read: async n => data.get(n) ?? null,
    write: async (e, b) => { data.set(e.name, b); }, touch: async () => {}, remove: async n => { data.delete(n); },
    readIndex: async () => null, writeIndex: async () => {} };
  const voices: AudioPackVoice[] = ["voicevox-8", "voicevox-10", "voicevox-11"].map(id => ({ id, label: id, ext: ".aac", engine: "voicevox", count: 1, complete: true,
    packs: [[`${id}/w-0-${"a".repeat(64)}.sap`, bytes.length]], clips: Object.fromEntries(Object.entries(decodeAudioPack(bytes)).map(([k, [o, l]]) => [k, [0, o, l]])) }));
  state.client = new AudioPackClient(store, { pointer: async () => ({ version: "b".repeat(64) }), index: async () => ({ format: 1, default: "voicevox-8", voices }), pack,
    range: async () => ({ bytes, partial: false }) });
});

it("prefetches today's word and example together before playback and shares the shop catalog", async () => {
  const speech = await import("./speech-packs");
  await speech.prefetchWordPlanAudio([plan, plan]);
  expect(await speech.audioClip(word)).toEqual(new Uint8Array([1, 2]));
  expect(await speech.audioClip(example)).toEqual(new Uint8Array([3, 4]));
  expect(pack).toHaveBeenCalledTimes(1);
  expect(speech.availableVoices().map(v => v.id)).toEqual(["voicevox-8", "voicevox-10", "voicevox-11"]);
  expect(speech.voiceDeliveryMode()).toBe("remote");
});

it("keeps an unpurchased selection on the free voice; shop preview/preparation can use the paid voice", async () => {
  const speech = await import("./speech-packs"); state.voiceId = "voicevox-10";
  await speech.prefetchWordPlanAudio([plan]);
  expect(pack.mock.calls[0][0]).toContain("voicevox-8/");
  await speech.prefetchVoicePreviews(); await speech.prepareVoice("voicevox-10");
  expect(pack).toHaveBeenCalledTimes(3);
  expect(await speech.audioClip(word, "voicevox-10", true)).toEqual(new Uint8Array([1, 2]));
  state.voiceId = "system"; await speech.prefetchWordPlanAudio([plan]);
  expect(await speech.audioClip(word, "system")).toBeNull(); expect(pack).toHaveBeenCalledTimes(3);
});

it("emits the offline notice at most once per study day when today's pack cannot download", async () => {
  const speech = await import("./speech-packs");
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
  pack.mockRejectedValue(new Error("offline"));
  const events: Event[] = [];
  const onEvent = (event: Event) => events.push(event);
  window.addEventListener(speech.AUDIO_OFFLINE_NOTICE_EVENT, onEvent);
  await speech.prefetchWordPlanAudio([plan]);
  await speech.prefetchWordPlanAudio([plan]);
  expect(events).toHaveLength(1);
});

it("does not claim the network is down when a planned word is simply missing from the index", async () => {
  const speech = await import("./speech-packs");
  const events: Event[] = [];
  window.addEventListener(speech.AUDIO_OFFLINE_NOTICE_EVENT, e => events.push(e));
  await speech.prefetchWordPlanAudio([plan, { kanji: "自導", kana: "じどう", example: "" }]);
  expect(events).toHaveLength(0);
});
