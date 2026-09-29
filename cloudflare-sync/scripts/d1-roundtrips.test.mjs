import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const outdir = mkdtempSync(join(tmpdir(), "shushugo-d1-roundtrips-"));
const build = spawnSync(join(root, "node_modules/.bin/wrangler"), ["deploy", "--dry-run", "--outdir", outdir], {
  cwd: root,
  encoding: "utf8"
});
if (build.status !== 0) throw new Error(`${build.stdout}\n${build.stderr}`);

const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON");
for (const file of readdirSync(join(root, "migrations")).filter((name) => name.endsWith(".sql")).sort()) {
  db.exec(readFileSync(join(root, "migrations", file), "utf8"));
}

let counts = { roundtrips: 0, statements: 0 };
const statement = (sql, params = []) => ({
  bind: (...bound) => statement(sql, bound),
  first() {
    counts.roundtrips += 1;
    counts.statements += 1;
    return db.prepare(sql).get(...params) ?? null;
  },
  all() {
    counts.roundtrips += 1;
    counts.statements += 1;
    return { results: db.prepare(sql).all(...params) };
  },
  run() {
    counts.roundtrips += 1;
    counts.statements += 1;
    return { success: true, meta: { changes: db.prepare(sql).run(...params).changes } };
  },
  execute() {
    if (/\bRETURNING\b/i.test(sql)) {
      const results = db.prepare(sql).all(...params);
      return { success: true, results, meta: { changes: results.length } };
    }
    if (/^\s*(SELECT|PRAGMA|WITH)\b/i.test(sql)) {
      return { success: true, results: db.prepare(sql).all(...params) };
    }
    return { success: true, meta: { changes: db.prepare(sql).run(...params).changes } };
  }
});

const env = {
  DB: {
    prepare: statement,
    batch: async (statements) => {
      counts.roundtrips += 1;
      counts.statements += statements.length;
      db.exec("BEGIN");
      try {
        const results = statements.map((item) => item.execute());
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
  },
  SYNC_DATA: { get: async () => null, put: async () => undefined, delete: async () => undefined },
  SYNC_BUCKET: { delete: async () => undefined },
  LAUNCH_GIFT_CLAIM_UNTIL: "2099-01-01T00:00:00.000Z",
  RESEND_API_KEY: "test-key",
  WECHAT_APP_ID: "mini-app",
  WECHAT_APP_SECRET: "test-secret"
};

const token = "roundtrip-token";
const tokenHash = createHash("sha256").update(token).digest("base64url");
const future = "2099-01-01T00:00:00.000Z";
const now = new Date().toISOString();
const studyDayDate = new Date();
const studyDay = studyDayDate.toISOString().slice(0, 10);
studyDayDate.setUTCDate(studyDayDate.getUTCDate() - 1);
const previousStudyDay = studyDayDate.toISOString().slice(0, 10);
const addUser = db.prepare(`
  INSERT INTO users (id, email, password_hash, password_salt, display_name, created_at)
  VALUES (?, ?, 'hash', 'salt', ?, ?)
`);
for (const [id, name] of [["u1", "学习者"], ["u2", "队友"], ["u3", "另一队长"], ["u4", "另一队友"]]) {
  addUser.run(id, `${id}@example.test`, name, now);
}
db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, 'u1', ?, ?)").run(tokenHash, now, future);
const addIdentity = db.prepare(`
  INSERT INTO auth_identities (provider, provider_subject, user_id, email, created_at) VALUES (?, ?, ?, ?, ?)
`);
addIdentity.run("wechat", "openid:mini-1", "u1", "u1@example.test", now);
addIdentity.run("wechat", "unionid:union-1", "u1", "u1@example.test", now);

const addTeam = db.prepare(`
  INSERT INTO teams (id, name, target_level, emoji, visibility, max_members, owner_user_id, invite_code, created_at, updated_at)
  VALUES (?, ?, 'N3', '🌱', 'public', 6, ?, ?, ?, ?)
`);
const addMember = db.prepare(`
  INSERT INTO team_members (id, team_id, user_id, role, joined_at) VALUES (?, ?, ?, ?, ?)
`);
for (const [teamId, owner, member, code] of [["team-1", "u1", "u2", "TEAM0001"], ["team-2", "u3", "u4", "TEAM0002"]]) {
  addTeam.run(teamId, `${teamId} 公共队伍`, owner, code, now, now);
  addMember.run(`${teamId}-owner`, teamId, owner, "owner", now);
  addMember.run(`${teamId}-member`, teamId, member, "member", now);
}
const addActivity = db.prepare(`
  INSERT INTO team_daily_activity (team_id, user_id, study_day, study_count, completed, updated_at)
  VALUES (?, ?, ?, ?, 0, ?)
`);
addActivity.run("team-1", "u1", previousStudyDay, 4, now);
addActivity.run("team-2", "u3", previousStudyDay, 8, now);

const objectKey = "r2/u1/generation-1";
db.prepare(`
  INSERT INTO sync_objects (id, user_id, object_key, last_modified, created_at, byte_length, generation, payload_hash)
  VALUES ('object-1', 'u1', ?, ?, ?, 1234, 1, 'hash')
`).run(objectKey, now, now);
db.prepare(`
  INSERT INTO sync_heads (user_id, generation, object_key, last_modified, payload_hash, updated_at)
  VALUES ('u1', 1, ?, ?, 'hash', ?)
`).run(objectKey, now, now);

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  if (String(input).includes("sns/jscode2session")) {
    return Response.json({ openid: "mini-1", unionid: "union-1", session_key: "session-key" });
  }
  throw new Error(`unexpected fetch: ${input}`);
};

