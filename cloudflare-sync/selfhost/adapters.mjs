import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createReadStream, mkdirSync, readdirSync, readFileSync, chmodSync } from "node:fs";
import { link, mkdir, readFile, readdir, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

const meta = (changes, rowsRead, lastRowId) => ({
  served_by: "node:sqlite",
  duration: 0,
  changes,
  last_row_id: lastRowId,
  changed_db: changes > 0,
  size_after: null,
  rows_read: rowsRead,
  rows_written: changes
});

const d1Value = (value) => value instanceof Uint8Array ? Array.from(value) : value;
const d1Row = (row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, d1Value(value)]));

class D1Statement {
  constructor(db, sql, params = []) { Object.assign(this, { db, sql, params }); }
  bind(...params) {
    return new D1Statement(this.db, this.sql, params.map((value) => {
      if (typeof value === "boolean") return Number(value);
      if (value === null || typeof value === "string" || typeof value === "number") return value;
      if (value instanceof ArrayBuffer) return new Uint8Array(value);
      if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      if (Array.isArray(value) && value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) return new Uint8Array(value);
      throw new Error(`D1_TYPE_ERROR: Type '${typeof value}' not supported for value '${String(value)}'`);
    }));
  }
  async first(columnName) {
    const row = this.execute().results[0] ?? null;
    if (row === null || columnName === undefined) return row;
    if (!Object.hasOwn(row, columnName)) throw new Error(`D1_COLUMN_NOTFOUND: Column not found: ${columnName}`);
    return row[columnName];
  }
  async all() { return this.execute(); }
  async run() { return this.execute(); }
  execute() {
    const statement = this.db.prepare(this.sql);
    const counters = this.db.prepare("SELECT total_changes() AS changes, last_insert_rowid() AS lastRowId");
    const before = counters.get();
    let results = [];
    if (statement.columns().length) {
      // Drain RETURNING completely, even when first() will expose just one row.
      results = statement.all(...this.params).map(d1Row);
    } else statement.run(...this.params);
    // changes() survives SELECTs; total_changes() deltas also include trigger/cascade writes.
    const after = counters.get();
    return { results, success: true, meta: meta(Number(after.changes - before.changes), results.length, Number(after.lastRowId)) };
  }
  async raw(options = {}) {
    const statement = this.db.prepare(this.sql);
    statement.setReturnArrays(true);
    const rows = statement.all(...this.params).map((row) => row.map(d1Value));
    return options.columnNames ? [statement.columns().map((column) => column.name), ...rows] : rows;
  }
}

export const putKvEntries = (db, entries) => {
  const insert = db.prepare(`
    INSERT INTO selfhost_kv (key, value, expires_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at
  `);
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const { key, value, expiration } of entries) insert.run(key, value, expiration ?? null);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
};

export const importD1Dump = (dbPath, sql) => {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec(sql);
    db.exec("PRAGMA foreign_keys = ON");
    // ⚠️ 迁移记录原样保留，绝不替它补记。2026-10-10 演练实测：线上 D1 停在 0017，仓库已有 0018，
    // 旧写法把仓库里所有迁移都补记成「已应用」，0018 的 duels 等表于是静默缺失。
    // 没执行过的迁移留给 openDatabase 启动时真正跑一遍。
    const migrations = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations'").get();
    if (!migrations) throw new Error("D1 export has no d1_migrations table; refusing to guess migration state");
    const integrity = db.prepare("PRAGMA integrity_check").get().integrity_check;
    if (integrity !== "ok") throw new Error(`D1 import integrity_check: ${integrity}`);
  } finally {
    db.close();
  }
};

