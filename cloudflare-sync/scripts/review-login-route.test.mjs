import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outdir = mkdtempSync(join(tmpdir(), "shushugo-review-login-test-"));
const built = spawnSync(join(root, "node_modules", ".bin", "wrangler"), ["deploy", "--dry-run", "--outdir", outdir], { cwd: root, encoding: "utf8" });
if (built.status !== 0) throw new Error(`${built.stdout}\n${built.stderr}`);

const password = "test-only-review-password";
const sha256 = (value) => createHash("sha256").update(value).digest("base64url");
const day = 24 * 60 * 60 * 1000;
const useBy = new Date(Date.now() + 30 * day).toISOString();

class Statement {
  constructor(db, sql) { this.db = db; this.sql = sql.replace(/\s+/g, " ").trim(); this.params = []; }
  bind(...params) { this.params = params; return this; }
  async first() {
    if (this.sql.startsWith("INSERT INTO auth_rate_limits")) return { request_count: 1 };
    if (this.sql.includes("FROM review_passwords WHERE password_hash")) return this.db.passwords.find((row) => row.password_hash === this.params[0]) ?? null;
    if (this.sql.includes("FROM review_passwords WHERE (first_login_at IS NULL")) {
      const [a, b] = this.params;
      return this.db.passwords.some((row) => (row.first_login_at === null && row.use_by > a) || (row.expires_at !== null && row.expires_at > b)) ? { ok: 1 } : null;
    }
    if (this.sql.includes("FROM users WHERE email")) return this.db.users.find((user) => user.email === this.params[0]) ?? null;
    if (this.sql.includes("FROM entitlements")) return this.db.entitlements.get(this.params[0]) ?? null;
    return null;
  }
  async run() {
    if (this.sql.startsWith("INSERT INTO users")) {
      const [id, email, password_hash, password_salt, display_name, email_verified_at, created_at, last_login] = this.params;
      this.db.users.push({ id, email, password_hash, password_salt, display_name, email_verified_at, created_at, last_login });
      this.db.userInsertCount += 1;
    } else if (this.sql.startsWith("UPDATE review_passwords SET first_login_at")) {
      const [first_login_at, expires_at, password_hash] = this.params;
      const row = this.db.passwords.find((item) => item.password_hash === password_hash && item.first_login_at === null);
      if (row) Object.assign(row, { first_login_at, expires_at });
    } else if (this.sql.startsWith("UPDATE users SET last_login")) {
      const user = this.db.users.find((item) => item.id === this.params[1]);
      if (user) user.last_login = this.params[0];
    } else if (this.sql.startsWith("INSERT INTO sessions")) {
      const [token_hash, user_id, created_at, expires_at] = this.params;
      this.db.sessions.push({ token_hash, user_id, created_at, originalExpiresAt: expires_at, expires_at });
    } else if (this.sql.startsWith("UPDATE sessions SET expires_at")) {
      const [expires_at, token_hash, cutoff] = this.params;
      this.db.sessionExpiryUpdates.push({ sql: this.sql, params: this.params });
      const session = this.db.sessions.find((item) => item.token_hash === token_hash && item.expires_at > cutoff);
      if (session) session.expires_at = expires_at;
    } else if (this.sql.startsWith("INSERT INTO entitlements")) {
      const [user_id, product_id, source, original_transaction_id, transaction_id, environment, expires_at, updated_at] = this.params;
      this.db.entitlements.set(user_id, { user_id, is_pro: 1, product_id, source, original_transaction_id, transaction_id, environment, expires_at, updated_at });
    }
    return { success: true };
  }
}

class Db {
  constructor() {
    this.users = [];
    this.passwords = [];
    this.sessions = [];
    this.entitlements = new Map();
    this.userInsertCount = 0;
    this.sessionExpiryUpdates = [];
  }
  prepare(sql) { return new Statement(this, sql); }
  async batch(statements) {
    return statements.map((statement) => {
      if (statement.sql.includes("FROM auth_identities")) return { results: [{ provider: "email" }] };
      if (statement.sql.includes("FROM entitlements")) {
        const entitlement = this.entitlements.get(statement.params[0]);
        return { results: entitlement ? [entitlement] : [] };
      }
      return { results: [] };
    });
  }
}

