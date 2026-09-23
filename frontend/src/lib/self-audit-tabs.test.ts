/** Two module instances model two tabs, sharing only browser storage and Web Locks. */
import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ activeDb: { id: 0 }, now: '2030-01-02T00:00:00.000Z' }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('@capacitor/preferences', () => ({ Preferences: { get: async () => ({ value: null }) } }));
vi.mock('./database', () => ({
  getDatabase: () => state.activeDb,
  importDatabase: async () => {},
  exportDatabase: () => new Uint8Array([state.activeDb.id])
}));
vi.mock('./sync/schema', () => ({ ensureSyncSchema: () => {}, resetDeviceId: () => {} }));
vi.mock('./sync/study-time', () => ({ rebuildStudyTimeAggregate: () => {} }));
vi.mock('./sync-api', () => ({ requestCloudAutoSync: () => {} }));
vi.mock('./dev-snapshot', () => ({ mirrorLiveSnapshot: async () => {} }));
vi.mock('./local-delta', () => ({
  applyDelta: () => {},
  currentMark: () => state.now,
  stampSnapshotMark: () => {},
  readSnapshotMark: () => '2030-01-01T00:00:00.000Z',
  deltaRowCount: () => 1,
  collectDelta: () => ({
    from: '2030-01-01T00:00:00.000Z', to: state.now,
    rows: { reviews: [{ word_id: state.activeDb.id, sync_uid: `tab:${state.activeDb.id}` }] }, tombstones: []
  })
}));
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); delete (globalThis as Record<string, unknown>).__shushugoBrowserWriter; });

// 真实的两个标签页各有自己的 globalThis；storage.ts 把已拿到的锁记在 globalThis 上
// （为了扛住开发时的热替换），所以这里切换「标签页」时要把那一格换进换出。
const realms = new Map<string, unknown>();
let currentRealm = '';
const enterRealm = (name: string) => {
  const g = globalThis as Record<string, unknown>;
  if (currentRealm) realms.set(currentRealm, g.__shushugoBrowserWriter);
  if (realms.get(name) === undefined) delete g.__shushugoBrowserWriter;
  else g.__shushugoBrowserWriter = realms.get(name);
  currentRealm = name;
};

it('second tab cannot load or overwrite a live writer; after closing it, persisted answers survive', async () => {
  const store = new Map<string, unknown>([['study-database', new Uint8Array([0]).buffer]]);
  const local = new Map<string, string>([['shushugo-study-database-revision', 'seed']]);
  let held = false;
  const lock = vi.fn(async (_name, _options, callback) => {
    if (held) return callback(null);
    held = true;
    return callback({ name: 'shushugo-study-database-write' });
  });
  vi.stubGlobal('navigator', { locks: { request: lock } });
  vi.stubGlobal('localStorage', { getItem: (k: string) => local.get(k) ?? null, setItem: (k: string, v: string) => local.set(k, v) });
  const db = {
    objectStoreNames: { contains: () => true }, close: () => {},
    transaction: () => {
      const transaction: Record<string, any> = { objectStore: () => ({
        get: (key: string) => {
          const request: Record<string, any> = { result: store.get(key) };
          queueMicrotask(() => request.onsuccess?.());
          return request;
        },
        put: (value: unknown, key: string) => { store.set(key, value); return {}; },
        delete: (key: string) => { store.delete(key); return {}; }
      }) };
      queueMicrotask(() => transaction.oncomplete?.());
      return transaction;
    }
  };
  vi.stubGlobal('indexedDB', { open: () => {
    const request: Record<string, any> = { result: db };
    queueMicrotask(() => request.onsuccess?.());
    return request;
  } });
  const aDb = { id: 1 };
  const bDb = { id: 2 };
  state.activeDb = aDb;
  enterRealm('A');
  const a = await import('./storage');
  await a.loadDatabase();
  vi.resetModules();
  state.activeDb = bDb;
  enterRealm('B');
  const b = await import('./storage');
  await expect(b.loadDatabase()).rejects.toThrow(/另一个窗口/);
  await expect(b.saveDatabase()).rejects.toThrow(/另一个窗口/);
  state.activeDb = aDb;
  enterRealm('A');
  a.scheduleSave(60_000);
  await a.flushPendingSave();
  // Closing tab A destroys its realm and releases the browser-owned lock.
  held = false;
  realms.clear(); currentRealm = '';
  vi.resetModules();
  state.activeDb = bDb;
  enterRealm('B2');
  const reopened = await import('./storage');
  await expect(reopened.loadDatabase()).resolves.toBe(true);
  const delta = JSON.parse(String(store.get('study-database-delta')));
  console.log('self-audit: Web Lock calls:', lock.mock.calls.length, 'persisted answers:', delta.rows.reviews);
  expect(delta.rows.reviews.map((row: { word_id: number }) => row.word_id).sort()).toEqual([1]);
  // A 一次；B 的 load 和 save 各申请一次（失败不记住，关掉 A 后「重试」才能拿到锁）；B2 一次。
  expect(lock).toHaveBeenCalledTimes(4);
  // Clock rollback must bypass a delta whose cursor excludes the new local edits.
  state.now = '2029-01-01T00:00:00.000Z';
  reopened.scheduleSave(60_000);
  await reopened.flushPendingSave();
  expect(Array.from(new Uint8Array(store.get('study-database') as ArrayBuffer))).toEqual([2]);
  expect(store.has('study-database-delta')).toBe(false);
});

it('hot module replacement in the same tab keeps the lock it already holds', async () => {
  let held = false;
  const lock = vi.fn(async (_name, _options, callback) => {
    if (held) return callback(null);
    held = true;
    return callback({ name: 'shushugo-study-database-write' });
  });
  vi.stubGlobal('navigator', { locks: { request: lock } });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  vi.stubGlobal('indexedDB', { open: () => {
    const request: Record<string, any> = { result: {
      objectStoreNames: { contains: () => true }, close: () => {},
      transaction: () => {
        const t: Record<string, any> = { objectStore: () => ({
          get: () => { const r: Record<string, any> = { result: undefined }; queueMicrotask(() => r.onsuccess?.()); return r; },
          put: () => ({}), delete: () => ({})
        }) };
        queueMicrotask(() => t.oncomplete?.());
        return t;
      }
    } };
    queueMicrotask(() => request.onsuccess?.());
    return request;
  } });
  const first = await import('./storage');
  await first.loadDatabase();
  vi.resetModules();                       // Vite 原地替换模块：同一个页面、同一个 globalThis
  const replaced = await import('./storage');
  await expect(replaced.saveDatabase()).resolves.toBeUndefined();
  expect(lock).toHaveBeenCalledTimes(1);
});
