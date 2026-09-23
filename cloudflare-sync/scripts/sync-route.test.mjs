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
  SYNC_DATA: { get: async () => null, delete: async () => {} }
};
try {
  for (const file of readdirSync(join(root, 'migrations')).filter(f => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(root, 'migrations', file), 'utf8'));
  }
  for (const user of ['a', 'b']) {
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
  for (let generation = 2; generation < 5; generation++) {
    assert.equal((await push([generation+10], generation, `retention-operation-${generation}`)).status, 200);
  }
  assert.equal(objects.size, 3);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sync_objects').get().n, 3);
  assert.equal((await (await call('status')).json()).generation, 5);
  assert.equal((await call('status', { headers: { authorization: 'Bearer invalid' } })).status, 401);
  console.log('PASS real sync push/pull/status: generation 0, idempotence, conflict, concurrent CAS, account isolation, rollback cleanup, three-generation retention, auth');
} finally {
  db.close();
  rmSync(outdir, { recursive: true, force: true });
}
