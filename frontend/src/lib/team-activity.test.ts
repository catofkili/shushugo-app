import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import initSqlJs, { type Database } from "sql.js";
import type { CloudSession, CloudTeam, CloudTeamRewards } from "./sync-api";

let db: Database;
let SQL: Awaited<ReturnType<typeof initSqlJs>>;
let day = "2026-10-26";
let session: CloudSession;
let owner: string | undefined;
const report = vi.fn();
const rewards = vi.fn();
vi.mock("./database", () => ({ getDatabase: () => db }));
vi.mock("./storage", () => ({ scheduleSave: () => undefined, requestFullSnapshot: () => undefined }));
vi.mock("./database/db-utils", async (importOriginal) => ({ ...(await importOriginal<typeof import("./database/db-utils")>()), today: () => day, persistSoon: () => undefined }));
vi.mock("./sync-api", () => ({
  getCloudSession: async () => session, getLocalSyncOwnerEmail: async () => owner,
  reportCloudTeamActivity: (...args: unknown[]) => report(...args), getCloudTeamRewards: () => rewards()
}));

import { claimTeamCheckin, collectTeamRewards, localActivity, readTeamCache, rememberTeamActivity, reportTeamActivity, teamCheckedIn, writeTeamCache } from "./team-activity";
import { yuzuBalance } from "./yuzu";

const team = { id: "team-1", members: [] } as unknown as CloudTeam;
const seedWords = (count: number) => {
  for (let i = 0; i < count; i++) db.run("INSERT INTO reviews (word_id, reviewed_on, direction) VALUES (?, ?, 'forward')", [i + 1, day]);
};
const seconds = (value: number) => db.run("INSERT OR REPLACE INTO word_study_time VALUES (?, ?)", [day, value]);

