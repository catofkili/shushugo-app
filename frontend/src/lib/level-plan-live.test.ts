/** 可选的作者库验收：只读磁盘快照，所有写入都发生在内存 SQLite。 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import initSqlJs, { type Database } from "sql.js";

let db: Database;
const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, String(value)), removeItem: (key: string) => store.delete(key) },
  window: { dispatchEvent: () => true, addEventListener: () => undefined, removeEventListener: () => undefined }
});
vi.mock("./database", () => ({ getDatabase: () => db }));
vi.mock("./storage", () => ({ requestFullSnapshot: vi.fn(), scheduleSave: vi.fn() }));

import { ensureUserTables } from "./study-core";
import { applyLevelStartingPoint, type LevelPlanSettings } from "./level-plan";

const snapshotPath = process.env.LEVEL_PLAN_LIVE_DB;
describe.skipIf(!snapshotPath)("作者库起点只读验收", () => {
  beforeAll(async () => {
    const SQL = await initSqlJs();
    db = new SQL.Database(new Uint8Array(readFileSync(snapshotPath!)));
    ensureUserTables();
  });

  it("只给未学卡加起点，真实作答及其 FSRS 状态原样保留", async () => {
    const beforeReviews = Number(db.exec("SELECT COUNT(*) FROM reviews")[0].values[0][0]);
    const before = db.exec(`SELECT p.word_id, p.seen_count, p.fsrs_stability, p.fsrs_due
      FROM progress p WHERE EXISTS (SELECT 1 FROM reviews r WHERE r.word_id = p.word_id) ORDER BY p.word_id`)[0].values;
    const eligible = Number(db.exec(`SELECT COUNT(*) FROM progress p JOIN words w ON w.id = p.word_id
      WHERE w.jlpt_level IN ('N5','N4') AND p.seen_count = 0 AND p.known_forever = 0
        AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.word_id = p.word_id)`)[0].values[0][0]);
    expect(eligible).toBeGreaterThan(0);
    const settings: LevelPlanSettings = {
      startingLevel: "N4", familiarity: { words: 75, grammar: 75, kanji: 75, confusion: 75 },
      target: "N3", examKind: "jlpt", examDate: "2026-12-06", startedOn: "2026-09-23"
    };
    await applyLevelStartingPoint(settings, new Date("2026-09-23T12:00:00+08:00"));
    expect(Number(db.exec("SELECT COUNT(*) FROM reviews")[0].values[0][0])).toBe(beforeReviews);
    expect(db.exec(`SELECT p.word_id, p.seen_count, p.fsrs_stability, p.fsrs_due
      FROM progress p WHERE EXISTS (SELECT 1 FROM reviews r WHERE r.word_id = p.word_id) ORDER BY p.word_id`)[0].values).toEqual(before);
    expect(Number(db.exec("SELECT COUNT(*) FROM level_prior_baselines WHERE entity='words'")[0].values[0][0])).toBe(eligible);
    const spread = db.exec(`SELECT w.jlpt_level, COUNT(DISTINCT substr(b.due,1,10)) AS days,
      MIN(substr(b.due,1,10)) AS first_due, MAX(substr(b.due,1,10)) AS last_due
      FROM level_prior_baselines b JOIN words w ON w.id = CAST(b.entity_key AS INTEGER)
      WHERE b.entity='words' GROUP BY w.jlpt_level`)[0].values;
    const n4 = spread.find((row) => row[0] === "N4")!;
    const n5 = spread.find((row) => row[0] === "N5")!;
    expect(Number(n4[1])).toBeGreaterThanOrEqual(10);
    expect(Date.parse(String(n4[3]))).toBeLessThan(Date.parse("2026-10-08"));
    expect(Date.parse(String(n5[3]))).toBeLessThan(Date.parse("2026-10-24"));
  });
});
