import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import initSqlJs, { type Database } from "sql.js";

let db: Database;
let SQL: Awaited<ReturnType<typeof initSqlJs>>;
let now: number;
vi.mock("./database", () => ({ getDatabase: () => db }));
vi.mock("./database/db-utils", async (original) => ({
  ...(await original<typeof import("./database/db-utils")>()), persistSoon: () => undefined
}));

import {
  continueStudyFocus, enterStudyFocus, getStudyFocusSnapshot, leaveStudyFocus,
  recordStudyFocusAnswer, recordStudyFocusTime, startStudyFocus, stopStudyFocus,
  STUDY_FOCUS_PARTIAL_KEY, STUDY_FOCUS_REWARDS, STUDY_FOCUS_WINDOW_MS, summarizeStudyFocus, undoStudyFocusAnswer
} from "./study-focus";
import { LOCAL_SCHEMA_SQL } from "./database/schema";
import { rowsFor } from "./database/db-utils";
import { claimStudyFocusYuzu, yuzuBalance } from "./yuzu";
import { DEVICE_LOCAL_STATE_KEYS, SYNCED_TABLES } from "./sync/tables";
import { accrueStudyTime, createStudyClock, noteStudyInteraction } from "./study-clock";

const advance = (ms: number) => {
  now += ms;
  vi.setSystemTime(now);
  return recordStudyFocusTime(ms, now);
};
const answer = (id: number, rating: "know" | "fuzzy" | "forgot" | "known_forever" = "know") => recordStudyFocusAnswer(id, rating, now);
const complete = () => advance(STUDY_FOCUS_WINDOW_MS);

beforeAll(async () => { SQL = await initSqlJs(); });
beforeEach(() => {
  vi.useFakeTimers();
  now = new Date("2026-09-28T12:00:00").getTime();
  vi.setSystemTime(now);
  db = new SQL.Database();
  db.run("CREATE TABLE app_state(key TEXT PRIMARY KEY, value TEXT)");
  for (const statement of LOCAL_SCHEMA_SQL.split(";")) {
    if (/CREATE TABLE IF NOT EXISTS (yuzu_ledger|study_focus_windows)\b/.test(statement)) db.run(statement);
  }
  db.run("INSERT INTO app_state VALUES('yuzu_scale_10', '1')");
  enterStudyFocus("word", now);
});
afterEach(() => { db.close(); vi.useRealTimers(); });

