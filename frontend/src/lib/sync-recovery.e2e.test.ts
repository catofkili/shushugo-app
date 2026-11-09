import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { gunzipSync } from "node:zlib";
import type { Database } from "sql.js";
import type { CloudSyncTrigger } from "./sync-api";

// 只替换平台边界：真实 database/storage/schema/snapshot/merge/sync-api 全部执行。
// Node 没有微信宿主；Preferences 用官方 Web 实现，文件 API 写独立临时目录。
vi.mock("@capacitor/core", async (original) => {
  const actual = await original<typeof import("@capacitor/core")>();
  return { ...actual, Capacitor: { ...actual.Capacitor, getPlatform: () => "wechat", isNativePlatform: () => false } };
});
vi.mock("@capacitor/preferences", async () => {
  const { PreferencesWeb } = await import("@capacitor/preferences/dist/esm/web");
  return { Preferences: new PreferencesWeb() };
});
vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: fileURLToPath(new URL("../../node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url))
}));
let diskRoot: string;
vi.mock("@capacitor/filesystem", async () => {
  const fs = await import("node:fs/promises");
  const path = (name: string) => join(diskRoot, name);
  return { Directory: { Library: "LIBRARY" }, Encoding: { UTF8: "utf8" }, Filesystem: {
    writeFile: async ({ path: name, data, encoding }: { path: string; data: string; encoding?: string }) => {
      await fs.mkdir(join(path(name), ".."), { recursive: true });
      await fs.writeFile(path(name), encoding === "utf8" ? data : Buffer.from(data, "base64"));
    },
    readFile: async ({ path: name, encoding }: { path: string; encoding?: string }) => {
      const bytes = await fs.readFile(path(name));
      return { data: encoding === "binary" ? new Uint8Array(bytes) : bytes.toString(encoding === "utf8" ? "utf8" : "base64") };
    },
    stat: async ({ path: name }: { path: string }) => {
      const info = await fs.stat(path(name));
      return { type: info.isDirectory() ? "directory" : "file", size: info.size, mtime: info.mtimeMs, ctime: info.ctimeMs };
    },
    rename: async ({ from, to }: { from: string; to: string }) => fs.rename(path(from), path(to)),
    deleteFile: async ({ path: name }: { path: string }) => fs.unlink(path(name)),
    readdir: async ({ path: name }: { path: string }) => ({ files: (await fs.readdir(path(name))).map((name) => ({ name })) })
  } };
});

const seed = new Uint8Array(readFileSync(new URL("../../public/nihongo.db", import.meta.url)));
const email = "recovery@example.invalid";
const token = "recovery-test-token";
const stateKey = `mn_cloud_sync_state:${encodeURIComponent(email)}`;
const reviewTables = ["reviews", "grammar_reviews", "kana_reviews", "kanji_unit_reviews", "kanji_char_reviews", "confusion_reviews"] as const;
const storage = new Map<string, string>();
let client: typeof import("./sync-api");
let database: typeof import("./database");
let db: Database;
let host: EventTarget & { __shushugoCloudSyncCleanup?: () => void };
let server: ReturnType<typeof createServer>;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// 和 Worker 一样保存压缩 blob；同 operation/hash 重试幂等，再以 generation 乐观锁拒绝旧写入。
// 不在服务端做合并，否则客户端漏合并也能过测试。解压只用于下面的观察断言。
function createServer() {
  let bytes: Uint8Array | undefined;
  let generation = 0;
  let modified: string | null = null;
  let compression = "none";
  let format = "";
  let hash = "";
  const operations = new Map<string, { hash: string; generation: number; timestamp: string }>();
  const pushes: Array<{ bytes: Uint8Array; compression: string }> = [];
  const requests: string[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input), "https://sync.invalid");
    const headers = new Headers(init?.headers);
    requests.push(url.pathname);
    if (url.pathname === "/api/auth/wechat") return json({ access_token: token, email, emailVerified: true, authProviders: ["wechat"] });
    if (headers.get("authorization") !== `Bearer ${token}`) return json({ detail: "Unauthorized" }, 401);
    if (url.pathname === "/api/sync/status") return json({ available: Boolean(bytes), last_modified: modified, generation });
    if (url.pathname === "/api/sync/pull") {
      if (!bytes) return json({ detail: "No backup" }, 404);
      return new Response(bytes.slice().buffer as ArrayBuffer, { headers: {
        "content-type": "application/octet-stream", "x-sync-format": format,
        "x-sync-compression": compression, "x-sync-generation": String(generation), "x-sync-last-modified": modified!
      } });
    }
    if (url.pathname === "/api/sync/push" && init?.method === "POST") {
      const uploaded = new Uint8Array(await new Response(init.body).arrayBuffer());
      const nextHash = createHash("sha256").update(uploaded).digest("hex");
      const operation = headers.get("x-sync-operation-id")!;
      const previous = operations.get(operation);
      if (previous) return previous.hash === nextHash
        ? json({ ...previous, idempotent_replay: true }) : json({ detail: "operation_id reused" }, 409);
      if (bytes && hash === nextHash) return json({ generation, timestamp: modified, idempotent_replay: true });
      const base = headers.get("x-sync-base-generation");
      const baseModified = headers.get("x-sync-base-modified");
      if ((base !== null && Number(base) !== generation) || (base === null && baseModified && baseModified !== modified)) {
        return json({ detail: "云端已有更新，请先同步云端进度后再上传。", conflict: true, generation, last_modified: modified }, 409);
      }
      format = headers.get("x-sync-format")!;
      compression = headers.get("x-sync-compression")!;
      expect(format).toBe("master-nihongo-user-sqlite-v1");
      expect(headers.get("x-sync-protocol-version")).toBe("2");
      expect(["gzip", "none"]).toContain(compression);
      expect(base).not.toBeNull();
      bytes = uploaded.slice();
      hash = nextHash;
      generation += 1;
      modified = new Date(Date.UTC(2026, 10, 9, 0, 0, generation)).toISOString();
      operations.set(operation, { hash, generation, timestamp: modified });
      pushes.push({ bytes, compression });
      return json({ status: "success", generation, timestamp: modified });
    }
    throw new Error(`Unexpected network request: ${url.pathname}`);
  };
  return { fetch: vi.fn(fetch), pushes, requests, get generation() { return generation; }, get modified() { return modified; } };
}

