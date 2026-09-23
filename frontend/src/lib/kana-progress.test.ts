import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;
const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, String(value)), removeItem: (key: string) => store.delete(key) },
  window: { dispatchEvent: () => true }
});
vi.mock("./database", () => ({ getDatabase: () => testDb }));
vi.mock("./storage", () => ({ requestFullSnapshot: vi.fn(), scheduleSave: vi.fn() }));

import { ensureUserTables } from "./study-core";
import { getState, setState } from "./database/db-utils";
import { getDailyWordGoal, getStudyPreferences } from "./studyPreferences";
import { KANA, deferWordPlanUntilKanaComplete, getKanaProgress, kanaComplete, kanaQuizChoices, recordKanaAnswer, replayKanaReviews } from "./kana-progress";
import { hydrateLevelPlanPreferences } from "./level-plan";

describe("五十音进度门槛", () => {
  beforeAll(async () => {
    const SQL = await initSqlJs();
    testDb = new SQL.Database(new Uint8Array(readFileSync(fileURLToPath(new URL("../../public/nihongo.db", import.meta.url)))));
    ensureUserTables();
    setState("starting_level", "kana-none");
  });

  it("92 个字卡的四选一题都包含正确罗马字，且选项不重复", () => {
    KANA.forEach(([, reading], index) => {
      const choices = kanaQuizChoices(index);
      expect(choices).toHaveLength(4);
      expect(new Set(choices).size).toBe(4);
      expect(choices).toContain(reading);
    });
  });

  it("答题写 FSRS 和流水，重放后保留正确次数", () => {
    const first = KANA[0][0];
    const result = recordKanaAnswer(first, true);
    expect(result.progress[first]).toBe(1);
    expect(Number(testDb.exec("SELECT COUNT(*) FROM kana_reviews")[0].values[0][0])).toBe(1);
    expect(Number(testDb.exec("SELECT fsrs_stability FROM kana_memory WHERE symbol=?", [first])[0].values[0][0])).toBeGreaterThan(0);
    testDb.run("UPDATE kana_memory SET correct_streak=0, fsrs_stability=NULL WHERE symbol=?", [first]);
    replayKanaReviews();
    expect(getKanaProgress()[first]).toBe(1);
    expect(Number(testDb.exec("SELECT fsrs_stability FROM kana_memory WHERE symbol=?", [first])[0].values[0][0])).toBeGreaterThan(0);
  });

  it("没完成五十音时新词为 0；完成后从真实完成日启动原定额度", () => {
    deferWordPlanUntilKanaComplete(23);
    expect(getDailyWordGoal()).toBe(0);
    testDb.run("UPDATE kana_memory SET correct_streak=2 WHERE symbol != ?", [KANA[0][0]]);
    const done = recordKanaAnswer(KANA[0][0], true);
    expect(done.completed).toBe(true);
    expect(kanaComplete()).toBe(true);
    expect(getDailyWordGoal()).toBe(23);
    expect(getStudyPreferences().dailyGoal).toBe(23);
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    expect(getState("jlpt_plan_started_on", "")).toBe(today);
    expect(getStudyPreferences().jlptPlanStartedOn).toBe(today);
  });

  it("另一台设备合并完成假名后恢复原定新词量和实际起点日期", () => {
    setState("type_familiarity", JSON.stringify({ words: 0, grammar: 0, kanji: 0, confusion: 0 }));
    setState("jlpt_plan_target", "N5");
    setState("jlpt_plan_started_on", "2026-09-01");
    setState("kana_completed", "0");
    setState("level_plan_quotas", JSON.stringify({ dailyGoal: 0 }));
    testDb.run("UPDATE kana_memory SET correct_streak=0");
    const at = new Date("2026-09-20T12:00:00").getTime();
    for (const [symbol] of KANA) {
      testDb.run("INSERT INTO kana_reviews (symbol,answer,reviewed_on,reviewed_at) VALUES (?, 'know', '2026-09-20', ?)", [symbol, at]);
      testDb.run("INSERT INTO kana_reviews (symbol,answer,reviewed_on,reviewed_at) VALUES (?, 'know', '2026-09-20', ?)", [symbol, at + 1000]);
    }
    replayKanaReviews();
    hydrateLevelPlanPreferences();
    expect(getDailyWordGoal()).toBe(23);
    expect(getState("jlpt_plan_started_on", "")).toBe("2026-09-20");
    expect(getStudyPreferences().jlptPlanStartedOn).toBe("2026-09-20");
  });
});
