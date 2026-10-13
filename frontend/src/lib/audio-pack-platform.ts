import { Capacitor } from "@capacitor/core";
import { AudioPackClient, type AudioCacheEntry, type AudioPackStore } from "./audio-pack-cache";
import type { AudioPackIndex } from "./audio-pack-format";

// 线上公开网页不取音频包，一律系统朗读（作者 2026-10-13：「网页端不能赚钱而且容易被破，我不想管理，核心功能存在就行」）。
// 只有 App（Capacitor）和本机 dev 取包。fetchAudio 直接失败、不发请求；load() 吞掉错误，audioClip 返回 null → speech.ts 退回系统声音。
export const PUBLIC_WEB_WITHOUT_PACKS = !import.meta.env.DEV && !Capacitor.isNativePlatform();

// CloudBase's public CDN URL, same bucket as cloudbaserc.json / config.js. No SDK or signed URL on web/iOS.
// 作者本机 5173 读本机打好的包（frontend/audio-pack-dist，gitignore；Vite dev 按项目根目录直接提供），不走云。
// 要在本机测云端那条路时：VITE_AUDIO_PACKS=cloud npm run dev。（2026-10-13 作者定）
export const AUDIO_PACK_BASE = import.meta.env.DEV && import.meta.env.VITE_AUDIO_PACKS !== "cloud"
  ? `${import.meta.env.BASE_URL}audio-pack-dist/`
  : "https://636c-cloud1-d3g7dauie3961575b-1491634527.tcb.qcloud.la/audio/packs/";

export function browserAudioPackStore(): AudioPackStore {
  let opening: Promise<IDBDatabase> | undefined;
  const open = () => opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("shushugo-audio-packs", 1);
    request.onupgradeneeded = () => { for (const name of ["bytes", "entries", "meta"]) request.result.createObjectStore(name); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { opening = undefined; reject(request.error); };
  });
  const get = async <T>(store: string, key: string): Promise<T | null> => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const request = db.transaction(store).objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  };
  const change = async (names: string[], run: (tx: IDBTransaction) => void) => {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(names, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("Audio cache write failed"));
      run(tx);
    });
  };
  return {
    async list() {
      const db = await open();
      return new Promise((resolve, reject) => {
        const request = db.transaction("entries").objectStore("entries").getAll();
        request.onsuccess = () => resolve(request.result as AudioCacheEntry[]);
        request.onerror = () => reject(request.error);
      });
    },
    read: async name => { const bytes = await get<ArrayBuffer>("bytes", name); return bytes ? new Uint8Array(bytes) : null; },
    write: (entry, data) => change(["bytes", "entries"], tx => {
      tx.objectStore("bytes").put(data.slice().buffer, entry.name);
      tx.objectStore("entries").put(entry, entry.name);
    }),
    touch: entry => change(["entries"], tx => { tx.objectStore("entries").put(entry, entry.name); }),
    remove: name => change(["bytes", "entries"], tx => { tx.objectStore("bytes").delete(name); tx.objectStore("entries").delete(name); }),
    readIndex: () => get<{ version: string; index: AudioPackIndex }>("meta", "index"),
    writeIndex: value => change(["meta"], tx => { tx.objectStore("meta").put(value, "index"); })
  };
}

const fetchAudio = async <T>(path: string, read: (response: Response) => Promise<T>, headers?: Record<string, string>): Promise<T> => {
  if (PUBLIC_WEB_WITHOUT_PACKS) throw new Error("网页版不取音频包");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${AUDIO_PACK_BASE}${path}`, { headers, signal: controller.signal, cache: path === "current.json" ? "no-cache" : "default" });
    if (!response.ok) throw new Error(`Audio HTTP ${response.status}`);
    return await read(response);
  } finally { clearTimeout(timer); }
};

export function createAudioPackClient(): AudioPackClient {
  return new AudioPackClient(browserAudioPackStore(), {
    pointer: () => fetchAudio("current.json", response => response.json()),
    index: version => fetchAudio(`index-${version}.json.gz`, async response => {
      const bytes = await response.arrayBuffer();
      // Accept both raw .gz files and servers that already apply Content-Encoding: gzip.
      const data = new Uint8Array(bytes);
      if (data[0] !== 0x1f || data[1] !== 0x8b) return JSON.parse(new TextDecoder().decode(data));
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
      return JSON.parse(await new Response(stream).text());
    }),
    pack: name => fetchAudio(name, async response => new Uint8Array(await response.arrayBuffer())),
    range: (name, offset, length) => fetchAudio(name, async response => {
      if (response.status === 206 && !response.headers.get("Content-Range")?.startsWith(`bytes ${offset}-${offset + length - 1}/`)) throw new Error("Invalid audio Content-Range");
      return { bytes: new Uint8Array(await response.arrayBuffer()), partial: response.status === 206 };
    }, { Range: `bytes=${offset}-${offset + length - 1}` })
  });
}
