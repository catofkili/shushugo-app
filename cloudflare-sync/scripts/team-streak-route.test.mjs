import assert from "node:assert/strict";
import { teamDuelHarness } from "./team-duel-test-harness.mjs";

const h = await teamDuelHarness();
const { db, call } = h;
const shift = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const addTeam = (id, anchor, members) => {
  for (const [user] of members) h.addUser(user);
  db.prepare("INSERT INTO teams (id, name, target_level, emoji, visibility, max_members, owner_user_id, invite_code, created_at, updated_at, streak_start) VALUES (?, ?, 'N3', '🌱', 'public', 6, ?, ?, ?, ?, ?)")
    .run(id, id, members[0][0], id.padEnd(8, "X"), "2026-10-01T04:00:00+08:00", new Date().toISOString(), anchor);
  for (const [index, [user, day]] of members.entries()) db.prepare("INSERT INTO team_members (id, team_id, user_id, role, joined_at) VALUES (?, ?, ?, ?, ?)")
    .run(`${id}-${user}`, id, user, index ? "member" : "owner", `${day}T04:00:00+08:00`);
};
const activity = (team, user, day, words = 30, minutes = 10) => db.prepare("INSERT INTO team_daily_activity (team_id, user_id, study_day, study_count, completed, updated_at, word_count, active_minutes) VALUES (?, ?, ?, 0, 0, ?, ?, ?)")
  .run(team, user, day, new Date().toISOString(), words, minutes);
const allDays = (team, user, start, except = []) => {
  for (let i = 0; i < 14; i++) if (!except.includes(i)) activity(team, user, shift(start, i));
};
const me = (user, day = "2026-10-26") => call(`/api/teams/me?day=${day}`, { user });