describe("独立十分钟记录与可选倒计时", () => {
  it("未开启倒计时也留完整窗口；重复词按最后自评去重", () => {
    answer(1, "forgot"); answer(1, "know"); answer(2, "fuzzy"); answer(3, "forgot"); answer(4, "known_forever");
    expect(complete().status).toBe("off");
    expect(rowsFor("SELECT kind, words, remembered, fuzzy, forgotten FROM study_focus_windows"))
      .toEqual([{ kind: "baseline", words: 4, remembered: 2, fuzzy: 1, forgotten: 1 }]);
    expect(yuzuBalance()).toBe(0);
  });

  it("Start 不重置已有观测；对比只用开始前完成的同入口窗口", () => {
    answer(1); answer(2); complete(); // prior baseline remembers 2
    answer(10); advance(300_000); // independent baseline is halfway through
    startStudyFocus(now);
    answer(20); answer(21); answer(22); answer(23, "forgot");
    const snapshot = complete();
    expect(rowsFor("SELECT COUNT(*) AS n FROM study_focus_windows WHERE kind='baseline'")[0].n).toBe(2);
    expect(snapshot.status).toBe("break");
    expect(snapshot.remainingSeconds).toBe(0);
    expect(snapshot.summary).toMatchObject({ words: 4, remembered: 3, forgotten: 1, rememberedRate: 75,
      baselineWindows: 1, baselineRemembered: 2, rememberedDelta: 1, efficiencyChangePercent: 50 });
    expect(yuzuBalance()).toBe(0);
  });

  it("休息时间、休息页点击与倒计时终点后的余量都不记学习", () => {
    startStudyFocus(now); answer(1);
    advance(599_500);
    expect(advance(5_000).status).toBe("break");
    const before = rowsFor("SELECT value FROM app_state WHERE key = ?", [STUDY_FOCUS_PARTIAL_KEY]);
    advance(300_000); answer(2);
    expect(rowsFor("SELECT value FROM app_state WHERE key = ?", [STUDY_FOCUS_PARTIAL_KEY])).toEqual(before);
    expect(getStudyFocusSnapshot(now).summary?.words).toBe(1);
    expect(continueStudyFocus(now)).toBe(100);
    expect(getStudyFocusSnapshot(now).remainingSeconds).toBe(600);
    expect(continueStudyFocus(now)).toBe(0);
  });

  it("只有继续发奖；停止、回主页和未完成退出都作废待领奖励", () => {
    startStudyFocus(now); answer(1); advance(599_999); leaveStudyFocus();
    expect(continueStudyFocus(now)).toBe(0);
    enterStudyFocus("word", now); startStudyFocus(now); answer(2); complete(); stopStudyFocus(now);
    expect(continueStudyFocus(now)).toBe(0);
    startStudyFocus(now); answer(3); complete(); leaveStudyFocus();
    expect(continueStudyFocus(now)).toBe(0);
    expect(yuzuBalance()).toBe(0);
    enterStudyFocus("word", now);
    expect(getStudyFocusSnapshot(now)).toMatchObject({ status: "off", remainingSeconds: 600, nextReward: 100 });
  });

  it("数据库重载只恢复观测的未满窗口，不恢复倒计时或奖励入口", () => {
    answer(1, "forgot"); advance(240_000); startStudyFocus(now); answer(2); advance(120_000);
    const bytes = db.export(); db.close(); db = new SQL.Database(bytes);
    enterStudyFocus("word", now);
    expect(getStudyFocusSnapshot(now).status).toBe("off");
    expect(continueStudyFocus(now)).toBe(0);
    advance(240_000);
    expect(rowsFor("SELECT kind, words, remembered, forgotten FROM study_focus_windows"))
      .toEqual([{ kind: "baseline", words: 2, remembered: 1, forgotten: 1 }]);
  });

  it("换学习入口作废倒计时，基线按入口分开，回主页后时间不累计", () => {
    answer(1); complete(); startStudyFocus(now); advance(300_000);
    enterStudyFocus("quick-study", now);
    expect(getStudyFocusSnapshot(now).status).toBe("off");
    startStudyFocus(now); answer(1); complete();
    expect(getStudyFocusSnapshot(now).summary?.baselineWindows).toBe(0);
    leaveStudyFocus(); advance(600_000);
    expect(rowsFor("SELECT COUNT(*) AS n FROM study_focus_windows")[0].n).toBe(3);
  });

  it("只吃已有 study-clock 的有效时间，隐藏和超过 60 秒无操作不补算", () => {
    startStudyFocus(now);
    let clock = createStudyClock(now);
    now += 300_000;
    clock = accrueStudyTime(clock, now, { visible: true });
    recordStudyFocusTime(clock.pendingMs, now);
    expect(getStudyFocusSnapshot(now).remainingSeconds).toBe(540);
    clock = { ...clock, pendingMs: 0 };
    now += 300_000;
    clock = noteStudyInteraction(clock, now, { visible: false });
    recordStudyFocusTime(clock.pendingMs, now);
    expect(getStudyFocusSnapshot(now).remainingSeconds).toBe(540);
    now += 1000;
    clock = accrueStudyTime(clock, now, { visible: true });
    recordStudyFocusTime(clock.pendingMs, now);
    expect(getStudyFocusSnapshot(now).remainingSeconds).toBe(539);
  });

  it("没有历史或零基线都不给虚假百分比，表现下降保留负数", () => {
    const counts = { words: 2, remembered: 0, fuzzy: 0, forgotten: 2 };
    expect(summarizeStudyFocus({}, [])).toMatchObject({ rememberedRate: null, baselineRemembered: null, efficiencyChangePercent: null });
    expect(summarizeStudyFocus({ 1: "know" }, [counts])).toMatchObject({ rememberedDelta: 1, efficiencyChangePercent: null });
    expect(summarizeStudyFocus({ 1: "know" }, [{ ...counts, remembered: 2 }])).toMatchObject({ rememberedDelta: -1, efficiencyChangePercent: -50 });
  });

  it("撤销恢复同词上次自评，跨窗口不会删掉旧窗口的词", () => {
    answer(1, "forgot"); advance(300_000); startStudyFocus(now);
    answer(1, "know"); undoStudyFocusAnswer(1, now);
    answer(2, "fuzzy"); answer(2, "know"); undoStudyFocusAnswer(2, now);
    advance(300_000); // baseline completed, focus still halfway
    answer(2, "know"); undoStudyFocusAnswer(2, now);
    advance(300_000);
    expect(getStudyFocusSnapshot(now).summary).toMatchObject({ words: 1, fuzzy: 1, remembered: 0 });
    expect(rowsFor("SELECT words, forgotten, fuzzy FROM study_focus_windows WHERE kind='baseline'"))
      .toEqual([{ words: 2, forgotten: 1, fuzzy: 1 }]);
  });
});