beforeEach(async () => {
  SQL = SQL ?? await initSqlJs();
  db = new SQL.Database();
  db.run("CREATE TABLE reviews (word_id INTEGER, reviewed_on TEXT, direction TEXT); CREATE TABLE grammar_reviews (reviewed_on TEXT); CREATE TABLE kanji_unit_reviews (reviewed_on TEXT); CREATE TABLE checkins (checked_on TEXT); CREATE TABLE word_study_time (studied_on TEXT PRIMARY KEY, seconds INTEGER); CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE yuzu_ledger (kind TEXT, key TEXT, amount INTEGER, day TEXT, PRIMARY KEY(kind, key));");
  db.run("INSERT INTO app_state VALUES ('yuzu_scale_10', '1')");
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-26T12:00:00+08:00"));
  day = "2026-10-26";
  session = { configured: true, email: "a@example.test", token: "token-a" };
  owner = undefined;
  report.mockReset().mockResolvedValue(team);
  rewards.mockReset().mockResolvedValue({ periods: [], wins: [] });
  writeTeamCache(session.email, team, []);
});
afterEach(() => { db.close(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("team activity and local rewards", () => {
  it("counts distinct words across directions and floors stored active seconds", () => {
    seedWords(30);
    db.run("INSERT INTO reviews VALUES (1, ?, 'reverse'), (1, ?, 'kanji'), (99, '2026-10-25', 'forward')", [day, day]);
    db.run("INSERT INTO grammar_reviews VALUES (?);", [day]);
    db.run("INSERT INTO kanji_unit_reviews VALUES (?);", [day]);
    seconds(659);
    expect(localActivity()).toEqual({ studyDay: day, wordCount: 30, activeMinutes: 10, studyCount: 34, completed: false });
  });
  it("skips signed-out and uncached non-members without a cloud request", async () => {
    session.token = undefined;
    await reportTeamActivity();
    session.token = "token-a";
    writeTeamCache(session.email, null, []);
    await reportTeamActivity();
    expect(report).not.toHaveBeenCalled();
  });
  it("does not use another account's membership cache or learning database", async () => {
    session.email = "b@example.test";
    expect(readTeamCache(session.email)).toBeNull();
    await reportTeamActivity();
    writeTeamCache(session.email, team, []);
    owner = "a@example.test";
    await reportTeamActivity();
    expect(report).not.toHaveBeenCalled();
  });
  it("suppresses unchanged activity for five minutes, then reports again", async () => {
    await reportTeamActivity();
    await reportTeamActivity();
    expect(report).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5 * 60_000);
    await reportTeamActivity();
    expect(report).toHaveBeenCalledTimes(2);
  });
  it("reports changed values within the five-minute interval", async () => {
    await reportTeamActivity();
    seedWords(1);
    await reportTeamActivity();
    seconds(60);
    await reportTeamActivity();
    expect(report).toHaveBeenCalledTimes(3);
  });
  it("does not throttle the next learning day", async () => {
    await reportTeamActivity();
    day = "2026-10-27";
    await reportTeamActivity();
    expect(report).toHaveBeenCalledTimes(2);
  });
  it("coalesces concurrent flushes and silently handles a failed report", async () => {
    report.mockRejectedValueOnce(new Error("offline"));
    await expect(Promise.all([reportTeamActivity(), reportTeamActivity()])).resolves.toEqual([undefined, undefined]);
    expect(report).toHaveBeenCalledTimes(1);
    await reportTeamActivity();
    expect(report).toHaveBeenCalledTimes(2);
  });
  it("remembers the team-page overview's report to suppress an immediate duplicate", async () => {
    rememberTeamActivity(session.email, localActivity());
    await reportTeamActivity();
    expect(report).not.toHaveBeenCalled();
  });
  it("drains a changed completion flush that arrives during the in-flight report", async () => {
    let finish!: () => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    report.mockImplementationOnce(() => new Promise<CloudTeam>((resolve) => { finish = () => resolve(team); started(); }));
    const first = reportTeamActivity();
    await ready;
    seedWords(30); seconds(600);
    const completion = reportTeamActivity();
    finish();
    await Promise.all([first, completion]);
    expect(report).toHaveBeenCalledTimes(2);
    expect(report.mock.calls[1][0]).toMatchObject({ wordCount: 30, activeMinutes: 10 });
  });
  it("an in-flight response cannot restore a membership cleared by leaving", async () => {
    report.mockImplementationOnce(async () => { writeTeamCache(session.email, null, []); return team; });
    await reportTeamActivity();
    expect(readTeamCache(session.email)?.team).toBeNull();
  });
  it("allows the daily check-in only for a member with both local thresholds", async () => {
    seedWords(29); seconds(600);
    expect(await claimTeamCheckin()).toBe(false);
    seedWords(1); // This is the same word; distinct counting must still fail.
    expect(await claimTeamCheckin()).toBe(false);
    db.run("INSERT INTO reviews VALUES (30, ?, 'reverse')", [day]);
    seconds(599);
    expect(await claimTeamCheckin()).toBe(false);
    seconds(600);
    expect(await claimTeamCheckin()).toBe(true);
    expect(teamCheckedIn()).toBe(true);
    expect(await claimTeamCheckin()).toBe(false);
    expect(yuzuBalance()).toBe(20);
  });
  it("a former member cannot check in even after passing locally", async () => {
    seedWords(30); seconds(600);
    writeTeamCache(session.email, null, []);
    expect(await claimTeamCheckin()).toBe(false);
    expect(yuzuBalance()).toBe(0);
  });
  it("collects each settled period and ISO first win once", async () => {
    const response: CloudTeamRewards = { periods: [{ team_id: "team-1", period_start: "2026-10-10", amount: 700 }, { team_id: "team-2", period_start: "2026-10-10", amount: 650 }], wins: [{ iso_week: "2026-W44", duel_id: "duel-1" }] };
    rewards.mockResolvedValue(response);
    expect(await collectTeamRewards()).toBe(1500);
    expect(await collectTeamRewards()).toBe(0);
    expect(yuzuBalance()).toBe(1500);
  });
  it("discards a reward response if the account changes while fetching", async () => {
    rewards.mockImplementationOnce(async () => { session = { ...session, email: "b@example.test", token: "token-b" }; return { periods: [{ team_id: "team-1", period_start: day, amount: 1400 }], wins: [] }; });
    expect(await collectTeamRewards()).toBe(0);
    expect(yuzuBalance()).toBe(0);
  });
});
