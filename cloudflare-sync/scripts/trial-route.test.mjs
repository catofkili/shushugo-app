import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outdir = mkdtempSync(join(tmpdir(), "shushugo-trial-test-"));
const built = spawnSync(join(root, "node_modules", ".bin", "wrangler"), ["deploy", "--dry-run", "--outdir", outdir], { cwd: root, encoding: "utf8" });
if (built.status !== 0) throw new Error(`${built.stdout}\n${built.stderr}`);
const future = "2099-01-01T00:00:00.000Z";

class Statement {
  constructor(db, sql) { this.db = db; this.sql = sql.replace(/\s+/g, " ").trim(); this.params = []; }
  bind(...params) { this.params = params; return this; }
  async first() {
    if (this.sql.includes("FROM sessions")) return { user_id: "user-1", expires_at: future };
    if (this.sql.startsWith("INSERT INTO auth_rate_limits")) return { request_count: 1 };
    if (this.sql.includes("FROM trial_grants")) return this.db.grant;
    if (this.sql.includes("FROM entitlements")) return this.db.entitlement;
    return null;
  }
  async run() {
    if (this.sql.startsWith("INSERT OR IGNORE INTO trial_grants") && !this.db.grant) {
      this.db.grant = { granted_at: this.params[1], expires_at: this.params[2] };
    } else if (this.sql.startsWith("INSERT INTO entitlements")) {
      const [, product_id, source, original_transaction_id, transaction_id, environment, expires_at, updated_at] = this.params;
      this.db.entitlement = { is_pro: 1, product_id, source, original_transaction_id, transaction_id, environment, expires_at, updated_at };
    } else if (this.sql.startsWith("UPDATE entitlements SET updated_at")) {
      this.db.entitlement.updated_at = this.params[0];
    }
    return { success: true };
  }
}
class Db {
  constructor(entitlement = null) { this.entitlement = entitlement; this.grant = null; }
  prepare(sql) { return new Statement(this, sql); }
}
const env = (db) => ({ DB: db, SYNC_DATA: { get: async () => null, put: async () => undefined }, SYNC_BUCKET: {} });
const request = () => new Request("https://worker.test/api/entitlements/trial", { method: "POST", headers: { authorization: "Bearer token" } });

try {
  const worker = (await import(pathToFileURL(join(outdir, "index.js")).href)).default;
  const db = new Db();
  const first = await worker.fetch(request(), env(db), {});
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(firstBody.source, "trial");
  assert.equal(firstBody.productId, "shushugo_pro_trial");
  const expiry = firstBody.expiresAt;
  const second = await worker.fetch(request(), env(db), {});
  assert.equal(second.status, 200, "retry is idempotent so a lost response can be repaired");
  assert.equal((await second.json()).expiresAt, expiry, "retry must not extend the seven days");

  const lifetime = { is_pro: 1, product_id: "shushugo_pro_lifetime", source: "app_store", original_transaction_id: "T", transaction_id: "T", environment: "Production", expires_at: null, updated_at: future };
  const paidDb = new Db(lifetime);
  const paid = await worker.fetch(request(), env(paidDb), {});
  assert.equal((await paid.json()).productId, "shushugo_pro_lifetime", "trial cannot replace paid entitlement");
  assert.equal(paidDb.entitlement.product_id, "shushugo_pro_lifetime");
  console.log("OK one-time plan trial route");
} finally {
  rmSync(outdir, { recursive: true, force: true });
}
