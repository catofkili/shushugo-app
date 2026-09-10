/**
 * 落盘本身的两条判据。都不看中间结构,只问「重启之后磁盘上是哪一份」。
 *
 * 这两条以前是**通过的测试覆盖不到的路**:现有测试盯的是调度纯函数和增量行往返,
 * 而这里出错的方式是「写完了,但写下去的是旧的那份」和「完整的新增量在磁盘上,
 * 启动却不读它」——两者都没有报错、没有日志,只有第二天少一段进度。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const exportDatabase = vi.fn<() => Uint8Array | null>();
const files = new Map<string, string>();
const isNative = { value: false };

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => isNative.value } }));
vi.mock("@capacitor/preferences", () => ({ Preferences: { get: async () => ({ value: null }), remove: async () => undefined } }));
vi.mock("@capacitor/filesystem", () => ({
  Directory: { Library: "LIBRARY" },
  Encoding: { UTF8: "utf8" },
  Filesystem: {
    readFile: async ({ path }: { path: string }) => {
      if (!files.has(path)) throw new Error(`ENOENT ${path}`);
      return { data: files.get(path) };
    },
    writeFile: async ({ path, data }: { path: string; data: string }) => { files.set(path, data); },
    deleteFile: async ({ path }: { path: string }) => { files.delete(path); },
    rename: async ({ from, to }: { from: string; to: string }) => {
      files.set(to, files.get(from)!);
      files.delete(from);
    },
    stat: async ({ path }: { path: string }) => {
      if (!files.has(path)) throw new Error(`ENOENT ${path}`);
      return { size: 0 };
    }
  }
}));
vi.mock("./database", () => ({
  exportDatabase: () => exportDatabase(),
  getDatabase: () => ({ run: () => undefined }),
  importDatabase: async () => undefined
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
});

afterEach(() => {
  vi.useRealTimers();
  files.clear();
  isNative.value = false;
  applyDelta.mockReset();
  resetDeviceId.mockReset();
  Reflect.deleteProperty(globalThis as Record<string, unknown>, "indexedDB");
  exportDatabase.mockReset();
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

describe("原生端启动", () => {
  it("增量只剩 .tmp 那一份时也要回放", async () => {
    isNative.value = true;
    // 写增量的顺序是 write tmp → delete delta → rename tmp→delta。
    // ⚠️ 在 delete 之后、rename 之前被杀掉,磁盘上就是这个样子:
    // **完整的新增量在 tmp 里**,而启动只认 delta 的话它就白写了。
    files.set("masternihongo/nihongo.db", "ZmFrZQ==");
    files.set(
      "masternihongo/nihongo.delta.json.tmp",
      JSON.stringify({ from: "", to: "2099-01-01T00:00:00.000Z", rows: {}, tombstones: [] })
    );

    const { loadDatabase } = await import("./storage");
    expect(await loadDatabase()).toBe(true);
    expect(applyDelta).toHaveBeenCalledTimes(1);
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

    // ⚠️ 备份里带着导出那台设备的设备号,而 sync_uid = 设备号:本机自增 id。
    // 不换的话,两台设备各答一道**不同**的题会撞成同一个 uid,云端按 uid
    // 合并时把后到的那条当重复丢掉 —— 一次静默的、不可逆的丢数据。
    expect(resetDeviceId).toHaveBeenCalled();
  });
});
