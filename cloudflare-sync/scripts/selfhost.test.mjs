import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBindings, importD1Dump, openDatabase, putKvEntries } from "../selfhost/adapters.mjs";
import { compareRowCounts, countTables, importKvBatch, importR2Page } from "../selfhost/migrate.mjs";
import { verifyMigrationDir } from "../selfhost/verify-migration.mjs";
import { createRuntime, dispatch, parseEnv, setClientIpHeader } from "../selfhost/server.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(root, "migrations");
const staging = await mkdtemp(path.join(os.tmpdir(), "shushugo-selfhost-test-"));
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("Self-host tests must not make network requests"); };

try {
  assert.deepEqual(parseEnv("# ignored\nA=one=two\ninvalid\nB=\\n"), { A: "one=two", B: "\\n" });
  const proxied = new Request("http://localhost/", { headers: { "x-forwarded-for": "spoofed, 203.0.113.7" } });
  setClientIpHeader(proxied, "127.0.0.1");
  assert.equal(proxied.headers.get("cf-connecting-ip"), "203.0.113.7");
  const trusted = new Request("http://localhost/", { headers: { "cf-connecting-ip": "203.0.113.9" } });
  setClientIpHeader(trusted, "127.0.0.1");
  assert.equal(trusted.headers.get("cf-connecting-ip"), "203.0.113.9");

  const build = spawnSync("npm", ["run", "selfhost:build"], {
    cwd: root, encoding: "utf8",
    env: { ...process.env, WRANGLER_HIDE_BANNER: "true", WRANGLER_SEND_METRICS: "false", WRANGLER_SEND_ERROR_REPORTS: "false", WRANGLER_LOG_PATH: path.join(staging, "wrangler.log") }
  });
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);

  // 模拟线上 D1 比仓库落后一个迁移的导出：导入不许替它补记，启动时必须真正执行最后那个迁移。
  const migrationFiles = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();
  const exportedFiles = migrationFiles.slice(0, -1);
  const migrationSql = [
    ...(await Promise.all(exportedFiles.map((name) => readFile(path.join(migrationsDir, name), "utf8")))),
    "CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);",
    ...exportedFiles.map((name) => `INSERT INTO d1_migrations(name) VALUES ('${name}');`)
  ].join("\n");
  const dbPath = path.join(staging, "worker.sqlite");
  assert.throws(() => importD1Dump(path.join(staging, "no-history.sqlite"), "CREATE TABLE users(id TEXT);"), /no d1_migrations/);
  importD1Dump(dbPath, migrationSql);
  const importedDb = new DatabaseSync(dbPath);
  assert.equal(importedDb.prepare("SELECT COUNT(*) AS n FROM d1_migrations").get().n, exportedFiles.length);
  importedDb.close();
  const junkDir = path.join(staging, "junk-migrations");
  await mkdir(junkDir);
  await writeFile(path.join(junkDir, "0001_x.sql"), "CREATE TABLE x(id INTEGER);");
  await writeFile(path.join(junkDir, "._0001_x.sql"), "\u0000\u0005\u0016\u0007 AppleDouble");
  const junkDb = openDatabase(path.join(staging, "junk.sqlite"), junkDir);
  assert.deepEqual(junkDb.prepare("SELECT name FROM d1_migrations").all().map(({ name }) => name), ["0001_x.sql"]);
  junkDb.close();
  const db = openDatabase(dbPath, migrationsDir);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM d1_migrations").get().n, migrationFiles.length);
  const r2 = createBindings(db, path.join(staging, "r2"));

  db.exec("CREATE TABLE adapter_probe(id INTEGER PRIMARY KEY, value TEXT NOT NULL UNIQUE)");
  const inserted = await r2.DB.prepare("INSERT INTO adapter_probe(value) VALUES (?)").bind("one").run();
  assert.deepEqual(inserted.results, []);
  assert.equal(inserted.success, true);
  assert.equal(inserted.meta.changes, 1);
  assert.equal(inserted.meta.last_row_id, 1);
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
  assert.deepEqual(batch[0].results, []);
  assert.equal(batch[1].results[0].n, 3);
  assert.equal(batch[1].meta.changes, 0, "a SELECT must not inherit the preceding INSERT's changes");
  assert.equal(batch[1].meta.last_row_id, 3);
  for (const result of batch) {
    assert.equal(result.success, true);
    assert.ok(Array.isArray(result.results));
    assert.equal(typeof result.meta.changes, "number");
  }
  const readRun = await r2.DB.prepare("SELECT id, value FROM adapter_probe WHERE id = 1").run();
  assert.deepEqual(readRun.results, [{ id: 1, value: "one" }]);
  assert.equal(readRun.meta.changes, 0);
  assert.equal(readRun.meta.last_row_id, 3);
  const unmatched = await r2.DB.prepare("UPDATE adapter_probe SET value = value WHERE id = -1").run();
  assert.deepEqual(unmatched.results, []);
  assert.equal(unmatched.meta.changes, 0, "conditional writes must report zero, even after a previous write");
  const reusable = r2.DB.prepare("SELECT ? AS value");
  const firstBinding = reusable.bind("first");
  reusable.bind("second");
  assert.equal(await firstBinding.first("value"), "first", "bind() returns an independent statement");
  assert.deepEqual(await r2.DB.prepare("SELECT NULL AS empty, 0 AS zero, '' AS blank").first(), { empty: null, zero: 0, blank: "" });
  assert.equal(await r2.DB.prepare("SELECT NULL AS empty").first("empty"), null);
  assert.equal(await r2.DB.prepare("SELECT 0 AS zero").first("zero"), 0);
  assert.equal(await r2.DB.prepare("SELECT 1 WHERE 0").first(), null);
  assert.equal(await r2.DB.prepare("SELECT 1 WHERE 0").first("missing"), null);
  await assert.rejects(r2.DB.prepare("SELECT 1 AS present").first("missing"), /D1_COLUMN_NOTFOUND/);
  for (const value of [undefined, {}, 1n]) assert.throws(() => r2.DB.prepare("SELECT ?").bind(value), /D1_TYPE_ERROR/);
  const binary = new Uint8Array([99, 1, 2, 98]).subarray(1, 3);
  const boundValues = r2.DB.prepare("SELECT ? AS yes, ? AS no, ? AS buffer, ? AS view, ? AS absent")
    .bind(true, false, new Uint8Array([3, 4]).buffer, binary, null);
  assert.deepEqual(await boundValues.first(), { yes: 1, no: 0, buffer: [3, 4], view: [1, 2], absent: null });
  assert.deepEqual((await boundValues.all()).results, [{ yes: 1, no: 0, buffer: [3, 4], view: [1, 2], absent: null }]);
  assert.deepEqual(await boundValues.raw({ columnNames: true }), [["yes", "no", "buffer", "view", "absent"], [1, 0, [3, 4], [1, 2], null]]);
  assert.deepEqual(await r2.DB.prepare("SELECT ? AS bytes").bind([5, 6]).first("bytes"), [5, 6]);
  const returning = await r2.DB.prepare("INSERT INTO adapter_probe(value) VALUES (?) RETURNING id, value").bind("four").run();
  assert.deepEqual(returning.results, [{ id: 4, value: "four" }]);
  assert.equal(returning.meta.changes, 1);
  assert.equal(returning.meta.last_row_id, 4);
  const returningAll = await r2.DB.prepare("INSERT INTO adapter_probe(value) VALUES ('five') RETURNING id").all();
  assert.deepEqual(returningAll.results, [{ id: 5 }]);
  assert.equal(returningAll.meta.changes, 1);
  const returningBatch = await r2.DB.batch([
    r2.DB.prepare("UPDATE adapter_probe SET value = value || '-updated' WHERE id <= 2 RETURNING id"),
    r2.DB.prepare("SELECT COUNT(*) AS n FROM adapter_probe")
  ]);
  assert.deepEqual(returningBatch[0].results, [{ id: 1 }, { id: 2 }]);
  assert.equal(returningBatch[0].meta.changes, 2);
  assert.equal(returningBatch[0].meta.last_row_id, 5);
  assert.equal(returningBatch[1].meta.changes, 0);
  assert.equal(await r2.DB.prepare("UPDATE adapter_probe SET value = value || '-first' WHERE id <= 2 RETURNING id").first("id"), 1);
  assert.equal(await r2.DB.prepare("SELECT COUNT(*) AS n FROM adapter_probe WHERE value LIKE '%-first'").first("n"), 2, "first() must finish all writes, including rows after the first RETURNING row");
  await assert.rejects(r2.DB.batch([
    r2.DB.prepare("INSERT INTO adapter_probe(value) VALUES ('returning-rollback') RETURNING id"),
    r2.DB.prepare("SELECT * FROM missing_adapter_table")
  ]));
  assert.equal(await r2.DB.prepare("SELECT COUNT(*) AS n FROM adapter_probe WHERE value = 'returning-rollback'").first("n"), 0);
  db.exec("CREATE TABLE adapter_trigger_log(value TEXT); CREATE TRIGGER adapter_probe_log AFTER INSERT ON adapter_probe BEGIN INSERT INTO adapter_trigger_log(value) VALUES (new.value); END;");
  assert.equal((await r2.DB.prepare("INSERT INTO adapter_probe(value) VALUES ('triggered')").run()).meta.changes, 2, "D1 changes includes trigger writes");
  await assert.rejects(r2.DB.batch([
    r2.DB.prepare("INSERT INTO adapter_probe(value) VALUES ('fk-rollback') RETURNING id"),
    r2.DB.prepare("INSERT INTO sessions(token_hash, user_id, created_at, expires_at) VALUES ('invalid', 'missing-user', '', '')")
  ]), /FOREIGN KEY/);
  assert.equal(await r2.DB.prepare("SELECT COUNT(*) AS n FROM adapter_probe WHERE value = 'fk-rollback'").first("n"), 0);
  assert.equal(await r2.DB.prepare("SELECT COUNT(*) AS n FROM adapter_trigger_log WHERE value = 'fk-rollback'").first("n"), 0);

  await r2.SYNC_DATA.put("fixture:live", "kept", { expirationTtl: 60 });
  assert.equal(await r2.SYNC_DATA.get("fixture:live"), "kept");
  assert.equal(await r2.SYNC_DATA.get("fixture:missing"), null);
  await r2.SYNC_DATA.put("fixture:persistent", "永久");
  assert.equal(await r2.SYNC_DATA.get("fixture:persistent"), "永久");
  await r2.SYNC_DATA.delete("fixture:persistent");
  await r2.SYNC_DATA.delete("fixture:missing");
  assert.equal(await r2.SYNC_DATA.get("fixture:persistent"), null);
  await r2.SYNC_DATA.put("fixture:live", "replaced");
  assert.equal(db.prepare("SELECT expires_at FROM selfhost_kv WHERE key = 'fixture:live'").get().expires_at, null, "overwriting without a TTL clears the previous expiry");
  const realNow = Date.now;
  let kvNow = 1_800_000_000_000;
  Date.now = () => kvNow;
  try {
    await r2.SYNC_DATA.put("fixture:ttl", "ttl", { expirationTtl: 60 });
    kvNow += 59_000;
    assert.equal(await r2.SYNC_DATA.get("fixture:ttl"), "ttl");
    kvNow += 1_000;
    assert.equal(await r2.SYNC_DATA.get("fixture:ttl"), null);
    await r2.SYNC_DATA.put("fixture:absolute", "absolute", { expiration: Math.floor(kvNow / 1000) + 60 });
    kvNow += 60_000;
    assert.equal(await r2.SYNC_DATA.get("fixture:absolute"), null);
  } finally { Date.now = realNow; }
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
  await assert.rejects(stored.arrayBuffer(), TypeError, "arrayBuffer() consumes the object's body exactly once");
  assert.equal(stored.httpMetadata.contentType, "application/json");
  assert.equal(stored.customMetadata.userId, "fixture");
  assert.equal(stored.uploaded.toISOString(), "2026-09-21T00:00:00.000Z");
  assert.equal(await localR2.get("weekly/fixture/missing"), null);
  assert.equal(await localR2.head("weekly/fixture/missing"), null);
  const r2Options = { httpMetadata: { contentType: "text/plain", cacheControl: "no-store" }, customMetadata: { kind: "probe" } };
  for (const [key, body, expected] of [
    ["body/string", "日本語", "日本語"],
    ["body/buffer", new TextEncoder().encode("buffer").buffer, "buffer"],
    ["body/view", new TextEncoder().encode("-view-").subarray(1, 5), "view"],
    ["body/stream", new Response("stream").body, "stream"]
  ]) {
    const put = await localR2.put(key, body, r2Options);
    const head = await localR2.head(key);
    assert.equal(put.key, key);
    assert.equal(head.size, new TextEncoder().encode(expected).byteLength);
    assert.equal(head.etag, createHash("md5").update(expected).digest("hex"));
    assert.ok(head.uploaded instanceof Date);
    assert.deepEqual(head.httpMetadata, r2Options.httpMetadata);
    assert.deepEqual(head.customMetadata, r2Options.customMetadata);
    assert.equal(Object.hasOwn(head, "body"), false);
    const object = await localR2.get(key);
    assert.equal(await object.text(), expected);
    await assert.rejects(object.arrayBuffer(), TypeError);
    const streamed = await localR2.get(key);
    assert.equal(await new Response(streamed.body).text(), expected);
    await assert.rejects(streamed.text(), TypeError);
    await localR2.delete(key);
    assert.equal(await localR2.head(key), null);
  }

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
  assert.equal(page2.cursor, undefined);
  assert.deepEqual([...page1.objects, ...page2.objects].map((object) => object.key), ["weekly/fixture/2026-09-21.json", "weekly/fixture/a", "weekly/fixture/b", "weekly/fixture/c"]);
  assert.ok(page1.objects.every((object) => object.uploaded instanceof Date && typeof object.size === "number"));
  assert.equal(await localR2.put("weekly/fixture/a", "overwrite", { onlyIf: { etagDoesNotMatch: "*" } }), null);
  assert.equal(await (await localR2.get("weekly/fixture/a")).text(), "a");
  const races = await Promise.all([
    localR2.put("weekly/fixture/race", "first", { onlyIf: { etagDoesNotMatch: "*" } }),
    localR2.put("weekly/fixture/race", "second", { onlyIf: { etagDoesNotMatch: "*" } })
  ]);
  assert.equal(races.filter(Boolean).length, 1, "only one conditional R2 create may win concurrently");
  assert.ok(["first", "second"].includes(new TextDecoder().decode(await (await localR2.get("weekly/fixture/race")).arrayBuffer())));
  await (await localR2.get("weekly/fixture/race")).body.cancel();
  await localR2.delete(["weekly/fixture/a", "weekly/fixture/b", "weekly/fixture/c", "weekly/fixture/race"]);
  await localR2.delete("weekly/fixture/missing");

  assert.deepEqual(await r2.SYNC_PUSH_LIMITER.limit({ key: "same" }), { success: true });
  assert.deepEqual(await r2.SYNC_PUSH_LIMITER.limit({ key: "same" }), { success: true });
  assert.deepEqual(await r2.SYNC_PUSH_LIMITER.limit({ key: "same" }), { success: false });
  assert.deepEqual(await createBindings(db, oldR2).SYNC_PUSH_LIMITER.limit({ key: "same" }), { success: false }, "limits survive adapter recreation");
  assert.deepEqual(await r2.SYNC_PUSH_LIMITER.limit({ key: "other" }), { success: true });
  for (const [name, maximum] of [["SYNC_PULL_LIMITER", 4], ["SYNC_STATUS_LIMITER", 20]]) {
    for (let count = 0; count < maximum; count++) assert.deepEqual(await r2[name].limit({ key: "same" }), { success: true });
    assert.deepEqual(await r2[name].limit({ key: "same" }), { success: false });
  }
  Date.now = () => 120_000;
  try {
    assert.deepEqual(await r2.SYNC_PUSH_LIMITER.limit({ key: "window" }), { success: true });
    assert.deepEqual(await r2.SYNC_PUSH_LIMITER.limit({ key: "window" }), { success: true });
    assert.deepEqual(await r2.SYNC_PUSH_LIMITER.limit({ key: "window" }), { success: false });
    Date.now = () => 180_000;
    assert.deepEqual(await r2.SYNC_PUSH_LIMITER.limit({ key: "window" }), { success: true });
  } finally { Date.now = realNow; }
  const rowCounts = countTables(db);
  await mkdir(path.join(staging, "r2"), { recursive: true });
  await writeFile(path.join(staging, "manifest.json"), JSON.stringify({ rowCounts, r2Objects: 0 }));
  assert.ok(verifyMigrationDir(staging).tables > 0);
  compareRowCounts({ users: 0, teams: 0 }, { users: "0", teams: 0 });
  assert.throws(() => compareRowCounts({ users: 2 }, { users: 1 }), /row count differs/);
  db.close();

  const bundlePath = path.join(root, "selfhost", "dist", "index.js");
  const vars = JSON.parse((await readFile(path.join(root, "wrangler.jsonc"), "utf8")).replace(/^\s*\/\/.*$/gm, "")).vars;
  const runtime = await createRuntime({ dataDir: path.join(staging, "route-runtime"), envFile: path.join(staging, "missing.env"), bundlePath });
  try {
    assert.equal(runtime.env.LAUNCH_GIFT_CLAIM_UNTIL, vars.LAUNCH_GIFT_CLAIM_UNTIL);
    assert.equal(runtime.env.LAUNCH_GIFT_CLAIM_UNTIL, "2026-11-08T00:00:00+08:00");
    for (const [key, value] of Object.entries(vars)) assert.equal(runtime.env[key], value);
    assert.equal(runtime.env.REQUIRE_AUTH_HARDENING, "1");
    const overrideFile = path.join(staging, "override.env");
    await writeFile(overrideFile, "APP_BUNDLE_ID=override.bundle\nLAUNCH_GIFT_CLAIM_UNTIL=2099-01-01T00:00:00Z\nREQUIRE_AUTH_HARDENING=0\nAPP_STORE_PRIVATE_KEY=one\\ntwo\n");
    const overridden = await createRuntime({ dataDir: path.join(staging, "override-runtime"), envFile: overrideFile, bundlePath });
    try {
      assert.equal(overridden.env.APP_BUNDLE_ID, "override.bundle");
      assert.equal(overridden.env.LAUNCH_GIFT_CLAIM_UNTIL, "2099-01-01T00:00:00Z");
      assert.equal(overridden.env.REQUIRE_AUTH_HARDENING, "0");
      assert.equal(overridden.env.APP_STORE_PRIVATE_KEY, "one\ntwo");
      assert.equal(overridden.env.WECHAT_PAY_PRICES, vars.WECHAT_PAY_PRICES);
    } finally { overridden.db.close(); }
    const health = await runtime.worker.fetch(new Request("http://127.0.0.1:8787/api/health"), runtime.env, { waitUntil() {} });
    assert.equal(health.status, 200);
    const healthJson = await health.json();
    assert.equal(healthJson.migrationsApplied, true);
    assert.equal(healthJson.authHardening, true);
    assert.equal(healthJson.productionReady, false);
    const config = await runtime.worker.fetch(new Request("http://127.0.0.1:8787/api/auth/config"), runtime.env, { waitUntil() {} });
    assert.deepEqual(await config.json(), { appleEnabled: true, appleClientId: "com.shushugo.app", wechatAppEnabled: false, turnstileEnabled: false, reviewLoginOpen: false });

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

    // Mirror the team/duel harness requests, using the migrated runtime's real bindings.
    const call = async (pathname, { body, auth = token, method = body === undefined ? "GET" : "POST" } = {}) => {
      const response = await dispatch(runtime.worker, new Request(`https://worker.test${pathname}`, {
        method,
        headers: { "content-type": "application/json", "cf-connecting-ip": "192.0.2.4", ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      }), runtime.env);
      return { status: response.status, body: await response.json() };
    };
    await runtime.env.DB.prepare("INSERT INTO users(id,email,password_hash,password_salt,display_name,created_at) VALUES(?,?,?,?,?,?)")
      .bind("adapter-opponent", "opponent@example.invalid", "", "", "对手", now).run();
    const opponentToken = "adapter-opponent-token";
    await runtime.env.DB.prepare("INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)")
      .bind(createHash("sha256").update(opponentToken).digest("base64url"), "adapter-opponent", now, "2099-01-01T00:00:00.000Z").run();
    const questions = Array.from({ length: 10 }, (_, index) => ({ id: index + 1, level: "N3", kind: "meaning", prompt: `词${index + 1}`, options: ["学习", "睡觉", "吃饭", "走路"], answerIndex: 0, answer: "学习", limitMs: 10000 }));
    const answers = (correct) => questions.map((_, index) => ({ selected: index < correct ? 0 : "unknown", responseMs: 1000 }));
    const createdDuel = await call("/api/duels", { body: { levels: ["N3"], questionCount: 10, questions, answers: answers(2) } });
    assert.equal(createdDuel.status, 201, JSON.stringify(createdDuel.body));
    const duelId = createdDuel.body.duel.id;
    const duelToken = "adapter-anonymous-token".padEnd(40, "x");
    const submitted = await call(`/api/duels/${duelId}/submit`, { auth: null, body: { answers: answers(3), token: duelToken } });
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
    assert.equal(submitted.body.duel.winner, null);
    assert.equal(await runtime.env.DB.prepare("SELECT opponent_user_id FROM duels WHERE id = ?").bind(duelId).first("opponent_user_id"), null);
    const claimed = await call(`/api/duels/${duelId}/claim`, { auth: opponentToken, body: { token: duelToken } });
    assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
    assert.equal(claimed.body.duel.winner, "opponent");
    const retry = await call(`/api/duels/${duelId}/claim`, { auth: opponentToken, body: { token: duelToken } });
    assert.equal(retry.body.duel.decidedAt, claimed.body.duel.decidedAt);
    assert.equal((await call(`/api/duels/${duelId}/claim`, { body: { token: duelToken } })).status, 400);
    const rewards = await call("/api/teams/rewards", { auth: opponentToken });
    assert.equal(rewards.status, 200);
    assert.equal(rewards.body.wins.length, 1);
    assert.equal(rewards.body.wins[0].duel_id, duelId, "decision and weekly reward commit together in a D1 batch");

    const createdTeam = await call("/api/teams", { body: { name: "适配器队伍", displayName: "学习伙伴", targetLevel: "N3", emoji: "🌱", visibility: "public" } });
    assert.equal(createdTeam.status, 201, JSON.stringify(createdTeam.body));
    const studyDay = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await runtime.env.DB.prepare("UPDATE teams SET streak_start = ? WHERE id = ?").bind(studyDay, createdTeam.body.team.id).run();
    const activity = { studyDay, studyCount: 40, completed: true, wordCount: 30, activeMinutes: 10 };
    assert.equal((await call("/api/teams/activity", { body: activity })).status, 200);
    const staleActivity = await call("/api/teams/activity", { body: { ...activity, studyCount: 2, completed: false, wordCount: 12, activeMinutes: 3 } });
    assert.equal(staleActivity.status, 200, JSON.stringify(staleActivity.body));
    const member = staleActivity.body.team.members[0];
    assert.deepEqual([member.studyCount, member.completed, member.wordCount, member.activeMinutes, member.cells[0]], [40, true, 30, 10, "passed"], "batch reads see the preceding MAX-based activity write");

    const feedback = { kind: "feedback", message: "希望增加一个功能", contact: "", platform: "web", app_version: "1.0.0", route: "profile" };
    assert.deepEqual(await call("/api/feedback", { body: feedback }), { status: 200, body: { accepted: true } });
    assert.equal((await call("/api/feedback", { auth: null, body: feedback })).status, 200);
    assert.equal((await call("/api/feedback", { auth: "invalid", body: feedback })).status, 200);
    const reports = (await runtime.env.DB.prepare("SELECT user_id, diagnostics_json, client_hash FROM feedback_reports ORDER BY rowid").all()).results;
    assert.deepEqual(reports.map((row) => row.user_id), ["adapter-user", null, null]);
    assert.equal(reports[0].diagnostics_json, null);
    assert.equal(reports[0].client_hash, createHash("sha256").update("192.0.2.4").digest("base64url"));
    for (let index = 3; index < 10; index++) assert.equal((await call("/api/feedback", { auth: null, body: feedback })).status, 200);
    assert.equal((await call("/api/feedback", { auth: null, body: feedback })).status, 429, "real D1 UPSERT RETURNING returns no row once the feedback quota is exhausted");
    assert.equal(await runtime.env.DB.prepare("SELECT COUNT(*) AS n FROM feedback_reports").first("n"), 10);

    const reviewPassword = "adapter-review-password";
    await runtime.env.DB.prepare("INSERT INTO review_passwords (password_hash, use_by) VALUES (?, ?)")
      .bind(createHash("sha256").update(reviewPassword).digest("base64url"), new Date(Date.now() + 86_400_000).toISOString()).run();
    const review = await call("/api/auth/review-login", { auth: null, body: { account: "review@shushugo.com", password: reviewPassword } });
    assert.equal(review.status, 200, JSON.stringify(review.body));
    assert.equal(review.body.email, "review@shushugo.com");
    assert.equal(review.body.entitlements.isPro, true);
    const reviewRow = await runtime.env.DB.prepare("SELECT first_login_at, expires_at FROM review_passwords").first();
    assert.ok(reviewRow.first_login_at && Math.abs(Date.parse(reviewRow.expires_at) - Date.now() - 7 * 86_400_000) < 60_000, "first login starts the seven-day clock");
    assert.equal(review.body.entitlements.expiresAt, reviewRow.expires_at);
    const reviewSession = await runtime.env.DB.prepare("SELECT expires_at FROM sessions WHERE token_hash = ?")
      .bind(createHash("sha256").update(review.body.access_token).digest("base64url")).first();
    assert.equal(reviewSession.expires_at, reviewRow.expires_at);

    await runtime.env.DB.prepare("UPDATE feedback_reports SET created_at = ? WHERE rowid = (SELECT MIN(rowid) FROM feedback_reports)")
      .bind(Math.floor(Date.now() / 1000) - 181 * 24 * 60 * 60).run();
    const oldWeeklyKey = "weekly/adapter-user/2020-01-05.json";
    await importR2Page([{ key: oldWeeklyKey, last_modified: "2020-01-05T00:00:00Z" }], "fixture-bucket", path.join(staging, "route-runtime", "r2"), async () => Buffer.from("old"));
    const retainedKey = "weekly/adapter-user/2099-01-04.json";
    await runtime.env.SYNC_BUCKET.put(retainedKey, "recent");
    const scheduledEnvFile = path.join(staging, "scheduled.env");
    await writeFile(scheduledEnvFile, "WEEKLY_REPORT_RETENTION_DAYS=30\n");
    const scheduled = spawnSync(process.execPath, [path.join(root, "selfhost/server.mjs"), "--scheduled"], {
      encoding: "utf8", env: { ...process.env, SHUSHUGO_DATA_DIR: path.join(staging, "route-runtime"), SHUSHUGO_CREDENTIAL_FILE: scheduledEnvFile, SHUSHUGO_WORKER_BUNDLE: bundlePath }
    });
    assert.equal(scheduled.status, 0, `${scheduled.stdout}\n${scheduled.stderr}`);
    assert.equal(await runtime.env.DB.prepare("SELECT COUNT(*) AS n FROM feedback_reports").first("n"), 9, "the CLI runs the real Worker's scheduled cleanup batch");
    assert.equal(await runtime.env.SYNC_BUCKET.head(oldWeeklyKey), null);
    assert.notEqual(await runtime.env.SYNC_BUCKET.head(retainedKey), null);
  } finally { runtime.db.close(); }

  let waited = false;
  const response = await dispatch({ async fetch(_request, _env, ctx) {
    ctx.waitUntil(new Promise((resolve) => setTimeout(() => { waited = true; resolve(); }, 20)));
    return new Response("ok");
  } }, new Request("http://localhost/"), {});
  assert.equal(await response.text(), "ok");
  assert.equal(waited, true, "waitUntil promises must finish before the response is returned");
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  try {
    let nested = false;
    const response = await dispatch({ async fetch(_request, _env, ctx) {
      assert.equal(ctx.waitUntil(Promise.reject(new Error("early background failure"))), undefined);
      ctx.waitUntil(new Promise((resolve) => setTimeout(() => {
        ctx.waitUntil(new Promise((finish) => setTimeout(() => { nested = true; finish(); }, 10)));
        resolve();
      }, 20)));
      await new Promise((resolve) => setTimeout(resolve, 10));
      return new Response("still ok");
    } }, new Request("https://worker.test/"), {});
    assert.equal(await response.text(), "still ok");
    assert.equal(nested, true);
    assert.ok(errors.some((message) => message.includes("early background failure")));
    let drained = false;
    await assert.rejects(dispatch({ async fetch(_request, _env, ctx) {
      ctx.waitUntil(new Promise((resolve) => setTimeout(() => { drained = true; resolve(); }, 10)));
      throw new Error("fetch failed");
    } }, new Request("https://worker.test/"), {}), /fetch failed/);
    assert.equal(drained, true, "handler failure still drains registered background tasks");
  } finally { console.error = originalError; }

  const scheduledProbe = path.join(staging, "scheduled-probe.mjs");
  await writeFile(scheduledProbe, `
    import assert from "node:assert/strict";
    export default { async scheduled(controller, env, ctx) {
      assert.equal(controller.cron, "17 3 * * *");
      assert.ok(Math.abs(controller.scheduledTime - Date.now()) < 1000);
      assert.equal(env.REQUIRE_AUTH_HARDENING, "1");
      assert.equal(ctx.waitUntil(Promise.reject(new Error("scheduled background failure"))), undefined);
      ctx.waitUntil(new Promise(resolve => setTimeout(() => {
        ctx.waitUntil(env.DB.prepare("CREATE TABLE scheduled_probe(ok INTEGER)").run().then(() => console.log("scheduled task drained")));
        resolve();
      }, 20)));
      await new Promise(resolve => setTimeout(resolve, 10));
      if (env.FAIL_SCHEDULED === "1") throw new Error("scheduled handler failure");
    } };
  `);
  const scheduledProbeRun = spawnSync(process.execPath, [path.join(root, "selfhost/server.mjs"), "--scheduled"], {
    encoding: "utf8", env: { ...process.env, SHUSHUGO_DATA_DIR: path.join(staging, "scheduled-probe-data"), SHUSHUGO_CREDENTIAL_FILE: path.join(staging, "missing.env"), SHUSHUGO_WORKER_BUNDLE: scheduledProbe }
  });
  assert.equal(scheduledProbeRun.status, 0, `${scheduledProbeRun.stdout}\n${scheduledProbeRun.stderr}`);
  assert.match(scheduledProbeRun.stderr, /scheduled background failure/);
  assert.match(scheduledProbeRun.stdout, /scheduled task drained/);
  const failureEnv = path.join(staging, "scheduled-failure.env");
  await writeFile(failureEnv, "FAIL_SCHEDULED=1\n");
  const failedScheduled = spawnSync(process.execPath, [path.join(root, "selfhost/server.mjs"), "--scheduled"], {
    encoding: "utf8", env: { ...process.env, SHUSHUGO_DATA_DIR: path.join(staging, "scheduled-failure-data"), SHUSHUGO_CREDENTIAL_FILE: failureEnv, SHUSHUGO_WORKER_BUNDLE: scheduledProbe }
  });
  assert.equal(failedScheduled.status, 1, `${failedScheduled.stdout}\n${failedScheduled.stderr}`);
  assert.match(failedScheduled.stderr, /scheduled handler failure/);
  assert.match(failedScheduled.stdout, /scheduled task drained/, "scheduled handler failure drains background tasks before closing SQLite");
  console.log("PASS self-host adapters, imports, health/auth/sync/team-streak/duel/feedback/review-login routes, vars, scheduled cleanup and waitUntil");
} finally {
  globalThis.fetch = originalFetch;
  await rm(staging, { recursive: true, force: true });
  await rm(path.join(root, "selfhost", "dist"), { recursive: true, force: true });
}
