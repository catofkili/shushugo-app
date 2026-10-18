import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const outdir = mkdtempSync(join(tmpdir(), "shushugo-team-title-"));
const built = spawnSync(join(root, "node_modules/.bin/wrangler"), ["deploy", "--dry-run", "--outdir", outdir], {
  cwd: root,
  encoding: "utf8"
});
if (built.status !== 0) throw new Error(`${built.stdout}\n${built.stderr}`);

const db = new (await import("node:sqlite")).DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON");
for (const file of readdirSync(join(root, "migrations")).filter((name) => name.endsWith(".sql")).sort()) {
  db.exec(readFileSync(join(root, "migrations", file), "utf8"));
}

const statement = (sql, params = []) => ({
  bind: (...bound) => statement(sql, bound),
  first: () => db.prepare(sql).get(...params) ?? null,
  all: () => ({ results: db.prepare(sql).all(...params) }),
  run: () => ({ success: true, meta: { changes: db.prepare(sql).run(...params).changes } }),
  execute() {
    if (/\bRETURNING\b/i.test(sql)) {
      const results = db.prepare(sql).all(...params);
      return { success: true, results, meta: { changes: results.length } };
    }
    if (/^\s*(SELECT|PRAGMA|WITH)\b/i.test(sql)) return { success: true, results: db.prepare(sql).all(...params) };
    return { success: true, meta: { changes: db.prepare(sql).run(...params).changes } };
  }
});

const env = {
  DB: {
    prepare: statement,
    async batch(statements) {
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
  }
};

const now = new Date().toISOString();
const studyDay = now.slice(0, 10);
const previousDay = new Date(`${studyDay}T12:00:00Z`);
previousDay.setUTCDate(previousDay.getUTCDate() - 1);
const yesterday = previousDay.toISOString().slice(0, 10);
const insertUser = db.prepare(`INSERT INTO users (id, email, password_hash, password_salt, display_name, created_at)
  VALUES (?, ?, 'hash', 'salt', ?, ?)`);
for (const [id, name] of [["u1", "学习者"], ["u2", "队友"], ["u3", "队长"], ["u4", "队友"], ["u5", "无队伍"]]) {
  insertUser.run(id, `${id}@example.test`, name, now);
  db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .run(createHash("sha256").update(`token-${id}`).digest("base64url"), id, now, "2099-01-01T00:00:00.000Z");
}

const addTeam = db.prepare(`INSERT INTO teams (id, name, target_level, emoji, visibility, max_members, owner_user_id, invite_code, created_at, updated_at)
  VALUES (?, ?, 'N3', '🌱', 'public', 6, ?, ?, ?, ?)`);
const addMember = db.prepare("INSERT INTO team_members (id, team_id, user_id, role, joined_at) VALUES (?, ?, ?, ?, ?)");
for (const [teamId, owner, member] of [["team-1", "u1", "u2"], ["team-2", "u3", "u4"]]) {
  addTeam.run(teamId, `${teamId} 公共队伍`, owner, `${teamId}code`, now, now);
  addMember.run(`${teamId}-owner`, teamId, owner, "owner", now);
  if (owner !== member) addMember.run(`${teamId}-member`, teamId, member, "member", now);
}
db.prepare(`INSERT INTO team_daily_activity (team_id, user_id, study_day, study_count, completed, updated_at)
  VALUES ('team-1', 'u1', ?, 4, 0, ?)` ).run(yesterday, now);

const token = "token-u1";
const worker = (await import(pathToFileURL(join(outdir, "index.js")).href)).default;
const request = (path, method = "GET", body, auth = token) => worker.fetch(new Request(`https://worker.test${path}`, {
  method,
  headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) })
}), env, { waitUntil() {} });
const put = (body, auth = token) => request("/api/teams/title", "PUT", body, auth);
const members = async (auth = token) => (await (await request(`/api/teams/me?day=${studyDay}`, "GET", undefined, auth)).json()).team.members;

try {
  assert.equal((await put({ title: "title-early" }, "")).status, 401);
  assert.equal((await members()).find((member) => member.isMe).title, null, "old rows default to NULL");
  for (const title of ["title-early", "title-night", "title-hunter", "title-slow", "title-grove", "title-capy"]) {
    const result = await put({ title });
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { title });
    assert.equal((await members()).find((member) => member.isMe).title, title);
    assert.equal((await members("token-u2")).find((member) => member.memberId === "team-1-owner").title, title, "teammates see the title");
    assert.equal((await members()).find((member) => !member.isMe).title, null, "other members are unchanged");
  }
  assert.equal((await put({ title: "title-early" }, "token-u2")).status, 200, "ordinary members may set their own title");
  assert.equal((await members()).find((member) => !member.isMe).title, "title-early");
  assert.equal((await put({ title: "" })).status, 200);
  assert.equal((await members()).find((member) => member.isMe).title, null);
  assert.equal((await put({ title: "" })).status, 200, "clearing an already empty title is idempotent");
  for (const body of [{ title: "title-fake" }, { title: "theme-matcha" }, { title: " title-early" }, { title: null }, { title: 1 }, { title: [] }, {}, null, [], "title-early", 123]) {
    const result = await put(body);
    assert.equal(result.status, 400);
    assert.equal(typeof (await result.json()).detail, "string");
  }
  assert.equal((await members()).find((member) => member.isMe).title, null, "invalid writes leave the previous value alone");
  const noTeam = await put({ title: "title-early" }, "token-u5");
  assert.equal(noTeam.status, 404);
  assert.deepEqual(await noTeam.json(), { detail: "你还没有加入队伍。" });
  assert.equal((await put({ title: "" }, "token-u5")).status, 404);
  const windowStart = Math.floor(Date.now() / 1000 / 3600) * 3600;
  db.prepare(`INSERT INTO auth_rate_limits (subject, scope, window_start, request_count, updated_at)
    VALUES ('user:u1', 'team-write', ?, 30, ?)
    ON CONFLICT(subject, scope, window_start) DO UPDATE SET request_count = 30`).run(windowStart, now);
  assert.equal((await put({ title: "title-early" })).status, 429);
  console.log("OK team titles: auth, all six keys, teammate visibility, own row only, clear, invalid input, no team, NULL, rate limit");
} finally {
  db.close();
  rmSync(outdir, { recursive: true, force: true });
}
