import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { brotliCompressSync, brotliDecompressSync } from "node:zlib";
import { runInNewContext } from "node:vm";
import { encodeAudioPack, decodeAudioPack } from "./audio-pack-format";
import { pronunciationAudioName, exampleAudioName } from "./speech-audio";

vi.mock("./audio-pack-platform", () => import("./audio-pack-platform.weapp"));
vi.mock("./studyPreferences", () => ({ getStudyPreferences: () => ({ voiceId: "voicevox-8" }), PREFERENCES_EVENT: "prefs" }));
vi.mock("./yuzu", () => ({ voiceUnlocked: (id: string) => id !== "voicevox-11" }));

const runtime = vi.hoisted(() => {
  const files = new Map<string, Uint8Array>();
  const listeners: { canplay?: () => void; error?: () => void } = {};
  const context = { src: "", stop: vi.fn(), play: vi.fn(),
    offCanplay: vi.fn(() => { listeners.canplay = undefined; }), offError: vi.fn(() => { listeners.error = undefined; }),
    onCanplay: vi.fn((fn: () => void) => { listeners.canplay = fn; }), onError: vi.fn((fn: () => void) => { listeners.error = fn; }), listeners };
  return { files, context, downloadedIds: [] as string[], removedDirectory: "", fs: {} as Record<string, (...args: any[]) => void>,
    cloud: { init: vi.fn(), getTempFileURL: vi.fn(), downloadFile: vi.fn() } };
});
const version = "b".repeat(64);
const word = (kanji: string, kana: string) => `w:${pronunciationAudioName(kanji, kana)}`;
const keys = [word("灰皿", "はいざら"), word("箸", "はし"), word("勉強", "べんきょう"), `e:${exampleAudioName("灰皿を使います。")}`];

beforeEach(() => {
  vi.resetModules(); delete (globalThis as any).__shushugoAudioPackClient;
  runtime.files.clear(); runtime.downloadedIds.length = 0; runtime.removedDirectory = "";
  runtime.context.offCanplay(); runtime.context.offError(); vi.clearAllMocks();
  const encoder = new TextEncoder();
  Object.assign(runtime.fs, {
    readdir: (o: any) => o.success({ files: o.dirPath.endsWith("/audio") ? ["2026-09-26", "talk"]
      : o.dirPath === "/wx-user" ? [...runtime.files.keys()].filter(p => p.startsWith("/wx-user/") && !p.slice(9).includes("/")).map(p => p.slice(9)) : [] }),
    rmdir: (o: any) => { runtime.removedDirectory = o.dirPath; o.success(); }, mkdir: (o: any) => o.success(),
    stat: (o: any) => runtime.files.has(o.path) ? o.success({ stats: { size: runtime.files.get(o.path)!.length } }) : o.fail({ errMsg: "no such file" }),
    readFile: (o: any) => {
      const data = runtime.files.get(o.filePath);
      if (!data) return o.fail({ errMsg: "no such file" });
      o.success({ data: o.encoding === "utf8" ? new TextDecoder().decode(data) : data.slice().buffer });
    },
    readCompressedFile: (o: any) => o.success({ data: runInNewContext("Uint8Array.from(bytes).buffer", { bytes: [...brotliDecompressSync(runtime.files.get(o.filePath)!)] }) }),
    writeFile: (o: any) => { runtime.files.set(o.filePath, typeof o.data === "string" ? encoder.encode(o.data) : new Uint8Array(o.data)); o.success(); },
    rename: (o: any) => { runtime.files.set(o.newPath, runtime.files.get(o.oldPath)!); runtime.files.delete(o.oldPath); o.success(); },
    unlink: (o: any) => { runtime.files.delete(o.filePath); o.success(); }
  });
  const packs = new Map<string, Uint8Array>();
  const voices = [8, 11].map(id => {
    const data = encodeAudioPack(new Map(keys.map(k => [k, new Uint8Array([id, 2, 3])])));
    const name = `voicevox-${id}/w-0-${"a".repeat(64)}.sap`; packs.set(name, data);
    return { id: `voicevox-${id}`, label: `voice ${id}`, ext: ".aac", engine: "voicevox", count: 3, complete: true,
      packs: [[name, data.length]], clips: Object.fromEntries(Object.entries(decodeAudioPack(data)).map(([k, [offset, length]]) => [k, [0, offset, length]])) };
  });
  const index = { format: 1, default: "voicevox-8", voices };
  runtime.cloud.downloadFile.mockImplementation(async ({ fileID }: { fileID: string }) => {
    runtime.downloadedIds.push(fileID); const path = `/wx-user/tmp-${runtime.downloadedIds.length}`;
    const relative = fileID.split("/audio/packs/")[1];
    const content = relative === "current.json" ? encoder.encode(JSON.stringify({ version }))
      : relative.endsWith(".br") ? new Uint8Array(brotliCompressSync(JSON.stringify(index))) : packs.get(relative)!;
    runtime.files.set(path, content); return { tempFilePath: path };
  });
  vi.stubGlobal("wx", { env: { USER_DATA_PATH: "/wx-user" }, cloud: runtime.cloud, getFileSystemManager: () => runtime.fs, createInnerAudioContext: () => runtime.context });
  vi.stubGlobal("window", { addEventListener: vi.fn(), dispatchEvent: vi.fn() });
});

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); delete (globalThis as any).__shushugoAudioPackClient; });

