/**
 * 落盘本身的两条判据。都不看中间结构,只问「重启之后磁盘上是哪一份」。
 *
 * 这两条以前是**通过的测试覆盖不到的路**:现有测试盯的是调度纯函数和增量行往返,
 * 而这里出错的方式是「写完了,但写下去的是旧的那份」和「完整的新增量在磁盘上,
 * 启动却不读它」——两者都没有报错、没有日志,只有第二天少一段进度。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const exportDatabase = vi.fn<() => Uint8Array | null>();
const files = new Map<string, Uint8Array>();
const directories = new Set(['/wx-user']);
const platform = { value: 'web' };

const fail = (options: { fail?: (error: { errMsg: string }) => void }, message = 'no such file or directory') =>
  options.fail?.({ errMsg: `operate:fail ${message}` });
const fileManager = {
  mkdir({ dirPath, recursive, success, fail: onFail }: any) {
    if (recursive) {
      let current = '';
      dirPath.split('/').filter(Boolean).forEach((part: string) => {
        current += `/${part}`;
        directories.add(current);
      });
    } else if (directories.has(dirPath)) return fail({ fail: onFail }, 'file already exists');
    else directories.add(dirPath);
    success?.();
  },
  writeFile({ filePath, data, encoding, success }: any) {
    if (typeof data === 'string') files.set(filePath, new Uint8Array(Buffer.from(data, encoding || 'binary')));
    else files.set(filePath, new Uint8Array(data.slice(0)));
    success?.();
  },
  readFile({ filePath, encoding, success, fail: onFail }: any) {
    const data = files.get(filePath);
    if (!data) return fail({ fail: onFail });
    success?.({ data: encoding === 'utf8' ? Buffer.from(data).toString('utf8') : data.slice().buffer });
  },
  unlink({ filePath, success, fail: onFail }: any) {
    if (!files.delete(filePath)) return fail({ fail: onFail });
    success?.();
  },
  rename({ oldPath, newPath, success, fail: onFail }: any) {
    const data = files.get(oldPath);
    if (!data) return fail({ fail: onFail });
    files.set(newPath, data);
    files.delete(oldPath);
    success?.();
  },
  stat({ path, success, fail: onFail }: any) {
    if (files.has(path)) return success?.({ stats: { size: files.get(path)!.length, mtime: 1, ctime: 1, isDirectory: () => false } });
    if (directories.has(path)) return success?.({ stats: { size: 0, mtime: 1, ctime: 1, isDirectory: () => true } });
    return fail({ fail: onFail });
  },
  readdir({ dirPath, success, fail: onFail }: any) {
    if (!directories.has(dirPath)) return fail({ fail: onFail });
    const prefix = `${dirPath.replace(/\/$/, '')}/`;
    const names = new Set<string>();
    for (const path of [...files.keys(), ...directories]) {
      if (!path.startsWith(prefix)) continue;
      const name = path.slice(prefix.length).split('/')[0];
      if (name) names.add(name);
    }
    success?.({ files: [...names] });
  }
};
const fakeWx = {
  env: { USER_DATA_PATH: '/wx-user' },
  getFileSystemManager: () => fileManager,
  arrayBufferToBase64: (data: ArrayBuffer) => Buffer.from(data).toString('base64'),
  base64ToArrayBuffer: (data: string) => Uint8Array.from(Buffer.from(data, 'base64')).buffer
};
const setFile = (path: string, value: string) => {
  const parts = path.split('/').filter(Boolean);
  parts.pop();
  let current = '';
  parts.forEach((part) => { current += `/${part}`; directories.add(current); });
  files.set(path, new Uint8Array(Buffer.from(value)));
};

vi.mock("@capacitor/core", () => ({ Capacitor: {
  isNativePlatform: () => false,
  getPlatform: () => platform.value
} }));
vi.mock("@capacitor/preferences", () => ({ Preferences: { get: async () => ({ value: null }), remove: async () => undefined } }));
vi.mock("@capacitor/filesystem", async () => {
  // @ts-expect-error This platform CJS module is exercised directly by the fake wx filesystem.
  const shim = await import("../../../taro-spike-2/src/platform/filesystem.weapp.cjs");
  return shim.default ?? shim;
});
const importDatabase = vi.fn(async (_data: Uint8Array) => undefined);
vi.mock("./database", () => ({
  exportDatabase: () => exportDatabase(),
  getDatabase: () => ({ run: () => undefined }),
  importDatabase: (data: Uint8Array) => importDatabase(data)
}));

const applyDelta = vi.fn();
const resetDeviceId = vi.fn(() => "new-device");
vi.mock("./sync/schema", () => ({
  ensureSyncSchema: () => undefined,
  resetDeviceId: () => resetDeviceId()
}));

vi.mock("./local-delta", () => ({
  applyDelta: (delta: unknown) => applyDelta(delta),
  collectDelta: () => ({ from: "", to: "", rows: {}, tombstones: [] }),
  currentMark: () => "2026-09-10T00:00:00.000Z",
  deltaRowCount: () => 0,
  readSnapshotMark: () => "2026-09-10T00:00:00.000Z",
  stampSnapshotMark: () => undefined
}));

/**
 * 假 IndexedDB:**第一次**写盘故意慢一拍(50ms),后面的立刻完成。
 * 真实世界里两次写盘的完成顺序本来就不保证跟发起顺序一致 —— 旧的那次晚一点
 * 落地,磁盘上剩下的就是旧版本。
 */
