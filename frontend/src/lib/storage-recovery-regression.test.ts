/** 故障注入只使用种子库与内存文件系统；以重新加载后的数据验证持久化。 */
import { beforeAll, beforeEach, afterEach, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import initSqlJs from 'sql.js';
let db: import('sql.js').Database, SQL: import('sql.js').SqlJsStatic;
const opened: import('sql.js').Database[] = [];
const io = vi.hoisted(() => ({ files: new Map<string, string>(), failWrite: false, failRead: false, gate: null as Promise<void> | null, entered: null as (() => void) | null }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock('@capacitor/preferences', () => ({ Preferences: { get: async () => ({ value: null }), remove: async () => { } } }));
vi.mock('@capacitor/filesystem', () => ({ Directory: { Library: 'lib' }, Encoding: { UTF8: 'utf8' }, Filesystem: {
        readdir: async ({ path }: {
            path: string;
        }) => ({ files: path === '' ? [{ name: 'masternihongo' }] : [...io.files.keys()].map(key => ({ name: key.split('/').pop() })) }),
        readFile: async ({ path }: {
            path: string;
        }) => { if (io.failRead)
            throw Error('Permission denied'); if (!io.files.has(path))
            throw Error('ENOENT'); return { data: io.files.get(path) }; },
        writeFile: async ({ path, data }: {
            path: string;
            data: string;
        }) => { if (io.failWrite) {
            io.failWrite = false;
            throw Error('Quota exceeded');
        } const g = io.gate; io.gate = null; io.entered?.(); io.entered = null; if (g)
            await g; io.files.set(path, data); },
        stat: async ({ path }: {
            path: string;
        }) => { if (!io.files.has(path))
            throw Error('ENOENT'); return {}; },
        deleteFile: async ({ path }: {
            path: string;
        }) => { io.files.delete(path); },
        rename: async ({ from, to }: {
            from: string;
            to: string;
        }) => { if (!io.files.has(from))
            throw Error('ENOENT'); io.files.set(to, io.files.get(from)!); io.files.delete(from); }
    } }));
vi.mock('./database.ts', () => ({
    getDatabase: () => db, exportDatabase: () => db.export(), initDatabase: async () => db,
    importDatabase: async (bytes: Uint8Array) => { db = new SQL.Database(bytes); opened.push(db); }
}));
const core = await import('./study-core.ts');
const { ensureSyncSchema } = await import('./sync/schema.ts');
const storage = await import('./storage.ts');
const one = (sql: string, args: (string | number | null)[] = []) => db.exec(sql, args)[0]?.values[0]?.[0];
beforeAll(async () => { SQL = await initSqlJs(); });
beforeEach(async () => { io.files.clear(); io.failRead = false; io.failWrite = false; io.gate = null; db = new SQL.Database(new Uint8Array(readFileSync(new URL('../../public/nihongo.db', import.meta.url)))); opened.push(db); core.ensureUserTables(); ensureSyncSchema(); db.run('INSERT OR IGNORE INTO progress(word_id) VALUES(1),(2)'); await storage.saveDatabase({ notifyCloud: false }); });
afterEach(async () => { await storage.flushPendingSave(); for (const d of opened.splice(0))
    d.close(); });
it('native I/O read failure blocks factory initialization', async () => {
    io.failRead = true;
    await expect(storage.loadDatabase()).rejects.toBeInstanceOf(storage.LocalArchiveUnreadableError);
    io.failRead = false;
});
it('failed full snapshot preserves both earlier and later edits after restart', async () => {
    db.run('UPDATE progress SET seen_count=7 WHERE word_id=1');
    await new Promise(r => setTimeout(r, 20));
    io.failWrite = true;
    await expect(storage.saveDatabase({ notifyCloud: false })).rejects.toThrow('Quota exceeded');
    await new Promise(r => setTimeout(r, 20));
    db.run('UPDATE progress SET seen_count=9 WHERE word_id=2');
    storage.scheduleSave(100000);
    await storage.flushPendingSave();
    await storage.loadDatabase();
    expect(one('SELECT seen_count FROM progress WHERE word_id=1')).toBe(7);
    expect(one('SELECT seen_count FROM progress WHERE word_id=2')).toBe(9);
});
it('content snapshot requested during a save survives restart', async () => {
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>(r => entered = r);
    io.entered = entered;
    io.gate = new Promise<void>(r => release = r);
    const writing = storage.saveDatabase({ notifyCloud: false });
    await ready;
    db.run("UPDATE words SET meaning='NEW_CONTENT' WHERE id=1");
    db.run("INSERT OR REPLACE INTO app_state(key,value) VALUES('test-content-version','new')");
    storage.requestFullSnapshot();
    storage.scheduleSave(100000);
    release();
    await writing;
    await storage.flushPendingSave();
    await storage.loadDatabase();
    expect(one('SELECT meaning FROM words WHERE id=1')).toBe('NEW_CONTENT');
    expect(one("SELECT value FROM app_state WHERE key='test-content-version'")).toBe('new');
});
it('empty native archive blocks factory initialization', async () => {
    io.files.set('masternihongo/nihongo.db', '');
    await expect(storage.loadDatabase()).rejects.toBeInstanceOf(storage.LocalArchiveUnreadableError);
});
it('missing native archives allow first installation', async () => {
    io.files.clear();
    expect(await storage.loadDatabase()).toBe(false);
});
it('startup recovery failure remains visible after a successful save', async () => {
    io.files.set('masternihongo/nihongo.delta.json', '{broken');
    await storage.loadDatabase();
    expect(storage.getPersistenceFailure()).toBe('recovery');
    await storage.saveDatabase({ notifyCloud: false });
    expect(storage.getPersistenceFailure()).toBe('recovery');
});