const keyPath = (root, key) => {
  if (typeof key !== "string" || !key || /[\x00-\x1f\x7f]/.test(key) || key.startsWith("/") || key.split("/").some((part) => !part || part === "." || part === "..") || key.split("/")[0] === ".metadata") {
    throw new Error("Invalid R2 object key");
  }
  const file = path.resolve(root, ...key.split("/"));
  if (!file.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error("R2 object key escapes its bucket");
  return file;
};

const metadataPath = (root, key) => path.join(root, ".metadata", `${createHash("sha256").update(key).digest("hex")}.json`);

export const writeR2Object = async (root, { key, body, lastModified, etag, httpMetadata, customMetadata, onlyIf }) => {
  const file = keyPath(root, key);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, body, { mode: 0o600 });
  try {
    if (onlyIf?.etagDoesNotMatch === "*") {
      try { await link(temporary, file); }
      catch (error) { if (error.code === "EEXIST") return false; throw error; }
      await rm(temporary, { force: true });
    } else await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
  if (lastModified) await utimes(file, new Date(lastModified), new Date(lastModified));
  const metadata = { etag, httpMetadata: httpMetadata ?? {}, customMetadata: customMetadata ?? {} };
  const metaFile = metadataPath(root, key);
  await mkdir(path.dirname(metaFile), { recursive: true, mode: 0o700 });
  const tempMeta = `${metaFile}.${randomUUID()}.tmp`;
  await writeFile(tempMeta, JSON.stringify(metadata), { mode: 0o600 });
  try { await rename(tempMeta, metaFile); }
  finally { await rm(tempMeta, { force: true }); }
  return true;
};

export const createBindings = (db, r2Root) => {
  const dbBinding = {
    prepare: (sql) => new D1Statement(db, sql),
    async batch(statements) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((statement) => statement.execute());
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
  };

  const kv = {
    async get(key) {
      db.prepare("DELETE FROM selfhost_kv WHERE expires_at IS NOT NULL AND expires_at <= ?").run(Math.floor(Date.now() / 1000));
      const row = db.prepare("SELECT value, expires_at FROM selfhost_kv WHERE key = ?").get(key);
      if (!row) return null;
      if (row.expires_at !== null && row.expires_at <= Math.floor(Date.now() / 1000)) {
        db.prepare("DELETE FROM selfhost_kv WHERE key = ?").run(key);
        return null;
      }
      return row.value;
    },
    async put(key, value, options = {}) {
      let expiration = options.expiration ?? null;
      if (options.expirationTtl !== undefined) expiration = Math.floor(Date.now() / 1000) + Number(options.expirationTtl);
      db.prepare(`
        INSERT INTO selfhost_kv (key, value, expires_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at
      `).run(key, String(value), expiration);
    },
    async delete(key) {
      db.prepare("DELETE FROM selfhost_kv WHERE key = ?").run(key);
    }
  };

  const r2 = {
    async put(key, value, options = {}) {
      const bytes = Buffer.from(await new Response(value).arrayBuffer());
      const hash = createHash("md5").update(bytes).digest("hex");
      const created = await writeR2Object(r2Root, { key, body: bytes, etag: hash, ...options });
      if (!created) return null;
      return await this.head(key);
    },
    async get(key) {
      const object = await this.head(key);
      if (!object) return null;
      const response = new Response(Readable.toWeb(createReadStream(keyPath(r2Root, key))));
      return {
        ...object,
        body: response.body,
        arrayBuffer: () => response.arrayBuffer(),
        text: () => response.text()
      };
    },
    async head(key) {
      const file = keyPath(r2Root, key);
      let info;
      try { info = await stat(file); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
      const saved = await readFile(metadataPath(r2Root, key), "utf8").then(JSON.parse).catch(() => ({}));
      return { key, size: info.size, etag: saved.etag ?? "", uploaded: info.mtime, httpMetadata: saved.httpMetadata ?? {}, customMetadata: saved.customMetadata ?? {} };
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        const file = keyPath(r2Root, key);
        await rm(file, { force: true });
        await rm(metadataPath(r2Root, key), { force: true });
      }
    },
    async list({ prefix = "", limit = 1000, cursor } = {}) {
      const all = [];
      const walk = async (directory, relative = "") => {
        for (const entry of await readdir(directory, { withFileTypes: true }).catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error))) {
          if (!relative && entry.name === ".metadata") continue;
          const rel = relative ? `${relative}/${entry.name}` : entry.name;
          const full = path.join(directory, entry.name);
          if (entry.isDirectory()) await walk(full, rel);
          else if (rel.startsWith(prefix) && !/\.[0-9a-f-]{36}\.tmp$/i.test(entry.name)) {
            const info = await stat(full);
            const saved = await readFile(metadataPath(r2Root, rel), "utf8").then(JSON.parse).catch(() => ({}));
            all.push({ key: rel, size: info.size, etag: saved.etag ?? "", uploaded: info.mtime });
          }
        }
      };
      await mkdir(r2Root, { recursive: true, mode: 0o700 });
      await walk(r2Root);
      all.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
      let after = "";
      if (cursor) {
        try { after = Buffer.from(cursor, "base64url").toString("utf8"); }
        catch { throw new Error("Invalid R2 list cursor"); }
      }
      const remaining = all.filter((object) => object.key > after);
      const page = remaining.slice(0, Math.min(1000, limit));
      const truncated = page.length < remaining.length;
      return { objects: page, truncated, cursor: truncated ? Buffer.from(page.at(-1).key).toString("base64url") : undefined };
    }
  };

  const limiter = (namespace, max, period) => ({
    async limit({ key }) {
      const now = Math.floor(Date.now() / 1000);
      const bucket = Math.floor(now / period) * period;
      const digest = createHash("sha256").update(key).digest("hex");
      const insert = db.prepare(`
        INSERT INTO selfhost_rate_limits(namespace, key_hash, bucket, count) VALUES (?, ?, ?, 1)
        ON CONFLICT(namespace, key_hash, bucket) DO UPDATE SET count = count + 1
      `);
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("DELETE FROM selfhost_rate_limits WHERE namespace = ? AND bucket < ?").run(namespace, bucket - period);
        insert.run(namespace, digest, bucket);
        const result = db.prepare("SELECT count FROM selfhost_rate_limits WHERE namespace = ? AND key_hash = ? AND bucket = ?").get(namespace, digest, bucket).count;
        db.exec("COMMIT");
        return { success: result <= max };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
  });

  return {
    DB: dbBinding,
    SYNC_DATA: kv,
    SYNC_BUCKET: r2,
    SYNC_PUSH_LIMITER: limiter("1001", 2, 60),
    SYNC_PULL_LIMITER: limiter("1002", 4, 60),
    SYNC_STATUS_LIMITER: limiter("1003", 20, 60)
  };
};

