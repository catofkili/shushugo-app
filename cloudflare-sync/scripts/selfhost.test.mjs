import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createBindings, importD1Dump, openDatabase, putKvEntries } from "../selfhost/adapters.mjs";
import { compareRowCounts, countTables, importKvBatch, importR2Page } from "../selfhost/migrate.mjs";
import { verifyMigrationDir } from "../selfhost/verify-migration.mjs";
import { dispatch, parseEnv, setClientIpHeader } from "../selfhost/server.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(root, "migrations");
const staging = await mkdtemp(path.join(os.tmpdir(), "shushugo-selfhost-test-"));

try {
  assert.deepEqual(parseEnv("# ignored\nA=one=two\ninvalid\nB=\\n"), { A: "one=two", B: "\\n" });
  const proxied = new Request("http://localhost/", { headers: { "x-forwarded-for": "spoofed, 203.0.113.7" } });
  setClientIpHeader(proxied, "127.0.0.1");
  assert.equal(proxied.headers.get("cf-connecting-ip"), "203.0.113.7");
  const trusted = new Request("http://localhost/", { headers: { "cf-connecting-ip": "203.0.113.9" } });
  setClientIpHeader(trusted, "127.0.0.1");
  assert.equal(trusted.headers.get("cf-connecting-ip"), "203.0.113.9");

  const build = spawnSync("npm", ["run", "selfhost:build"], { cwd: root, encoding: "utf8" });
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);

  const migrationSql = (await Promise.all((await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort()
    .map((name) => readFile(path.join(migrationsDir, name), "utf8")))).join("\n");
  const dbPath = path.join(staging, "worker.sqlite");
  importD1Dump(dbPath, migrationSql, migrationsDir);
  const db = openDatabase(dbPath, migrationsDir);
  const r2 = createBindings(db, path.join(staging, "r2"));

  db.exec("CREATE TABLE adapter_probe(id INTEGER PRIMARY KEY, value TEXT NOT NULL UNIQUE)");
  const inserted = await r2.DB.prepare("INSERT INTO adapter_probe(value) VALUES (?)").bind("one").run();
  assert.equal(inserted.meta.changes, 1);
  assert.equal((await r2.DB.prepare("INSERT INTO adapter_probe(value) VALUES (?)").bind("two").run()).meta.last_row_id, 2);
  assert.deepEqual((await r2.DB.prepare("SELECT value FROM adapter_probe ORDER BY id").all()).results.map((row) => row.value), ["one", "two"]);
  assert.equal(await r2.DB.prepare("SELECT value FROM adapter_probe WHERE id = ?").bind(1).first("value"), "one");
  assert.deepEqual(await r2.DB.prepare("SELECT id, value FROM adapter_probe ORDER BY id").raw(), [[1, "one"], [2, "two"]]);
  assert.deepEqual(await r2.DB.prepare("SELECT id, value FROM adapter_probe LIMIT 1").raw({ columnNames: true }), [["id", "value"], [1, "one"]]);
  await assert.rejects(r2.DB.batch([
    r2.DB.prepare("INSERT INTO adapter_probe(value) VALUES (?)").bind("rolled-back"),
    r2.DB.prepare("INSERT INTO adapter_probe(value) VALUES (?)").bind("one")
  ]));
  assert.equal(await r2.DB.prepare("SELECT COUNT(*) AS n FROM adapter_probe WHERE value = 'rolled-back'").first("n"), 0);
  const batch = await r2.DB.batch([
    r2.DB.prepare("INSERT INTO adapter_probe(value) VALUES (?)").bind("three"),
    r2.DB.prepare("SELECT COUNT(*) AS n FROM adapter_probe").bind()
  ]);
  assert.equal(batch[1].results[0].n, 3);

  await r2.SYNC_DATA.put("fixture:live", "kept", { expirationTtl: 60 });
  assert.equal(await r2.SYNC_DATA.get("fixture:live"), "kept");
  putKvEntries(db, [{ key: "fixture:expired", value: "old", expiration: Math.floor(Date.now() / 1000) - 1 }]);
  assert.equal(await r2.SYNC_DATA.get("fixture:expired"), null);

  const oldR2 = path.join(staging, "imported-r2");
  await importR2Page([{
    key: "weekly/fixture/2026-09-21.json", last_modified: "2026-09-21T00:00:00.000Z",
    etag: "fixture-etag", http_metadata: { contentType: "application/json" }, custom_metadata: { userId: "fixture" }
  }], "fixture-bucket", oldR2, async () => Buffer.from("{\"fixture\":true}"));
  const localR2 = createBindings(db, oldR2).SYNC_BUCKET;
  const stored = await localR2.get("weekly/fixture/2026-09-21.json");
  assert.equal(new TextDecoder().decode(await stored.arrayBuffer()), "{\"fixture\":true}");
  await stored.body.cancel();
  assert.equal(stored.httpMetadata.contentType, "application/json");
  assert.equal(stored.customMetadata.userId, "fixture");
  assert.equal(stored.uploaded.toISOString(), "2026-09-21T00:00:00.000Z");

  const imported = await importKvBatch([
    { name: "fixture:bulk", expiration: 4102444800 }
  ], "fixture-account", "fixture-namespace", db, async (_url, init) => {
    assert.deepEqual(JSON.parse(init.body).keys, ["fixture:bulk"]);
    return Response.json({ success: true, result: { values: { "fixture:bulk": { value: "bulk-value", expiration: 4102444800 } } } });
  });
  assert.equal(imported, 1);
  assert.equal(await r2.SYNC_DATA.get("fixture:bulk"), "bulk-value");

  const pages = await Promise.all([
    localR2.put("weekly/fixture/a", "a"), localR2.put("weekly/fixture/b", "b"), localR2.put("weekly/fixture/c", "c")
  ]);
  assert.equal(pages.length, 3);
  const page1 = await localR2.list({ prefix: "weekly/fixture/", limit: 2 });
  const page2 = await localR2.list({ prefix: "weekly/fixture/", limit: 2, cursor: page1.cursor });
  assert.equal(page1.objects.length, 2);
  assert.equal(page1.truncated, true);
  assert.equal(page2.objects.length, 2);
  assert.equal(page2.truncated, false);
  assert.equal(await localR2.put("weekly/fixture/a", "overwrite", { onlyIf: { etagDoesNotMatch: "*" } }), null);
  const races = await Promise.all([
    localR2.put("weekly/fixture/race", "first", { onlyIf: { etagDoesNotMatch: "*" } }),
    localR2.put("weekly/fixture/race", "second", { onlyIf: { etagDoesNotMatch: "*" } })
  ]);
  assert.equal(races.filter(Boolean).length, 1, "only one conditional R2 create may win concurrently");
  assert.ok(["first", "second"].includes(new TextDecoder().decode(await (await localR2.get("weekly/fixture/race")).arrayBuffer())));
  await (await localR2.get("weekly/fixture/race")).body.cancel();
  await localR2.delete(["weekly/fixture/a", "weekly/fixture/b", "weekly/fixture/c", "weekly/fixture/race"]);

  assert.deepEqual(await r2.SYNC_PUSH_LIMITER.limit({ key: "same" }), { success: true });
  assert.deepEqual(await r2.SYNC_PUSH_LIMITER.limit({ key: "same" }), { success: true });
  assert.deepEqual(await r2.SYNC_PUSH_LIMITER.limit({ key: "same" }), { success: false });
  const rowCounts = countTables(db);
  await mkdir(path.join(staging, "r2"), { recursive: true });
  await writeFile(path.join(staging, "manifest.json"), JSON.stringify({ rowCounts, r2Objects: 0 }));
  assert.ok(verifyMigrationDir(staging).tables > 0);
  compareRowCounts({ users: 0, teams: 0 }, { users: "0", teams: 0 });
  assert.throws(() => compareRowCounts({ users: 2 }, { users: 1 }), /row count differs/);
  db.close();

  const bundlePath = path.join(root, "selfhost", "dist", "index.js");
  const { createRuntime } = await import(pathToFileURL(path.join(root, "selfhost", "server.mjs")).href);
  const runtime = await createRuntime({ dataDir: path.join(staging, "route-runtime"), envFile: path.join(staging, "missing.env"), bundlePath });
  try {
    const health = await runtime.worker.fetch(new Request("http://127.0.0.1:8787/api/health"), runtime.env, { waitUntil() {} });
    assert.equal(health.status, 200);
    const healthJson = await health.json();
    assert.equal(healthJson.migrationsApplied, true);
    assert.equal(healthJson.authHardening, true);
    assert.equal(healthJson.productionReady, false);
    const config = await runtime.worker.fetch(new Request("http://127.0.0.1:8787/api/auth/config"), runtime.env, { waitUntil() {} });
    assert.deepEqual(await config.json(), { appleEnabled: true, appleClientId: "com.shushugo.app", wechatAppEnabled: false, turnstileEnabled: false });

    const { createHash } = await import("node:crypto");
    const token = "adapter-route-token";
    const now = new Date().toISOString();
    runtime.db.prepare("INSERT INTO users(id,email,password_hash,password_salt,created_at) VALUES(?,?,?,?,?)")
      .run("adapter-user", "adapter@example.invalid", "", "", now);
    runtime.db.prepare("INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)")
      .run(createHash("sha256").update(token).digest("base64url"), "adapter-user", now, "2099-01-01T00:00:00.000Z");
    const callSync = (suffix, options = {}) => runtime.worker.fetch(new Request(`http://127.0.0.1:8787/api/sync/${suffix}`, {
      ...options,
      headers: { authorization: `Bearer ${token}`, ...(options.headers ?? {}) }
    }), runtime.env, { waitUntil() {} });
    const initialStatus = await callSync("status");
    assert.deepEqual(await initialStatus.json(), { available: false, last_modified: null, byte_length: 0, generation: 0 });
    assert.equal((await callSync("pull")).status, 404);
    const payload = new Uint8Array([1, 2, 3, 4]);
    const pushed = await callSync("push", { method: "POST", body: payload, headers: {
      "content-type": "application/octet-stream",
      "x-sync-format": "master-nihongo-user-sqlite-v1",
      "x-sync-compression": "none",
      "x-sync-base-generation": "0",
      "x-sync-operation-id": "adapter-operation"
    } });
    assert.equal(pushed.status, 200, await pushed.clone().text());
    assert.equal((await pushed.json()).generation, 1);
    const pulled = await callSync("pull", { headers: { accept: "application/octet-stream" } });
    assert.deepEqual([...new Uint8Array(await pulled.arrayBuffer())], [...payload]);
    const denied = await runtime.worker.fetch(new Request("http://127.0.0.1:8787/api/sync/status", {
      headers: { authorization: "Bearer another-user-token" }
    }), runtime.env, {});
    assert.equal(denied.status, 401);
  } finally { runtime.db.close(); }

  let waited = false;
  const response = await dispatch({ async fetch(_request, _env, ctx) {
    ctx.waitUntil(new Promise((resolve) => setTimeout(() => { waited = true; resolve(); }, 20)));
    return new Response("ok");
  } }, new Request("http://localhost/"), {});
  assert.equal(await response.text(), "ok");
  assert.equal(waited, true, "waitUntil promises must finish before the response is returned");
  console.log("PASS self-host adapters, local D1/R2/KV import, health/auth/sync routes and waitUntil semantics");
} finally {
  await rm(staging, { recursive: true, force: true });
  await rm(path.join(root, "selfhost", "dist"), { recursive: true, force: true });
}
