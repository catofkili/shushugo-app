import { AUDIO_CACHE_BYTES, decodeAudioPack, validateAudioPackIndex, type AudioPackIndex, type AudioPackVoice } from "./audio-pack-format";

export interface AudioCacheEntry { name: string; voice: string; bytes: number; used: number }
export interface AudioPackStore {
  list(): Promise<AudioCacheEntry[]>;
  read(name: string): Promise<Uint8Array | null>;
  write(entry: AudioCacheEntry, data: Uint8Array): Promise<void>;
  touch(entry: AudioCacheEntry): Promise<void>;
  remove(name: string): Promise<void>;
  readIndex(): Promise<{ version: string; index: AudioPackIndex } | null>;
  writeIndex(value: { version: string; index: AudioPackIndex }): Promise<void>;
}
export interface AudioPackTransport {
  pointer(): Promise<{ version: string }>;
  index(version: string): Promise<unknown>;
  pack(name: string): Promise<Uint8Array>;
  range(name: string, offset: number, length: number): Promise<{ bytes: Uint8Array; partial: boolean }>;
}

export function audioLruVictims(entries: readonly AudioCacheEntry[], incoming: number, limit = AUDIO_CACHE_BYTES, protectedNames = new Set<string>()): string[] {
  let size = entries.reduce((sum, e) => sum + e.bytes, 0) + incoming;
  const victims: string[] = [];
  for (const e of [...entries].sort((a, b) => a.used - b.used || a.name.localeCompare(b.name))) {
    if (size <= limit) break;
    if (protectedNames.has(e.name)) continue;
    victims.push(e.name); size -= e.bytes;
  }
  return victims;
}