const rows = (source: Database, table: string) => {
  const result = source.exec(`SELECT * FROM ${table} ORDER BY sync_uid`)[0];
  return result ? result.values.map((values) => Object.fromEntries(result.columns.flatMap((column, i) => column === "id" ? [] : [[column, values[i]]]))) : [];
};
const records = (source = db) => Object.fromEntries(reviewTables.map((table) => [table, rows(source, table)]));
const cloudRecords = async () => {
  const latest = server.pushes[server.pushes.length - 1];
  const remote = await database.openDatabase(latest.compression === "gzip" ? new Uint8Array(gunzipSync(latest.bytes)) : latest.bytes);
  try { return records(remote); } finally { remote.close(); }
};
const union = (old: ReturnType<typeof records>, added: ReturnType<typeof records>) => Object.fromEntries(
  reviewTables.map((table) => [table, [...old[table], ...added[table]].sort((a, b) => String(a.sync_uid).localeCompare(String(b.sync_uid)))])
);

async function boot(clearPreferences = true) {
  if (client) {
    await (await import("./storage")).flushPendingSave();
    host.__shushugoCloudSyncCleanup?.();
    db.close();
  }
  rmSync(diskRoot, { recursive: true, force: true });
  if (clearPreferences) storage.clear();
  vi.resetModules(); // 真正重启模块单例，包括首次上传合并标记和设备号。
  database = await import("./database");
  await database.importDatabase(seed);
  db = database.getDatabase();
  (await import("./study-core")).ensureUserTables();
  (await import("./sync/schema")).ensureSyncSchema();
  client = await import("./sync-api");
  expect(reviewTables.map((table) => rows(db, table).length)).toEqual([0, 0, 0, 0, 0, 0]);
}

async function login() {
  client.registerCloudAutoSyncLifecycle();
  await client.cloudWechatMiniLogin({ code: "test-wx-code" });
  // 登录事件已经启动真实监听器；这里等待同一个 in-flight promise，不另写同步流程。
  return client.autoSyncCloudDatabase("login");
}

function learn(count: number, allTables = false) {
  for (let i = 0; i < count; i += 1) {
    db.run("INSERT INTO reviews(word_id, answer, score_after, reviewed_on) VALUES (?, 'know', 10, '2026-11-09')", [i + 1]);
    if (!allTables) continue;
    db.run("INSERT INTO grammar_reviews(grammar_id, answer, score_after, reviewed_on) VALUES (?, 'know', 10, '2026-11-09')", [i + 1]);
    db.run("INSERT INTO kana_reviews(symbol, answer, reviewed_on, reviewed_at) VALUES (?, 'know', '2026-11-09', ?)", ["あいう"[i], Date.UTC(2026, 10, 9) + i * 1000]);
    for (const [table, key, value] of [
      ["kanji_unit_reviews", "unit_key", `test-unit-${i}`],
      ["kanji_char_reviews", "char", "日月火"[i]],
      ["confusion_reviews", "group_key", `test-group-${i}`]
    ]) db.run(`INSERT INTO ${table}(${key}, answer, reviewed_on, reviewed_at) VALUES (?, 'know', '2026-11-09', ?)`, [value, Date.UTC(2026, 10, 9) + i * 1000]);
  }
}

async function backedUpDevice() {
  learn(2, true);
  const original = records();
  await expect(login()).resolves.toMatchObject({ status: "uploaded" });
  expect(await cloudRecords()).toEqual(original);
  return original;
}

