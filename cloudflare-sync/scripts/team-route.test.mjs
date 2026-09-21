import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/index.ts'), 'utf8');
const migration = readFileSync(join(root, 'migrations/0014_teams.sql'), 'utf8');

for (const contract of [
  'GET" && url.pathname === "/api/teams/me',
  'GET" && url.pathname === "/api/teams/plaza',
  'POST" && url.pathname === "/api/teams"',
  'PUT" && url.pathname === "/api/teams/me',
  'POST" && url.pathname === "/api/teams/join',
  'POST" && url.pathname === "/api/teams/activity',
  'POST" && url.pathname === "/api/teams/cheers',
  'POST" && url.pathname === "/api/teams/leave',
  'POST" && url.pathname === "/api/teams/report'
]) assert.ok(source.includes(contract), `missing team route: ${contract}`);
assert.ok(source.includes('/wxa/msg_sec_check?access_token='), 'WeChat user-generated text must use the official content safety API');
assert.ok(source.includes('result.result?.suggest !== "pass"'), 'review/risky content must fail closed');
assert.ok(source.includes('study_count = MAX('), 'a stale device must not reduce reported activity');
assert.ok(source.includes('await leaveTeamForUser(env, userId);'), 'account deletion must run the normal ownership-transfer path');

const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON');
db.exec(`
  CREATE TABLE users (id TEXT PRIMARY KEY);
  ${migration}
`);
const now = new Date().toISOString();
for (let index = 1; index <= 8; index += 1) db.prepare('INSERT INTO users (id) VALUES (?)').run(`user-${index}`);
db.prepare(`
  INSERT INTO teams (id, name, target_level, emoji, visibility, max_members, owner_user_id, invite_code, created_at, updated_at)
  VALUES ('team-1', 'N3 每日学习', 'N3', '🌱', 'public', 6, 'user-1', 'ABCDEFGH', ?, ?)
`).run(now, now);
const addMember = db.prepare(`INSERT INTO team_members (id, team_id, user_id, role, joined_at) VALUES (?, 'team-1', ?, ?, ?)`);
addMember.run('member-1', 'user-1', 'owner', now);
for (let index = 2; index <= 6; index += 1) addMember.run(`member-${index}`, `user-${index}`, 'member', now);
assert.throws(() => addMember.run('member-7', 'user-7', 'member', now), /team_full/, 'capacity must be enforced inside SQLite');
db.prepare(`
  INSERT INTO teams (id, name, target_level, emoji, visibility, max_members, owner_user_id, invite_code, created_at, updated_at)
  VALUES ('team-2', '另一队', 'N3', '📚', 'invite', 6, 'user-7', 'HGFEDCBA', ?, ?)
`).run(now, now);
assert.throws(() => db.prepare(`
  INSERT INTO team_members (id, team_id, user_id, role, joined_at) VALUES ('duplicate', 'team-2', 'user-2', 'member', ?)
`).run(now), /UNIQUE/, 'one account must not join multiple teams');

db.exec('BEGIN');
db.prepare("DELETE FROM team_members WHERE team_id = 'team-1' AND user_id = 'user-1'").run();
db.prepare("UPDATE team_members SET role = 'owner' WHERE team_id = 'team-1' AND user_id = 'user-2'").run();
db.prepare("UPDATE teams SET owner_user_id = 'user-2' WHERE id = 'team-1'").run();
db.exec('COMMIT');
assert.equal(db.prepare("SELECT owner_user_id FROM teams WHERE id = 'team-1'").get().owner_user_id, 'user-2');
assert.equal(db.prepare("SELECT role FROM team_members WHERE user_id = 'user-2'").get().role, 'owner');

db.prepare("INSERT INTO team_reports (id, team_id, reporter_user_id, reason, created_at) VALUES ('report-1', 'team-1', 'user-8', '不当内容', ?)").run(now);
assert.throws(() => db.prepare("INSERT INTO team_reports (id, team_id, reporter_user_id, reason, created_at) VALUES ('report-2', 'team-1', 'user-8', '其他', ?)").run(now), /UNIQUE/, 'one reporter must not flood duplicate reports');

console.log('OK team route contract, official moderation, capacity, unique membership, reports, and owner transfer');
