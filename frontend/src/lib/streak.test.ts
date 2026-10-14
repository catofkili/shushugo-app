import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import initSqlJs, { type Database } from "sql.js";

let db: Database;
const TODAY = "2026-10-14";
vi.mock("./database", () => ({ getDatabase: () => db }));
import { dayStatusesBetween, isStreakMilestone, readDayStatuses, repairableStreakDays, STREAK_MILESTONES, streakSnapshot, streakTier, summarizeStreak, todayStreakStatus, type DayStatus } from "./streak";
import { shiftDay } from "./zoo-streak";

const statuses = (...days: string[]) => new Map<string, DayStatus>(days.map((day) => [day, "lit"]));
const summary = (days: Map<string, DayStatus>, hour = 12) => summarizeStreak(days, TODAY, hour, 19, 299);
const answer = (table: string, n: number, day = TODAY, column = "reviewed_on") => {
  for (let i = 0; i < n; i++) db.run(`INSERT INTO ${table} (${column}) VALUES (?)`, [day]);
};
const checkin = (day = TODAY) => db.run("INSERT INTO checkins VALUES (?)", [day]);
const time = (seconds: number, day = TODAY) => db.run("INSERT INTO word_study_time VALUES (?, ?)", [day, seconds]);

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 14, 12));
  const SQL = await initSqlJs();
  db = new SQL.Database();
  db.run(`CREATE TABLE checkins (checked_on TEXT PRIMARY KEY);
    CREATE TABLE yuzu_ledger (kind TEXT, key TEXT);
    CREATE TABLE reviews (reviewed_on TEXT);
    CREATE TABLE grammar_reviews (reviewed_on TEXT);
    CREATE TABLE kanji_unit_reviews (reviewed_on TEXT);
    CREATE TABLE word_study_time (studied_on TEXT, seconds INTEGER);`);
});
afterEach(() => { db.close(); vi.useRealTimers(); });

describe("每日火苗判据", () => {
  it("清完计划为 gold，没有活动的日期为 none", () => {
    checkin();
    expect(readDayStatuses().get(TODAY)).toBe("gold");
    expect(dayStatusesBetween("2026-10-13", TODAY)).toEqual({ "2026-10-13": "none", [TODAY]: "gold" });
  });
  it("花柚子补签为 repaired，即使作答达标也不是 gold", () => {
    checkin(); answer("reviews", 20);
    db.run("INSERT INTO yuzu_ledger VALUES ('repair', ?)", [TODAY]);
    expect(readDayStatuses().get(TODAY)).toBe("repaired");
  });
  it("补签卡也为 repaired；没有 checkin 的账本行不点亮", () => {
    checkin();
    db.run("INSERT INTO yuzu_ledger VALUES ('repair_card', ?), ('repair', '2026-10-13')", [TODAY]);
    expect(readDayStatuses()).toEqual(new Map([[TODAY, "repaired"]]));
  });
  it("19 次不亮，20 次点亮", () => {
    answer("reviews", 19);
    expect(readDayStatuses().has(TODAY)).toBe(false);
    answer("reviews", 1);
    expect(readDayStatuses().get(TODAY)).toBe("lit");
  });
  it("299 秒不亮，300 秒点亮", () => {
    time(299);
    expect(readDayStatuses().has(TODAY)).toBe(false);
    db.run("UPDATE word_study_time SET seconds = 300");
    expect(readDayStatuses().get(TODAY)).toBe("lit");
  });
  it("单词、语法、汉字作答按天相加，不跨天凑数", () => {
    answer("reviews", 7); answer("grammar_reviews", 6); answer("kanji_unit_reviews", 7);
    answer("reviews", 19, "2026-10-13");
    expect(readDayStatuses()).toEqual(new Map([[TODAY, "lit"]]));
  });
  it("存在时计入拼写和 JLPT 作答", () => {
    db.run("CREATE TABLE spelling_reviews (reviewed_on TEXT); CREATE TABLE jlpt_answers (answered_on TEXT)");
    answer("spelling_reviews", 9); answer("jlpt_answers", 11, TODAY, "answered_on");
    expect(readDayStatuses().get(TODAY)).toBe("lit");
  });
  it("spelling / JLPT 表都不存在也不抛错", () => {
    expect(() => readDayStatuses()).not.toThrow();
    expect(streakSnapshot().todayStatus).toBe("none");
  });
  it("只有一个实验表时仍正确计算", () => {
    db.run("CREATE TABLE jlpt_answers (answered_on TEXT)");
    answer("jlpt_answers", 20, TODAY, "answered_on");
    expect(streakSnapshot().todayAnswers).toBe(20);
  });
  it("snapshot 汇总当天作答和秒数，凌晨三点仍属前一学习日", () => {
    answer("reviews", 20, "2026-10-13"); time(301, "2026-10-13");
    expect(streakSnapshot(new Date(2026, 9, 14, 3))).toMatchObject({ today: "2026-10-13", todayStatus: "lit", todayAnswers: 20, todaySeconds: 301 });
    expect(streakSnapshot(new Date(2026, 9, 14, 4))).toMatchObject({ today: TODAY, todayStatus: "none", todayAnswers: 0, todaySeconds: 0 });
  });
});