export const openDatabase = (dbPath, migrationsDir) => {
  mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath);
  chmodSync(dbPath, 0o600);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  db.exec("CREATE TABLE IF NOT EXISTS selfhost_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER)");
  db.exec("CREATE INDEX IF NOT EXISTS selfhost_kv_expiry_idx ON selfhost_kv(expires_at)");
  db.exec("CREATE TABLE IF NOT EXISTS selfhost_rate_limits (namespace TEXT NOT NULL, key_hash TEXT NOT NULL, bucket INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(namespace, key_hash, bucket))");
  db.exec("CREATE INDEX IF NOT EXISTS selfhost_rate_limits_expiry_idx ON selfhost_rate_limits(namespace, bucket)");
  const hasTables = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name NOT IN ('sqlite_sequence', 'd1_migrations', 'selfhost_kv', 'selfhost_rate_limits') LIMIT 1").get();
  const hasMigrations = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations'").get();
  if (hasTables && !hasMigrations) {
    db.close();
    throw new Error("Existing D1 tables have no d1_migrations history; refusing to guess migration state");
  }
  db.exec("CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  const applied = new Set(db.prepare("SELECT name FROM d1_migrations").all().map(({ name }) => name));
  for (const name of readdirSync(migrationsDir).filter((file) => file.endsWith(".sql") && !file.startsWith(".")).sort()) {
    if (applied.has(name)) continue;
    const sql = readFileSync(path.join(migrationsDir, name), "utf8");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO d1_migrations(name) VALUES (?)").run(name);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      db.close();
      throw new Error(`Applying ${name}: ${error.message}`);
    }
  }
  return db;
};
