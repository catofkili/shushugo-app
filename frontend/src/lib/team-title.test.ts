import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudSession, CloudTeam } from "./sync-api";

let title = "";
let db = {};
let session: CloudSession;
let owner: string | undefined;
const putTitle = vi.fn();
vi.mock("./database", () => ({ getDatabase: () => db }));
vi.mock("./yuzu", () => ({ equippedItem: () => title, YUZU_EVENT: "test:yuzu" }));
vi.mock("./sync-api", () => ({
  getCloudSession: async () => session,
  getLocalSyncOwnerEmail: async () => owner,
  updateCloudTeamTitle: (...args: unknown[]) => putTitle(...args)
}));
import { syncTeamTitle, watchTeamTitle } from "./team-activity";
import { teamTitleName } from "./yuzu-catalog";
const team = (saved?: string | null) => ({ id: "team-1", members: [{ memberId: "me", isMe: true, title: saved }] }) as CloudTeam;
const change = (next: string) => { title = next; window.dispatchEvent(new Event("test:yuzu")); };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

beforeEach(() => {
  title = ""; db = {}; owner = undefined;
  session = { configured: true, token: "a-token", email: "a@example.test" };
  putTitle.mockReset().mockImplementation(async (key: string) => key || null);
  vi.stubGlobal("window", new EventTarget());
});
afterEach(() => vi.unstubAllGlobals());

describe("team title projection", () => {
  it("maps only title items; unknown, old and empty values stay invisible", () => {
    expect(teamTitleName("title-early")).toBe("晨读派");
    expect(teamTitleName("title-grove")).toBe("柚子庄园主");
    for (const key of [undefined, null, "", "title-future", "theme-matcha"]) expect(teamTitleName(key)).toBe("");
  });
  it("reconciles mismatches on entry and clears; skips equal/old empty and non-members", async () => {
    await syncTeamTitle(null);
    await syncTeamTitle(team());
    await syncTeamTitle(team(null));
    expect(putTitle).not.toHaveBeenCalled();
    title = "title-early";
    expect(await syncTeamTitle(team())).toBe("title-early");
    await syncTeamTitle(team(title));
    expect(putTitle).toHaveBeenCalledTimes(1);
    title = "";
    expect(await syncTeamTitle(team("title-early"))).toBeNull();
    expect(putTitle).toHaveBeenLastCalledWith("");
  });
  it("silently retries an offline or old-server failure on next entry", async () => {
    title = "title-night";
    putTitle.mockRejectedValueOnce(new Error("404"));
    await expect(syncTeamTitle(team())).resolves.toBeUndefined();
    expect(await syncTeamTitle(team())).toBe("title-night");
    expect(putTitle).toHaveBeenCalledTimes(2);
  });
  it("does not push equipment from another local owner or a signed-out session", async () => {
    title = "title-early"; owner = "b@example.test";
    await syncTeamTitle(team());
    owner = undefined; session.token = undefined;
    await syncTeamTitle(team());
    expect(putTitle).not.toHaveBeenCalled();
  });
  it("discards a response after account, database or equipment changes", async () => {
    title = "title-early";
    putTitle.mockImplementationOnce(async () => { session = { ...session, token: "b-token" }; return title; });
    expect(await syncTeamTitle(team())).toBeUndefined();
    putTitle.mockImplementationOnce(async () => { db = {}; return title; });
    expect(await syncTeamTitle(team())).toBeUndefined();
    putTitle.mockImplementationOnce(async () => { title = "title-night"; return "title-early"; });
    expect(await syncTeamTitle(team())).toBeUndefined();
  });
  it("ignores unrelated/duplicate events and serializes rapid equip and unequip", async () => {
    let finish!: () => void;
    putTitle.mockImplementationOnce(() => new Promise<string>((resolve) => { finish = () => resolve("title-early"); }));
    const synced = vi.fn();
    const stop = watchTeamTitle(synced);
    change(""); change("title-early"); change("title-early");
    await flush();
    expect(putTitle.mock.calls).toEqual([["title-early"]]);
    change("title-night"); await flush();
    expect(putTitle).toHaveBeenCalledTimes(1);
    finish(); await flush();
    expect(putTitle.mock.calls).toEqual([["title-early"], ["title-night"]]);
    expect(synced.mock.calls).toEqual([["title-night"]]);
    change(""); await flush();
    expect(putTitle).toHaveBeenLastCalledWith("");
    stop(); change("title-capy"); await flush();
    expect(putTitle).toHaveBeenCalledTimes(3);
  });
});
