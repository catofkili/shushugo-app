import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outdir = mkdtempSync(join(tmpdir(), "shushugo-review-login-test-"));
const built = spawnSync(join(root, "node_modules", ".bin", "wrangler"), ["deploy", "--dry-run", "--outdir", outdir], { cwd: root, encoding: "utf8" });
if (built.status !== 0) throw new Error(`${built.stdout}\n${built.stderr}`);

const password = "test-only-review-password";
const deadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

class Statement {
  constructor(db, sql) { this.db = db; this.sql = sql.replace(/\s+/g, " ").trim(); this.params = []; }
  bind(...params) { this.params = params; return this; }
  async first() {
    if (this.sql.startsWith("INSERT INTO auth_rate_limits")) return { request_count: 1 };
    if (this.sql.includes("FROM users WHERE email")) return this.db.users.find((user) => user.email === this.params[0]) ?? null;
    if (this.sql.includes("FROM entitlements")) return this.db.entitlements.get(this.params[0]) ?? null;
    return null;
  }
  async run() {
    if (this.sql.startsWith("INSERT INTO users")) {
      const [id, email, password_hash, password_salt, display_name, email_verified_at, created_at, last_login] = this.params;
      this.db.users.push({ id, email, password_hash, password_salt, display_name, email_verified_at, created_at, last_login });
      this.db.userInsertCount += 1;
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

const envFor = (DB, overrides = {}) => ({
  DB,
  REVIEW_LOGIN_PASSWORD: password,
  REVIEW_LOGIN_UNTIL: deadline,
  SYNC_DATA: { get: async () => null, put: async () => undefined },
  SYNC_BUCKET: {},
  ...overrides
});
const loginRequest = (account, loginPassword) => new Request("https://worker.test/api/auth/review-login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ account, password: loginPassword })
});

try {
  const worker = (await import(pathToFileURL(join(outdir, "index.js")).href)).default;
  const closedCases = [
    ["missing secret", { REVIEW_LOGIN_PASSWORD: undefined }],
    ["missing deadline", { REVIEW_LOGIN_UNTIL: undefined }],
    ["expired deadline", { REVIEW_LOGIN_UNTIL: "2000-01-01T00:00:00.000Z" }]
  ];
  for (const [name, config] of closedCases) {
    const env = envFor(new Db(), config);
    const response = await worker.fetch(loginRequest("review@shushugo.com", password), env, {});
    assert.equal(response.status, 404, `${name} closes the route`);
    const authConfig = await worker.fetch(new Request("https://worker.test/api/auth/config"), env, {});
    assert.equal((await authConfig.json()).reviewLoginOpen, false, `${name} hides the login entry`);
  }

  const db = new Db();
  const env = envFor(db);
  const authConfig = await worker.fetch(new Request("https://worker.test/api/auth/config"), env, {});
  assert.equal((await authConfig.json()).reviewLoginOpen, true, "the entry is open during the configured window");

  const wrongAccount = await worker.fetch(loginRequest("other@example.com", password), env, {});
  assert.equal(wrongAccount.status, 401);
  const wrongPassword = await worker.fetch(loginRequest("review@shushugo.com", "wrong-password"), env, {});
  assert.equal(wrongPassword.status, 401);
  assert.equal(db.userInsertCount, 0, "invalid credentials do not create the reviewer account");

  const first = await worker.fetch(loginRequest("review@shushugo.com", password), env, {});
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.ok(firstBody.access_token);
  assert.equal(firstBody.email, "review@shushugo.com");
  assert.equal(firstBody.entitlements.isPro, true);
  assert.equal(firstBody.entitlements.expiresAt, deadline);
  assert.equal(firstBody.entitlements.productId, "shushugo_pro_launch_gift");
  assert.equal(db.sessionExpiryUpdates.length, 1);
  assert.match(db.sessionExpiryUpdates[0].sql, /^UPDATE sessions SET expires_at = \? WHERE token_hash = \? AND expires_at > \?$/);
  assert.deepEqual([db.sessionExpiryUpdates[0].params[0], db.sessionExpiryUpdates[0].params[2]], [deadline, deadline]);
  assert.ok(Date.parse(db.sessions[0].originalExpiresAt) > Date.parse(deadline), "test setup starts with a longer default session");
  assert.equal(db.sessions[0].expires_at, deadline, "the session is clamped to the deadline");

  const second = await worker.fetch(loginRequest("review@shushugo.com", password), env, {});
  assert.equal(second.status, 200);
  const secondBody = await second.json();
  assert.equal(db.userInsertCount, 1, "repeated login reuses the same user");
  assert.equal(db.users.length, 1);
  assert.equal(secondBody.entitlements.expiresAt, deadline, "repeated login does not extend the entitlement");
  assert.equal(db.entitlements.get(db.users[0].id).expires_at, deadline);
  assert.equal(db.sessions.length, 2);
  assert.equal(db.sessionExpiryUpdates.length, 2);
  assert.ok(db.sessions.every((session) => session.expires_at === deadline));
  console.log("OK review login route rules");
} finally {
  rmSync(outdir, { recursive: true, force: true });
}
