import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import type { TalkContent } from "./content";

let testDb: Database;
let SQL: SqlJsStatic;
const seed = new Uint8Array(readFileSync(fileURLToPath(new URL("../../../public/nihongo.db", import.meta.url))));
vi.mock("../database", () => ({ getDatabase: () => testDb, initDatabase: async () => testDb }));
vi.mock("../../data/talk_content.json", () => ({ default: fixture }));

import { loadTalkContent, setTalkContentForTest, talkContent, talkContentLoaded } from "./content";
import { allCardKeys, talkCard } from "./cards";
import { rowsFor } from "../study-core";

const words = [
  { ja: "お茶", zh: "茶", wordId: 259 },
  { ja: "塩", zh: "盐", wordId: 404 },
  { ja: "牛乳", zh: "牛奶", wordId: 449 },
  { ja: "魚", zh: "鱼", wordId: 451 },
  { ja: "砂糖", zh: "砂糖", wordId: 505 },
  { ja: "水", zh: "水", wordId: 578 },
  { ja: "肉", zh: "肉", wordId: 663 },
  { ja: "卵", zh: "鸡蛋", wordId: 741 }
];

const fixture: TalkContent = {
  version: "fixture",
  formulas: [
    {
      id: "F02", intent: "说自己想要", pattern: "[物]をお願いします。", skeleton: "[物]を ……",
      prompt: "向店员要：{物}", note: "请求提供物品", scene: "S01", fillers: words.map((word) => ({ 物: word }))
    },
    {
      id: "F11", intent: "比较两种方案", pattern: "[A]と[B]は、どう違いますか。", skeleton: "[A]と[B]は ……",
      prompt: "比较：{A}和{B}", note: "先指清对象",
      // 键的书写顺序与句中槽位顺序不同，filler 仍须按句中 A/B 顺序稳定保存。
      fillers: words.map((word, index) => ({ B: words[(index + 1) % words.length], A: word }))
    }
  ],
  scenes: [
    {
      id: "S01", title: "请求物品", note: "场景提醒", lines: [
        { speaker: "店员", self: false, ja: "何になさいますか。", zh: "您要什么？", formulas: [] },
        { speaker: "顾客", self: true, ja: "水をお願いします。", zh: "请给我水。", formulas: ["F02"] }
      ]
    },
    {
      id: "S02", title: "比较物品", lines: [
        { speaker: "顾客", self: true, ja: "水とお茶は、どう違いますか。", zh: "水和茶有什么不同？", formulas: ["F11"] },
        { speaker: "店员", self: false, ja: "味が違います。", zh: "味道不同。", formulas: [] }
      ]
    }
  ]
};

