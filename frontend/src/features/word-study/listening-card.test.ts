import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { describe, expect, it } from "vitest";
import type { WordCard } from "../../types/vocabulary";
import { buildKanjiComponents } from "../../lib/models/word-card";
import { isListeningReverseCard } from "./listening-card";

const card = (kanji: string, kana: string, meaning: string, patch: Partial<WordCard> = {}): WordCard => ({
  id: 1, kanji, kana, meaning, jlptLevel: "N1", primaryMeaning: meaning, promptMeaning: meaning,
  pos: "名词", importance: 3, importanceScore: 3, isFavorite: false, note: "",
  example: { jp: "", meaning: "" }, conjugations: [], confusions: [],
  kanjiComponents: buildKanjiComponents(kanji), ...patch
});

describe("N1 汉字看得出意思的反向卡", () => {
  it("繁殖：简体表记等于释义", () => {
    expect(isListeningReverseCard(card("繁殖", "はんしょく", "繁殖"))).toBe(true);
  });

  it("遺産：复用卡上简体映射", () => {
    expect(isListeningReverseCard(card("遺産", "いさん", "遗产"))).toBe(true);
  });

  it("統御：完整匹配多义项中的一项", () => {
    expect(isListeningReverseCard(card("統御", "とうぎょ", "统御；控制"))).toBe(true);
  });

  it("精巧：允许义项结尾的的", () => {
    expect(isListeningReverseCard(card("精巧", "せいこう", "精巧的"))).toBe(true);
  });

  it("勉強：汉字和释义不同", () => {
    expect(isListeningReverseCard(card("勉強", "べんきょう", "学习"))).toBe(false);
  });

  it("手紙：不把假朋友当同义词", () => {
    expect(isListeningReverseCard(card("手紙", "てがみ", "信"))).toBe(false);
  });

  it("下水：不能匹配释义中的子串", () => {
    expect(isListeningReverseCard(card("下水", "げすい", "下水道；污水"))).toBe(false);
  });

  it("愛：单字不参与", () => {
    expect(isListeningReverseCard(card("愛", "あい", "爱"))).toBe(false);
  });

  it("培う：含假名不参与", () => {
    expect(isListeningReverseCard(card("培う", "つちかう", "培育"))).toBe(false);
  });

  it("N2 経済：范围只到 N1", () => {
    expect(isListeningReverseCard(card("経済", "けいざい", "经济", { jlptLevel: "N2" }))).toBe(false);
  });

  it("人目：不能匹配义项末尾的子串", () => {
    expect(isListeningReverseCard(card("人目", "ひとめ", "他人目光"))).toBe(false);
  });

  it("物件：接受同字义项与其他义项共存", () => {
    expect(isListeningReverseCard(card("物件", "ぶっけん", "物件；房产"))).toBe(true);
  });

  it("岐路：不扩展近形字映射", () => {
    expect(isListeningReverseCard(card("岐路", "きろ", "歧路"))).toBe(false);
  });

  it("表记等于 kana 时不参与", () => {
    expect(isListeningReverseCard(card("繁殖", "繁殖", "繁殖"))).toBe(false);
  });

  it("按原词逐字映射，保留去重组件里的重复字", () => {
    const repeated = card("戦戦", "せんせん", "战战");
    expect(repeated.kanjiComponents).toHaveLength(1);
    expect(isListeningReverseCard(repeated)).toBe(true);
  });

  it("允许々，组件没有它时保留原字", () => {
    expect(isListeningReverseCard(card("人々", "ひとびと", "人々"))).toBe(true);
  });

  it("支持全部约定的义项分隔符并去掉两端空格", () => {
    for (const separator of ["；", ";", "，", ",", "、", "/", "／"]) {
      expect(isListeningReverseCard(card("精巧", "せいこう", `细致${separator} 精巧的 ${separator}灵巧`)), separator).toBe(true);
    }
  });

  it("用户改写的 questionMeaning 不影响判据", () => {
    expect(isListeningReverseCard(card("勉強", "べんきょう", "学习", { questionMeaning: "勉强" }))).toBe(false);
    expect(isListeningReverseCard(card("繁殖", "はんしょく", "繁殖", { questionMeaning: "生物繁衍" }))).toBe(true);
  });

  it("出厂库 N1 命中数保持在 1250–1350", async () => {
    const seed = readFileSync(fileURLToPath(new URL("../../../public/nihongo.db", import.meta.url)));
    const db = new (await initSqlJs()).Database(new Uint8Array(seed));
    try {
      const rows = db.exec("SELECT kanji, kana, meaning FROM words WHERE jlpt_level = 'N1'")[0].values;
      const count = rows.filter(([kanji, kana, meaning]) => isListeningReverseCard(card(String(kanji), String(kana), String(meaning)))).length;
      expect(count).toBeGreaterThanOrEqual(1250);
      expect(count).toBeLessThanOrEqual(1350);
      console.info(`出厂库 N1 听音反向卡：${count}`);
    } finally {
      db.close();
    }
  });
});
