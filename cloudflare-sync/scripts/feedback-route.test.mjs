import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outdir = mkdtempSync(join(tmpdir(), "shushugo-feedback-test-"));
const built = spawnSync(join(root, "node_modules", ".bin", "wrangler"), ["deploy", "--dry-run", "--outdir", outdir], { cwd: root, encoding: "utf8" });
if (built.status !== 0) throw new Error(`${built.stdout}\n${built.stderr}`);

const hash = (value) => createHash("sha256").update(value).digest("base64url");
const tables = ["apple_transaction_owners", "auth_rate_limits", "apple_notifications", "wechat_orders", "teams", "team_members", "team_daily_activity", "team_cheers", "team_reports", "trial_grants", "launch_gift_grants", "feedback_reports"];
const makeEnv = (validHash) => {
  const rateLimits = new Map();
  const reports = [];
  const env = {
    DB: {
      prepare(sql) {
        let values = [];
        return {
          bind(...bound) { values = bound; return this; },
          async first() {
            if (sql.includes("INSERT INTO auth_rate_limits")) {
              const key = `${values[0]}:${values[1]}:${values[2]}`;
              const count = rateLimits.get(key) ?? 0;
              if (count >= values[4]) return null;
              rateLimits.set(key, count + 1);
              return { request_count: count + 1 };
            }
            if (sql.includes("FROM sessions")) return values[0] === validHash ? { user_id: "user-1", expires_at: "2099-01-01T00:00:00.000Z" } : null;
            if (sql.includes("sqlite_master") && sql.includes("type = 'index'")) return { name: "idx_purchase_events_transaction_status" };
            return null;
          },
          async all() { return { results: values.filter((name) => tables.includes(name)).map((name) => ({ name })) }; },
          async run() {
            if (sql.includes("INSERT INTO feedback_reports")) reports.push(values);
            return { success: true };
          }
        };
      }
    }
  };
  return { env, reports, rateLimits };
};

const makeRequest = (body, { token, ip = "192.0.2.4" } = {}) => new Request("https://worker.test/api/feedback", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "cf-connecting-ip": ip,
    ...(token ? { authorization: `Bearer ${token}` } : {})
  },
  body: JSON.stringify(body)
});

const sample = {
  kind: "feedback",
  message: "希望增加一个功能",
  contact: "",
  platform: "web",
  app_version: "1.0.0",
  route: "profile"
};

try {
  const worker = (await import(pathToFileURL(join(outdir, "index.js")).href)).default;
  const token = "valid-session-token";
  const authed = makeEnv(hash(token));
  const normal = await worker.fetch(makeRequest(sample, { token }), authed.env, {});
  assert.equal(normal.status, 200);
  assert.equal(authed.reports[0][5], "user-1", "valid Bearer records its account id");

  const anonymous = makeEnv(hash(token));
  assert.equal((await worker.fetch(makeRequest(sample), anonymous.env, {})).status, 200, "feedback does not require login");
  assert.equal(anonymous.reports[0][5], null);
  assert.equal((await worker.fetch(makeRequest(sample, { token: "invalid" }), anonymous.env, {})).status, 200, "invalid Bearer is accepted anonymously");
  assert.equal(anonymous.reports[1][5], null);

  const truncated = makeEnv(hash(token));
  const longRequest = makeRequest({ ...sample, message: "𠮷".repeat(2_100), contact: "x".repeat(120), diagnostics: { trace: "x".repeat(40_000) } });
  assert.equal((await worker.fetch(longRequest, truncated.env, {})).status, 200);
  const saved = truncated.reports[0];
  assert.equal(Array.from(saved[3]).length, 2_000);
  assert.equal(Array.from(saved[4]).length, 100);
  assert.ok(new TextEncoder().encode(saved[9]).byteLength <= 32 * 1024);
  assert.equal(JSON.parse(saved[9]).truncated, true);

  for (const body of [
    { ...sample, kind: 4 },
    { ...sample, message: [] },
    { ...sample, contact: {} },
    { ...sample, diagnostics: [] }
  ]) assert.equal((await worker.fetch(makeRequest(body), makeEnv(hash(token)).env, {})).status, 400);

  const hourly = makeEnv(null);
  for (let index = 0; index < 10; index += 1) assert.equal((await worker.fetch(makeRequest(sample), hourly.env, {})).status, 200);
  assert.equal((await worker.fetch(makeRequest(sample), hourly.env, {})).status, 429, "hourly hashed-IP quota is atomic");

  const originalNow = Date.now;
  let now = Date.UTC(2026, 8, 27, 12);
  Date.now = () => now;
  try {
    const daily = makeEnv(null);
    for (let index = 0; index < 31; index += 1) {
      if (index > 0 && index % 10 === 0) now += 60 * 60 * 1_000;
      const response = await worker.fetch(makeRequest(sample, { ip: "192.0.2.9" }), daily.env, {});
      assert.equal(response.status, index < 30 ? 200 : 429, "daily hashed-IP quota is enforced across hourly windows");
    }
  } finally {
    Date.now = originalNow;
  }

  const health = await worker.fetch(new Request("https://worker.test/api/health"), makeEnv(null).env, {});
  assert.equal(health.status, 200);
  assert.equal((await health.json()).migrations.feedback_reports, true);
  console.log("OK feedback accepts anonymous reports, clips input, validates types, rate-limits hashed IPs, and reports migration health");
} finally {
  rmSync(outdir, { recursive: true, force: true });
}