describe("开口练习内容（独立 fixture，正式内容另一个任务负责）", () => {
  beforeAll(async () => { SQL = await initSqlJs(); });
  beforeEach(() => {
    testDb = new SQL.Database(seed);
    setTalkContentForTest(null);
  });
  afterEach(() => { testDb.close(); });

  it("未加载不出卡；动态加载合并并发请求，后续复用已加载内容", async () => {
    expect(talkContentLoaded()).toBe(false);
    expect(talkContent()).toBeNull();
    expect(allCardKeys()).toEqual([]);
    expect(talkCard("f:F02")).toBeNull();
    const first = loadTalkContent();
    expect(loadTalkContent()).toBe(first);
    await first;
    expect(talkContentLoaded()).toBe(true);
    expect(talkContent()).toBe(fixture);
    await loadTalkContent();
    expect(talkContent()).toBe(fixture);
  });

  it("pattern / skeleton / prompt / 每组 fillers 的槽位名四处一致", () => {
    const slots = (text: string, regex: RegExp) => [...new Set([...text.matchAll(regex)].map((match) => match[1]))].sort();
    for (const formula of fixture.formulas) {
      const names = slots(formula.pattern, /\[([^\]]+)\]/gu);
      expect(slots(formula.skeleton, /\[([^\]]+)\]/gu)).toEqual(names);
      expect(slots(formula.prompt, /\{([^}]+)\}/gu)).toEqual(names);
      for (const group of formula.fillers) expect(Object.keys(group).sort()).toEqual(names);
    }
  });

  it("公式和场景 id 唯一，场景引用的公式与公式挂图都存在，每条公式至少八组候选", () => {
    const formulaIds = new Set(fixture.formulas.map((formula) => formula.id));
    const sceneIds = new Set(fixture.scenes.map((scene) => scene.id));
    expect(formulaIds.size).toBe(fixture.formulas.length);
    expect(sceneIds.size).toBe(fixture.scenes.length);
    for (const formula of fixture.formulas) {
      expect(formula.fillers.length).toBeGreaterThanOrEqual(8);
      if (formula.scene) expect(sceneIds.has(formula.scene)).toBe(true);
    }
    for (const scene of fixture.scenes) {
      for (const line of scene.lines) {
        for (const id of line.formulas) expect(formulaIds.has(id)).toBe(true);
      }
    }
  });

  it("带 wordId 的候选在出厂库存在，词形等于 kanji 或 kana", () => {
    for (const formula of fixture.formulas) {
      for (const group of formula.fillers) {
        for (const word of Object.values(group)) {
          if (word.wordId === undefined) continue;
          const rows = rowsFor("SELECT kanji, kana FROM words WHERE id = ?", [word.wordId]);
          expect(rows).toHaveLength(1);
          expect([rows[0].kanji, rows[0].kana]).toContain(word.ja);
        }
      }
    }
  });

  it("公式各一张、每个 self 行各一张，行号从零起，对方的行不出卡", () => {
    setTalkContentForTest(fixture);
    expect(allCardKeys()).toEqual(["f:F02", "f:F11", "r:S01:1", "r:S02:0"]);
    expect(new Set(allCardKeys()).size).toBe(allCardKeys().length);
    expect(talkCard("f:missing")).toBeNull();
    expect(talkCard("r:S01:0")).toBeNull();
    expect(talkCard("r:S01:99")).toBeNull();
    expect(talkCard("r:S01:-1")).toBeNull();
    expect(talkCard("r:S01:1.5")).toBeNull();
  });

  it("双槽位一次挑一整组，中文与骨架同时替换，保存按句中槽位顺序的词形", () => {
    setTalkContentForTest(fixture);
    const card = talkCard("f:F11", { random: () => 0 })!;
    expect(card.filler).toBe("お茶/塩");
    expect(card.prompt).toBe("比较：茶和盐");
    expect(card.answer).toEqual({ ja: "お茶と塩は、どう違いますか。", zh: "比较：茶和盐" });
    expect(card.hints).toEqual(["お茶と塩は ……", "お茶と塩は、…"]);
    expect(card.image).toBeUndefined();
    expect(talkCard("f:F02", { random: () => 0 })?.image).toBe("/talk/scenes/S01.jpg");
  });

  it("接话提示先给对方原文与中文，再给自己中文、答案开头；保留场景提醒", () => {
    setTalkContentForTest(fixture);
    const card = talkCard("r:S01:1")!;
    expect(card.partnerLine).toEqual({ speaker: "店员", ja: "何になさいますか。", zh: "您要什么？" });
    expect(card.hints).toEqual(["何になさいますか。\n您要什么？", "请给我水。", "水をお願…"]);
    expect(card.prompt).toBe("接着对方的话回答");
    expect(card.answer).toEqual({ ja: "水をお願いします。", zh: "请给我水。" });
    expect(card.image).toBe("/talk/scenes/S01.jpg");
    expect(card.note).toBe("场景提醒");
  });

  it("开场白没有 partnerLine，题面用自己中文，只保留两条提示", () => {
    setTalkContentForTest(fixture);
    const card = talkCard("r:S02:0")!;
    expect(card).not.toHaveProperty("partnerLine");
    expect(card.prompt).toBe("水和茶有什么不同？");
    expect(card.hints).toEqual(["水和茶有什么不同？", "水とお茶は、…"]);
  });

  it("答案开头向上取整、至少两字符，不截断 Unicode 字符", () => {
    const content = structuredClone(fixture);
    content.scenes[1].lines[0].ja = "はい。";
    setTalkContentForTest(content);
    expect(talkCard("r:S02:0")?.hints[1]).toBe("はい…");
    content.scenes[1].lines[0].ja = "𠮷野家へ。";
    expect(talkCard("r:S02:0")?.hints[1]).toBe("𠮷野…");
  });

  it("只有一组候选时允许重复，不会把卡过滤掉", () => {
    const content = structuredClone(fixture);
    content.formulas[1].fillers = [content.formulas[1].fillers[0]];
    setTalkContentForTest(content);
    testDb.run("CREATE TABLE talk_reviews (id INTEGER PRIMARY KEY, card_key TEXT, reviewed_at INTEGER, filler TEXT)");
    testDb.run("INSERT INTO talk_reviews VALUES (1, 'f:F11', 1, 'お茶/塩')");
    expect(talkCard("f:F11", { random: () => 0 })?.filler).toBe("お茶/塩");
  });
});