try {
  addTeam("legacy", null, [["legacy-user", "2026-10-01"]]);
  const legacy = await me("legacy-user");
  assert.equal(legacy.status, 200);
  assert.equal(db.prepare("SELECT streak_start FROM teams WHERE id = 'legacy'").get().streak_start, "2026-10-27");
  assert.equal(legacy.body.team.period.dayNumber, 0);
  assert.equal(legacy.body.team.period.broken, false, "legacy teams do not get punished for missing old word-count history");
  await me("legacy-user");
  assert.equal(db.prepare("SELECT streak_start FROM teams WHERE id = 'legacy'").get().streak_start, "2026-10-27");
  h.addUser("new-owner");
  const created = await call("/api/teams", { user: "new-owner", body: { name: "新的队伍", targetLevel: "N3", emoji: "🌱", visibility: "public" } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.team.period.start, "2026-10-27", "new teams start tomorrow");

  addTeam("report", "2026-10-26", [["report-user", "2026-10-25"]]);
  const postActivity = (body) => call("/api/teams/activity", { user: "report-user", body: { studyDay: "2026-10-26", studyCount: 40, completed: true, ...body } });
  assert.equal((await postActivity({ wordCount: 30, activeMinutes: 10 })).status, 200);
  const stale = await postActivity({ studyCount: 2, completed: false, wordCount: 12, activeMinutes: 3 });
  assert.equal(stale.status, 200);
  const reported = stale.body.team.members[0];
  assert.deepEqual([reported.studyCount, reported.completed, reported.wordCount, reported.activeMinutes, reported.cells[0]], [40, true, 30, 10, "passed"]);
  for (const fields of [{ wordCount: 5001 }, { wordCount: -1 }, { wordCount: 30.5 }, { activeMinutes: 1441 }, { activeMinutes: -1 }, { activeMinutes: 10.5 }]) assert.equal((await postActivity(fields)).status, 400);
  const overview = await call("/api/teams/overview", { user: "report-user", body: { studyDay: "2026-10-26", studyCount: 5, completed: false, wordCount: 31, activeMinutes: 11 } });
  assert.equal(overview.body.team.members[0].wordCount, 31);
  assert.equal(overview.body.team.members[0].activeMinutes, 11);

  h.setTime("2026-10-25T12:00:00+08:00");
  addTeam("leaves", "2026-10-12", [["leave-user", "2026-10-12"], ["leave-buddy", "2026-10-12"]]);
  allDays("leaves", "leave-user", "2026-10-12", [12, 13]); allDays("leaves", "leave-buddy", "2026-10-12");
  assert.equal((await call("/api/teams/leaves", { user: "leave-user", body: { studyDay: "2026-10-23" } })).status, 400, "expired leave cannot be repaired");
  assert.equal((await call("/api/teams/leaves", { user: "leave-user", body: { studyDay: "2026-10-25" } })).status, 400, "cannot take leave in advance");
  const leave = await call("/api/teams/leaves", { user: "leave-user", body: { studyDay: "2026-10-24" } });
  assert.equal(leave.status, 200);
  assert.equal(leave.body.team.members.find((member) => member.isMe).cells[12], "leave");
  h.setTime("2026-10-26T04:00:00+08:00");
  assert.equal((await call("/api/teams/leaves", { user: "leave-user", body: { studyDay: "2026-10-25" } })).status, 409, "one leave per user and period is enforced by the primary key");
  const grace = await me("leave-user");
  assert.equal(grace.body.team.leaveOpportunity.used, true);
  assert.equal(grace.body.team.leaveOpportunity.periodStart, "2026-10-12");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM team_period_results WHERE team_id = 'leaves'").get().n, 0, "last-day leave window stays open");
  h.setTime("2026-10-27T04:00:00+08:00");
  await me("leave-user", "2026-10-27");
  assert.equal(db.prepare("SELECT amount FROM team_period_results WHERE team_id = 'leaves' AND user_id = 'leave-buddy'").get().amount, 700);
  assert.equal(db.prepare("SELECT amount FROM team_period_results WHERE team_id = 'leaves' AND user_id = 'leave-user'").get().amount, 0);

  h.setTime("2026-10-24T04:00:00+08:00");
  addTeam("settle", "2026-10-10", [["culprit", "2026-10-10"], ["buddy", "2026-10-10"], ["late", "2026-10-11"], ["after-end", "2026-10-24"]]);
  allDays("settle", "culprit", "2026-10-10", [0]); allDays("settle", "buddy", "2026-10-10"); allDays("settle", "late", "2026-10-10", [0]);
  const reward = await call("/api/teams/rewards", { user: "buddy" });
  assert.deepEqual(reward.body.periods, [{ team_id: "settle", period_start: "2026-10-10", amount: 700 }]);
  const firstRows = db.prepare("SELECT * FROM team_period_results WHERE team_id = 'settle' ORDER BY user_id").all();
  assert.equal(firstRows.length, 3, "members joining after the period end are excluded");
  assert.equal(firstRows.find((row) => row.user_id === "culprit").amount, 0);
  assert.equal(firstRows.find((row) => row.user_id === "late").amount, 325);
  assert.equal(firstRows.find((row) => row.user_id === "buddy").days_passed, 14, "days after the break still accrue");
  await call("/api/teams/leave", { user: "culprit", body: {} });
  db.prepare("UPDATE team_daily_activity SET word_count = 0 WHERE team_id = 'settle'").run();
  await me("buddy", "2026-10-24");
  await call("/api/teams/rewards", { user: "buddy" });
  assert.deepEqual(db.prepare("SELECT * FROM team_period_results WHERE team_id = 'settle' ORDER BY user_id").all(), firstRows, "lazy settlement writes once and freezes the entire roster");

  addTeam("departure", "2026-10-10", [["departed", "2026-10-10"], ["stayer", "2026-10-10"]]);
  allDays("departure", "stayer", "2026-10-10");
  assert.equal((await call("/api/teams/leave", { user: "departed", body: {} })).status, 200);
  const stayer = await me("stayer", "2026-10-24");
  assert.equal(stayer.status, 200);
  assert.equal(db.prepare("SELECT amount FROM team_period_results WHERE team_id = 'departure' AND user_id = 'stayer'").get().amount, 1400, "a departed member does not break the roster");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM team_period_results WHERE team_id = 'departure' AND user_id = 'departed'").get().n, 0);
  await call("/api/teams/leave", { user: "stayer", body: {} });
  assert.equal((await call("/api/teams/rewards", { user: "stayer" })).body.periods[0].amount, 1400, "settled rewards survive dissolution");

  addTeam("repair", "2026-10-10", [["repair-user", "2026-10-10"], ["repair-late", "2026-10-11"]]);
  allDays("repair", "repair-user", "2026-10-10", [13]); allDays("repair", "repair-late", "2026-10-10", [0]);
  assert.equal((await me("repair-user", "2026-10-24")).status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM team_period_results WHERE team_id = 'repair'").get().n, 0);
  assert.equal((await call("/api/teams/leaves", { user: "repair-user", body: { studyDay: "2026-10-23" } })).status, 200);
  const repaired = db.prepare("SELECT user_id, amount FROM team_period_results WHERE team_id = 'repair'").all();
  assert.equal(repaired.find((row) => row.user_id === "repair-user").amount, 1400);
  assert.equal(repaired.find((row) => row.user_id === "repair-late").amount, 650, "day-two join gets half of its thirteen days");
  assert.equal((await call("/api/teams/rewards")).status, 401);
  console.log("OK team streak routes: lazy anchors, new-team start, MAX columns, validation, one leave per period, final-day grace, immutable settlement, late joining, departures, and dissolution");
} finally { h.close(); }
