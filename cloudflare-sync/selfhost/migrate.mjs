import { mkdtemp, mkdir, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { importD1Dump, putKvEntries, writeR2Object } from "./adapters.mjs";

const selfhost = path.dirname(fileURLToPath(import.meta.url));
const workerRoot = path.resolve(selfhost, "..");
const apiRoot = "https://api.cloudflare.com/client/v4";

const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const kvNamespace = "a8a8e2d05d2e4159a26e37e057bd8ebf";
const bucket = "master-nihongo-sync-snapshots";
const d1Database = "eb7ebca5-8026-41c2-8662-1dbc76eef5d7";

const api = async (url, init) => {
  const response = await fetch(url, { ...init, headers: { authorization: `Bearer ${token}`, ...init?.headers } });
  if (!response.ok) throw new Error(`Cloudflare API returned HTTP ${response.status} for ${new URL(url).pathname}`);
  return response;
};

const listPages = async (base, limitName, limit) => {
  const result = [];
  let cursor;
  do {
    const url = new URL(base);
    url.searchParams.set(limitName, String(limit));
    if (cursor) url.searchParams.set("cursor", cursor);
    const page = await (await api(url)).json();
    if (!page.success) throw new Error(`Cloudflare API rejected ${url.pathname}`);
    result.push(...page.result);
    const info = page.result_info ?? {};
    cursor = info.cursor ?? info.cursors?.after ?? info.cursors?.next;
    if (info.is_truncated === false || info.list_complete === true) cursor = undefined;
    if (result.length > 1_000_000) throw new Error("Refusing an unexpectedly large export (over 1,000,000 objects)");
  } while (cursor);
  return result;
};

const safeObjectPath = (base, key) => {
  if (!key || /[\x00-\x1f\x7f]/.test(key) || key.startsWith("/") || key.split("/").some((part) => !part || part === "." || part === "..") || key.split("/")[0] === ".metadata") throw new Error("Cloudflare returned an unsafe R2 key");
  const target = path.resolve(base, ...key.split("/"));
  if (!target.startsWith(`${path.resolve(base)}${path.sep}`)) throw new Error("R2 key escapes export directory");
  return target;
};

export const countTables = (db, { exclude = [] } = {}) => Object.fromEntries(
  db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all().map(({ name }) => [name, Number(db.prepare(`SELECT COUNT(*) AS count FROM "${name.replaceAll('"', '""')}"`).get().count)])
    .filter(([name]) => !exclude.includes(name))
);

export const compareRowCounts = (localCounts, remoteCounts) => {
  const localNames = Object.keys(localCounts).sort();
  const remoteNames = Object.keys(remoteCounts).sort();
  if (JSON.stringify(localNames) !== JSON.stringify(remoteNames)) throw new Error("D1 export table list differs from remote D1");
  for (const name of localNames) {
    if (Number(localCounts[name]) !== Number(remoteCounts[name])) {
      throw new Error(`D1 row count differs for ${name}: export=${localCounts[name]}, remote=${remoteCounts[name]}`);
    }
  }
};

const remoteRowCounts = async (tableNames) => {
  const endpoint = `${apiRoot}/accounts/${account}/d1/database/${d1Database}/query`;
  const listed = await api(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sql: "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> 'd1_migrations' ORDER BY name" })
  });
  const listPayload = await listed.json();
  if (!listPayload.success || !Array.isArray(listPayload.result?.[0]?.results)) throw new Error("Could not read the remote D1 table list");
  const remoteNames = listPayload.result[0].results.map(({ name }) => name).sort();
  if (JSON.stringify(remoteNames) !== JSON.stringify([...tableNames].sort())) throw new Error("D1 export table list differs from remote D1");
  if (!tableNames.length) return {};
  const sql = tableNames.map((name) => `SELECT '${name.replaceAll("'", "''")}' AS table_name, COUNT(*) AS row_count FROM "${name.replaceAll('"', '""')}"`).join(" UNION ALL ");
  const response = await api(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sql })
  });
  const payload = await response.json();
  if (!payload.success || !Array.isArray(payload.result?.[0]?.results)) throw new Error("Cloudflare D1 row-count query failed");
  return Object.fromEntries(payload.result[0].results.map(({ table_name, row_count }) => [table_name, Number(row_count)]));
};

export const importR2Page = async (objects, bucketName, r2Root, downloadObject = downloadR2Object) => {
  for (const object of objects) {
    const key = object.key;
    safeObjectPath(r2Root, key);
    await writeR2Object(r2Root, {
      key,
      body: await downloadObject(bucketName, key),
      lastModified: object.last_modified ?? object.uploaded,
      etag: object.etag,
      httpMetadata: object.http_metadata,
      customMetadata: object.custom_metadata
    });
  }
};

const downloadR2Object = async (bucketName, key) => {
  const temporary = path.join(process.env.TMPDIR ?? "/tmp", `shushugo-r2-${process.pid}-${randomUUID()}.tmp`);
  const wrangler = process.env.WRANGLER_BIN ?? path.join(workerRoot, "node_modules", ".bin", "wrangler");
  try {
    const result = spawnSync(wrangler, ["r2", "object", "get", `${bucketName}/${key}`, "--remote", `--file=${temporary}`], {
      cwd: workerRoot, env: process.env, encoding: "utf8", stdio: ["ignore", "ignore", "pipe"]
    });
    if (result.status !== 0) throw new Error(`wrangler r2 object get failed for ${key}: ${result.stderr?.trim() || result.error?.message || "unknown error"}`);
    return await readFile(temporary);
  } finally {
    await rm(temporary, { force: true });
  }
};

