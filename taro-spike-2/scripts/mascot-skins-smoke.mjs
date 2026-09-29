import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(root, '..');
const require = createRequire(import.meta.url);
const ts = require('typescript');
const realLoad = Module._load;
let runtime;

const addDirectories = (dir) => {
  const parts = dir.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) { current += `/${part}`; runtime.dirs.add(current); }
};

const makeRuntime = ({ manifest, networkError = false, failName = '', files = [], dirs = [], storage = [] } = {}) => {
  runtime = {
    manifest,
    networkError,
    failName,
    files: new Set(files),
    dirs: new Set(dirs),
    storage: new Map(storage),
    temporary: new Set(),
    downloads: [],
    requests: [],
    removedDirectories: [],
    events: [],
    modules: new Map()
  };
  const fs = {
    accessSync(filename) { if (!runtime.files.has(filename)) throw new Error('no such file'); },
    copyFile(options) {
      if (!runtime.temporary.has(options.srcPath)) return options.fail({ errMsg: 'no such file' });
      runtime.files.add(options.destPath);
      addDirectories(path.dirname(options.destPath));
      options.success();
    },
    readdir(options) {
      if (!runtime.dirs.has(options.dirPath)) return options.fail({ errMsg: 'no such file' });
      const prefix = `${options.dirPath}/`;
      const children = new Set();
      for (const entry of runtime.dirs) if (entry.startsWith(prefix)) children.add(entry.slice(prefix.length).split('/')[0]);
      for (const entry of runtime.files) if (entry.startsWith(prefix)) children.add(entry.slice(prefix.length).split('/')[0]);
      options.success({ files: [...children] });
    },
    rmdir(options) {
      const prefix = `${options.dirPath}/`;
      const existed = runtime.dirs.has(options.dirPath) || [...runtime.files].some((entry) => entry.startsWith(prefix));
      if (!existed) return options.fail({ errMsg: 'no such file' });
      runtime.removedDirectories.push(options.dirPath);
      runtime.dirs.delete(options.dirPath);
      for (const entry of [...runtime.dirs]) if (entry.startsWith(prefix)) runtime.dirs.delete(entry);
      for (const entry of [...runtime.files]) if (entry.startsWith(prefix)) runtime.files.delete(entry);
      options.success();
    }
  };
  const helpers = {
    async requestJson(url) {
      runtime.requests.push(url);
      if (runtime.networkError) throw new Error('offline');
      return runtime.manifest;
    },
    async downloadFile(url) {
      const name = decodeURIComponent(url.split('/').at(-1) ?? '');
      runtime.downloads.push(name);
      if (name === runtime.failName) throw new Error('download failed');
      const temporaryPath = `/wx-user/tmp-${runtime.downloads.length}`;
      runtime.temporary.add(temporaryPath);
      return temporaryPath;
    },
    async fileExists(filename) { return runtime.files.has(filename); },
    async makeDirectory(dirPath) { addDirectories(dirPath); },
    async removeFile(filename) { runtime.files.delete(filename); runtime.temporary.delete(filename); }
  };
  runtime.helpers = helpers;
  globalThis.wx = {
    env: { USER_DATA_PATH: '/wx-user' },
    getFileSystemManager: () => fs,
    getStorageSync: (key) => runtime.storage.get(key),
    setStorageSync: (key, value) => runtime.storage.set(key, value)
  };
  const listeners = new Map();
  globalThis.window = {
    addEventListener(type, callback) { const list = listeners.get(type) ?? []; list.push(callback); listeners.set(type, list); },
    removeEventListener(type, callback) { listeners.set(type, (listeners.get(type) ?? []).filter((item) => item !== callback)); },
    dispatchEvent(event) { runtime.events.push(event.type); for (const callback of listeners.get(event.type) ?? []) callback(event); return true; }
  };
  return { helpers };
};

const loadTypeScript = (filename) => {
  if (runtime.modules.has(filename)) return runtime.modules.get(filename).exports;
  const source = readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true
  } }).outputText;
  const compiled = new Module(filename);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  runtime.modules.set(filename, compiled);
  compiled._compile(output, filename);
  return compiled.exports;
};

Module._load = function (request, parent, isMain) {
  if (request === '../../../wechat-miniprogram/src/runtime/wx-promise.js') return runtime.helpers;
  if (request === '@tarojs/components') return { Image() {}, View() {} };
  if (request === '@tarojs/taro') return { getCurrentPages: () => [] };
  if (request === 'react') return { useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot() };
  if (request === 'react/jsx-runtime') return { jsx: () => null, jsxs: () => null, Fragment: Symbol('Fragment') };
  if (request.startsWith('.') && parent?.filename) {
    const base = path.resolve(path.dirname(parent.filename), request);
    for (const extension of ['.ts', '.tsx']) if (existsSync(`${base}${extension}`)) return loadTypeScript(`${base}${extension}`);
  }
  return realLoad.call(this, request, parent, isMain);
};