const installIndexedDb = () => {
  const store = new Map<string, unknown>();
  let openedTransactions = 0;
  const objectStore = (queued: Array<() => void>) => ({
    get: (key: string) => {
      const request: Record<string, unknown> = { result: store.get(key) };
      queueMicrotask(() => (request.onsuccess as (() => void) | undefined)?.());
      return request;
    },
    put: (value: unknown, key: string) => { queued.push(() => store.set(key, value)); return {}; },
    delete: (key: string) => { queued.push(() => store.delete(key)); return {}; }
  });
  const db = {
    transaction: () => {
      const queued: Array<() => void> = [];
      const delay = openedTransactions++ === 0 ? 50 : 0;
      const transaction: Record<string, unknown> = { objectStore: () => objectStore(queued) };
      setTimeout(() => {
        for (const apply of queued) apply();
        (transaction.oncomplete as (() => void) | undefined)?.();
      }, delay);
      return transaction;
    },
    close: () => undefined,
    objectStoreNames: { contains: () => true }
  };
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: { open: () => {
      const request: Record<string, unknown> = { result: db };
      queueMicrotask(() => (request.onsuccess as (() => void) | undefined)?.());
      return request;
    } }
  });
  return { store };
};

beforeEach(() => {
  vi.useFakeTimers();
  directories.clear();
  directories.add('/wx-user');
  vi.stubGlobal('wx', fakeWx);
  vi.stubGlobal('navigator', { locks: { request: (_name: string, _options: unknown, callback: (lock: object) => unknown) => Promise.resolve(callback({})) } });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  files.clear();
  platform.value = 'web';
  applyDelta.mockReset();
  resetDeviceId.mockReset();
  Reflect.deleteProperty(globalThis as Record<string, unknown>, "indexedDB");
  exportDatabase.mockReset();
  importDatabase.mockClear();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("同时保存", () => {
  it("排队执行,后发起的那次不会被先发起的那次盖回去", async () => {
    const io = installIndexedDb();
    const { saveDatabase } = await import("./storage");

    exportDatabase.mockReturnValueOnce(new Uint8Array([1])); // 旧版本
    const first = saveDatabase();
    exportDatabase.mockReturnValueOnce(new Uint8Array([2])); // 新版本
    const second = saveDatabase();

    await vi.runAllTimersAsync();
    await Promise.all([first, second]);

    // ⚠️ 没有串行队列时,两次写盘共用同一份 tmp/基准,完成顺序一变主文件就从
    // 版本 2 退回版本 1。排队之后「最后发起的那次」一定是最后落盘的那次。
    expect(new Uint8Array(io.store.get("study-database") as ArrayBuffer)).toEqual(new Uint8Array([2]));
    // 而且第二次导出必须发生在第一次写完之后 —— 否则它导的是同一时刻的库。
    expect(exportDatabase).toHaveBeenCalledTimes(2);
  });
});

describe("微信文件存储", () => {
  it("增量只剩 .tmp 那一份时也要回放", async () => {
    platform.value = 'wechat';
    // 写增量的顺序是 write tmp → delete delta → rename tmp→delta。
    // ⚠️ 在 delete 之后、rename 之前被杀掉,磁盘上就是这个样子:
    // **完整的新增量在 tmp 里**,而启动只认 delta 的话它就白写了。
    setFile("/wx-user/masternihongo/nihongo.db", "ZmFrZQ==");
    setFile(
      "/wx-user/masternihongo/nihongo.delta.json.tmp",
      JSON.stringify({ from: "", to: "2099-01-01T00:00:00.000Z", rows: {}, tombstones: [] })
    );

    const { loadDatabase } = await import("./storage");
    expect(await loadDatabase()).toBe(true);
    expect(applyDelta).toHaveBeenCalledTimes(1);
  });

  it("串行保存时保留最后一次数据库", async () => {
    platform.value = 'wechat';
    const { saveDatabase } = await import("./storage");
    exportDatabase.mockReturnValueOnce(new Uint8Array([1]));
    const first = saveDatabase();
    exportDatabase.mockReturnValueOnce(new Uint8Array([2]));
    const second = saveDatabase();

    await Promise.all([first, second]);

    expect(Buffer.from(files.get('/wx-user/masternihongo/nihongo.db')!).toString('base64')).toBe('Ag==');
    expect(exportDatabase).toHaveBeenCalledTimes(2);
  });

  it("迁移原生小程序数据库时保留源文件", async () => {
    platform.value = 'wechat';
    setFile('/wx-user/shushugo/nihongo.db', 'bGVnYWN5');
    const { loadDatabase } = await import("./storage");

    expect(await loadDatabase()).toBe(true);
    expect(Buffer.from(files.get('/wx-user/shushugo/nihongo.db')!).toString()).toBe('bGVnYWN5');
    expect(Buffer.from(files.get('/wx-user/masternihongo/nihongo.db')!).toString()).toBe('bGVnYWN5');
  });

  it("整库读写按二进制直通，不经过 base64", async () => {
    // 小程序没有原生 atob / btoa，iOS 又没有 JIT：55 MB 的库绕一圈 base64 读写各要好几秒、
    // 还多占几百 MB（见 storage.ts FILE_BINARY 那段注释）。这里钉住「整库那条路上一次都不转」。
    platform.value = 'wechat';
    const toBase64 = vi.spyOn(fakeWx, 'arrayBufferToBase64');
    const fromBase64 = vi.spyOn(fakeWx, 'base64ToArrayBuffer');
    const bytes = new Uint8Array(4096).map((_, index) => (index * 31) & 255);
    const { saveDatabase } = await import("./storage");
    exportDatabase.mockReturnValueOnce(bytes);
    await saveDatabase();
    expect(files.get('/wx-user/masternihongo/nihongo.db')).toEqual(bytes);

    vi.resetModules();
    const reloaded = await import("./storage");
    expect(await reloaded.loadDatabase()).toBe(true);
    expect(importDatabase).toHaveBeenLastCalledWith(bytes);
    expect(toBase64).not.toHaveBeenCalled();
    expect(fromBase64).not.toHaveBeenCalled();
  });

  it("检查旧库时的 I/O 错误不能当成首次启动", async () => {
    platform.value = 'wechat';
    vi.spyOn(fileManager, 'stat').mockImplementationOnce(({ fail: onFail }: any) => {
      onFail?.({ errMsg: 'operate:fail permission denied' });
    });
    const { LocalArchiveUnreadableError, loadDatabase } = await import("./storage");

    await expect(loadDatabase()).rejects.toBeInstanceOf(LocalArchiveUnreadableError);
  });
});

describe("导入整库备份", () => {
  it("换掉本机设备号 —— 否则两台设备会生成一模一样的 sync_uid", async () => {
    installIndexedDb();
    exportDatabase.mockReturnValue(new Uint8Array([1]));
    const { restoreDatabaseBackup } = await import("./storage");

    const restore = restoreDatabaseBackup(new Uint8Array([9]));
    await vi.runAllTimersAsync();
    await restore;

    // ⚠️ 备份里带着导出那台设备的设备号；新 sync_uid 还带随机尾段。
    // 不换的话,两台设备各答一道**不同**的题会撞成同一个 uid,云端按 uid
    // 合并时把后到的那条当重复丢掉 —— 一次静默的、不可逆的丢数据。
    expect(resetDeviceId).toHaveBeenCalled();
  });
});
