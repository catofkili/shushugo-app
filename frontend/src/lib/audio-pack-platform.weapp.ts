import { AudioPackClient, type AudioCacheEntry, type AudioPackStore } from "./audio-pack-cache";
declare const require: (path: string) => any;
declare const wx: any;
const config = require("../../../wechat-miniprogram/src/config.js");
// 小程序走云开发 SDK 取包；「线上网页不取包」只是公开网页的决定（见 audio-pack-platform.ts），这里恒为 false。
export const PUBLIC_WEB_WITHOUT_PACKS = false;
const { readFile, readCompressedFile, makeDirectory, removeFile } = require("../../../wechat-miniprogram/src/runtime/wx-promise.js");
const fs = wx.getFileSystemManager();
const root = `${wx.env.USER_DATA_PATH}/audio-packs`;
const base = String(config.audioPackBaseUrl).replace(/\/?$/, "/");
const call = (method: string, args: Record<string, unknown>) => new Promise<any>((resolve, reject) => fs[method]({ ...args, success: resolve, fail: reject }));
const pathFor = (name: string) => `${root}/${name.replace(/\//g, "_")}`;
const text = (bytes: Uint8Array) => typeof TextDecoder === "function" ? new TextDecoder().decode(bytes)
  : decodeURIComponent(Array.from(bytes, b => `%${b.toString(16).padStart(2, "0")}`).join(""));

export function weappAudioPackStore(): AudioPackStore {
  let entries: AudioCacheEntry[] = [];
  let ready: Promise<void> | undefined;
  const init = () => ready ??= (async () => {
    await makeDirectory(root);
    // Retire only the old speech cache's dated directories, leaving talk and other user files alone.
    const legacy = `${wx.env.USER_DATA_PATH}/audio`;
    const old = await call("readdir", { dirPath: legacy }).catch(() => ({ files: [] }));
    for (const day of old.files) if (/^\d{4}-\d{2}-\d{2}$/.test(day)) await call("rmdir", { dirPath: `${legacy}/${day}`, recursive: true });
    try { const data = (await call("readFile", { filePath: `${root}/lru.json`, encoding: "utf8" })).data; const parsed = JSON.parse(data); if (Array.isArray(parsed)) entries = parsed.filter(e => typeof e.name === "string" && !/[\\/]/.test(e.name.replace(/^voicevox-(8|10|11)\//, "")) && Number.isFinite(e.bytes) && e.bytes > 0 && Number.isFinite(e.used)); } catch { entries = []; }
    // Remove interrupted .tmp writes and unindexed files, so disk use cannot escape the LRU ledger.
    const keep = new Set(entries.map(e => pathFor(e.name).split("/").pop()));
    const { files = [] } = await call("readdir", { dirPath: root });
    for (const name of files) if (name.endsWith(".tmp") || ((name.endsWith(".sap") || name.includes("single-")) && !keep.has(name))) await removeFile(`${root}/${name}`).catch(() => undefined);
  })();
  const writeJson = async (name: string, value: unknown) => {
    await call("writeFile", { filePath: `${root}/${name}.tmp`, data: JSON.stringify(value), encoding: "utf8" });
    await call("rename", { oldPath: `${root}/${name}.tmp`, newPath: `${root}/${name}` });
  };
  const saveEntries = () => writeJson("lru.json", entries);
  return {
    list: async () => { await init(); return [...entries]; },
    read: async name => {
      await init();
      try { return await readFile(pathFor(name)) as Uint8Array; }
      catch { entries = entries.filter(e => e.name !== name); await saveEntries(); return null; }
    },
    write: async (entry, data) => {
      await init();
      const path = pathFor(entry.name);
      try {
        await call("writeFile", { filePath: `${path}.tmp`, data: data.slice().buffer });
        await call("rename", { oldPath: `${path}.tmp`, newPath: path });
        entries = [...entries.filter(e => e.name !== entry.name), entry];
        await saveEntries();
      } catch (error) { await removeFile(`${path}.tmp`).catch(() => undefined); throw error; }
    },
    touch: async entry => { await init(); entries = entries.map(e => e.name === entry.name ? entry : e); await saveEntries(); },
    remove: async name => { await init(); await removeFile(pathFor(name)).catch(() => undefined); entries = entries.filter(e => e.name !== name); await saveEntries(); },
    readIndex: async () => { await init(); try { return JSON.parse((await call("readFile", { filePath: `${root}/index.json`, encoding: "utf8" })).data); } catch { return null; } },
    writeIndex: async value => { await init(); await writeJson("index.json", value); }
  };
}

// Direct SDK download avoids one getTempFileURL request per prefetch pack (no byte-progress UI is needed).
async function downloaded<T>(name: string, read: (path: string) => Promise<T>): Promise<T> {
  wx.cloud.init({ env: config.cloudEnv, traceUser: false });
  const { tempFilePath } = await wx.cloud.downloadFile({ fileID: `${base}${name}` });
  try { return await read(tempFilePath); } finally { await removeFile(tempFilePath).catch(() => undefined); }
}
export function createAudioPackClient(): AudioPackClient {
  // Taro can duplicate this module across independent subpackages. One process-wide client owns the file ledger.
  const shared = globalThis as typeof globalThis & { __shushugoAudioPackClient?: AudioPackClient };
  return shared.__shushugoAudioPackClient ??= new AudioPackClient(weappAudioPackStore(), {
    pointer: () => downloaded("current.json", async path => JSON.parse(text(await readFile(path)))),
    index: version => downloaded(`index-${version}.json.br`, async path => JSON.parse(text(await readCompressedFile(path, "br")))),
    pack: name => downloaded(name, readFile),
    range: async (name, offset, length) => {
      const { fileList } = await wx.cloud.getTempFileURL({ fileList: [`${base}${name}`] });
      const result = await new Promise<any>((resolve, reject) => wx.request({ url: fileList[0].tempFileURL, header: { Range: `bytes=${offset}-${offset + length - 1}` }, responseType: "arraybuffer", success: resolve, fail: reject }));
      if (result.statusCode !== 200 && result.statusCode !== 206) throw new Error("这条云端音频暂不可用");
      if (result.statusCode === 206 && !String(result.header?.["Content-Range"] ?? result.header?.["content-range"]).startsWith(`bytes ${offset}-${offset + length - 1}/`)) throw new Error("Invalid audio range");
      return { bytes: new Uint8Array(result.data), partial: result.statusCode === 206 };
    }
  });
}