const loadMascot = () => loadTypeScript(path.join(root, 'src/platform/mascot.weapp.tsx'));
const skinId = 'mascot-croc';
const sharedFile = path.join(repo, 'frontend/src/lib/mascot-skins.ts');
const readShared = () => loadTypeScript(sharedFile).MASCOT_SKINS;
const manifest = (version = 'c0ffee01') => ({
  version,
  skins: { [skinId]: { files: [...readShared()[skinId].names] } }
});
const waitFor = async (condition) => {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.fail('等待皮肤缓存操作超时');
};

{
  makeRuntime({ networkError: true });
  const mascot = loadMascot();
  await assert.doesNotReject(mascot.prepareMascotSkins());
  assert.equal(mascot.mascotSkinReady(skinId), false);
}

let downloaded;
{
  makeRuntime({ manifest: manifest() });
  const mascot = loadMascot();
  await mascot.prepareMascotSkins();
  assert.equal(mascot.mascotSkinReady(skinId), true);
  mascot.setMascotSkin(skinId);
  await waitFor(() => runtime.storage.get(`mn-skin-ready:${skinId}`) === 'c0ffee01');
  const names = readShared()[skinId].names;
  assert.equal(runtime.downloads.length, names.length);
  assert.equal(runtime.files.size, names.length);
  assert.ok(runtime.files.has(`/wx-user/skins/${skinId}/c0ffee01/mood-default.png`));
  assert.ok(runtime.events.filter((event) => event === 'shushugo:mascot-skin').length >= 2);
  assert.equal(mascot.mascotSkinReady(skinId), true);
  downloaded = { files: [...runtime.files], dirs: [...runtime.dirs], storage: [...runtime.storage] };
}

{
  makeRuntime({ networkError: true, ...downloaded });
  const mascot = loadMascot();
  mascot.setMascotSkin(skinId);
  assert.equal(mascot.mascotSkinReady(skinId), true);
  assert.equal(mascot.stickerUrl('mood-happy', skinId), `/wx-user/skins/${skinId}/c0ffee01/mood-happy.png`);
  assert.equal(mascot.stickerUrl('mood-missing', skinId), `/wx-user/skins/${skinId}/c0ffee01/mood-default.png`);
  assert.equal(mascot.stickerUrl('tool-plan', skinId), '/assets/brand/tool-plan.png');
  assert.equal(mascot.brandIconUrl(skinId), `/wx-user/skins/${skinId}/c0ffee01/app-icon.png`);
  await waitFor(() => runtime.requests.length > 0);
  assert.equal(runtime.downloads.length, 0);
}

{
  makeRuntime({ manifest: manifest(), ...downloaded });
  const mascot = loadMascot();
  mascot.setMascotSkin(skinId);
  assert.equal(mascot.stickerUrl('mood-happy', skinId), `/wx-user/skins/${skinId}/c0ffee01/mood-happy.png`);
  await waitFor(() => runtime.events.filter((event) => event === 'shushugo:mascot-skin').length >= 2);
  assert.equal(runtime.downloads.length, 0);
}

{
  const oldVersion = 'old00001';
  const oldFiles = readShared()[skinId].names.map((name) => `/wx-user/skins/${skinId}/${oldVersion}/${name}.png`);
  const oldDirs = [`/wx-user/skins/${skinId}`, `/wx-user/skins/${skinId}/${oldVersion}`];
  makeRuntime({ manifest: manifest('new00002'), files: oldFiles, dirs: oldDirs, storage: [[`mn-skin-ready:${skinId}`, oldVersion]] });
  const mascot = loadMascot();
  await mascot.prepareMascotSkins();
  mascot.setMascotSkin(skinId);
  await waitFor(() => runtime.storage.get(`mn-skin-ready:${skinId}`) === 'new00002');
  assert.equal([...runtime.files].some((filename) => filename.includes(`/${oldVersion}/`)), false);
  assert.ok(runtime.removedDirectories.includes(`/wx-user/skins/${skinId}/${oldVersion}`));
}

{
  makeRuntime({ manifest: manifest('fail0003'), failName: 'mood-study.png' });
  const mascot = loadMascot();
  await mascot.prepareMascotSkins();
  mascot.setMascotSkin(skinId);
  const versionDir = `/wx-user/skins/${skinId}/fail0003`;
  await waitFor(() => runtime.removedDirectories.includes(versionDir));
  assert.equal(runtime.storage.has(`mn-skin-ready:${skinId}`), false);
  assert.equal([...runtime.files].some((filename) => filename.startsWith(`${versionDir}/`)), false);
  assert.equal(runtime.events.filter((event) => event === 'shushugo:mascot-skin').length, 1);
}

Module._load = realLoad;
console.log('吉祥物皮肤 smoke tests passed');
