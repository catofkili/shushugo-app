import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outdir = mkdtempSync(join(tmpdir(), "shushugo-weekly-worker-test-"));
const built = spawnSync(join(root, "node_modules", ".bin", "wrangler"), ["deploy", "--dry-run", "--outdir", outdir], { cwd: root, encoding: "utf8" });
if (built.status !== 0) throw new Error(`${built.stdout}\n${built.stderr}`);

const bytes = (value) => new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));
const validReport = (weekStart = "2026-09-06") => ({
  window: { start: weekStart, end: "2026-09-12", startAt: 1, endAt: 2 },
  metrics: {
    days: 1, minutes: 1, totalSeconds: 60, totalReviews: 1, wordReviews: 1,
    grammarReviews: 0, kanjiReviews: 0, newWords: 1, reviewCount: 0,
    daily: [{ date: "2026-09-07", reviews: 1, newWords: 1 }],
    streak: 1, cumulativeDays: 1, cumulativeWords: 1
  },
  keyword: null,
  keywordCandidates: [],
  speedBand: null,
  eta: null,
  references: []
});

const makeEnv = (pro = true) => {
  const objects = new Map();
  let raceContent = null;
  const bucket = {
    async get(key) {
      const value = objects.get(key);
      if (!value) return null;
      return { body: value, arrayBuffer: async () => value.slice().buffer };
    },
    async put(key, value, options = {}) {
      if (raceContent) {
        objects.set(key, raceContent);
        raceContent = null;
        return null;
      }
      if (options.onlyIf?.etagDoesNotMatch === "*" && objects.has(key)) return null;
      const stored = value instanceof Uint8Array ? value : bytes(value);
      objects.set(key, stored);
      return { key };
    },
    async list(options = {}) {
      const all = [...objects]
        .filter(([key]) => !options.prefix || key.startsWith(options.prefix))
        .map(([key, value]) => ({ key, size: value.byteLength, uploaded: new Date() }));
      const start = Number(options.cursor ?? 0);
      const end = Math.min(start + Number(options.limit ?? 1000), all.length);
      return { objects: all.slice(start, end), truncated: end < all.length, ...(end < all.length ? { cursor: String(end) } : {}) };
    },
    async delete(key) { objects.delete(key); }
  };
  return {
    env: {
      DB: { prepare(sql) { return { bind() { return this; }, async first() {
        if (sql.includes("FROM sessions")) return { user_id: "user-1", expires_at: "2099-01-01T00:00:00.000Z" };
        if (sql.includes("FROM entitlements")) return { is_pro: pro ? 1 : 0, product_id: pro ? "shushugo_pro_lifetime" : null, expires_at: null };
        return null;
      } }; } },
      SYNC_BUCKET: bucket
    },
    objects,
    raceWith(value) { raceContent = bytes(value); }
  };
};

try {
  const worker = (await import(pathToFileURL(join(outdir, "index.js")).href)).default;
  const request = (method, body, path = "/api/weekly-report") => new Request(`https://worker.test${path}`, {
    method,
    headers: { authorization: "Bearer token", "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {})
  });

  const options = await worker.fetch(new Request("https://worker.test/api/weekly-report", { method: "OPTIONS" }), {}, {});
  assert.equal(options.status, 204);
  assert.match(options.headers.get("access-control-allow-methods") ?? "", /PUT/);
  const noAuth = await worker.fetch(new Request("https://worker.test/api/weekly-reports"), makeEnv().env, {});
  assert.equal(noAuth.status, 401);
  const free = await worker.fetch(request("GET", null, "/api/weekly-reports"), makeEnv(false).env, {});
  assert.equal(free.status, 403);
  const invalidDate = await worker.fetch(request("PUT", { week_start: "2026-99-99", report: validReport("2026-99-99") }), makeEnv().env, {});
  assert.equal(invalidDate.status, 400);
  const nonSunday = await worker.fetch(request("PUT", { week_start: "2026-09-07", report: validReport("2026-09-07") }), makeEnv().env, {});
  assert.equal(nonSunday.status, 400);

  const weak = makeEnv();
  const weakResponse = await worker.fetch(request("PUT", {
    week_start: "2026-09-06",
    report: { window: { start: "2026-09-06" }, metrics: { days: 1 } }
  }), weak.env, {});
  assert.equal(weakResponse.status, 400, "a report that would crash the reader must be rejected");

  const normal = makeEnv();
  const first = await worker.fetch(request("PUT", { week_start: "2026-09-06", report: validReport() }), normal.env, {});
  assert.equal(first.status, 200);
  const same = await worker.fetch(request("PUT", { week_start: "2026-09-06", report: validReport() }), normal.env, {});
  assert.equal(same.status, 200, "identical retry must be idempotent");
  const conflict = await worker.fetch(request("PUT", { week_start: "2026-09-06", report: { ...validReport(), references: [{ kind: "review", text: "different" }] } }), normal.env, {});
  assert.equal(conflict.status, 409, "different content for one week must conflict");

  const raced = makeEnv();
  const competing = JSON.stringify({ schemaVersion: 2, weekStart: "2026-09-06", report: { ...validReport(), references: [{ kind: "review", text: "winner" }] } });
  raced.raceWith(competing);
  const racedResponse = await worker.fetch(request("PUT", { week_start: "2026-09-06", report: validReport() }), raced.env, {});
  assert.equal(racedResponse.status, 409, "a concurrent writer must not be overwritten");
  assert.equal(new TextDecoder().decode(raced.objects.values().next().value), competing);

  const paged = makeEnv();
  for (let index = 0; index < 1001; index += 1) {
    const date = new Date(Date.UTC(2000, 0, 2 + index * 7)).toISOString().slice(0, 10);
    paged.objects.set(`weekly/user-1/${date}.json`, bytes("x"));
  }
  const listed = await worker.fetch(request("GET", null, "/api/weekly-reports"), paged.env, {});
  assert.equal(listed.status, 200);
  assert.equal((await listed.json()).reports.length, 1001, "listing must consume every R2 cursor page");

  console.log("OK weekly report auth, validation, pagination, idempotency, and concurrent conflict handling");
} finally {
  rmSync(outdir, { recursive: true, force: true });
}
