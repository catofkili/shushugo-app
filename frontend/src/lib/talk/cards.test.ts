import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import type { TalkContent } from "./content";

let testDb: Database;
let SQL: SqlJsStatic;
const seed = new Uint8Array(readFileSync(fileURLToPath(new URL("../../../public/nihongo.db", import.meta.url))));
vi.mock("../database", () => ({ getDatabase: () => testDb, initDatabase: async () => testDb }));

import currentContent from "../../data/talk_content.json";
import { setTalkContentForTest } from "./content";
import { sceneSessionKeys, talkCard } from "./cards";

const fixture: TalkContent = {
  version: "cards-fixture",
  formulas: [
    { id: "F99", intent: "最后", pattern: "[物]。", skeleton: "[物] ……", prompt: "{物}", note: "", fillers: [{ 物: { ja: "水", zh: "水", wordId: 578 } }] },
    { id: "F03", intent: "问有没有", pattern: "[物]はありますか。", skeleton: "[物]は ……", prompt: "有没有{物}", note: "", fillers: [{ 物: { ja: "卵", zh: "鸡蛋", wordId: 741 } }] },
    {
      id: "F02", intent: "说自己想要", pattern: "[物]をお願いします。", skeleton: "[物]を ……", prompt: "请给我{物}", note: "",
      fillers: [
        { 物: { ja: "水", zh: "水", wordId: 578 } },
        { 物: { ja: "お茶", zh: "茶", wordId: 259 } },
        { 物: { ja: "牛乳", zh: "牛奶", wordId: 449 } }
      ]
    },
    { id: "F01", intent: "末尾按 id", pattern: "[物]。", skeleton: "[物] ……", prompt: "{物}", note: "", fillers: [{ 物: { ja: "塩", zh: "盐", wordId: 404 } }] },
    {
      id: "F11", intent: "比较", pattern: "[A]と[B]は、どう違いますか。", skeleton: "[A]と[B]は ……", prompt: "{A}和{B}有什么不同", note: "",
      fillers: [
        { A: { ja: "水", zh: "水", wordId: 578 }, B: { ja: "お茶", zh: "茶", wordId: 259 } },
        { A: { ja: "牛乳", zh: "牛奶", wordId: 449 }, B: { ja: "砂糖", zh: "砂糖", wordId: 505 } }
      ]
    }
  ],
  scenes: [
    {
      id: "S02", title: "排在前的场景", lines: [
        { speaker: "店员", self: false, ja: "何にしますか。", zh: "要什么？", formulas: ["F99"] },
        { speaker: "顾客", self: true, ja: "水をお願いします。", zh: "请给我水。", formulas: ["F02", "F11"] },
        { speaker: "顾客", self: true, ja: "お茶はありますか。", zh: "有茶吗？", formulas: ["F02"] }
      ]
    },
    {
      id: "S01", title: "排在后的场景", lines: [
        { speaker: "顾客", self: true, ja: "卵はありますか。", zh: "有鸡蛋吗？", formulas: ["F03", "F02"] }
      ]
    }
  ]
};

const learn = (...ids: number[]) => {
  for (const id of ids) {
    testDb.run("INSERT OR IGNORE INTO progress (word_id) VALUES (?)", [id]);
    testDb.run("UPDATE progress SET seen_count = 1 WHERE word_id = ?", [id]);
  }
};
const previous = (key: string, filler: string, at = 1) => {
  testDb.run("INSERT INTO talk_reviews (card_key, reviewed_at, filler) VALUES (?, ?, ?)", [key, at, filler]);
};

