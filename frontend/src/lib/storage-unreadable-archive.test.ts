import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// importDatabase 会真的起 sql.js/WASM，这里只关心「打不开时存档还在不在」。
const importDatabase = vi.fn();
vi.mock("./database", () => ({
  importDatabase: (...args: unknown[]) => importDatabase(...args),
  exportDatabase: () => null,
  getDatabase: () => null
}));

/** node 没有 IndexedDB。只实现 storage.ts 用到的那几步：open / get / put / close。 */
const installIndexedDb = (initial: Record<string, ArrayBuffer>) => {
  const store = new Map(Object.entries(initial));
  const objectStore = {
    get: (key: string) => {
      const request: Record<string, unknown> = { result: store.get(key) };
      queueMicrotask(() => (request.onsuccess as (() => void) | undefined)?.());
      return request;
    },
    put: (value: ArrayBuffer, key: string) => { store.set(key, value); return {}; },
    delete: (key: string) => { store.delete(key); return {}; }
  };
  const db = {
    transaction: () => {
      const transaction: Record<string, unknown> = { objectStore: () => objectStore };
      queueMicrotask(() => (transaction.oncomplete as (() => void) | undefined)?.());
      return transaction;
    },
    close: () => undefined,
    objectStoreNames: { contains: () => true }
  };
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: {
      open: () => {
        const request: Record<string, unknown> = { result: db };
        queueMicrotask(() => (request.onsuccess as (() => void) | undefined)?.());
        return request;
      }
    }
  });
  return store;
};

beforeEach(() => {
  vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown, callback: (lock: object) => unknown) => callback({}) } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis as Record<string, unknown>, "indexedDB");
  importDatabase.mockReset();
  vi.resetModules();
});

describe("浏览器端存档打不开时", () => {
  it("原样另存到 recovery key，不让出厂库把它覆盖掉", async () => {
    const archive = new Uint8Array([1, 2, 3, 4]).buffer;
    const store = installIndexedDb({ "study-database": archive });
    importDatabase.mockRejectedValue(new Error("Invalid ShuShuGo backup. Missing tables: progress"));

    const { loadDatabase, LocalArchiveUnreadableError } = await import("./storage");
    // ⚠️ 绝不能返回 false:调用方拿到 false 就去加载出厂库,而下一次落盘用的还是
    // 同一个 key —— 那份可能只是这次读不出来的存档会被出厂库盖掉。
    // 「有存档但打不开」必须抛出来,由启动画面交给用户决定。
    await expect(loadDatabase()).rejects.toBeInstanceOf(LocalArchiveUnreadableError);

    expect(store.get("recovery-unreadable-archive")).toEqual(archive);
  });

  it("已经存过一份坏存档就不再覆盖：第一份才是有价值的那份", async () => {
    const first = new Uint8Array([9, 9]).buffer;
    const store = installIndexedDb({ "study-database": new Uint8Array([1]).buffer, "recovery-unreadable-archive": first });
    importDatabase.mockRejectedValue(new Error("boom"));

    const { loadDatabase } = await import("./storage");
    await loadDatabase().catch(() => undefined);

    expect(store.get("recovery-unreadable-archive")).toBe(first);
  });
});

it('IndexedDB open errors must not initialize a factory database', async () => {
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: {
    open: () => {
      const request: Record<string, unknown> = { error: new Error('Access denied') };
      queueMicrotask(() => (request.onerror as () => void)());
      return request;
    }
  } });
  const { loadDatabase, LocalArchiveUnreadableError } = await import('./storage');
  await expect(loadDatabase()).rejects.toBeInstanceOf(LocalArchiveUnreadableError);
});
