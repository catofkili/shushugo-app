// 真实 Worker 构建产物验证两条微信身份链：
// 小程序 openid 升级 unionid；移动 App 登录/关联只认 unionid，绝不静默合并冲突账号。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outdir = mkdtempSync(join(tmpdir(), "shushugo-worker-wechat-auth-"));
const wrangler = join(root, "node_modules", ".bin", "wrangler");
const built = spawnSync(wrangler, ["deploy", "--dry-run", "--outdir", outdir], { cwd: root, encoding: "utf8" });
if (built.status !== 0) throw new Error(`${built.stdout}\n${built.stderr}`);

const futureDate = "2099-01-01T00:00:00.000Z";
const tokenHash = (token) => createHash("sha256").update(token).digest("base64url");

class FakeStatement {
  constructor(db, sql) { this.db = db; this.sql = sql.replace(/\s+/g, " ").trim(); this.params = []; }
  bind(...params) { this.params = params; return this; }

  async first() {
    if (this.sql.startsWith("INSERT INTO auth_rate_limits")) return { request_count: 1 };
    if (this.sql.includes("FROM sessions")) {
      const userId = this.db.sessions.get(this.params[0]);
      return userId ? { user_id: userId, expires_at: futureDate } : null;
    }
    if (this.sql.includes("FROM entitlements")) return null;
    if (this.sql.includes("FROM users WHERE id = ?")) return this.db.users.get(this.params[0]) ?? null;
    return null;
  }

  async all() {
    if (this.sql.includes("FROM auth_identities") && this.sql.includes("provider_subject IN")) {
      return { results: this.params.map((subject) => this.db.identities.get(subject)).filter(Boolean) };
    }
    if (this.sql.startsWith("SELECT DISTINCT provider FROM auth_identities")) {
      const providers = new Set([...this.db.identities.values()]
        .filter((identity) => identity.user_id === this.params[0])
        .map((identity) => identity.provider));
      return { results: [...providers].sort().map((provider) => ({ provider })) };
    }
    return { results: [] };
  }

  async run() {
    if (this.sql.startsWith("INSERT INTO users")) {
      const [id, email, password_hash, password_salt, display_name, email_verified_at] = this.params;
      this.db.users.set(id, { id, email, password_hash, password_salt, display_name, email_verified_at });
    } else if (this.sql.includes("INSERT") && this.sql.includes("INTO auth_identities")) {
      const [provider_subject, user_id, email] = this.params;
      if (!this.db.identities.has(provider_subject)) {
        this.db.identities.set(provider_subject, { provider: "wechat", provider_subject, user_id, email });
      }
    } else if (this.sql.startsWith("INSERT INTO sessions")) {
      this.db.sessions.set(this.params[0], this.params[1]);
    }
    return { success: true, meta: { changes: 1 } };
  }
}

class FakeD1 {
  constructor() {
    this.users = new Map();
    this.identities = new Map();
    this.sessions = new Map();
  }
  addUser(id, email, subjects = []) {
    this.users.set(id, { id, email, password_hash: "hash", password_salt: "salt", display_name: id, email_verified_at: futureDate });
    for (const subject of subjects) this.identities.set(subject, { provider: "wechat", provider_subject: subject, user_id: id, email });
  }
  prepare(sql) { return new FakeStatement(this, sql); }
  async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); }
}

const db = new FakeD1();
db.addUser("existing", "existing@example.com");
db.identities.set("email:existing@example.com", {
  provider: "email",
  provider_subject: "existing@example.com",
  user_id: "existing",
  email: "existing@example.com"
});
db.sessions.set(tokenHash("existing-token"), "existing");
db.addUser("other", "other@example.com");
db.sessions.set(tokenHash("other-token"), "other");
db.addUser("legacy-mini", "legacy@wechat.invalid", ["openid:mini-old"]);
db.addUser("conflict-a", "a@wechat.invalid", ["unionid:union-conflict"]);
db.addUser("conflict-b", "b@wechat.invalid", ["mobile-openid:mobile-conflict"]);