describe("小程序音频包缓存与播放", () => {
  it("downloads a word and example once into USER_DATA_PATH and retires only the old dated cache", async () => {
    const speech = await import("./speech.weapp");
    const plan = [{ kanji: "灰皿", kana: "はいざら", example: "灰皿を使います。" }];
    await speech.prefetchWordPlanAudio(plan); await speech.prefetchWordPlanAudio(plan);
    expect(runtime.downloadedIds.filter(id => id.endsWith(".sap"))).toHaveLength(1);
    expect(runtime.downloadedIds.filter(id => id.includes("index-"))).toHaveLength(1);
    expect(runtime.cloud.getTempFileURL).not.toHaveBeenCalled();
    expect([...runtime.files.keys()].filter(p => p.endsWith(".sap"))).toHaveLength(1);
    expect(runtime.removedDirectory).toBe("/wx-user/audio/2026-09-26");
    expect([...runtime.files.keys()].some(p => p.endsWith(".tmp"))).toBe(false);
  });

  it("settles the previous playback on interruption and rejects only the current audio error", async () => {
    const speech = await import("./speech.weapp");
    await speech.prefetchWordPlanAudio([{ kanji: "灰皿", kana: "はいざら", example: "" }]);
    const previous = speech.playPronunciation("灰皿", "はいざら");
    await vi.waitFor(() => expect(runtime.context.onError).toHaveBeenCalledTimes(1));
    const current = speech.playPronunciation("箸", "はし");
    const rejection = expect(current).rejects.toThrow("暂不可用"); await expect(previous).resolves.toBeUndefined();
    await vi.waitFor(() => expect(runtime.context.onError).toHaveBeenCalledTimes(2)); runtime.context.listeners.error?.(); await rejection;
  });

  it("gives every playback a fresh src, or the player replays the first word forever", async () => {
    runtime.files.set("/wx-user/audio-playing-words.aac", new Uint8Array([9])); // 旧版固定文件名的遗留
    const speech = await import("./speech.weapp");
    await speech.prefetchWordPlanAudio([{ kanji: "灰皿", kana: "はいざら", example: "" }, { kanji: "箸", kana: "はし", example: "" }]);
    const srcs: string[] = [];
    for (const [kanji, kana] of [["灰皿", "はいざら"], ["箸", "はし"]]) {
      const done = speech.playPronunciation(kanji, kana);
      await vi.waitFor(() => expect(runtime.context.onCanplay).toHaveBeenCalled());
      srcs.push(runtime.context.src); runtime.context.listeners.canplay?.(); await done; runtime.context.onCanplay.mockClear();
    }
    expect(srcs[0]).not.toBe(srcs[1]);
    await vi.waitFor(() => expect([...runtime.files.keys()].filter(p => p.includes("audio-playing-")).sort()).toEqual([srcs[1]]));
  });

  it("previews the unpurchased voice from its own cached pack and interrupts the active word", async () => {
    const speech = await import("./speech.weapp"); await speech.prefetchVoicePreviews();
    const current = speech.playPronunciation("灰皿", "はいざら");
    await vi.waitFor(() => expect(runtime.context.onError).toHaveBeenCalledTimes(1));
    const stops = runtime.context.stop.mock.calls.length, preview = speech.previewVoice("voicevox-11");
    expect(runtime.context.stop).toHaveBeenCalledTimes(stops + 1); await expect(current).resolves.toBeUndefined();
    await vi.waitFor(() => expect(runtime.context.onError).toHaveBeenCalledTimes(2));
    expect(runtime.files.get(runtime.context.src)).toEqual(new Uint8Array([11, 2, 3]));
    runtime.context.listeners.canplay?.(); await preview;
  });
});