/** One cache policy for web/WKWebView and wx files. Only storage/transport are platform adapters. */
export class AudioPackClient {
  index: AudioPackIndex | null = null;
  private loading?: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  private downloads = new Map<string, Promise<void>>();
  private selectedVoice = "";
  private protectedPacks = new Set<string>();
  private retryAfter = 0;
  private transfers = 0;
  private transferWaiters: (() => void)[] = [];
  constructor(private store: AudioPackStore, private transport: AudioPackTransport, private limit = AUDIO_CACHE_BYTES) {}
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }
  private async transfer<T>(run: () => Promise<T>): Promise<T> {
    if (this.transfers >= 2) await new Promise<void>(resolve => this.transferWaiters.push(resolve));
    else this.transfers++;
    try { return await run(); }
    finally {
      const next = this.transferWaiters.shift();
      if (next) next(); else this.transfers--;
    }
  }
  async load(): Promise<void> {
    if (!this.index && Date.now() < this.retryAfter) return;
    return this.loading ??= (async () => {
      const cached = await this.store.readIndex().catch(() => null);
      if (cached) { try { this.index = validateAudioPackIndex(cached.index); } catch { /* Ignore damaged metadata. */ } }
      try {
        const pointer = await this.transport.pointer();
        if (!/^[0-9a-f]{64}$/.test(pointer.version)) throw new Error("Invalid audio version");
        if (this.index && cached?.version === pointer.version) return;
        const index = validateAudioPackIndex(await this.transport.index(pointer.version));
        await this.store.writeIndex({ version: pointer.version, index }).catch(() => undefined);
        this.index = index;
      } catch { /* Offline startup retains the last valid catalog. */ }
      if (!this.index) { this.retryAfter = Date.now() + 60_000; this.loading = undefined; }
    })();
  }
  voices(): AudioPackVoice[] { return this.index?.voices.filter(v => v.complete || v.id === this.index?.default) ?? []; }
  async selectVoice(id: string): Promise<void> {
    if (this.selectedVoice === id) return;
    this.selectedVoice = id;
    await this.serial(async () => {
      for (const e of await this.store.list()) if (e.voice !== id) await this.store.remove(e.name);
    });
  }
  private async save(name: string, voice: string, bytes: Uint8Array): Promise<void> {
    if (bytes.length > this.limit) throw new Error("Audio cache limit exceeded");
    await this.serial(async () => {
      const entries = (await this.store.list()).filter(e => e.name !== name);
      for (const victim of audioLruVictims(entries, bytes.length, this.limit, this.protectedPacks)) await this.store.remove(victim);
      // The 200 MB wx quota is shared with the learning DB; reclaim audio before retrying a quota failure.
      for (;;) {
        try { await this.store.write({ name, voice, bytes: bytes.length, used: Date.now() }, bytes); break; }
        catch (error) {
          if (!/quota|storage|space|exceed|容量|空间/i.test(String((error as { errMsg?: string })?.errMsg ?? error))) throw error;
          const oldest = (await this.store.list()).sort((a, b) => a.used - b.used).find(e => e.name !== name && !this.protectedPacks.has(e.name));
          if (!oldest) throw error;
          await this.store.remove(oldest.name);
        }
      }
    });
  }
  /** 整库落盘撞上配额时由 storage.ts 调用：清空缓存（含今天受保护的包），返回是否真腾出了东西。下载来的东西随时能再下。 */
  reclaim(): Promise<boolean> {
    return this.serial(async () => {
      const entries = await this.store.list();
      for (const e of entries) await this.store.remove(e.name);
      return entries.length > 0;
    });
  }
  private read(name: string): Promise<Uint8Array | null> {
    return this.serial(async () => {
      const data = await this.store.read(name);
      if (data) {
        const entry = (await this.store.list()).find(e => e.name === name);
        if (entry) await this.store.touch({ ...entry, used: Date.now() }).catch(() => undefined);
      }
      return data;
    });
  }
  async prefetch(voice: AudioPackVoice, keys: readonly string[], protect = false): Promise<boolean> {
    const selectedAtStart = this.selectedVoice;
    const packs = [...new Set(keys.flatMap(key => voice.clips[key] ? [voice.clips[key][0]] : []))];
    if (protect) { this.protectedPacks.clear(); for (const slot of packs) this.protectedPacks.add(voice.packs[slot][0]); }
    // 只有下载失败才算不完整：索引里本来就没有的 key（自导的词、改过的例句）不是网络问题，不能触发「没有网络」提示。
    let complete = true;
    // Two transfers keep the first pack responsive; the whole plan is queued on page entry.
    let cursor = 0;
    await Promise.all([0, 1].map(async () => {
      while (cursor < packs.length) {
        if (selectedAtStart !== this.selectedVoice) return;
        const [name, size] = voice.packs[packs[cursor++]];
        if (await this.read(name)) continue;
        let task = this.downloads.get(name);
        if (!task) {
          task = (async () => {
            const bytes = await this.transfer(() => this.transport.pack(name));
            if (bytes.length !== size) throw new Error("Truncated audio download");
            decodeAudioPack(bytes);
            if (selectedAtStart !== this.selectedVoice) return;
            await this.save(name, voice.id, bytes);
          })().finally(() => this.downloads.delete(name));
          this.downloads.set(name, task);
        }
        await task.catch(() => { complete = false; });
      }
    }));
    return complete;
  }
  /** Playback checks persistent cache first; a miss requests only this AAC range, never the whole plan. */
  async clip(voice: AudioPackVoice, key: string): Promise<Uint8Array | null> {
    const loc = voice.clips[key];
    if (!loc) return null;
    const [slot, offset, length] = loc;
    const [name, size] = voice.packs[slot];
    // The reading hash survives re-synthesis; include the pack hash so an old fallback cannot mask new audio.
    const single = `${name.slice(0, -4)}-single-${key.replace(":", "-")}.aac`;
    const read = async () => {
      const pack = await this.read(name);
      if (pack) {
        try {
          const range = decodeAudioPack(pack)[key];
          if (pack.length !== size || range?.[0] !== offset || range[1] !== length) throw new Error("Invalid cached audio range");
          return pack.slice(offset, offset + length);
        } catch { await this.serial(() => this.store.remove(name)); }
      }
      return this.read(single);
    };
    const downloading = this.downloads.get(name);
    const hit = await read();
    if (hit) return hit;
    // A click during prefetch joins that request instead of racing it with a second HTTP request.
    const pending = downloading ?? this.downloads.get(name);
    if (pending) { await pending.catch(() => undefined); const ready = await read(); if (ready) return ready; }
    // A fast save may finish between the pack read and the single-cache read, then remove its in-flight entry.
    const savedMeanwhile = await read();
    if (savedMeanwhile) return savedMeanwhile;
    const running = this.downloads.get(single);
    if (running) { await running; return read(); }
    const task = (async () => {
      const result = await this.transfer(() => this.transport.range(name, offset, length));
      if (result.partial) {
        if (result.bytes.length !== length) throw new Error("Truncated AAC range");
        await this.save(single, voice.id, result.bytes);
      } else {
        if (result.bytes.length !== size) throw new Error("Truncated audio pack");
        decodeAudioPack(result.bytes);
        await this.save(name, voice.id, result.bytes);
      }
    })().finally(() => this.downloads.delete(single));
    this.downloads.set(single, task);
    await task;
    return read();
  }
}
