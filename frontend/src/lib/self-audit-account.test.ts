import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import initSqlJs, { type Database } from 'sql.js';
let db: Database;
let SQL: Awaited<ReturnType<typeof initSqlJs>>;
const prefs = new Map<string, string>();
vi.mock('@capacitor/preferences', () => ({ Preferences: {
  get: async ({ key }: { key: string }) => ({ value: prefs.get(key) ?? null }),
  set: async ({ key, value }: { key: string; value: string }) => { prefs.set(key, value); },
  remove: async ({ key }: { key: string }) => { prefs.delete(key); }
} }));
let dbMissing = false;
vi.mock('./database', () => ({ getDatabase: () => { if (dbMissing) throw new Error('Database not initialized'); return db; } }));
vi.mock('./secure-token', () => ({ getCloudAccessToken: async () => 'synthetic-token' }));
vi.mock('./storage', () => ({ flushPendingSave: async () => {}, getLocalDataRevision: () => 0, saveDatabase: async () => {} }));
vi.mock('./study-core', () => ({ ensureSeedData: async () => {} }));
vi.mock('./sync/schema', () => ({ ensureSyncSchema: () => {}, getDeviceId: () => 'test-device' }));
vi.mock('./sync/merge', () => ({ mergeDatabaseBytes: async () => {} }));
vi.mock('./sync/snapshot', () => ({
  exportSyncSnapshot: async () => new Uint8Array([1]),
  compressSyncSnapshot: async (bytes: Uint8Array) => ({ bytes, compression: 'none' }),
  decompressSyncSnapshot: async (bytes: Uint8Array) => bytes,
  SYNC_PROTOCOL_VERSION: 2,
  SYNC_SNAPSHOT_FORMAT: 'master-nihongo-user-sqlite-v1'
}));
beforeAll(async () => { SQL = await initSqlJs(); });
beforeEach(() => {
  dbMissing = false;
  vi.stubEnv('VITE_SYNC_API_URL', 'https://self-audit.invalid');
  prefs.clear();
  prefs.set('mn_cloud_sync_email', 'b@example.invalid');
  db = new SQL.Database();
  db.run('CREATE TABLE reviews(id INTEGER PRIMARY KEY); INSERT INTO reviews VALUES(1)');
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(
    url.endsWith('/status') ? { available: false, last_modified: null, generation: 0 }
      : { generation: 1, timestamp: '2030-01-01T00:00:00.000Z' }
  ), { headers: { 'content-type': 'application/json' } })));
});
afterEach(() => { db.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('manual sync rejects records owned by another account before network access', async () => {
  prefs.set('mn_cloud_sync_owner_email', 'a@example.invalid');
  const { pullCloudBackup } = await import('./sync-api');
  await expect(pullCloudBackup()).rejects.toThrow(/另一个账号/);
  expect(fetch).not.toHaveBeenCalled();
  expect(prefs.get('mn_cloud_sync_owner_email')).toBe('a@example.invalid');
});

it('explicit manual upload can bind existing guest study data to the first account', async () => {
  const { pushCloudBackup } = await import('./sync-api');
  await expect(pushCloudBackup()).resolves.toBe('云端备份已上传。');
  expect(prefs.get('mn_cloud_sync_owner_email')).toBe('b@example.invalid');
});

it('failed first upload leaves guest data unbound and sends generation zero for empty cloud', async () => {
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    if (String(input).endsWith('/status')) return new Response(JSON.stringify({ available: false, generation: 0 }));
    expect(new Headers(init?.headers).get('X-Sync-Base-Generation')).toBe('0');
    return new Response('unavailable', { status: 503 });
  });
  const { pushCloudBackup } = await import('./sync-api');
  await expect(pushCloudBackup()).rejects.toThrow();
  expect(prefs.has('mn_cloud_sync_owner_email')).toBe(false);
});

it('manual upload cannot bind data already owned by another account', async () => {
  prefs.set('mn_cloud_sync_owner_email', 'a@example.invalid');
  const { pushCloudBackup } = await import('./sync-api');
  await expect(pushCloudBackup()).rejects.toThrow(/另一个账号/);
  expect(fetch).not.toHaveBeenCalled();
});

// 2026-11-05：小程序登录后发起的自动同步。本机有数据、没绑过账号：云端是空账号就上传绑定，云端有数据才报冲突（不混两份）。
it('auto sync on login uploads unowned local data to an empty cloud account and binds it', async () => {
  const { autoSyncCloudDatabase } = await import('./sync-api');
  await expect(autoSyncCloudDatabase('login')).resolves.toMatchObject({ status: 'uploaded' });
  expect(prefs.get('mn_cloud_sync_owner_email')).toBe('b@example.invalid');
});

it('auto sync on login keeps unowned local data apart from a cloud account that already has a snapshot', async () => {
  vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify(
    { available: true, last_modified: '2030-01-01T00:00:00.000Z', generation: 3 }
  )));
  const { autoSyncCloudDatabase } = await import('./sync-api');
  await expect(autoSyncCloudDatabase('login')).resolves.toMatchObject({ status: 'conflict' });
  expect(prefs.has('mn_cloud_sync_owner_email')).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('auto sync on startup still pulls when the local library is empty although the sync marker says up to date', async () => {
  db.run('DELETE FROM reviews; CREATE TABLE app_state(key TEXT PRIMARY KEY, value TEXT)');
  vi.stubGlobal('window', { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} });
  prefs.set('mn_cloud_sync_owner_email', 'b@example.invalid');
  prefs.set('mn_cloud_sync_state:b%40example.invalid', JSON.stringify({ lastSyncedGeneration: 3, localDirty: false }));
  vi.mocked(fetch).mockImplementation(async (input) => String(input).endsWith('/status')
    ? new Response(JSON.stringify({ available: true, last_modified: '2030-01-01T00:00:00.000Z', generation: 3 }))
    : new Response(new Uint8Array([1]), { headers: { 'content-type': 'application/octet-stream', 'x-sync-last-modified': '2030-01-01T00:00:00.000Z', 'x-sync-generation': '3' } }));
  const { autoSyncCloudDatabase } = await import('./sync-api');
  await expect(autoSyncCloudDatabase('startup')).resolves.toMatchObject({ status: 'downloaded' });
});

it('auto sync skips (no network) while the factory library is still downloading on first install', async () => {
  dbMissing = true;
  const { autoSyncCloudDatabase } = await import('./sync-api');
  await expect(autoSyncCloudDatabase('login')).resolves.toMatchObject({ status: 'skipped' });
  expect(fetch).not.toHaveBeenCalled();
});
