import { beforeEach, describe, expect, it, vi } from "vitest";
import { AudioPackClient, audioLruVictims, type AudioPackStore, type AudioCacheEntry } from "./audio-pack-cache";
import { encodeAudioPack, decodeAudioPack, validateAudioPackIndex, type AudioPackIndex, type AudioPackVoice } from "./audio-pack-format";

const word = "w:0123456789abcdef", example = "e:fedcba9876543210";
const bytes = encodeAudioPack(new Map([[word, new Uint8Array([1, 2, 3])], [example, new Uint8Array([4, 5, 6, 7])]]));
const name = `voicevox-8/w-r1-i5-0-${"a".repeat(64)}.sap`;
const voice: AudioPackVoice = { id: "voicevox-8", label: "春日部つむぎ", ext: ".aac", engine: "voicevox", count: 1, complete: true,
  packs: [[name, bytes.length]], clips: Object.fromEntries(Object.entries(decodeAudioPack(bytes)).map(([key, [offset, length]]) => [key, [0, offset, length]])) };
const index: AudioPackIndex = { format: 1, default: voice.id, voices: [voice] };

describe("audio packs", () => {
  let data: Map<string, Uint8Array>, entries: Map<string, AudioCacheEntry>;
  let meta: { version: string; index: AudioPackIndex } | null;
  let store: AudioPackStore;
  const version = "b".repeat(64);
  const transport = { pointer: vi.fn(), index: vi.fn(), pack: vi.fn(), range: vi.fn() };
  const client = (limit?: number) => new AudioPackClient(store, transport, limit);
  beforeEach(() => {
    data = new Map(); entries = new Map(); meta = null;
    store = { list: async () => [...entries.values()], read: async n => data.get(n) ?? null,
      write: async (e, b) => { entries.set(e.name, e); data.set(e.name, b); }, touch: async e => { entries.set(e.name, e); },
      remove: async n => { entries.delete(n); data.delete(n); }, readIndex: async () => meta, writeIndex: async m => { meta = m; } };
    vi.resetAllMocks();
    transport.pointer.mockResolvedValue({ version }); transport.index.mockResolvedValue(index);
    transport.pack.mockResolvedValue(bytes);
    transport.range.mockImplementation(async (_name, offset, length) => ({ bytes: bytes.slice(offset, offset + length), partial: true }));
  });

  it("round-trips a pack and rejects a truncated/overlapping payload", () => {
    const ranges = decodeAudioPack(bytes);
    expect(bytes.slice(ranges[word][0], ranges[word][0] + ranges[word][1])).toEqual(new Uint8Array([1, 2, 3]));
    expect(bytes.slice(ranges[example][0], ranges[example][0] + ranges[example][1])).toEqual(new Uint8Array([4, 5, 6, 7]));
    expect(() => decodeAudioPack(bytes.slice(0, -1))).toThrow();
    const broken = bytes.slice(); broken[8] = 91;
    expect(() => decodeAudioPack(broken)).toThrow();
    expect(() => encodeAudioPack(new Map([["../escape", new Uint8Array([1])]]))).toThrow();
  });

  it("expands the shared-key wire catalog and rejects path traversal/out-of-bounds mapping", () => {
    const wire = { ...index, keys: [word, example], voices: [{ ...voice, clips: [voice.clips[word], voice.clips[example]] }] };
    expect(validateAudioPackIndex(wire)).toEqual(index);
    expect(() => validateAudioPackIndex({ ...index, voices: [{ ...voice, packs: [["../outside.sap", bytes.length]] }] })).toThrow();
    expect(() => validateAudioPackIndex({ ...index, voices: [{ ...voice, clips: { [word]: [0, 8, bytes.length] } }] })).toThrow();
    expect(() => validateAudioPackIndex({ ...wire, keys: [word, word] })).toThrow();
  });

  it("downloads one pack for both sounds and never requests again on a persistent cache hit", async () => {
    const c = client(); await c.load();
    await c.prefetch(voice, [word, example, word]);
    expect(await c.clip(voice, word)).toEqual(new Uint8Array([1, 2, 3]));
    expect(await c.clip(voice, example)).toEqual(new Uint8Array([4, 5, 6, 7]));
    const restarted = client(); await restarted.load(); await restarted.prefetch(voice, [word, example]);
    await restarted.clip(voice, example);
    expect(transport.pack).toHaveBeenCalledTimes(1); expect(transport.range).not.toHaveBeenCalled();
    expect(transport.index).toHaveBeenCalledTimes(1); // Only the tiny pointer is checked on restart.
  });

  it("joins concurrent page prefetch and playback instead of making a second request", async () => {
    let finish!: (b: Uint8Array) => void;
    transport.pack.mockImplementation(() => new Promise<Uint8Array>(r => { finish = r; }));
    const c = client(); await c.load();
    const tasks = [c.prefetch(voice, [word]), c.prefetch(voice, [example])];
    await vi.waitFor(() => expect(transport.pack).toHaveBeenCalledTimes(1));
    const playing = c.clip(voice, example); finish(bytes);
    await Promise.all(tasks); expect(await playing).toEqual(new Uint8Array([4, 5, 6, 7]));
    expect(transport.range).not.toHaveBeenCalled();
  });

  it("fetches one AAC range on a miss and keys that fallback by content version", async () => {
    const c = client(); await c.load();
    await c.clip(voice, word); await c.clip(voice, word);
    expect(transport.range).toHaveBeenCalledTimes(1); expect(transport.pack).not.toHaveBeenCalled();
    const updated = { ...voice, packs: [[name.replace("a".repeat(64), "c".repeat(64)), bytes.length]] as [string, number][] };
    await c.clip(updated, word);
    expect(transport.range).toHaveBeenCalledTimes(2);
  });

  it("uses a full returned pack when the server ignores Range", async () => {
    transport.range.mockResolvedValue({ bytes, partial: false });
    const c = client(); await c.clip(voice, word); await c.clip(voice, example);
    expect(transport.range).toHaveBeenCalledTimes(1); expect(data.has(name)).toBe(true);
  });

  it("does not persist broken downloads and retries them on the next page entry", async () => {
    transport.pack.mockResolvedValueOnce(bytes.slice(0, -1));
    const c = client(); await c.prefetch(voice, [word]); expect(data.size).toBe(0);
    await c.prefetch(voice, [word]); expect(data.size).toBe(1);
    expect(transport.pack).toHaveBeenCalledTimes(2);
  });

  it("evicts least recently used packs before writing and drops the old voice on switch", async () => {
    const old: AudioCacheEntry = { name: "old", voice: "voicevox-10", bytes: bytes.length, used: 1 };
    const fresh = { ...old, name: "fresh", voice: "voicevox-8", used: 2 };
    entries.set(old.name, old); entries.set(fresh.name, fresh); data.set("old", bytes); data.set("fresh", bytes);
    expect(audioLruVictims([...entries.values()], bytes.length, bytes.length * 2)).toEqual(["old"]);
    expect(audioLruVictims([...entries.values()], bytes.length, bytes.length * 2, new Set(["old"]))).toEqual(["fresh"]);
    const c = client(bytes.length * 2); await c.prefetch(voice, [word]);
    expect([...entries.keys()].sort()).toEqual(["fresh", name].sort());
    await c.selectVoice("voicevox-11"); expect(entries.size).toBe(0);
  });

  it("retains the valid offline catalog, fetches an index only when its version changes, and hides incomplete paid voices", async () => {
    const c = client(); await c.load();
    transport.pointer.mockRejectedValueOnce(new Error("offline"));
    const offline = client(); await offline.load(); expect(offline.voices()).toEqual([voice]);
    transport.pointer.mockResolvedValue({ version: "d".repeat(64) });
    const paid = { ...voice, id: "voicevox-10", complete: false, packs: [] as [string, number][], clips: {} };
    transport.index.mockResolvedValue({ ...index, voices: [voice, paid] });
    const updated = client(); await updated.load(); expect(updated.voices()).toEqual([voice]);
    expect(transport.index).toHaveBeenCalledTimes(2);
  });

  it("removes a corrupted on-disk pack before using the single-clip fallback", async () => {
    data.set(name, bytes.slice(0, -1));
    const c = client(); expect(await c.clip(voice, word)).toEqual(new Uint8Array([1, 2, 3]));
    expect(data.has(name)).toBe(false); expect(transport.range).toHaveBeenCalledTimes(1);
  });
});