describe("倒计时的递减奖励", () => {
  it("九档合计 222，第十段为 0；重进页面也不会重拿第一档，重复领同一段无效", () => {
    const earned: number[] = [];
    for (let index = 0; index < 10; index++) {
      enterStudyFocus("word", now); startStudyFocus(now); answer(1, index % 2 ? "forgot" : "know");
      complete(); earned.push(continueStudyFocus(now)); leaveStudyFocus();
    }
    expect(earned).toEqual([...STUDY_FOCUS_REWARDS, 0]);
    expect(yuzuBalance()).toBe(222);
    expect(rowsFor("SELECT key FROM yuzu_ledger WHERE kind='focus' ORDER BY key").map((row) => row.key))
      .toEqual(Array.from({ length: 9 }, (_, index) => `2026-09-28:${index + 1}`));
    const firstId = String(rowsFor("SELECT key FROM yuzu_ledger WHERE kind='focus_claim' LIMIT 1")[0].key);
    expect(claimStudyFocusYuzu(firstId)).toBe(0);
    expect(claimStudyFocusYuzu("not-a-completed-window")).toBe(0);
    expect(yuzuBalance()).toBe(222);
  });

  it("跨凌晨四点才重置档位，休息后才点击也归属于完成窗口的学习日", () => {
    now = new Date("2026-09-29T03:40:00").getTime(); vi.setSystemTime(now);
    startStudyFocus(now); answer(1); complete(); // 03:50 belongs to Sep 28
    now = new Date("2026-09-29T04:01:00").getTime(); vi.setSystemTime(now);
    expect(continueStudyFocus(now)).toBe(100);
    answer(1); complete(); expect(continueStudyFocus(now)).toBe(100);
    expect(rowsFor("SELECT key FROM yuzu_ledger WHERE kind='focus' ORDER BY key"))
      .toEqual([{ key: "2026-09-28:1" }, { key: "2026-09-29:1" }]);
  });

  it("历史表同步取并集，设备自己的未满窗口不会进入账号同步", () => {
    expect(SYNCED_TABLES.find((entry) => entry.table === "study_focus_windows"))
      .toEqual({ table: "study_focus_windows", keys: ["id"], strategy: "union" });
    expect(DEVICE_LOCAL_STATE_KEYS.has(STUDY_FOCUS_PARTIAL_KEY)).toBe(true);
  });
});