const envFor = (DB) => ({
  DB,
  SYNC_DATA: { get: async () => null, put: async () => undefined },
  SYNC_BUCKET: {}
});
const loginRequest = (account, loginPassword) => new Request("https://worker.test/api/auth/review-login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ account, password: loginPassword })
});
const row = (overrides = {}) => ({ password_hash: sha256(password), use_by: useBy, first_login_at: null, expires_at: null, ...overrides });
const entryOpen = async (worker, env) => (await (await worker.fetch(new Request("https://worker.test/api/auth/config"), env, {})).json()).reviewLoginOpen;

try {
  const worker = (await import(pathToFileURL(join(outdir, "index.js")).href)).default;

  // 没有可用密码：入口收起、登录一律 401
  const closedCases = [
    ["empty table", []],
    ["unused password past use_by", [row({ use_by: "2000-01-01T00:00:00.000Z" })]],
    ["used password past its week", [row({ first_login_at: "2000-01-01T00:00:00.000Z", expires_at: "2000-01-08T00:00:00.000Z" })]]
  ];
  for (const [name, rows] of closedCases) {
    const db = new Db();
    db.passwords = rows;
    const env = envFor(db);
    assert.equal(await entryOpen(worker, env), false, `${name} hides the login entry`);
    const response = await worker.fetch(loginRequest("review@shushugo.com", password), env, {});
    assert.equal(response.status, 401, `${name} rejects the password`);
    assert.equal(db.userInsertCount, 0);
  }

  const db = new Db();
  db.passwords = [row(), row({ password_hash: sha256("another-unused-password") })];
  const env = envFor(db);
  assert.equal(await entryOpen(worker, env), true, "the entry is open while a valid password exists");

  assert.equal((await worker.fetch(loginRequest("other@example.com", password), env, {})).status, 401);
  assert.equal((await worker.fetch(loginRequest("review@shushugo.com", "wrong-password"), env, {})).status, 401);
  assert.equal(db.userInsertCount, 0, "invalid credentials do not create the reviewer account");
  assert.equal(db.passwords[0].first_login_at, null, "invalid credentials do not start the clock");

  const before = Date.now();
  const first = await worker.fetch(loginRequest("review@shushugo.com", password), env, {});
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.ok(firstBody.access_token);
  assert.equal(firstBody.email, "review@shushugo.com");
  assert.equal(firstBody.entitlements.isPro, true);
  assert.equal(firstBody.entitlements.productId, "shushugo_pro_launch_gift");
  const expiresAt = db.passwords[0].expires_at;
  assert.ok(db.passwords[0].first_login_at, "the first login starts the clock");
  assert.ok(Math.abs(Date.parse(expiresAt) - (before + 7 * day)) < 60_000, "the password lives seven days from first login");
  assert.equal(firstBody.entitlements.expiresAt, expiresAt);
  assert.equal(db.passwords[1].first_login_at, null, "the other passwords stay untouched");
  assert.equal(db.sessionExpiryUpdates.length, 1);
  assert.equal(db.sessions[0].expires_at, expiresAt, "the session is clamped to the password's expiry");

  const second = await worker.fetch(loginRequest("review@shushugo.com", password), env, {});
  assert.equal(second.status, 200);
  assert.equal(db.passwords[0].expires_at, expiresAt, "repeated login does not push the expiry back");
  assert.equal((await second.json()).entitlements.expiresAt, expiresAt, "repeated login does not extend the entitlement");
  assert.equal(db.userInsertCount, 1, "repeated login reuses the same user");
  assert.ok(db.sessions.every((session) => session.expires_at === expiresAt));

  db.passwords[0].expires_at = new Date(Date.now() - 1000).toISOString();
  assert.equal((await worker.fetch(loginRequest("review@shushugo.com", password), env, {})).status, 401, "an expired password stops working");
  console.log("OK review login route rules");
} finally {
  rmSync(outdir, { recursive: true, force: true });
}