describe("todayStreakStatus 只查今天，判据和全表扫描对拍", () => {
  const both = () => [todayStreakStatus(), readDayStatuses().get(TODAY) ?? "none"];
  it("none / 作答 / 秒数 / 金 / 补签 五种情况两边一致", () => {
    expect(both()).toEqual(["none", "none"]);
    answer("reviews", 10); answer("grammar_reviews", 9);
    expect(both()).toEqual(["none", "none"]);
    answer("kanji_unit_reviews", 1);
    expect(both()).toEqual(["lit", "lit"]);
    db.run("DELETE FROM reviews; DELETE FROM grammar_reviews; DELETE FROM kanji_unit_reviews");
    time(300);
    expect(both()).toEqual(["lit", "lit"]);
    checkin();
    expect(both()).toEqual(["gold", "gold"]);
    db.run("INSERT INTO yuzu_ledger VALUES ('repair', ?)", [TODAY]);
    expect(both()).toEqual(["repaired", "repaired"]);
  });
});

describe("连胜统计", () => {
  it("今天没亮从昨天数，今天亮后加一天", () => {
    const days = statuses("2026-10-12", "2026-10-13");
    expect(summary(days).streak).toBe(2);
    days.set(TODAY, "repaired");
    expect(summary(days).streak).toBe(3);
  });
  it("昨天断一天归零，none 不计入亮的天数", () => {
    const days = statuses("2026-10-12"); days.set("2026-10-13", "none");
    expect(summary(days)).toMatchObject({ streak: 0, litDays: 1, tier: 0 });
  });
  it("最长取历史最长的一段，包含金和补签", () => {
    const days = statuses("2026-10-01", "2026-10-02", "2026-10-03", TODAY);
    days.set("2026-10-04", "gold"); days.set("2026-10-05", "repaired");
    expect(summary(days)).toMatchObject({ longest: 5, streak: 1, litDays: 6 });
  });
  it("19 点不处于 atRisk", () => {
    expect(summary(statuses("2026-10-13"), 19).atRisk).toBe(false);
  });
  it("20 点处于 atRisk", () => {
    expect(summary(statuses("2026-10-13"), 20).atRisk).toBe(true);
  });
  it("凌晨 3 点处于 atRisk，4 点不处于 atRisk", () => {
    expect(summary(statuses("2026-10-13"), 3).atRisk).toBe(true);
    expect(summary(statuses("2026-10-13"), 4).atRisk).toBe(false);
  });
  it("今天已亮或连胜为零时不处于 atRisk", () => {
    expect(summary(statuses(TODAY), 20).atRisk).toBe(false);
    expect(summary(statuses("2026-10-12"), 20).atRisk).toBe(false);
  });
  it("streakTier 每个边界", () => {
    for (const [n, tier] of [[0, 0], [1, 1], [6, 1], [7, 2], [29, 2], [30, 3], [99, 3], [100, 4], [364, 4], [365, 5], [1000, 5]]) {
      expect(streakTier(n)).toBe(tier);
    }
  });
  it("只有规格里程碑匹配，下一个取严格大于连胜的节点", () => {
    STREAK_MILESTONES.forEach((n) => expect(isStreakMilestone(n)).toBe(true));
    [0, 1, 6, 8, 21, 1001].forEach((n) => expect(isStreakMilestone(n)).toBe(false));
    const days = statuses(...Array.from({ length: 7 }, (_, i) => shiftDay(TODAY, -i)));
    expect(summary(days).nextMilestone).toBe(14);
    expect(summary(statuses()).nextMilestone).toBe(7);
    expect(summary(statuses(...Array.from({ length: 1000 }, (_, i) => shiftDay(TODAY, -i)))).nextMilestone).toBeNull();
  });
  it("everLitBefore 区分第一天和重新点燃，不数今天及未来", () => {
    expect(summary(statuses(TODAY)).everLitBefore).toBe(0);
    expect(summary(statuses("2026-10-01", "2026-10-02", "2026-10-03", TODAY, "2026-10-15"))).toMatchObject({ everLitBefore: 3, litDays: 4, streak: 1, todayAnswers: 19, todaySeconds: 299 });
  });
  it("月历含 none，跨月运算不依赖本地时区，反向范围为空", () => {
    checkin("2026-09-30"); time(300, "2026-10-01");
    expect(dayStatusesBetween("2026-09-30", "2026-10-02")).toEqual({ "2026-09-30": "gold", "2026-10-01": "lit", "2026-10-02": "none" });
    expect(dayStatusesBetween(TODAY, "2026-10-01")).toEqual({});
  });
  it("补签窗口包含第七天，排除今天、已亮天和首次点亮之前", () => {
    time(300, "2026-10-06"); answer("grammar_reviews", 20, "2026-10-12"); checkin("2026-10-13");
    expect(repairableStreakDays()).toEqual(["2026-10-11", "2026-10-10", "2026-10-09", "2026-10-08", "2026-10-07"]);
    db.run("DELETE FROM word_study_time");
    expect(repairableStreakDays()).toEqual([]);
  });
  it("从未亮过没有可补的日子", () => {
    expect(repairableStreakDays()).toEqual([]);
  });
});
