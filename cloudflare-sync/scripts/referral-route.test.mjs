import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const outdir = mkdtempSync(join(tmpdir(), "shushugo-referral-"));
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

const RealDate = Date;
let clock = RealDate.parse("2026-10-26T12:00:00Z");
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [clock])); }
  static now() { return clock; }
};
const today = "2026-10-26";
const dayAfter = (day, offset) => new RealDate(RealDate.parse(`${day}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
const worker = (await import(pathToFileURL(join(outdir, "index.js")).href)).default;
let userNumber = 0;
const addUser = (createdAt = new Date().toISOString()) => {
  const id = `referral-${++userNumber}`;
  db.prepare(`INSERT INTO users (id, email, password_hash, password_salt, created_at, email_verified_at)
    VALUES (?, ?, 'hash', 'salt', ?, ?)`).run(id, `${id}@example.test`, createdAt, createdAt);
  db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .run(createHash("sha256").update(`token-${id}`).digest("base64url"), id, createdAt, "2099-01-01T00:00:00Z");
  return id;
};
const call = async (path, user, body, method = body === undefined ? "GET" : "POST") => {
  const response = await worker.fetch(new Request(`https://worker.test${path}`, {
    method,
    headers: { "content-type": "application/json", ...(user ? { authorization: `Bearer token-${user}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  }), env, { waitUntil() {} });
  return { status: response.status, body: await response.json() };
};
const me = (user, deviceId) => call(`/api/referral/me${deviceId === undefined ? "" : `?deviceId=${encodeURIComponent(deviceId)}`}`, user);
const claim = (user, code, deviceId, studyDay = today) => call("/api/referral/claim", user, { code, deviceId, studyDay });
const earn = (user, rows) => call("/api/referral/earnings", user, { rows });
const row = (kind = "study", key = "one", day = today, amount = 50) => ({ kind, key, day, amount });
const pair = async (day = today) => {
  const inviter = addUser();
  const invitee = addUser();
  const code = (await me(inviter, `device-${inviter}`)).body.code;
  assert.equal((await claim(invitee, code, `device-${invitee}`, day)).status, 200);
  return { inviter, invitee, code };
};
const expectError = (result, status, detail) => {
  assert.equal(result.status, status);
  assert.deepEqual(result.body, { detail });
};
let cases = 0;
const test = async (name, fn) => {
  await fn();
  cases += 1;
  console.log(`OK referral ${cases}: ${name}`);
};

try {
  await test("all routes require verified auth", async () => {
    for (const [path, body] of [["/api/referral/me"], ["/api/referral/claim", {}], ["/api/referral/earnings", { rows: [] }]]) {
      assert.equal((await call(path, null, body)).status, 401);
      const user = addUser();
      db.prepare("UPDATE users SET email_verified_at = NULL WHERE id = ?").run(user);
      env.RESEND_API_KEY = "test";
      assert.equal((await call(path, user, body)).status, 403);
      delete env.RESEND_API_KEY;
    }
  });
  await test("lazy permanent unique codes, concurrent first GET and device updates", async () => {
    const user = addUser();
    assert.equal(db.prepare("SELECT 1 FROM referral_codes WHERE user_id = ?").get(user), undefined);
    const [first, concurrent] = await Promise.all([me(user, "first"), me(user, "first")]);
    assert.equal(first.status, 200);
    assert.match(first.body.code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    assert.equal(concurrent.body.code, first.body.code);
    assert.deepEqual(first.body, { code: first.body.code, invitedCount: 0, qualifiedCount: 0,
      inviterEarned: 0, inviterCap: 10000, setUnlocked: false, canClaim: true, claim: null, rewards: [] });
    assert.equal((await me(user, "last")).body.code, first.body.code);
    await me(user);
    assert.equal(db.prepare("SELECT device_id FROM referral_codes WHERE user_id = ?").get(user).device_id, "last");
    assert.notEqual((await me(addUser())).body.code, first.body.code);
    assert.equal((await me(user, "d".repeat(65))).status, 400);
    assert.equal((await me(user, "d".repeat(64))).status, 200);
  });
  await test("claim happy path, normalization and exact response", async () => {
    const inviter = addUser();
    const invitee = addUser();
    const code = (await me(inviter)).body.code;
    const result = await claim(invitee, ` ${code.toLowerCase()} `);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { claim: { claimedDay: today, windowEndDay: "2026-11-24", setUnlocked: false } });
    const own = (await me(invitee)).body;
    assert.equal(own.canClaim, false);
    assert.deepEqual(own.claim, result.body.claim);
    assert.equal((await me(inviter)).body.invitedCount, 1);
  });
  await test("bad format, unknown code and invalid study day", async () => {
    const user = addUser();
    for (const code of ["", "ABC", "ABC0DE", "ABC1DE", "AAAAAA", 123, null]) {
      expectError(await claim(user, code), 400, "邀请码无效。");
    }
    const code = (await me(addUser())).body.code;
    assert.equal((await claim(user, code, undefined, "2026-02-30")).status, 400);
    assert.equal((await claim(user, code, "x".repeat(65))).status, 400);
  });
  await test("own code and inviter's last device rejected", async () => {
    const inviter = addUser();
    const code = (await me(inviter, "old-device")).body.code;
    expectError(await claim(inviter, code, "different"), 400, "不能填自己的邀请码。");
    await me(inviter, "last-device");
    expectError(await claim(addUser(), code, "last-device"), 400, "不能填自己的邀请码。");
    assert.equal((await claim(addUser(), code, "old-device")).status, 200);
    assert.equal((await claim(addUser(), code)).status, 200, "missing device is allowed");
  });
  await test("claim once forever, including concurrent requests", async () => {
    const { invitee, code } = await pair();
    expectError(await claim(invitee, code), 409, "已经填过邀请码了。");
    const another = addUser();
    const results = await Promise.all([claim(another, code), claim(another, code)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    clock += 40 * 86400000;
    expectError(await claim(invitee, code), 409, "已经填过邀请码了。");
    clock -= 40 * 86400000;
  });
  await test("seven-day account boundary and canClaim", async () => {
    const code = (await me(addUser())).body.code;
    const old = addUser(new Date(clock - 7 * 86400000 - 1).toISOString());
    assert.equal((await me(old)).body.canClaim, false);
    expectError(await claim(old, code), 403, "只有新账号能填邀请码。");
    const boundary = addUser(new Date(clock - 7 * 86400000).toISOString());
    assert.equal((await me(boundary)).body.canClaim, true);
    assert.equal((await claim(boundary, code)).status, 200);
  });
  await test("no claim 404; rows array bound, null and malformed inputs", async () => {
    expectError(await earn(addUser(), []), 404, "还没有填邀请码。");
    const { invitee } = await pair();
    assert.equal((await earn(invitee, Array(501).fill(row()))).status, 400);
    for (const body of [null, {}, { rows: null }, { rows: {} }]) {
      assert.equal((await call("/api/referral/earnings", invitee, body)).status, 400);
    }
    assert.deepEqual((await earn(invitee, [])).body, { accepted: 0, setUnlocked: false });
    const fullBatch = Array.from({ length: 500 }, (_, i) => row("study", `${i}`.padEnd(80, "柚"), today, 1));
    assert.deepEqual((await earn(invitee, fullBatch)).body, { accepted: 500, setUnlocked: false });
  });
  await test("whitelist, integer row maxima, keys and calendar validation", async () => {
    const { invitee } = await pair();
    const valid = [row("study"), row("plan"), row("streak", "one", today, 300), row("encore"), row("focus", "one", today, 100)];
    const invalid = [null, [], "bad", row("achievement"), row("__proto__"), row("toString"), row("study", "over", today, 51),
      row("plan", "over", today, 51), row("streak", "over", today, 301), row("encore", "over", today, 51), row("focus", "over", today, 101),
      row("study", "zero", today, 0), row("study", "negative", today, -1), row("study", "decimal", today, 1.5),
      row("study", "string", today, "50"), row("study", ""), row("study", "x".repeat(81)),
      row("study", "date", "2026-02-30"), row("study", "date", "2026-1-1"), row("study", 123)];
    assert.deepEqual((await earn(invitee, [...invalid, ...valid, row("study", " ", today, 1), row("study", "x".repeat(80), today, 1)])).body, { accepted: 7, setUnlocked: true });
    assert.equal(db.prepare("SELECT SUM(amount) AS n FROM referral_earnings WHERE invitee_user_id = ?").get(invitee).n, 552);
  });
  await test("daily sum 700 skips excess, later smaller row still fits", async () => {
    const { invitee } = await pair();
    const result = await earn(invitee, [row("streak", "a", today, 300), row("streak", "b", today, 300),
      row("study", "a", today, 49), row("focus", "too-big", today, 100), row("study", "b", today, 50),
      row("study", "c", today, 1), row("study", "d", today, 1)]);
    assert.deepEqual(result.body, { accepted: 5, setUnlocked: false });
    assert.equal(db.prepare("SELECT SUM(amount) AS n FROM referral_earnings WHERE invitee_user_id = ?").get(invitee).n, 700);
    assert.equal((await earn(invitee, [row("study", "next-day", dayAfter(today, 1))])).body.accepted, 1);
  });
  await test("full 30-day offline window, inclusive end and server tomorrow limit", async () => {
    const { invitee } = await pair();
    clock += 29 * 86400000;
    const result = await earn(invitee, [row("study", "before", dayAfter(today, -1)), row("study", "first", today),
      row("study", "end", dayAfter(today, 29)), row("study", "after", dayAfter(today, 30))]);
    assert.equal(result.body.accepted, 2);
    clock -= 29 * 86400000;
    const other = await pair();
    assert.equal((await earn(other.invitee, [row("study", "tomorrow", dayAfter(today, 1)),
      row("study", "future", dayAfter(today, 2))])).body.accepted, 1);
  });
  await test("identity is invitee/kind/key, idempotent across day and request", async () => {
    const { inviter, invitee } = await pair();
    assert.equal((await earn(invitee, [row("study", "same", today, 5), row("study", "same", today, 5)])).body.accepted, 1);
    const first = (await me(inviter)).body;
    assert.deepEqual((await earn(invitee, [row("study", "same", dayAfter(today, 1), 50)])).body, { accepted: 0, setUnlocked: false });
    assert.deepEqual((await me(inviter)).body.rewards, first.rewards);
    assert.equal((await earn(invitee, [row("focus", "same", today, 1)])).body.accepted, 1);
    const inviterMe = (await me(inviter)).body;
    assert.equal(inviterMe.inviterEarned, 2, "floor is applied to each row");
    assert.equal(inviterMe.rewards.length, 1, "zero rewards are omitted");
    assert.deepEqual(Object.keys(inviterMe.rewards[0]).sort(), ["amount", "id"]);
    assert.equal(typeof inviterMe.rewards[0].id, "number");
  });
  await test("daily cap and duplicate identity hold under concurrent reports", async () => {
    const { invitee } = await pair();
    const results = await Promise.all([earn(invitee, [row("streak", "a", today, 300), row("streak", "b", today, 300)]),
      earn(invitee, [row("streak", "a", today, 300), row("streak", "c", today, 300), row("focus", "d", today, 100)])]);
    assert.equal(results.reduce((n, result) => n + result.body.accepted, 0), 3);
    assert.equal(db.prepare("SELECT SUM(amount) AS n FROM referral_earnings WHERE invitee_user_id = ?").get(invitee).n, 700);
  });
  await test("inviter lifetime cap clips across all invitees, rows still accepted at cap", async () => {
    const { inviter, invitee, code } = await pair();
    const second = addUser();
    assert.equal((await claim(second, code)).status, 200);
    const seed = db.prepare(`INSERT INTO referral_earnings (invitee_user_id, kind, key, day, amount, inviter_amount, created_at)
      VALUES (?, 'streak', ?, ?, ?, ?, ?)`);
    // Valid historic earnings from two invitees leave exactly one inviter yuzu to allocate.
    for (let i = 0; i < 66; i++) {
      seed.run(i < 40 ? invitee : second, `seed-${i}`, dayAfter(today, 1 + Math.floor((i < 40 ? i : i - 40) / 2)), 300, 150, new Date().toISOString());
    }
    seed.run(second, "seed-last", dayAfter(today, 14), 198, 99, new Date().toISOString());
    clock += 29 * 86400000;
    const results = await Promise.all([earn(invitee, [row("study", "clip", dayAfter(today, 29), 5)]),
      earn(second, [row("study", "cap", dayAfter(today, 29), 50)])]);
    assert.equal(results.reduce((n, r) => n + r.body.accepted, 0), 2);
    const result = (await me(inviter)).body;
    assert.equal(result.inviterEarned, 10000);
    assert.equal(result.rewards.reduce((sum, r) => sum + r.amount, 0), 10000);
    assert.equal((await earn(invitee, [row("plan", "at-cap", dayAfter(today, 29))])).body.accepted, 1);
    assert.equal((await me(inviter)).body.inviterEarned, 10000);
    clock -= 29 * 86400000;
  });
  await test("invitee unlock requires an accepted plan; inviter-only status is separate", async () => {
    const { inviter, invitee } = await pair();
    assert.deepEqual((await earn(invitee, [row()])).body, { accepted: 1, setUnlocked: false });
    assert.equal((await earn(invitee, [row("plan", "invalid", today, 51)])).body.setUnlocked, false);
    assert.deepEqual((await earn(invitee, [row("plan")])).body, { accepted: 1, setUnlocked: true });
    assert.equal((await me(invitee)).body.claim.setUnlocked, true);
    assert.equal((await me(invitee)).body.setUnlocked, true);
    assert.equal((await me(inviter)).body.setUnlocked, false);
    assert.equal((await earn(invitee, [])).body.setUnlocked, true);
  });
  await test("three distinct days within first 14 unlock inviter, qualification persists", async () => {
    const { inviter, invitee } = await pair();
    clock += 13 * 86400000;
    await earn(invitee, [row("study", "one", today), row("focus", "same-day", today), row("study", "two", dayAfter(today, 1))]);
    assert.equal((await me(inviter)).body.setUnlocked, false);
    await earn(invitee, [row("study", "third", dayAfter(today, 13))]);
    const result = (await me(inviter)).body;
    assert.equal(result.setUnlocked, true);
    assert.equal(result.qualifiedCount, 1);
    assert.equal((await me(invitee)).body.setUnlocked, false);
    const qualifiedAt = db.prepare("SELECT qualified_at FROM referral_claims WHERE invitee_user_id = ?").get(invitee).qualified_at;
    await earn(invitee, []);
    assert.equal(db.prepare("SELECT qualified_at FROM referral_claims WHERE invitee_user_id = ?").get(invitee).qualified_at, qualifiedAt);
    // An inviter unlock must not masquerade as invitee's own unlock in POST /earnings.
    const upstream = (await me(addUser())).body.code;
    db.prepare("UPDATE users SET created_at = ? WHERE id = ?").run(new Date().toISOString(), inviter);
    assert.equal((await claim(inviter, upstream, undefined, dayAfter(today, 13))).status, 200);
    assert.equal((await earn(inviter, [])).body.setUnlocked, false);
    assert.equal((await me(inviter)).body.setUnlocked, true);
    clock -= 13 * 86400000;
  });
  await test("third day after day 13 does not qualify; rejected plan does not unlock", async () => {
    const { inviter, invitee } = await pair();
    clock += 14 * 86400000;
    await earn(invitee, [row("study", "first", today), row("study", "second", dayAfter(today, 1)), row("study", "late", dayAfter(today, 14))]);
    assert.equal((await me(inviter)).body.qualifiedCount, 0);
    assert.equal((await me(inviter)).body.setUnlocked, false);
    await earn(invitee, [row("streak", "a", dayAfter(today, 14), 300), row("streak", "b", dayAfter(today, 14), 300), row("focus", "c", dayAfter(today, 14), 50)]);
    assert.deepEqual((await earn(invitee, [row("plan", "over-daily", dayAfter(today, 14))])).body, { accepted: 0, setUnlocked: false });
    clock -= 14 * 86400000;
  });
  await test("title-yuyou 403 until unlocked as invitee or inviter, ordinary titles unchanged", async () => {
    const { inviter, invitee } = await pair();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO teams (id, name, target_level, emoji, visibility, max_members, owner_user_id, invite_code, created_at, updated_at)
      VALUES ('referral-team', '测试队伍', 'N3', '🌱', 'public', 6, ?, 'REFTEAM1', ?, ?)`).run(inviter, now, now);
    for (const user of [inviter, invitee]) {
      db.prepare("INSERT INTO team_members (id, team_id, user_id, role, joined_at) VALUES (?, 'referral-team', ?, 'member', ?)").run(user, user, now);
    }
    const title = (user, value = "title-yuyou") => call("/api/teams/title", user, { title: value }, "PUT");
    expectError(await title(invitee), 403, "这个称号要邀请获得。");
    assert.equal((await title(invitee, "title-early")).status, 200);
    await earn(invitee, [row("plan")]);
    assert.deepEqual(await title(invitee), { status: 200, body: { title: "title-yuyou" } });
    expectError(await title(inviter), 403, "这个称号要邀请获得。");
    clock += 2 * 86400000;
    await earn(invitee, [row("study", "two", dayAfter(today, 1)), row("study", "three", dayAfter(today, 2))]);
    assert.equal((await title(inviter)).status, 200);
    assert.equal((await title(inviter, "")).status, 200);
    clock -= 2 * 86400000;
  });
  await test("separate per-user claim 10/hour and write 60/hour limits", async () => {
    const { invitee, code } = await pair();
    const windowStart = Math.floor(Date.now() / 1000 / 3600) * 3600;
    for (const [scope, count, path, body] of [["referral-claim", 10, "/api/referral/claim", { code, studyDay: today }],
      ["referral-write", 60, "/api/referral/earnings", { rows: [] }]]) {
      db.prepare(`INSERT INTO auth_rate_limits (subject, scope, window_start, request_count, updated_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(subject, scope, window_start) DO UPDATE SET request_count = excluded.request_count`)
        .run(`user:${invitee}`, scope, windowStart, count - 1, new Date().toISOString());
      assert.notEqual((await call(path, invitee, body)).status, 429);
      assert.equal((await call(path, invitee, body)).status, 429);
    }
    const other = await pair();
    assert.equal((await earn(other.invitee, [])).status, 200);
  });
  console.log(`OK ${cases} referral route cases`);
} finally {
  globalThis.Date = RealDate;
  db.close();
  rmSync(outdir, { recursive: true, force: true });
}