beforeEach(async () => {
  diskRoot = mkdtempSync(join(tmpdir(), "shushugo-sync-recovery-"));
  storage.clear();
  const localStorage = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); }, removeItem: (key: string) => { storage.delete(key); } };
  host = Object.assign(new EventTarget(), { localStorage, setTimeout, clearTimeout });
  vi.stubGlobal("window", host);
  vi.stubGlobal("localStorage", localStorage);
  vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
  const fflate = createRequire(import.meta.url)("../../../wechat-miniprogram/src/vendor/fflate.umd.js");
  vi.stubGlobal("__non_webpack_require__", Object.assign(() => undefined, { async: async (path: string) => {
    expect(path).toBe("./account/fflate.umd.js");
    return fflate;
  } }));
  vi.stubEnv("VITE_SYNC_API_URL", "https://sync.invalid");
  server = createServer();
  vi.stubGlobal("fetch", server.fetch);
  client = undefined as unknown as typeof client;
  await boot();
});

afterEach(async () => {
  await (await import("./storage")).flushPendingSave();
  host.__shushugoCloudSyncCleanup?.();
  db?.close();
  rmSync(diskRoot, { recursive: true, force: true });
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("真实 SQLite 云备份恢复", () => {
  it("1. 学习并登录自动上传，删库和 Preferences 后重新登录，六种作答流水逐行恢复", async () => {
    const original = await backedUpDevice();
    await boot();
    await expect(login()).resolves.toMatchObject({ status: "downloaded" });
    expect(records()).toEqual(original);
    expect(server.pushes).toHaveLength(1);
    expect((await import("./storage")).getPersistenceFailure()).toBeNull();
    const persisted = await database.openDatabase(new Uint8Array(readFileSync(join(diskRoot, "masternihongo/nihongo.db"))));
    try { expect(records(persisted)).toEqual(original); } finally { persisted.close(); }
  });

  it("2. 重装后先不登录新学 3 条，微信登录后本机和云端都保留旧记录 + 3 条", async () => {
    const original = await backedUpDevice();
    await boot();
    learn(3);
    const expected = union(original, records());
    await expect(login()).resolves.toMatchObject({ status: "uploaded" });
    expect(records()).toEqual(expected);
    expect(await cloudRecords()).toEqual(expected);
  });

  it.each<CloudSyncTrigger>(["startup", "login", "local-change", "foreground", "poll", "online"])("3. 空库残留 dirty 和旧游标，%s 不上传空快照且最终恢复全部记录", async (trigger) => {
    const original = await backedUpDevice();
    const { Preferences } = await import("@capacitor/preferences");
    await Preferences.set({ key: stateKey, value: JSON.stringify({ lastSyncedGeneration: server.generation, lastSyncedModified: server.modified, localDirty: true }) });
    await boot(false);
    const pushesBefore = server.pushes.length;
    const result = await client.autoSyncCloudDatabase(trigger);
    expect(result.status).toBe(["startup", "login"].includes(trigger) ? "downloaded" : "idle");
    expect(server.pushes).toHaveLength(pushesBefore);
    if (result.status === "idle") await expect(client.autoSyncCloudDatabase("startup")).resolves.toMatchObject({ status: "downloaded" });
    expect(records()).toEqual(original);
    expect(await cloudRecords()).toEqual(original);
    expect(server.pushes).toHaveLength(pushesBefore);
  });

  it("4. 重装后只有 2 条新记录，手动上传也先合并，旧记录逐条保留", async () => {
    const original = await backedUpDevice();
    await boot();
    learn(2);
    const expected = union(original, records());
    const { Preferences } = await import("@capacitor/preferences");
    await Preferences.set({ key: "mn_cloud_sync_token", value: token });
    await Preferences.set({ key: "mn_cloud_sync_email", value: email });
    const start = server.requests.length;
    await expect(client.pushCloudBackup()).resolves.toBe("云端备份已上传。");
    expect(server.requests.slice(start)).toEqual(["/api/sync/status", "/api/sync/pull", "/api/sync/push"]);
    expect(records()).toEqual(expected);
    expect(await cloudRecords()).toEqual(expected);
  });

  it("内存服务器拒绝旧 generation，失败写入不能改变云端备份", async () => {
    const original = await backedUpDevice();
    const response = await server.fetch("/api/sync/push", { method: "POST", headers: {
      authorization: `Bearer ${token}`, "content-type": "application/octet-stream",
      "x-sync-format": "master-nihongo-user-sqlite-v1", "x-sync-compression": "none", "x-sync-protocol-version": "2",
      "x-sync-base-generation": "0", "x-sync-operation-id": "stale-writer"
    }, body: new Uint8Array([1, 2, 3]) });
    expect(response.status).toBe(409);
    expect(server.generation).toBe(1);
    expect(await cloudRecords()).toEqual(original);
  });
});