export const importKvBatch = async (keys, accountId, namespaceId, db, fetcher = fetch) => {
  if (!keys.length) return 0;
  const url = `${apiRoot}/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/bulk/get`;
  const response = await fetcher(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ keys: keys.map(({ name }) => name), type: "text", withMetadata: true })
  });
  if (!response.ok) throw new Error(`KV batch download failed (HTTP ${response.status})`);
  const payload = await response.json();
  if (!payload.success) throw new Error("Cloudflare rejected KV batch download");
  const values = payload.result?.values ?? {};
  const entries = [];
  for (const key of keys) {
    const item = values[key.name];
    if (item === undefined) continue; // It expired after the list call.
    const value = item && typeof item === "object" && "value" in item ? item.value : item;
    if (typeof value !== "string") throw new Error(`KV key is not text: ${key.name}`);
    const expiration = item && typeof item === "object" ? item.expiration ?? key.expiration : key.expiration;
    if (expiration === undefined || expiration > Math.floor(Date.now() / 1000)) entries.push({ key: key.name, value, expiration });
  }
  putKvEntries(db, entries);
  return entries.length;
};

const main = async () => {
  const required = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"];
  for (const name of required) if (!process.env[name]) throw new Error(`${name} is required; no remote calls were made`);
  process.umask(0o077);
  const temp = await mkdtemp(path.join(process.env.TMPDIR ?? "/tmp", "shushugo-w25-"));
  let archiveDir;
  let keepArchive = false;
  try {
    archiveDir = await mkdtemp(path.join(process.env.TMPDIR ?? "/tmp", "shushugo-export-"));
    const d1SqlPath = path.join(temp, "d1-export.sql");
    const archive = path.join(archiveDir, `shushugo-cloudflare-${new Date().toISOString().replaceAll(":", "-")}.tar.gz`);
    const wrangler = process.env.WRANGLER_BIN ?? path.join(workerRoot, "node_modules", ".bin", "wrangler");
    const exported = spawnSync(wrangler, ["d1", "export", "master_nihongo_sync", "--remote", `--output=${d1SqlPath}`, "--skip-confirmation"], {
      cwd: workerRoot, env: process.env, stdio: "inherit"
    });
    if (exported.status !== 0) throw new Error("wrangler d1 export failed");
    const d1Sql = await readFile(d1SqlPath, "utf8");
    const r2Objects = await listPages(`${apiRoot}/accounts/${account}/r2/buckets/${bucket}/objects`, "per_page", 1000);
    const keys = await listPages(`${apiRoot}/accounts/${account}/storage/kv/namespaces/${kvNamespace}/keys`, "limit", 1000);
    const packageDir = await mkdtemp(path.join(process.env.TMPDIR ?? "/tmp", "shushugo-package-"));
    try {
      const dbPath = path.join(packageDir, "worker.sqlite");
      importD1Dump(dbPath, d1Sql, path.join(workerRoot, "migrations"));
      const sqlite = new DatabaseSync(dbPath);
      const sourceRowCounts = countTables(sqlite, { exclude: ["d1_migrations"] });
      const countsFromCloudflare = await remoteRowCounts(Object.keys(sourceRowCounts));
      compareRowCounts(sourceRowCounts, countsFromCloudflare);
      sqlite.exec("CREATE TABLE IF NOT EXISTS selfhost_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER)");
      sqlite.exec("CREATE TABLE IF NOT EXISTS selfhost_rate_limits (namespace TEXT NOT NULL, key_hash TEXT NOT NULL, bucket INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(namespace, key_hash, bucket))");
      let kvCount = 0;
      for (let offset = 0; offset < keys.length; offset += 10) kvCount += await importKvBatch(keys.slice(offset, offset + 10), account, kvNamespace, sqlite);
      const rowCounts = countTables(sqlite);
      sqlite.close();
      const r2Root = path.join(packageDir, "r2");
      await mkdir(r2Root, { recursive: true, mode: 0o700 });
      await importR2Page(r2Objects, bucket, r2Root);
      const integrityDb = new DatabaseSync(dbPath);
      try {
        if (integrityDb.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") throw new Error("Imported D1 failed integrity_check");
        const missing = integrityDb.prepare("SELECT count(*) AS n FROM d1_migrations").get().n;
        const totalRows = Object.values(sourceRowCounts).reduce((total, count) => total + count, 0);
        console.log(`D1 row counts match remote: ${Object.keys(sourceRowCounts).length} tables, ${totalRows} rows; migration records: ${missing}; R2 objects: ${r2Objects.length}; KV keys: ${kvCount}`);
      } finally { integrityDb.close(); }
      await writeFile(path.join(packageDir, "manifest.json"), JSON.stringify({ createdAt: new Date().toISOString(), sourceRowCounts, rowCounts, r2Objects: r2Objects.length, kvKeys: kvCount }, null, 2), { mode: 0o600 });
      const tar = spawnSync("tar", ["-czf", archive, "-C", packageDir, "worker.sqlite", "r2", "manifest.json"], { encoding: "utf8" });
      if (tar.status !== 0) throw new Error(tar.stderr || "Could not create migration archive");
      await chmod(archive, 0o600);
      keepArchive = true;
      console.log(`Migration archive: ${archive}`);
      console.log("Copy this archive to the server and run install-migration.sh only after write traffic is frozen.");
    } finally {
      await rm(packageDir, { recursive: true, force: true });
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
    if (!keepArchive && archiveDir) await rm(archiveDir, { recursive: true, force: true });
  }
};

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
