import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const outdir = mkdtempSync(join(tmpdir(), "shushugo-team-overview-"));
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
const postOverview = (body, auth = token) => worker.fetch(new Request("https://worker.test/api/teams/overview", {
  method: "POST",
  headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
  body: JSON.stringify(body)
}), env, { waitUntil() {} });

try {
  const unauthenticated = await postOverview({ studyDay, studyCount: 0, completed: false }, "");
  assert.equal(unauthenticated.status, 401);

  const first = await (await postOverview({ studyDay, studyCount: 12, completed: true })).json();
  assert.equal(first.team.members.find((member) => member.isMe).studyCount, 12);
  assert.equal(first.team.members.find((member) => member.isMe).completed, true);
  assert.deepEqual(first.plaza.map((team) => team.id), ["team-2"], "overview plaza must hide the caller's own team");

  const stale = await (await postOverview({ studyDay, studyCount: 3, completed: false })).json();
  assert.equal(stale.team.members.find((member) => member.isMe).studyCount, 12, "older devices cannot lower study count");
  assert.equal(stale.team.members.find((member) => member.isMe).completed, true, "older devices cannot clear completion");
  assert.equal((await postOverview({ studyDay, studyCount: 5001, completed: false })).status, 400);

  const noTeam = await (await postOverview({ studyDay, studyCount: 0, completed: false }, "token-u5")).json();
  assert.equal(noTeam.team, null);
  assert.deepEqual(noTeam.plaza.map((team) => team.id).sort(), ["team-1", "team-2"]);

  const windowSeconds = 3600;
  const windowStart = Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds;
  db.prepare(`INSERT INTO auth_rate_limits (subject, scope, window_start, request_count, updated_at)
    VALUES ('user:u1', 'team-activity', ?, 120, ?)
    ON CONFLICT(subject, scope, window_start) DO UPDATE SET request_count = 120, updated_at = excluded.updated_at`)
    .run(windowStart, now);
  assert.equal((await postOverview({ studyDay, studyCount: 0, completed: false })).status, 429);

  console.log("OK team overview route: auth, team/no-team payloads, own-team plaza exclusion, MAX activity merge, rate limit");
} finally {
  db.close();
  rmSync(outdir, { recursive: true, force: true });
}
