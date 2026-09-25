import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outdir = mkdtempSync(join(tmpdir(), "shushugo-launch-gift-test-"));
const built = spawnSync(join(root, "node_modules", ".bin", "wrangler"), ["deploy", "--dry-run", "--outdir", outdir], { cwd: root, encoding: "utf8" });
if (built.status !== 0) throw new Error(`${built.stdout}\n${built.stderr}`);
const farFuture = "2099-01-01T00:00:00.000Z";

class Statement {
  constructor(db, sql) { this.db = db; this.sql = sql.replace(/\s+/g, " ").trim(); this.params = []; }
  bind(...params) { this.params = params; return this; }
  async first() {
    if (this.sql.includes("FROM sessions")) return { user_id: "user-1", expires_at: this.db.sessionExpired ? "2000-01-01T00:00:00.000Z" : farFuture };
    if (this.sql.startsWith("INSERT INTO auth_rate_limits")) return { request_count: 1 };
    if (this.sql.includes("FROM launch_gift_grants")) return this.db.grant;
    if (this.sql.includes("FROM entitlements")) return this.db.entitlement;
    return null;
  }
  async run() {
    if (this.sql.startsWith("INSERT OR IGNORE INTO launch_gift_grants") && !this.db.grant) {
      const [user_id, granted_at, expires_at] = this.params;
      this.db.grant = { user_id, granted_at, expires_at };
    } else if (this.sql.startsWith("INSERT INTO entitlements")) {
      const [user_id, product_id, source, original_transaction_id, transaction_id, environment, expires_at, updated_at] = this.params;
      this.db.entitlement = { user_id, is_pro: 1, product_id, source, original_transaction_id, transaction_id, environment, expires_at, updated_at };
    } else if (this.sql.startsWith("UPDATE entitlements SET updated_at") && this.db.entitlement) {
      this.db.entitlement.updated_at = this.params[0];
    }
    return { success: true };
  }
}

class Db {
  constructor(entitlement = null) { this.entitlement = entitlement; this.grant = null; }
  prepare(sql) { return new Statement(this, sql); }
}

const envFor = (DB, deadline = farFuture) => ({
  DB,
  LAUNCH_GIFT_CLAIM_UNTIL: deadline,
  SYNC_DATA: { get: async () => null, put: async () => undefined },
  SYNC_BUCKET: {}
});
const request = (path, method = "POST") => new Request(`https://worker.test${path}`, {
  method,
  headers: { authorization: "Bearer token" }
});

try {
  const worker = (await import(pathToFileURL(join(outdir, "index.js")).href)).default;
  const db = new Db();
  const env = envFor(db);

  const anonymousClaim = await worker.fetch(new Request("https://worker.test/api/entitlements/launch-gift", { method: "POST" }), env, {});
  assert.equal(anonymousClaim.status, 401, "the grant requires an account");

  const unconfigured = await worker.fetch(request("/api/entitlements/launch-gift"), envFor(new Db(), ""), {});
  assert.equal(unconfigured.status, 409);
  assert.deepEqual(await unconfigured.json(), { code: "LAUNCH_GIFT_CLOSED" }, "empty configuration closes the window");

  const status = await worker.fetch(request("/api/entitlements", "GET"), env, {});
  assert.equal(status.status, 200);
  assert.deepEqual((await status.json()).launchGift, { open: true, claimUntil: farFuture });

  const anonymousStatus = await worker.fetch(new Request("https://worker.test/api/entitlements", { method: "GET" }), env, {});
  assert.equal(anonymousStatus.status, 200, "the client can read the public claim window before login");
  assert.deepEqual((await anonymousStatus.json()).launchGift, { open: true, claimUntil: farFuture });

  db.sessionExpired = true;
  const expiredStatus = await worker.fetch(request("/api/entitlements", "GET"), env, {});
  db.sessionExpired = false;
  assert.equal(expiredStatus.status, 401, "an expired session must stay 401, not read as an anonymous non-Pro user");

  const first = await worker.fetch(request("/api/entitlements/launch-gift"), env, {});
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(firstBody.source, "trial");
  assert.equal(firstBody.productId, "shushugo_pro_launch_gift");
  assert.equal(Date.parse(firstBody.expiresAt) - Date.parse(firstBody.launchGiftGrantedAt), 30 * 24 * 60 * 60 * 1000);

  const retry = await worker.fetch(request("/api/entitlements/launch-gift"), env, {});
  assert.equal(retry.status, 200, "retry repairs a lost response");
  assert.equal((await retry.json()).expiresAt, firstBody.expiresAt, "retry does not extend the original grant");

  const closedWindow = await worker.fetch(request("/api/entitlements/launch-gift"), envFor(new Db(), "2020-01-01T00:00:00.000Z"), {});
  assert.equal(closedWindow.status, 409);
  assert.deepEqual(await closedWindow.json(), { code: "LAUNCH_GIFT_CLOSED" });

  const afterClosing = await worker.fetch(request("/api/entitlements/launch-gift"), envFor(db, "2020-01-01T00:00:00.000Z"), {});
  assert.equal(afterClosing.status, 409, "a previous recipient cannot claim after the window closes");

  const lifetime = { is_pro: 1, product_id: "shushugo_pro_lifetime", source: "app_store", original_transaction_id: "T", transaction_id: "T", environment: "Production", expires_at: null, updated_at: farFuture };
  const paidDb = new Db(lifetime);
  const paid = await worker.fetch(request("/api/entitlements/launch-gift"), envFor(paidDb), {});
  assert.equal((await paid.json()).productId, "shushugo_pro_lifetime", "gift cannot replace lifetime membership");
  assert.equal(paidDb.entitlement.product_id, "shushugo_pro_lifetime");

  const trial = await worker.fetch(request("/api/entitlements/trial"), env, {});
  assert.equal(trial.status, 410);
  assert.deepEqual(await trial.json(), { code: "TRIAL_DISABLED" });
  console.log("OK launch gift route rules");
} finally {
  rmSync(outdir, { recursive: true, force: true });
}
