// Exercise the real Worker routes/SQL against in-memory SQLite; no cloud resources.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const outdir = mkdtempSync(join(tmpdir(), 'shushugo-sync-route-'));
const built = spawnSync(join(root, 'node_modules/.bin/wrangler'), ['deploy', '--dry-run', '--outdir', outdir], { cwd: root, encoding: 'utf8' });
if (built.status !== 0) throw new Error(`${built.stdout}\n${built.stderr}`);
const db = new DatabaseSync(':memory:');
const objects = new Map();
const kvObjects = new Map();
const RealDate = globalThis.Date;
let now = RealDate.parse('2030-01-20T04:00:00.000Z');
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
};
let failBatch = false;
const statement = (sql, params = []) => ({
  bind: (...args) => statement(sql, args),
  first: async () => db.prepare(sql).get(...params) ?? null,
  all: async () => ({ results: db.prepare(sql).all(...params) }),
  run: async () => ({ success: true, meta: { changes: db.prepare(sql).run(...params).changes } }),
  execute: () => ({ success: true, meta: { changes: db.prepare(sql).run(...params).changes } })
});
const env = {
  DB: {
    prepare: statement,
    batch: async statements => {
      if (failBatch) { failBatch = false; throw new Error('injected D1 failure'); }
      db.exec('BEGIN');
      try { const result = statements.map(s => s.execute()); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    }
  },
  SYNC_BUCKET: {
    put: async (key, bytes) => { objects.set(key, new Uint8Array(bytes)); },
    get: async key => objects.has(key) ? { body: objects.get(key), arrayBuffer: async () => objects.get(key).slice().buffer } : null,
    delete: async key => { objects.delete(key); }
  },
  SYNC_DATA: { get: async key => kvObjects.get(key) ?? null, delete: async key => { kvObjects.delete(key); } }
};
try {
  for (const file of readdirSync(join(root, 'migrations')).filter(f => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(root, 'migrations', file), 'utf8'));
  }
  for (const user of ['a', 'b', 'c', 'd']) {
    db.prepare('INSERT INTO users(id,email,password_hash,password_salt,created_at) VALUES(?,?,?,?,?)').run(user, `${user}@example.invalid`, '', '', '2030-01-01');
    db.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)').run(createHash('sha256').update(`token-${user}`).digest('base64url'), user, '2030-01-01', '2099-01-01');
  }
  const worker = (await import(pathToFileURL(join(outdir, 'index.js')).href)).default;
  const call = (path, options = {}, user = 'a') => worker.fetch(new Request(`https://sync.test/api/sync/${path}`, {
    ...options, headers: { authorization: `Bearer token-${user}`, ...options.headers }
  }), env, { waitUntil() {} });
  const push = (bytes, base, op, user = 'a') => call('push', {
    method: 'POST', body: new Uint8Array(bytes), headers: {
      'content-type': 'application/octet-stream', 'x-sync-format': 'master-nihongo-user-sqlite-v1',
      'x-sync-compression': 'none', 'x-sync-base-generation': String(base), 'x-sync-operation-id': op
    }
  }, user);
  assert.deepEqual(await (await call('status')).json(), { available: false, last_modified: null, byte_length: 0, generation: 0 });
  assert.equal((await call('pull')).status, 404);
  const first = await push([1,2,3], 0, 'initial-operation');
  assert.equal(first.status, 200);
  assert.equal((await first.json()).generation, 1);
  const repeat = await push([1,2,3], 0, 'initial-operation');
  assert.equal((await repeat.json()).idempotent_replay, true);
  assert.equal((await push([9], 1, 'initial-operation')).status, 409);
  assert.equal((await push([9], 0, 'stale-operation')).status, 409);
  const race = await Promise.all([push([4], 1, 'race-operation-a'), push([5], 1, 'race-operation-b')]);
  assert.deepEqual(race.map(r => r.status).sort(), [200,409]);
  assert.equal(objects.size, 2, 'losing upload must remove its orphan object');
  const winningBytes = race[0].status === 200 ? [4] : [5];
  const pull = await call('pull', { headers: { accept: 'application/octet-stream' } });
  assert.equal(pull.headers.get('x-sync-generation'), '2');
  assert.deepEqual([...new Uint8Array(await pull.arrayBuffer())], winningBytes);
  assert.equal((await call('pull')).status, 426, 'legacy clients must not receive a user-only snapshot as a full database');
  assert.equal((await (await call('status', {}, 'b')).json()).available, false);
  assert.equal((await call('pull', {}, 'b')).status, 404);
  failBatch = true;
  assert.equal((await push([8], 2, 'failed-operation')).status, 500);
  assert.equal(objects.size, 2, 'failed D1 commit must remove its orphan object');
  assert.equal((await (await call('status')).json()).generation, 2);
  const generations = user => db.prepare('SELECT generation FROM sync_objects WHERE user_id = ? ORDER BY generation').all(user).map(row => row.generation);
  for (let generation = 2; generation < 10; generation++) {
    now += 5 * 60_000;
    assert.equal((await push([generation+10], generation, `retention-operation-${generation}`)).status, 200);
  }
  assert.equal(objects.size, 3);
  assert.deepEqual(generations('a'), [8, 9, 10], 'ten same-day uploads keep only the latest three; the daily winner overlaps');
  assert.equal((await (await call('status')).json()).generation, 10);
  assert.equal((await call('status', { headers: { authorization: 'Bearer invalid' } })).status, 401);

  for (let generation = 1; generation <= 20; generation++) {
    now = RealDate.UTC(2030, 0, generation, 4);
    assert.equal((await push([generation], generation - 1, `daily-operation-${generation}`, 'b')).status, 200);
    if (generation === 6 || generation === 7) {
      // Historical KV snapshots must use the same retention rule and their own deletion backend.
      const row = db.prepare('SELECT id, object_key FROM sync_objects WHERE user_id = ? AND generation = ?').get('b', generation);
      kvObjects.set(row.object_key, `legacy-${generation}`);
      objects.delete(row.object_key);
      db.prepare("UPDATE sync_objects SET storage_backend = 'kv' WHERE id = ?").run(row.id);
    }
  }
  assert.deepEqual(generations('b'), Array.from({ length: 14 }, (_, i) => i + 7), 'twenty daily uploads keep days 7–20 inclusive, removing day 15 and older');
  assert.deepEqual([...kvObjects.values()], ['legacy-7'], 'expired KV objects are deleted; daily checkpoints are retained');
  assert.deepEqual(generations('a'), [8, 9, 10], 'cleanup is scoped to the uploading account');

  for (let generation = 21; generation <= 30; generation++) {
    now += 5 * 60_000;
    assert.equal((await push([generation], generation - 1, `burst-operation-${generation}`, 'b')).status, 200);
  }
  assert.deepEqual(generations('b'), [...Array.from({ length: 13 }, (_, i) => i + 7), 28, 29, 30], 'a burst preserves previous daily checkpoints plus the three newest generations');

  for (const [index, day] of [1, 2, 3, 20].entries()) {
    now = RealDate.UTC(2030, 0, day, 4);
    assert.equal((await push([index], index, `sparse-operation-${index}`, 'c')).status, 200);
  }
  assert.deepEqual(generations('c'), [2, 3, 4], 'the latest three generations survive even outside the fourteen-day window');

  const midnightUploads = [
    '2030-01-06T15:59:59.999Z', // Beijing Jan 6: outside the final window.
    '2030-01-06T16:00:00.000Z', // Beijing Jan 7: first instant inside the final window.
    '2030-01-19T15:59:59.999Z', // Beijing Jan 19: a separate daily checkpoint.
    '2030-01-19T16:00:00.000Z', // Beijing Jan 20 begins while UTC is still Jan 19.
    '2030-01-19T16:05:00.000Z',
    '2030-01-19T16:10:00.000Z'
  ];
  for (const [index, time] of midnightUploads.entries()) {
    now = RealDate.parse(time);
    assert.equal((await push([index], index, `midnight-operation-${index}`, 'd')).status, 200);
  }
  assert.deepEqual(generations('d'), [2, 3, 4, 5, 6], 'daily grouping and the inclusive fourteen-day cutoff both use UTC+8 midnight');
  const retained = db.prepare('SELECT object_key, storage_backend FROM sync_objects').all();
  assert.deepEqual([...objects.keys()].sort(), retained.filter(row => row.storage_backend === 'r2').map(row => row.object_key).sort(), 'R2 objects and retained metadata match exactly');
  assert.deepEqual([...kvObjects.keys()].sort(), retained.filter(row => row.storage_backend === 'kv').map(row => row.object_key).sort(), 'KV objects and retained metadata match exactly');
  console.log('PASS real sync push/pull/status: generation 0, idempotence, conflict, concurrent CAS, account isolation, rollback cleanup, latest-three + fourteen-day retention, UTC+8 boundaries, KV/R2 cleanup, auth');
} finally {
  globalThis.Date = RealDate;
  db.close();
  rmSync(outdir, { recursive: true, force: true });
}
