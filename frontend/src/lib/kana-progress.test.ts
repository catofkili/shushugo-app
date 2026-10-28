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
import { getState, setState, today } from "./database/db-utils";
import { getDailyWordGoal, getStudyPreferences } from "./studyPreferences";
import { KANA, deferWordPlanUntilKanaComplete, getKanaProgress, kanaComplete, kanaQuizChoices, kanaStateFrom, pickKanaIndex, recordKanaAnswer, replayKanaReviews } from "./kana-progress";
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

  it("乱序出题：不连出同一个字，新字只从表序前 8 个没学会的里挑，会回炉已学会的", () => {
    expect(pickKanaIndex(Object.fromEntries(KANA.map(([k]) => [k, 2])))).toBeNull();
    const fresh: Record<string, number> = {};
    const seen = new Set<number>();
    for (let n = 0; n < 500; n += 1) {
      const i = pickKanaIndex(fresh, KANA[0][0])!;
      expect(i).toBeGreaterThan(0);
      expect(i).toBeLessThan(8);
      seen.add(i);
    }
    expect(seen.size).toBe(7);
    const half = Object.fromEntries(KANA.slice(0, 40).map(([k]) => [k, 2]));
    const picks = Array.from({ length: 400 }, () => pickKanaIndex(half)!);
    expect(picks.some((i) => i < 40)).toBe(true);
    expect(picks.every((i) => i < 48)).toBe(true);
    const lastOne = Object.fromEntries(KANA.slice(1).map(([k]) => [k, 2]));
    expect(pickKanaIndex(lastOne, KANA[0][0])).not.toBe(0);
    expect(pickKanaIndex({ ...lastOne, [KANA[1][0]]: 0 }, KANA[0][0], () => 0.9)).toBe(1);
  });

  it("掌握 = 三个不同的日子都过关；第一天要连对两次，之后每天一次；隔天打回待重考；答错清零", () => {
    const r = (answer: string, reviewed_on: string) => ({ answer, reviewed_on });
    expect(kanaStateFrom([], "d1").stage).toBe("new");
    expect(kanaStateFrom([r("know", "d1")], "d1")).toMatchObject({ stage: "learning", days: 0, todayCorrect: 1 });
    const day1 = [r("know", "d1"), r("know", "d1")];
    expect(kanaStateFrom(day1, "d1")).toMatchObject({ stage: "passed", days: 1 });
    expect(kanaStateFrom(day1, "d2")).toMatchObject({ stage: "review", days: 1, todayCorrect: 0 });
    const day2 = [...day1, r("know", "d2")];
    expect(kanaStateFrom(day2, "d2")).toMatchObject({ stage: "passed", days: 2 });
    expect(kanaStateFrom([...day2, r("know", "d3")], "d3")).toMatchObject({ stage: "mastered", days: 3, masteredOn: "d3" });
    // 同一天多答几次不算多一天
    expect(kanaStateFrom([...day1, r("know", "d1"), r("know", "d1")], "d2").days).toBe(1);
    // 答错清零：第三天错了，从头算，而且又要当天连对两次
    const broken = [...day2, r("forgot", "d3"), r("know", "d3")];
    expect(kanaStateFrom(broken, "d3")).toMatchObject({ stage: "learning", days: 0, todayCorrect: 1 });
    // 第一天只对了一次没过关，第二天要重新连对两次
    expect(kanaStateFrom([r("know", "d1"), r("know", "d2")], "d2")).toMatchObject({ stage: "learning", days: 0 });
  });

  it("答题写 FSRS 和流水，重放后状态不变", () => {
    const first = KANA[0][0];
    const result = recordKanaAnswer(first, true);
    expect(result.states[first]).toMatchObject({ stage: "learning", todayCorrect: 1 });
    expect(Number(testDb.exec("SELECT COUNT(*) FROM kana_reviews")[0].values[0][0])).toBe(1);
    expect(Number(testDb.exec("SELECT fsrs_stability FROM kana_memory WHERE symbol=?", [first])[0].values[0][0])).toBeGreaterThan(0);
    expect(recordKanaAnswer(first, true).progress[first]).toBe(1);
    testDb.run("UPDATE kana_memory SET correct_streak=0, fsrs_stability=NULL WHERE symbol=?", [first]);
    replayKanaReviews();
    expect(getKanaProgress()[first]).toBe(1);
    expect(Number(testDb.exec("SELECT correct_streak FROM kana_memory WHERE symbol=?", [first])[0].values[0][0])).toBe(1);
    expect(Number(testDb.exec("SELECT fsrs_stability FROM kana_memory WHERE symbol=?", [first])[0].values[0][0])).toBeGreaterThan(0);
  });

  it("没完成五十音时新词为 0；第三天全部过关时从当天启动原定额度", () => {
    testDb.run("DELETE FROM kana_reviews");
    setState("kana_completed", "0");
    deferWordPlanUntilKanaComplete(23);
    expect(getDailyWordGoal()).toBe(0);
    const dayAgo = (n: number) => today(new Date(Date.now() - n * 86_400_000));
    let at = 1;
    const add = (symbol: string, day: string) => testDb.run("INSERT INTO kana_reviews (symbol,answer,reviewed_on,reviewed_at) VALUES (?, 'know', ?, ?)", [symbol, day, at++]);
    for (const [symbol] of KANA) {
      add(symbol, dayAgo(2)); add(symbol, dayAgo(2)); add(symbol, dayAgo(1));
      if (symbol !== KANA[0][0]) add(symbol, dayAgo(0));
    }
    // 两天都过关了也还没完成：门槛要三个不同的日子
    expect(kanaComplete()).toBe(false);
    const done = recordKanaAnswer(KANA[0][0], true);
    expect(done.completed).toBe(true);
    expect(kanaComplete()).toBe(true);
    expect(getDailyWordGoal()).toBe(23);
    expect(getStudyPreferences().dailyGoal).toBe(23);
    const now = new Date();
    const calendarToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    expect(getState("jlpt_plan_started_on", "")).toBe(calendarToday);
    expect(getStudyPreferences().jlptPlanStartedOn).toBe(calendarToday);
  });

  it("老口径下已经学完的人不被新口径翻回未完成", () => {
    testDb.run("DELETE FROM kana_reviews");
    setState("kana_completed", "1");
    expect(kanaComplete()).toBe(true);
    replayKanaReviews();
    expect(getState("kana_completed", "")).toBe("1");
  });

  it("另一台设备合并凑齐三天后恢复原定新词量，起点记在第三天", () => {
    setState("type_familiarity", JSON.stringify({ words: 0, grammar: 0, kanji: 0, confusion: 0 }));
    setState("jlpt_plan_target", "N5");
    setState("jlpt_plan_started_on", "2026-09-01");
    setState("kana_completed", "0");
    setState("level_plan_quotas", JSON.stringify({ dailyGoal: 0 }));
    testDb.run("DELETE FROM kana_reviews");
    testDb.run("UPDATE kana_memory SET correct_streak=0");
    let at = new Date("2026-09-18T12:00:00").getTime();
    for (const [symbol] of KANA) {
      for (const day of ["2026-09-18", "2026-09-18", "2026-09-19", "2026-09-20"]) {
        testDb.run("INSERT INTO kana_reviews (symbol,answer,reviewed_on,reviewed_at) VALUES (?, 'know', ?, ?)", [symbol, day, at]);
        at += 1000;
      }
    }
    replayKanaReviews();
    hydrateLevelPlanPreferences();
    expect(getDailyWordGoal()).toBe(23);
    expect(getState("jlpt_plan_started_on", "")).toBe("2026-09-20");
    expect(getStudyPreferences().jlptPlanStartedOn).toBe("2026-09-20");
  });
});
