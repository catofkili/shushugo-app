import { MASCOT_SKIN_EVENT, MASCOT_SKINS } from '../../../frontend/src/lib/mascot-skins';

declare const wx: any;
declare const require: (path: string) => any;

const config = require('../../../wechat-miniprogram/src/config.js');
const { downloadFile, fileExists, makeDirectory, removeFile, requestJson } = require('../../../wechat-miniprogram/src/runtime/wx-promise.js');
const skinRoot = `${wx.env.USER_DATA_PATH}/skins`;

type SkinManifest = { version: string; skins: Record<string, { files: string[] }> };
let manifest: SkinManifest | null = null;
let manifestRequest: Promise<SkinManifest | null> | null = null;
const downloads = new Map<string, Promise<string | null>>();

export const prepareMascotSkins = async (): Promise<SkinManifest | null> => {
  if (manifest) return manifest;
  if (!manifestRequest) {
    manifestRequest = (async () => {
      try {
        const value = await requestJson(`${String(config.skinBaseUrl || '').replace(/\/$/, '')}/manifest.json`);
        if (!value || typeof value.version !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(value.version) || !value.skins || typeof value.skins !== 'object') return null;
        manifest = value as SkinManifest;
        return manifest;
      } catch {
        return null;
      }
    })();
  }
  const result = await manifestRequest;
  if (!result) manifestRequest = null;
  return result;
};

const readDirectory = (dirPath: string): Promise<string[]> => new Promise((resolve, reject) => {
  wx.getFileSystemManager().readdir({ dirPath, success: (result: { files?: string[] }) => resolve(result.files ?? []), fail: reject });
});

const removeDirectory = (dirPath: string): Promise<void> => new Promise((resolve, reject) => {
  wx.getFileSystemManager().rmdir({ dirPath, recursive: true, success: () => resolve(), fail: (error: any) => {
    if (/no such file|not exist/i.test(error?.errMsg ?? '')) resolve();
    else reject(error);
  } });
});

const complete = async (id: string, version: string, names: readonly string[]) => {
  const dir = `${skinRoot}/${id}/${version}`;
  return (await Promise.all(names.map((name) => fileExists(`${dir}/${name}.png`)))).every(Boolean);
};

const yieldToMainThread = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export const downloadMascotSkin = (id: string): Promise<string | null> => {
  const running = downloads.get(id);
  if (running) return running;
  const task = (async (): Promise<string | null> => {
    const skin = MASCOT_SKINS[id as keyof typeof MASCOT_SKINS];
    const data = await prepareMascotSkins();
    const entry = data?.skins?.[id];
    if (!skin || !entry || !Array.isArray(entry.files) || !skin.names.every((name) => entry.files.includes(name))) return null;
    const version = data!.version;
    const storedVersion = wx.getStorageSync(`mn-skin-ready:${id}`);
    if (storedVersion === version && await complete(id, version, skin.names)) {
      wx.setStorageSync(`mn-skin-ready:${id}`, version);
      if (typeof window !== 'undefined') window.dispatchEvent(new Event(MASCOT_SKIN_EVENT));
      return version;
    }

    const skinDir = `${skinRoot}/${id}`;
    const versionDir = `${skinDir}/${version}`;
    await makeDirectory(skinDir);
    await removeDirectory(versionDir);
    await makeDirectory(versionDir);
    try {
      for (const name of skin.names) {
        const temporaryPath = await downloadFile(`${String(config.skinBaseUrl).replace(/\/$/, '')}/${id}/${name}.png`);
        const destination = `${versionDir}/${name}.png`;
        try {
          await new Promise<void>((resolve, reject) => {
            wx.getFileSystemManager().copyFile({ srcPath: temporaryPath, destPath: destination, success: () => resolve(), fail: reject });
          });
        } catch (error) {
          await removeFile(destination).catch(() => undefined);
          throw error;
        } finally {
          await removeFile(temporaryPath).catch(() => undefined);
        }
        await yieldToMainThread();
      }
      const oldVersions = (await readDirectory(skinDir)).filter((name) => name !== version);
      await Promise.all(oldVersions.map((name) => removeDirectory(`${skinDir}/${name}`)));
      wx.setStorageSync(`mn-skin-ready:${id}`, version);
      if (typeof window !== 'undefined') window.dispatchEvent(new Event(MASCOT_SKIN_EVENT));
      return version;
    } catch (error) {
      await removeDirectory(versionDir).catch(() => undefined);
      throw error;
    }
  })().finally(() => downloads.delete(id));
  downloads.set(id, task);
  return task;
};
