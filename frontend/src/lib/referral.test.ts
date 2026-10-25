import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import initSqlJs, { type Database } from "sql.js";
import type { CloudSession } from "./sync-api";
import type { Referral } from "./referral";
let db: Database;
let SQL: Awaited<ReturnType<typeof initSqlJs>>;
let session: CloudSession;
let owner: string | undefined;
const request = vi.fn();
vi.mock("./database", () => ({ getDatabase: () => db }));
vi.mock("./storage", () => ({ scheduleSave: () => undefined, requestFullSnapshot: () => undefined }));
vi.mock("./database/db-utils", async (original) => ({ ...(await original<typeof import("./database/db-utils")>()), today: () => "2026-10-26", persistSoon: () => undefined }));
vi.mock("./sync/schema", () => ({ getDeviceId: () => "local-device" }));
vi.mock("./sync-api", () => ({ getCloudSession: async () => session, getLocalSyncOwnerEmail: async () => owner, teamRequest: (...args: unknown[]) => request(...args) }));
import { claimReferral, fetchReferral, normalReferralEarnings, referralBannerVisible, syncReferral } from "./referral";
import { bookReferralReward, buyItem, equippedItem, ownsItem, yuzuBalance } from "./yuzu";
const me = (patch: Partial<Referral> = {}): Referral => ({ code: "ABC23456", invitedCount: 1, qualifiedCount: 0, inviterEarned: 50, inviterCap: 10000, setUnlocked: false, canClaim: false, claim: { claimedDay: "2026-10-01", windowEndDay: "2026-10-30", setUnlocked: false }, rewards: [], ...patch });
const seed = (kind: string, key: string, amount: number, day = "2026-10-26") => db.run("INSERT INTO yuzu_ledger VALUES (?, ?, ?, ?)", [kind, key, amount, day]);
const ledger = (kind: string) => db.exec("SELECT key, amount FROM yuzu_ledger WHERE kind = ? ORDER BY key", [kind])[0]?.values ?? [];
beforeEach(async () => {
 SQL ??= await initSqlJs(); db = new SQL.Database();
 db.run("CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT); INSERT INTO app_state VALUES ('yuzu_scale_10', '1'); CREATE TABLE yuzu_ledger (kind TEXT, key TEXT, amount INTEGER, day TEXT, PRIMARY KEY(kind,key)); CREATE TABLE reviews (reviewed_on TEXT); CREATE TABLE word_study_time (studied_on TEXT, seconds INTEGER)");
 session = { configured: true, email: "a@example.test", token: "session-a" }; owner = undefined;
 request.mockReset().mockImplementation(async (path: string) => path.startsWith("/api/referral/me") ? me() : { accepted: 0, setUnlocked: false });
 const storage = new Map<string, string>();
 vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
 vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-26T12:00:00Z"));
});
afterEach(() => { db.close(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("referral", () => {
 it("whitelists only positive study, plan, streak, encore and focus", () => {
  for (const kind of ["study", "plan", "streak", "encore", "focus", "achievement", "team_checkin", "team_period", "duel_win", "buy", "card_overflow", "referral_invitee", "referral_inviter", "unknown"]) seed(kind, "key", 50);
  seed("focus", "zero", 0); seed("focus", "negative", -10);
  expect(normalReferralEarnings(me().claim!).map((r) => r.kind).sort()).toEqual(["encore", "focus", "plan", "streak", "study"]);
 });
 it("includes both window bounds and excludes adjacent days", async () => {
  seed("study", "before", 50, "2026-09-30"); seed("study", "first", 50, "2026-10-01"); seed("study", "last", 50, "2026-10-30"); seed("study", "after", 50, "2026-10-31");
  await syncReferral(); expect(ledger("referral_invitee")).toEqual([["study:first", 50], ["study:last", 50]]);
  expect(request.mock.calls[1][2].rows.map((r: { key: string }) => r.key)).toEqual(["first", "last"]);
 });
 it("books invitee bonuses idempotently using original kind:key", async () => {
  seed("study", "same", 50); seed("plan", "same", 50);
  await syncReferral(); vi.advanceTimersByTime(600_000); await syncReferral();
  expect(ledger("referral_invitee")).toEqual([["plan:same", 50], ["study:same", 50]]); expect(yuzuBalance()).toBe(200);
 });
 it("books inviter rewards idempotently using the server id", async () => {
  request.mockResolvedValue(me({ claim: null, rewards: [{ id: 42, amount: 75 }] }));
  await syncReferral(); vi.advanceTimersByTime(600_000); await syncReferral(); expect(ledger("referral_inviter")).toEqual([["42", 75]]);
 });
 it("grants both set items with zero buy rows without equipping", async () => {
  request.mockResolvedValue(me({ claim: null, setUnlocked: true }));
  await syncReferral(); vi.advanceTimersByTime(600_000); await syncReferral();
  expect(ledger("buy")).toEqual([["theme-dusk", 0], ["title-yuyou", 0]]);
  expect(ownsItem("theme-dusk")).toBe(true); expect(ownsItem("title-yuyou")).toBe(true);
  expect(equippedItem("theme")).toBe(""); expect(equippedItem("title")).toBe(""); expect(yuzuBalance()).toBe(0);
 });
 it("grants the set from an earnings response too", async () => {
  request.mockImplementation(async (path: string) => path.startsWith("/api/referral/me") ? me() : { accepted: 0, setUnlocked: true });
  await syncReferral(); expect(ownsItem("theme-dusk")).toBe(true); expect(ownsItem("title-yuyou")).toBe(true);
 });
 it("buyItem refuses invite items even with sufficient funds", () => {
  seed("study", "funds", 10000); expect(buyItem("theme-dusk")).toBe(false); expect(buyItem("title-yuyou")).toBe(false);
  expect(ledger("buy")).toEqual([]); expect(yuzuBalance()).toBe(10000);
 });
 it("drops responses on account or token switch", async () => {
  request.mockImplementationOnce(async () => { session = { ...session, token: "other-session" }; return me({ setUnlocked: true, rewards: [{ id: 1, amount: 200 }] }); });
  await syncReferral(); expect(ledger("buy")).toEqual([]); expect(ledger("referral_inviter")).toEqual([]);
  request.mockImplementationOnce(async () => { session = { ...session, email: "b@example.test" }; return me(); }); expect(await fetchReferral()).toBeNull();
 });
 it("drops responses when the database changes", async () => {
  const replacement = new SQL.Database();
  request.mockImplementationOnce(async () => { const old = db; db = replacement; old.close(); return me({ setUnlocked: true }); }); expect(await fetchReferral()).toBeNull();
 });
 it("checks owner before and after requests", async () => {
  owner = "other@example.test"; await syncReferral(); expect(request).not.toHaveBeenCalled(); owner = session.email;
  request.mockImplementationOnce(async () => { owner = "other@example.test"; return me({ setUnlocked: true }); }); await syncReferral(); expect(ledger("buy")).toEqual([]);
 });
 it("throttles concurrent and repeated syncs to ten minutes per session", async () => {
  request.mockResolvedValue(me({ claim: null })); await Promise.all([syncReferral(), syncReferral(), syncReferral()]);
  vi.advanceTimersByTime(599_999); await syncReferral(); expect(request).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1); await syncReferral(); expect(request).toHaveBeenCalledTimes(2);
  session = { ...session, token: "session-b" }; await syncReferral(); expect(request).toHaveBeenCalledTimes(3);
 });
 it("sends every earning in batches of at most 500", async () => {
  for (let i = 0; i < 1001; i++) seed("focus", String(i), 1); await syncReferral();
  expect(request.mock.calls.slice(1).map((call) => call[2].rows.length)).toEqual([500, 500, 1]); expect(ledger("referral_invitee")).toHaveLength(1001);
 });
 it("silently handles offline and earnings 404 failures", async () => {
  request.mockRejectedValueOnce(new Error("offline")); await expect(syncReferral()).resolves.toBeUndefined(); vi.advanceTimersByTime(600_000);
  request.mockImplementation(async (path: string) => { if (path.startsWith("/api/referral/me")) return me(); throw new Error("404"); }); await expect(syncReferral()).resolves.toBeUndefined();
 });
 it("uses local device id and study day and preserves server detail", async () => {
  request.mockResolvedValueOnce({ claim: me().claim }); expect(await claimReferral(" abc23456 ")).toEqual(me().claim);
  expect(request).toHaveBeenCalledWith("/api/referral/claim", "POST", { code: "ABC23456", deviceId: "local-device", studyDay: "2026-10-26" });
  request.mockRejectedValueOnce(new Error("不能填写自己的邀请码")); await expect(claimReferral("ABC23456")).rejects.toThrow("不能填写自己的邀请码");
 });
 it("shows the banner only for new history and remembers claims and dismissal", async () => {
  db.run("INSERT INTO word_study_time VALUES ('2020-01-01',0)");
  expect(await referralBannerVisible()).toBe(true); db.run("INSERT INTO reviews VALUES ('2026-10-20')"); expect(await referralBannerVisible()).toBe(true);
  db.run("INSERT INTO word_study_time VALUES ('2026-10-19',60)"); expect(await referralBannerVisible()).toBe(false);
  db.run("DELETE FROM word_study_time"); await fetchReferral(); expect(await referralBannerVisible()).toBe(false);
  session = { ...session, email: "new@example.test" }; expect(await referralBannerVisible()).toBe(true);
  localStorage.setItem("referral_banner_dismissed", "1"); expect(await referralBannerVisible()).toBe(false);
 });
 it("validates reward amounts at the booking boundary", () => {
  expect(bookReferralReward("referral_inviter", "", 50)).toBe(false);
  for (const amount of [0, -1, NaN, Infinity, 1.5]) expect(bookReferralReward("referral_inviter", "id", amount)).toBe(false);
  expect(bookReferralReward("referral_inviter", "id", 50)).toBe(true); expect(bookReferralReward("referral_inviter", "id", 50)).toBe(false);
 });
});