const worker = (await import(pathToFileURL(join(outdir, "index.js")).href)).default;
const measure = async (name, request) => {
  counts = { roundtrips: 0, statements: 0 };
  const response = await worker.fetch(request, env, { waitUntil() {} });
  const result = { endpoint: name, roundtrips: counts.roundtrips, statements: counts.statements };
  assert.equal(response.status, 200, `${name}: ${await response.clone().text()}`);
  return { ...result, payload: await response.clone().json() };
};
const authed = (path, init = {}) => new Request(`https://worker.test${path}`, {
  ...init,
  headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) }
});
const jsonPost = (path, body, authenticated = true) => new Request(`https://worker.test${path}`, {
  method: "POST",
  headers: { "content-type": "application/json", ...(authenticated ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body)
});

try {
  const results = [];
  results.push(await measure("/api/teams/me", authed(`/api/teams/me?day=${studyDay}`)));
  results.push(await measure("/api/teams/plaza", authed(`/api/teams/plaza?day=${studyDay}`)));
  results.push(await measure("/api/teams/activity", jsonPost("/api/teams/activity", {
    studyDay, studyCount: 12, completed: true
  })));
  results.push(await measure("/api/teams/cheers", jsonPost("/api/teams/cheers", {
    memberId: "team-1-member", studyDay
  })));
  results.push(await measure("/api/entitlements", authed("/api/entitlements")));
  results.push(await measure("/api/sync/status", authed("/api/sync/status")));
  results.push(await measure("/api/auth/wechat", jsonPost("/api/auth/wechat", { code: "valid-code" }, false)));
  results.push(await measure("/api/feedback", jsonPost("/api/feedback", {
    kind: "feedback", message: "test", contact: "", platform: "web", app_version: "test", route: "profile"
  }, false)));
  results.push(await measure("/api/teams/overview", jsonPost("/api/teams/overview", {
    studyDay, studyCount: 11, completed: false
  })));
  results.push(await measure("/api/health", new Request("https://worker.test/api/health")));
  results.push(await measure("/api/entitlements/launch-gift", jsonPost("/api/entitlements/launch-gift", {})));

  const limits = new Map([
    ["/api/teams/me", 3],
    ["/api/teams/plaza", 3],
    ["/api/teams/activity", 5],
    ["/api/teams/overview", 6],
    ["/api/teams/cheers", 5],
    ["/api/entitlements", 1],
    ["/api/sync/status", 3],
    ["/api/auth/wechat", 8],
    ["/api/feedback", 3],
    ["/api/health", 1],
    ["/api/entitlements/launch-gift", 6]
  ]);
  for (const result of results) {
    assert.ok(result.roundtrips <= limits.get(result.endpoint), `${result.endpoint}: ${result.roundtrips} > ${limits.get(result.endpoint)}`);
  }
  assert.equal(results[0].payload.team.memberCount, 2);
  assert.equal(results[0].payload.team.streak, 1);
  assert.deepEqual(results[1].payload.teams.map((team) => team.streak), [1, 1]);
  assert.equal(results[2].payload.team.streak, 2);
  assert.equal(results[3].payload.team.members.find((member) => member.memberId === "team-1-member")?.cheersReceived, 1);
  assert.equal(results[4].payload.isPro, false);
  assert.equal(results[5].payload.byte_length, 1234);
  assert.deepEqual(results[6].payload.authProviders, ["wechat"]);
  assert.equal(results[7].payload.accepted, true);
  assert.equal(results[8].payload.team.members.find((member) => member.isMe).studyCount, 12);
  assert.equal(results[8].payload.team.members.find((member) => member.isMe).completed, true);
  assert.deepEqual(results[8].payload.plaza.map((team) => team.id), ["team-2"]);
  assert.equal(results[9].payload.migrationsApplied, true);
  assert.equal(results[10].payload.isPro, true);
  assert.equal((await worker.fetch(authed(`/api/teams/me?day=${studyDay}`), env, {})).status, 200);
  const activity = db.prepare("SELECT study_count, completed FROM team_daily_activity WHERE team_id = 'team-1' AND user_id = 'u1' AND study_day = ?").get(studyDay);
  assert.deepEqual({ ...activity }, { study_count: 12, completed: 1 });
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM team_cheers WHERE team_id = 'team-1'").get().count, 1);
  assert.equal((await (await worker.fetch(authed("/api/entitlements"), env, {})).json()).isPro, true);
  console.log(JSON.stringify(results.map(({ endpoint, roundtrips, statements }) => ({ endpoint, roundtrips, statements }))));
  console.log("OK D1 round-trip ceilings for targeted Worker routes");
} finally {
  globalThis.fetch = originalFetch;
  db.close();
  rmSync(outdir, { recursive: true, force: true });
}
