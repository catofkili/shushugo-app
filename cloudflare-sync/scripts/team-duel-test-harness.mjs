import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

export const hash = (value) => createHash("sha256").update(value).digest("base64url");
export async function teamDuelHarness() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const outdir = mkdtempSync(join(tmpdir(), "shushugo-team-duel-"));
  const built = spawnSync(join(root, "node_modules/.bin/wrangler"), ["deploy", "--dry-run", "--outdir", outdir], {
    cwd: root, encoding: "utf8", env: { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: join(outdir, "wrangler.log") }
  });
  if (built.status !== 0) { rmSync(outdir, { recursive: true, force: true }); throw new Error(`${built.stdout}\n${built.stderr}`); }
  const worker = (await import(pathToFileURL(join(outdir, "index.js")).href)).default;
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(join(root, "migrations")).filter((name) => name.endsWith(".sql")).sort()) db.exec(readFileSync(join(root, "migrations", file), "utf8"));
  const statement = (sql, params = []) => ({
    bind: (...bound) => statement(sql, bound),
    first: () => db.prepare(sql).get(...params) ?? null,
    all: () => ({ results: db.prepare(sql).all(...params) }),
    run: () => ({ success: true, meta: { changes: db.prepare(sql).run(...params).changes } }),
    execute() {
      if (/\bRETURNING\b/i.test(sql)) { const results = db.prepare(sql).all(...params); return { success: true, results, meta: { changes: results.length } }; }
      if (/^\s*(SELECT|PRAGMA|WITH)\b/i.test(sql)) return { success: true, results: db.prepare(sql).all(...params) };
      return { success: true, meta: { changes: db.prepare(sql).run(...params).changes } };
    }
  });
  const env = { SYNC_DATA: { get: async () => null, put: async () => undefined, delete: async () => undefined }, DB: { prepare: statement, async batch(statements) {
    db.exec("BEGIN");
    try { const results = statements.map((item) => item.execute()); db.exec("COMMIT"); return results; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  } } };
  const RealDate = globalThis.Date;
  let now = RealDate.parse("2026-10-26T04:00:00+08:00");
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  return {
    db,
    setTime: (time) => { now = RealDate.parse(time); },
    addUser(id) {
      db.prepare("INSERT INTO users (id, email, password_hash, password_salt, display_name, created_at, email_verified_at) VALUES (?, ?, 'hash', 'salt', ?, ?, ?)")
        .run(id, `${id}@example.test`, id, new Date().toISOString(), new Date().toISOString());
      db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(hash(`token-${id}`), id, new Date().toISOString(), "2099-01-01T00:00:00Z");
    },
    async call(path, { user, body, method = body === undefined ? "GET" : "POST", token, headers = {} } = {}) {
      const response = await worker.fetch(new Request(`https://worker.test${path}`, {
        method, headers: { "content-type": "application/json", ...(user ? { authorization: `Bearer token-${user}` } : {}), ...(token ? { "x-duel-token": token } : {}), ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      }), env, { waitUntil() {} });
      return { status: response.status, headers: response.headers, body: await response.json().catch(() => null) };
    },
    close() { globalThis.Date = RealDate; db.close(); rmSync(outdir, { recursive: true, force: true }); }
  };
}