const kv = new Map();
const env = {
  DB: db,
  SYNC_DATA: {
    get: async (key) => kv.get(key) ?? null,
    put: async (key, value) => { kv.set(key, value); },
    delete: async (key) => { kv.delete(key); }
  },
  SYNC_BUCKET: { delete: async () => undefined },
  WECHAT_APP_ID: "mini-id",
  WECHAT_APP_SECRET: "mini-secret",
  WECHAT_MOBILE_APP_ID: "mobile-id",
  WECHAT_MOBILE_APP_SECRET: "mobile-secret"
};

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  if (url.pathname.endsWith("/sns/jscode2session")) {
    assert.equal(url.searchParams.get("appid"), "mini-id");
    return Response.json({ openid: "mini-old", unionid: "union-legacy", session_key: "mini-session" });
  }
  if (url.pathname.endsWith("/sns/oauth2/access_token")) {
    assert.equal(url.searchParams.get("appid"), "mobile-id");
    const code = url.searchParams.get("code");
    if (code === "missing-union") return Response.json({ openid: "mobile-no-union", scope: "snsapi_base" });
    if (code === "link") return Response.json({ openid: "mobile-link", unionid: "union-link", scope: "snsapi_userinfo" });
    if (code === "conflict") return Response.json({ openid: "mobile-conflict", unionid: "union-conflict", scope: "snsapi_userinfo" });
    return Response.json({ openid: "mobile-new", unionid: "union-new", scope: "snsapi_userinfo" });
  }
  throw new Error(`unexpected fetch ${url}`);
};

try {
  const worker = (await import(pathToFileURL(join(outdir, "index.js")).href)).default;
  const call = (path, init) => worker.fetch(new Request(`https://api.test${path}`, init), env, { waitUntil() {} });
  const post = (path, body, token) => call(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  });

  let response = await call("/api/auth/config");
  assert.equal((await response.json()).wechatAppEnabled, true);
  const legal = await (await call("/api/legal")).json();

  response = await post("/api/auth/wechat-app", { code: "new-without-consent" });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "CONSENT_REQUIRED");

  response = await post("/api/auth/wechat-app", {
    code: "new-with-consent",
    terms_version: legal.terms.version,
    privacy_version: legal.privacy.version,
    display_name: "微信新用户"
  });
  assert.equal(response.status, 200, await response.clone().text());
  const created = await response.json();
  assert.equal(created.isNewAccount, true);
  assert.deepEqual(created.authProviders, ["wechat"], "openid + unionid aliases must still expose one provider");
  assert.equal(db.identities.get("unionid:union-new").user_id, created.user_id);
  assert.equal(db.identities.get("mobile-openid:mobile-new").user_id, created.user_id);

  response = await post("/api/auth/wechat-app", { code: "new-login-again" });
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).user_id, created.user_id);

  response = await post("/api/auth/link-wechat-app", { code: "link" }, "existing-token");
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual((await response.json()).authProviders, ["email", "wechat"]);
  assert.equal(db.identities.get("unionid:union-link").user_id, "existing");

  response = await post("/api/auth/link-wechat-app", { code: "link" }, "other-token");
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "ACCOUNT_LINK_CONFLICT");

  response = await post("/api/auth/wechat-app", { code: "missing-union" });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "WECHAT_UNIONID_REQUIRED");

  response = await post("/api/auth/wechat", { code: "legacy-mini" });
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).user_id, "legacy-mini");
  assert.equal(db.identities.get("unionid:union-legacy").user_id, "legacy-mini", "legacy mini account must gain unionid alias");
  assert.ok(kv.has("wechat-session:legacy-mini"), "mini-program session_key must remain available for virtual payment");

  response = await post("/api/auth/wechat-app", { code: "conflict" });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "WECHAT_IDENTITY_CONFLICT");

  console.log("OK Worker WeChat auth: mobile login/link, unionid requirement, legacy mini upgrade, conflict stop");
} finally {
  globalThis.fetch = originalFetch;
  rmSync(outdir, { recursive: true, force: true });
}
