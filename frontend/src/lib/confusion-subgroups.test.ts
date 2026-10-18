import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;

vi.mock("./database", () => ({
  getDatabase: () => testDb,
  initDatabase: async () => testDb,
  exportDatabase: () => null,
  importDatabase: async () => undefined
}));

import { confusionGroups, displayForm, type ConfusionGroup } from "./confusion-groups";
import { matchIndex, placeMembers, subgroupRuns } from "./confusion-subgroups";
import { CONFUSION_SUBGROUPS } from "../data/confusion_subgroups";

const formsOf = (member: ConfusionGroup["members"][number]) => [displayForm(member), member.kanji, member.kana];

describe("疑难辨析手写小组", () => {
  let groups: ConfusionGroup[];

  beforeAll(async () => {
    const SQL = await initSqlJs();
    testDb = new SQL.Database(new Uint8Array(readFileSync(
      fileURLToPath(new URL("../../public/nihongo.db", import.meta.url))
    )));
    groups = confusionGroups();
  });

  it("每条手写稿都对得上一个现存的组，键一个不错、成员一个不漏", () => {
    const byKey = new Map(groups.map((group) => [group.key, group]));
    Object.entries(CONFUSION_SUBGROUPS).forEach(([key, subgroups]) => {
      const group = byKey.get(key);
      expect(group, key).toBeTruthy();
      if (!group) return;
      // 每个键都认领得到成员，且卡面词形不重名（写错的键、两个成员同形都会在这里红）
      subgroups.forEach((subgroup) => Object.keys(subgroup.words).forEach((form) => {
        expect(matchIndex(group.members, form, formsOf), `${key} ${form}`).toBeGreaterThanOrEqual(0);
        expect(group.members.filter((member) => displayForm(member) === form).length, `${key} ${form}`).toBeLessThanOrEqual(1);
      }));
      const placed = placeMembers(key, group.members, formsOf, () => null);
      expect(placed.filter((item) => !item.subgroup).map((item) => displayForm(item.member)), key).toEqual([]);
      expect(subgroupRuns(placed).length, key).toBe(subgroups.length);
      // 分小组就是为了不让一个框里再堆一长串
      subgroups.forEach((subgroup) => expect(Object.keys(subgroup.words).length, `${key} ${subgroup.title}`).toBeLessThanOrEqual(4));
    });
  });

  it("超过两个词的同词根组都有手写小组", () => {
    const missing = groups
      .filter((group) => group.type === "stem" && group.members.length > 2 && !CONFUSION_SUBGROUPS[group.key])
      .map((group) => group.key);
    expect(missing).toEqual([]);
  });

  it("止 组：「止める」认领的是 とめる，不是 kanji 也写作止める的 やめる", () => {
    const group = groups.find((item) => item.key === "stem:止")!;
    const placed = placeMembers(group.key, group.members, formsOf, () => null);
    expect(placed.map((item) => item.member.kana)).toEqual(["とまる", "とめる", "やむ", "やめる"]);
  });

  it("没手写稿的组照旧平铺，自他走兜底", () => {
    const group = groups.find((item) => item.members.length >= 2 && !CONFUSION_SUBGROUPS[item.key])!;
    const placed = placeMembers(group.key, group.members, formsOf, () => "自");
    expect(subgroupRuns(placed)).toHaveLength(1);
    expect(placed.every((item) => item.subgroup === "" && item.voice === "自")).toBe(true);
  });

  it("手写稿没认领到的成员排在最后、不丢", () => {
    const group = groups.find((item) => item.key === "stem:向")!;
    const extra = { ...group.members[0], id: -1, kanji: "向こう", kana: "むこう" };
    const placed = placeMembers(group.key, [extra, ...group.members], formsOf, () => null);
    expect(placed).toHaveLength(group.members.length + 1);
    expect(placed[placed.length - 1].member.id).toBe(-1);
    expect(subgroupRuns(placed).map((run) => run.title)).toEqual(["单方朝向目标", "带「合う」：双方互相", ""]);
  });
});
