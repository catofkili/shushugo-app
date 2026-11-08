import { beforeAll, expect, it, vi } from "vitest";
import initSqlJs from "sql.js";
import { recordReview, retrievability } from "../fsrs-scheduler";
import * as scheduler from "../fsrs-scheduler";
import { PRIOR_ENTITIES } from "../prior-pacing";
import { calibrate, recallByStudyDay } from "./calibration";
import { KINDS } from "./model";

vi.stubEnv("TZ", "Asia/Singapore");
let SQL: Awaited<ReturnType<typeof initSqlJs>>;
beforeAll(async () => { SQL = await initSqlJs(); });

it("隔夜不足24小时的R按学习日差衰减，同学习日不衰减", () => {
  const state = recordReview(null, "know", new Date("2026-11-01T22:00:00+08:00"), { mode: "known" });
  const nextMorning = Date.parse("2026-11-02T09:00:00+08:00");
  expect(retrievability(state, new Date(nextMorning))).toBe(1);
  expect(recallByStudyDay(state, nextMorning)).toBeLessThan(1);
  expect(recallByStudyDay(state, Date.parse("2026-11-02T03:59:00+08:00"))).toBe(1);
});

it.each(["normal", null])("四类模糊算想起来，显式/旧流水模式%s仍重放为Hard", mode => {
  const db = new SQL.Database();
  const replay = vi.spyOn(scheduler, "recordReview");
  try {
    db.run("CREATE TABLE level_prior_baselines (entity TEXT, entity_key TEXT)");
    for (const k of KINDS) {
      const e = PRIOR_ENTITIES[k];
      db.run(`CREATE TABLE ${e.reviews} (id INTEGER, ${e.idColumn} TEXT, reviewed_on TEXT, reviewed_at INTEGER, created_at TEXT, answer TEXT, scheduler_mode TEXT, direction TEXT)`);
      for (const [i, answer] of ["know", "fuzzy", "know"].entries()) {
        const date = `2026-11-0${i + 1}`, at = `${date}T${i === 0 ? "22" : "09"}:00:00+08:00`;
        db.run(`INSERT INTO ${e.reviews} VALUES (?, '1', ?, ?, ?, ?, ?, 'forward')`,
          [i + 1, date, Date.parse(at), at, answer, i === 0 ? "known" : mode]);
      }
    }
    const before = db.export();
    const cal = calibrate(db);
    expect(db.export(), "标定不能改动冻结输入").toEqual(before);
    const fuzzy = replay.mock.calls.filter(call => call[1] === "fuzzy");
    expect(fuzzy).toHaveLength(4);
    for (const call of fuzzy) expect(call[3]?.mode).toBe("normal");
    for (const k of KINDS) {
      expect(cal.review[k].count).toBe(1);
      expect(cal.review[k].accuracy).toBe(1);
      expect(cal.review[k].meanR).toBeLessThan(1);
      expect(cal.previousCoefficients[k]).toBe(0);
      expect(cal.coefficients[k]).toBeGreaterThan(0);
      expect(cal.inferredModes[k]).toBe(mode === null ? 2 : 0);
    }
  } finally { replay.mockRestore(); db.close(); }
});
