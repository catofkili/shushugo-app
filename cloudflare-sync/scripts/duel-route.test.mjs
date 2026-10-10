import assert from "node:assert/strict";
import { hash, teamDuelHarness } from "./team-duel-test-harness.mjs";

const h = await teamDuelHarness();
const { db, call } = h;
const questions = Array.from({ length: 10 }, (_, index) => ({ id: index + 1, level: "N3", kind: "meaning", prompt: `词${index + 1}`, options: ["学习", "睡觉", "吃饭", "走路"], answerIndex: 0, answer: "学习", limitMs: 10000 }));
const answers = (correct, answered = 10, responseMs = 1000) => Array.from({ length: answered }, (_, index) => ({ selected: index < correct ? 0 : "unknown", responseMs }));
const payload = (correct = 2) => ({ levels: ["N3"], questionCount: 10, questions, answers: answers(correct), score: { correct: 999 } });
const create = async (correct = 2) => {
  const response = await call("/api/duels", { user: "creator", body: payload(correct) });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.duel;
};

try {
  for (const id of ["creator", "opponent", "third", "fourth"]) h.addUser(id);
  assert.equal((await call("/api/duels", { body: payload() })).status, 401, "creation requires a login");
  assert.equal((await call("/api/duels/missing")).status, 404);
  const duel = await create();
  assert.equal(duel.creatorScore.correct, 2, "creator score is recomputed, ignoring supplied score");
  const publicGet = await call(`/api/duels/${duel.id}`);
  assert.equal(publicGet.status, 200);
  assert.equal(publicGet.body.duel.creatorName, "creator", "the challenge intro includes the creator's display name");
  assert.deepEqual(publicGet.body.duel.questions, questions, "anonymous responder gets the exact stored snapshot");
  assert.equal(publicGet.body.duel.available, true);
  assert.ok(!JSON.stringify(publicGet.body).includes("creator_user_id"), "internal account IDs stay private");
  const preflight = await call(`/api/duels/${duel.id}`, { method: "OPTIONS" });
  assert.ok(preflight.headers.get("access-control-allow-headers").includes("x-duel-token"));
  assert.equal((await call(`/api/duels/${duel.id}/submit`, { user: "creator", body: { answers: [] } })).status, 400, "self-duels are rejected");
  assert.equal((await call(`/api/duels/${duel.id}/submit`, { body: { answers: [] } })).status, 400, "anonymous submission needs a token");

  const token = "anonymous-token-".padEnd(40, "x");
  const submitted = await call(`/api/duels/${duel.id}/submit`, { body: { answers: answers(3, 4, 90000), token, score: { correct: 999 } } });
  assert.equal(submitted.status, 200);
  assert.deepEqual(submitted.body.duel.opponentScore, { correct: 3, answered: 4, totalMs: 40000 }, "partial score excludes unreached questions and clamps time");
  assert.equal(submitted.body.duel.winner, null, "anonymous opponent cannot decide a winner");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM duel_weekly_wins").get().n, 0);
  assert.equal(db.prepare("SELECT opponent_token_hash FROM duels WHERE id = ?").get(duel.id).opponent_token_hash, hash(token));
  assert.ok(!JSON.stringify(db.prepare("SELECT * FROM duels WHERE id = ?").get(duel.id)).includes(token), "only the token hash is stored");
  assert.equal((await call(`/api/duels/${duel.id}`)).body.duel.available, false, "occupied status is visible before answering");
  assert.equal((await call(`/api/duels/${duel.id}`, { token })).body.duel.role, "opponent");
  assert.equal((await call(`/api/duels/${duel.id}/submit`, { user: "third", body: { answers: [] } })).status, 409);
  assert.equal((await call(`/api/duels/${duel.id}/claim`, { body: { token } })).status, 401);
  assert.equal((await call(`/api/duels/${duel.id}/claim`, { user: "creator", body: { token } })).status, 400);
  assert.equal((await call(`/api/duels/${duel.id}/claim`, { user: "opponent", body: { token: "z".repeat(40) } })).status, 403);
  const claimed = await call(`/api/duels/${duel.id}/claim`, { user: "opponent", body: { token } });
  assert.equal(claimed.status, 200);
  assert.equal(claimed.body.duel.winner, "opponent");
  assert.equal(claimed.body.duel.opponentLinked, true);
  const decidedAt = claimed.body.duel.decidedAt;
  assert.equal((await call(`/api/duels/${duel.id}/claim`, { user: "opponent", body: { token } })).body.duel.decidedAt, decidedAt, "claim retries do not re-decide");
  assert.equal((await call(`/api/duels/${duel.id}/claim`, { user: "third", body: { token } })).status, 409);
  assert.equal((await call(`/api/duels/${duel.id}/submit`, { user: "opponent", body: { token, answers: answers(3, 4, 90000) } })).status, 200, "submission retries are idempotent after normalized clamping");
  assert.equal((await call(`/api/duels/${duel.id}/submit`, { user: "opponent", body: { token, answers: [] } })).status, 409, "settled answers are immutable");

  const second = await create();
  assert.equal((await call(`/api/duels/${second.id}/submit`, { user: "opponent", body: { answers: answers(3) } })).body.duel.winner, "opponent");
  const wins = db.prepare("SELECT * FROM duel_weekly_wins WHERE user_id = 'opponent'").all();
  assert.equal(wins.length, 1, "weekly first win only once");
  assert.equal(wins[0].duel_id, duel.id);
  assert.equal(wins[0].iso_week, "2026-W44");
  assert.equal((await call("/api/teams/rewards", { user: "opponent" })).body.wins.length, 1);
  assert.equal((await call("/api/duels/me", { user: "opponent" })).body.duels.length, 2);
  assert.equal((await call("/api/duels/me")).status, 401);

  const draw = await create();
  assert.equal((await call(`/api/duels/${draw.id}/submit`, { user: "third", body: { answers: answers(2) } })).body.duel.winner, "draw");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM duel_weekly_wins WHERE user_id = 'third'").get().n, 0);
  const racing = await create(0);
  const racers = await Promise.all(["third", "fourth"].map((user) => call(`/api/duels/${racing.id}/submit`, { user, body: { answers: answers(1) } })));
  assert.deepEqual(racers.map((result) => result.status).sort(), [200, 409], "first submit atomically takes the only slot");

  h.setTime("2026-11-02T03:59:59+08:00");
  const sunday = await create();
  await call(`/api/duels/${sunday.id}/submit`, { user: "opponent", body: { answers: answers(3) } });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM duel_weekly_wins WHERE user_id = 'opponent'").get().n, 1);
  const lateClaim = await create();
  const lateToken = "late-token-".padEnd(40, "y");
  await call(`/api/duels/${lateClaim.id}/submit`, { body: { answers: answers(3), token: lateToken } });
  h.setTime("2026-11-02T04:00:00+08:00");
  await call(`/api/duels/${lateClaim.id}/claim`, { user: "opponent", body: { token: lateToken } });
  assert.deepEqual(db.prepare("SELECT iso_week FROM duel_weekly_wins WHERE user_id = 'opponent' ORDER BY iso_week").all().map((row) => row.iso_week), ["2026-W44", "2026-W45"], "decision time, not creation time, determines the week");

  const invalid = payload(); invalid.questions = questions.map((question) => ({ ...question, limitMs: 20000 }));
  assert.equal((await call("/api/duels", { user: "creator", body: invalid })).status, 400);
  const invalidAnswers = await create();
  assert.equal((await call(`/api/duels/${invalidAnswers.id}/submit`, { user: "third", body: { answers: [{ selected: 4, responseMs: 1 }] } })).status, 400);
  assert.equal((await call(`/api/duels/${invalidAnswers.id}/submit`, { user: "third", body: { answers: answers(0, 11) } })).status, 400);
  console.log("OK duel routes: anonymous snapshot/submission, hashed claim, self-duel rejection, two-account decision, weekly idempotency, immutable retries, racing responders, and Monday 04:00");
} finally { h.close(); }
