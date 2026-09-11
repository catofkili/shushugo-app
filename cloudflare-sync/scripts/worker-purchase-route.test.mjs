import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outdir = mkdtempSync(join(tmpdir(), "shushugo-worker-test-"));
const wrangler = join(root, "node_modules", ".bin", "wrangler");
const built = spawnSync(wrangler, ["deploy", "--dry-run", "--outdir", outdir], {
  cwd: root,
  encoding: "utf8"
});
if (built.status !== 0) throw new Error(`${built.stdout}\n${built.stderr}`);

const jws = (payload) => `e30.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;
const staleDate = "2020-01-01T00:00:00.000Z";
const futureDate = "2099-01-01T00:00:00.000Z";

class FakeStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql.replace(/\s+/g, " ").trim();
    this.params = [];
  }

  bind(...params) {
    this.params = params;
    return this;
  }

  async first() {
    if (this.sql.includes("FROM sessions")) return { user_id: "user-1", expires_at: futureDate };
    if (this.sql.includes("FROM entitlements")) return { ...this.database.entitlement };
    if (this.sql.includes("FROM apple_transaction_owners")) return { user_id: "user-1" };
    return null;
  }

  async all() {
    if (this.sql.includes("FROM entitlements") && this.sql.includes("LIMIT 25")) {
      // 不能让 fake 无条件补 user_id：旧实现的 SELECT 漏了这个字段，真实 D1 会给
      // undefined，但宽松替身仍会把测试跑绿。先锁住 SQL 投影，再返回对应结果。
      assert.match(this.sql, /^SELECT user_id,/);
      return { results: [{ user_id: "user-1", ...this.database.entitlement }] };
    }
    return { results: [] };
  }

  async run() {
    if (this.sql.startsWith("INSERT INTO entitlements")) {
      const [userId, productId, source, originalTransactionId, transactionId, environment, expiresAt, updatedAt] = this.params;
      this.database.lastSavedUserId = userId;
      this.database.entitlement = {
        is_pro: 1,
        product_id: productId,
        source,
        original_transaction_id: originalTransactionId,
        transaction_id: transactionId,
        environment,
        expires_at: expiresAt,
        updated_at: updatedAt
      };
    } else if (this.sql.startsWith("UPDATE entitlements SET is_pro = 0")) {
      this.database.entitlement = {
        ...this.database.entitlement,
        is_pro: 0,
        product_id: null,
        source: "free",
        expires_at: null,
        updated_at: this.params[0]
      };
    } else if (this.sql.startsWith("UPDATE entitlements SET updated_at")) {
      this.database.entitlement.updated_at = this.params[0];
    }
    return { success: true };
  }
}

class FakeD1 {
  constructor() {
    this.lastSavedUserId = null;
    this.entitlement = {
      is_pro: 1,
      product_id: "shushugo_pro_monthly",
      source: "app_store",
      original_transaction_id: "T1",
      transaction_id: "T1",
      environment: "Production",
      expires_at: staleDate,
      updated_at: staleDate
    };
  }

  prepare(sql) { return new FakeStatement(this, sql); }
  async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); }
}

const privateKeyPem = async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const bytes = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const body = bytes.toString("base64").match(/.{1,64}/g).join("\n");
  return `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`;
};

const key = await privateKeyPem();
const makeEnv = (database) => ({
  DB: database,
  SYNC_DATA: { get: async () => null, put: async () => undefined, delete: async () => undefined },
  SYNC_BUCKET: { delete: async () => undefined },
  APP_STORE_ISSUER_ID: "issuer",
  APP_STORE_KEY_ID: "key",
  APP_STORE_PRIVATE_KEY: key,
  APP_BUNDLE_ID: "com.shushugo.app"
});

const appleResponse = {
  data: [{ lastTransactions: [{
    originalTransactionId: "T1",
    status: 1,
    signedTransactionInfo: jws({
      bundleId: "com.shushugo.app",
      productId: "shushugo_pro_yearly",
      originalTransactionId: "T1",
      transactionId: "T2",
      environment: "Production",
      expiresDate: Date.parse(futureDate)
    })
  }] }]
};

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const url = String(input);
  assert.match(url, /\/inApps\/v1\/subscriptions\/T1$/);
  return new Response(JSON.stringify(appleResponse), { status: 200, headers: { "content-type": "application/json" } });
};

try {
  const worker = (await import(pathToFileURL(join(outdir, "index.js")).href)).default;

  const routeDb = new FakeD1();
  const response = await worker.fetch(new Request("https://worker.test/api/entitlements", {
    headers: { authorization: "Bearer test-token" }
  }), makeEnv(routeDb), {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    isPro: true,
    source: "app_store",
    productId: "shushugo_pro_yearly",
    expiresAt: futureDate,
    updatedAt: routeDb.entitlement.updated_at
  });
  assert.equal(routeDb.entitlement.transaction_id, "T2", "route must replace missed T1 renewal with T2");

  const cronDb = new FakeD1();
  await worker.scheduled({}, makeEnv(cronDb), {});
  assert.equal(cronDb.lastSavedUserId, "user-1", "cron query must select user_id before applying T2");
  assert.equal(cronDb.entitlement.transaction_id, "T2");

  console.log("OK Worker entitlement route and cron renewal recovery");
} finally {
  globalThis.fetch = originalFetch;
  rmSync(outdir, { recursive: true, force: true });
}