describe("开口练习卡片候选与顺序", () => {
  beforeAll(async () => { SQL = await initSqlJs(); });
  beforeEach(() => {
    testDb = new SQL.Database(seed);
    testDb.run("CREATE TABLE talk_reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, card_key TEXT, reviewed_at INTEGER, filler TEXT)");
    setTalkContentForTest(structuredClone(fixture));
  });
  afterEach(() => { testDb.close(); });

  it("逐句先放公式再接话，self 引用去重，对方引用忽略，末尾补挂图公式", () => {
    const content = structuredClone(fixture);
    content.formulas[0].scene = "S02";
    content.formulas[1].scene = "S02";
    content.scenes[0].lines[2].formulas = ["F02", "F03", "F03"];
    expect(sceneSessionKeys("S02", content)).toEqual(["f:F02", "f:F11", "r:S02:1", "f:F03", "r:S02:2", "f:F99"]);
    expect(sceneSessionKeys("S01", content)).toEqual(["f:F03", "f:F02", "r:S01:0"]);
    expect(sceneSessionKeys("missing", content)).toEqual([]);
  });

  it("每次随机挑整组，学过的词优先；没有学过的词时用最易候选", () => {
    expect(talkCard("f:F02", { random: () => 0 })?.filler).toBe("水");
    expect(talkCard("f:F02", { random: () => 0.99 })?.filler).toBe("牛乳");
    learn(259);
    expect(talkCard("f:F02", { random: () => 0 })?.filler).toBe("お茶");
    expect(talkCard("f:F02", { random: () => 0.99 })?.filler).toBe("お茶");
  });

  it("真实新库 F02 抽 50 次始终在 N5 档，不抽到領収書；避重仍在最易档", () => {
    setTalkContentForTest(currentContent);
    const formula = currentContent.formulas.find((f) => f.id === "F02")!;
    const easiest = new Set(formula.fillers.filter((group) => {
      const ids = Object.values(group).flatMap((word) => "wordId" in word ? [word.wordId as number] : []);
      return ids.length > 0 && ids.every((id) => testDb.exec(`SELECT jlpt_level FROM words WHERE id = ${id}`)[0].values[0][0] === "N5");
    }).map((group) => Object.values(group).map((word) => word.ja).join("/")));
    expect(easiest.size).toBeGreaterThan(1);
    for (let index = 0; index < 50; index++) {
      const card = talkCard("f:F02", { random: () => index / 50 })!;
      expect(easiest.has(card.filler!)).toBe(true);
      expect(card.filler).not.toBe("領収書");
      previous(card.key, card.filler!, index + 1);
      expect(talkCard(card.key, { random: () => index / 50 })?.filler).not.toBe(card.filler);
    }
  });

  it("取组内最难等级；无 wordId 的组算 N3；唯一熟组用过后仍按难度回退", () => {
    testDb.run("UPDATE words SET jlpt_level = 'N2' WHERE id = 449");
    testDb.run("UPDATE words SET jlpt_level = 'N4' WHERE id = 505");
    const content = structuredClone(fixture);
    content.formulas[4].fillers.push({ A: { ja: "レシート", zh: "收据" }, B: { ja: "セット", zh: "套餐" } });
    setTalkContentForTest(content);
    expect(talkCard("f:F11", { random: () => .99 })?.filler).toBe("水/お茶");
    learn(449);
    previous("f:F02", "牛乳");
    expect(talkCard("f:F02", { random: () => .99 })?.filler).toBe("お茶");
    testDb.run("UPDATE words SET jlpt_level = 'N2' WHERE id IN (578, 259)");
    expect(talkCard("f:F11", { random: () => 0 })?.filler).toBe("レシート/セット");
  });

  it("双槽位中所有带 wordId 的词都学过才优先，学过一个不足以优先", () => {
    learn(578, 449, 505);
    expect(talkCard("f:F11", { random: () => 0 })?.filler).toBe("牛乳/砂糖");
    learn(259);
    expect(talkCard("f:F11", { random: () => 0 })?.filler).toBe("水/お茶");
  });

  it("没有 wordId 的组不凭空算学过；混合组只要求有 wordId 的词都已学过", () => {
    const content = structuredClone(fixture);
    content.formulas[2].fillers.unshift({ 物: { ja: "レシート", zh: "收据" } });
    content.formulas[4].fillers[0].B = { ja: "レシート", zh: "收据" };
    setTalkContentForTest(content);
    learn(259, 578);
    expect(talkCard("f:F02", { random: () => 0 })?.filler).toBe("水");
    expect(talkCard("f:F11", { random: () => 0 })?.filler).toBe("水/レシート");
  });

  it("同一张公式连续练两次避开上次 filler，别的卡的历史不影响它", () => {
    const first = talkCard("f:F02", { random: () => 0 })!;
    previous(first.key, first.filler!);
    expect(talkCard(first.key, { random: () => 0 })?.filler).toBe("お茶");
    previous("f:F03", "牛乳", 100);
    expect(talkCard(first.key, { random: () => 0.99 })?.filler).toBe("牛乳");
  });

  it("优先在其它学过的组中换词；唯一学过组刚用过时回退其它组", () => {
    learn(578, 259);
    previous("f:F02", "水");
    expect(talkCard("f:F02", { random: () => 0.99 })?.filler).toBe("お茶");
    testDb.run("UPDATE progress SET seen_count = 0 WHERE word_id = 259");
    expect(talkCard("f:F02", { random: () => 0 })?.filler).toBe("お茶");
  });

  it("最近流水按 reviewed_at 再按 id 取，历史更早行不改变避重对象", () => {
    previous("f:F02", "水", 100);
    previous("f:F02", "牛乳", 50);
    expect(talkCard("f:F02", { random: () => 0 })?.filler).toBe("お茶");
    previous("f:F02", "お茶", 100);
    expect(talkCard("f:F02", { random: () => 0 })?.filler).toBe("水");
  });

  it("上一句也是自己说的话时不把自己当成对方，使用开场白提示", () => {
    const card = talkCard("r:S02:2")!;
    expect(card).not.toHaveProperty("partnerLine");
    expect(card.prompt).toBe("有茶吗？");
    expect(card.hints).toEqual(["有茶吗？", "お茶はあ…"]);
  });

  it("场景练习里公式卡配这一场的图，不用公式自己挂的场景", () => {
    expect(talkCard("f:F02", { random: () => 0 })).not.toHaveProperty("image");
    const card = talkCard("f:F02", { random: () => 0, sceneId: "S01" })!;
    expect(card.image).toBe("/talk/scenes/S01.jpg");
    expect(card.sceneTitle).toBe("排在后的场景");
  });
});
