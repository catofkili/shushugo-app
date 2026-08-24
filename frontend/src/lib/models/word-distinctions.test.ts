import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";
import type { WordCard } from "../../types/vocabulary";

let testDb: Database;

vi.mock("../database", () => ({
  getDatabase: () => testDb,
  initDatabase: async () => testDb,
  exportDatabase: () => null,
  importDatabase: async () => undefined
}));

import { wordDistinctions } from "./word-distinctions";

/** 只填辨析用得到的字段，其余给空壳 —— 这个函数不碰调度、不碰 FSRS */
const cardOf = (over: Partial<WordCard>): WordCard => ({
  id: 22,
  meaning: "公园",
  primaryMeaning: "公园",
  promptMeaning: "公园",
  kana: "こうえん",
  kanji: "公園",
  pos: "名词",
  jlptLevel: "N5",
  importance: 0,
  importanceScore: 0,
  isFavorite: false,
  note: "",
  example: { jp: "", meaning: "" },
  kanjiComponents: [],
  conjugations: [],
  confusions: [],
  ...over
} as WordCard);

describe("单词卡的辨析 section", () => {
  beforeAll(async () => {
    const SQL = await initSqlJs();
    testDb = new SQL.Database(new Uint8Array(readFileSync(
      fileURLToPath(new URL("../../../public/nihongo.db", import.meta.url))
    )));
  });

  it("接的是疑难辨析那份分组,key 能和「已掌握」对上", () => {
    const sections = wordDistinctions(cardOf({}));
    const homophone = sections.find((section) => section.key === "homophone:こうえん");
    expect(homophone).toBeTruthy();
    // masterable 的组必须用 confusion-groups 的原 key —— 那是「已掌握」的锚点,
    // 换成 id 拼的 key 会让用户在疑难辨析页标过的状态在这里对不上。
    expect(homophone!.masterable).toBe(true);
    expect(homophone!.members.map((member) => member.word)).toContain("講演");
  });

  it("当前这张留在成员里并标出来 —— 没有参照物的对照等于没对照", () => {
    const sections = wordDistinctions(cardOf({}));
    sections.forEach((section) => {
      const current = section.members.filter((member) => member.isCurrent);
      expect(current.length).toBeLessThanOrEqual(1);
    });
    const homophone = sections.find((section) => section.key === "homophone:こうえん")!;
    expect(homophone.members.find((member) => member.isCurrent)?.id).toBe(22);
  });

  it("只有当前词自己的 section 不出现", () => {
    const sections = wordDistinctions(cardOf({
      id: -1,
      kanji: "架空語",
      kana: "かくうご",
      similarMeaning: { title: "空组", distinction: "d", source: "manual", items: [] }
    }));
    expect(sections.every((section) => section.key !== "manual:空组")).toBe(true);
  });

  it("自动题面撞车不进入展开辨析区", () => {
    const sections = wordDistinctions(cardOf({
      similarMeaning: {
        title: "题面首义相同：公园",
        distinction: "d",
        source: "auto",
        // 3485 = 講演,已经在同音组里出现过
        items: [{ id: 3485, kana: "こうえん", kanji: "講演", meaning: "演讲", note: "演讲" }]
      }
    }));
    expect(sections.some((section) => section.key.startsWith("prompt:"))).toBe(false);
  });

  it("展开层不再添加旧的硬编码用法辨析", () => {
    const sections = wordDistinctions(cardOf({
      confusions: [{ id: 0, kanji: "食う", kana: "くう", meaning: "粗俗说法", kind: "sense" }]
    }));
    expect(sections.some((section) => section.key.startsWith("sense:"))).toBe(false);
  });

  it("说法从具体到笼统:手写辨析排在算出来的分组前面", () => {
    const sections = wordDistinctions(cardOf({
      similarMeaning: {
        title: "手写组",
        distinction: "d",
        source: "manual",
        items: [{ id: 3485, kana: "こうえん", kanji: "講演", meaning: "演讲", note: "人写的说明" }]
      },
      confusions: [{ id: 99999, kanji: "架空語B", kana: "かくうごびー", meaning: "测试音形相近", kind: "sound" }]
    }));
    expect(sections[0].key).toBe("manual:手写组");
    const sound = sections[sections.length - 1];
    expect(sound.key.startsWith("sound:")).toBe(true);
    expect(sound.summary).toBe("");
    expect(sound.level).toBeNull();
  });
});
