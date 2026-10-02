import { describe, expect, it } from "vitest";
import { checkSpelling } from "./check";
import type { SpellingLookup, SpellingProblemCode, SpellingTarget } from "./types";

const target = (partial: Partial<SpellingTarget> & Pick<SpellingTarget, "kana" | "surface">): SpellingTarget => ({
  forms: partial.surface && /[一-鿿]/u.test(partial.surface) ? [{ surface: partial.surface, tag: "standard" }] : [],
  altReadings: [],
  isLoanword: false,
  ...partial
});

const taberu = target({ kana: "たべる", surface: "食べる" });
const codes = (t: SpellingTarget, input: string, lookup?: SpellingLookup) => checkSpelling(t, input, lookup).problems.map((p) => p.code);
const first = (t: SpellingTarget, input: string, lookup?: SpellingLookup): SpellingProblemCode | undefined => codes(t, input, lookup)[0];

describe("拼写判定：罗马音 / 假名", () => {
  it("三种写法都算对，记录形式", () => {
    for (const [input, form] of [["taberu", "romaji"], ["TABERU", "romaji"], ["たべる", "kana"], ["食べる", "mixed"]] as const) {
      const verdict = checkSpelling(taberu, input);
      expect(verdict.correct, input).toBe(true);
      expect(verdict.form).toBe(form);
      expect(verdict.problems).toEqual([]);
    }
    expect(checkSpelling(taberu, "taberu").readingOk).toBe(true);
    expect(checkSpelling(taberu, "食べる").readingOk).toBeNull();
  });

  it("读音错：给第一处对不上的拍；少 / 多字符", () => {
    expect(checkSpelling(taberu, "taberu").matched).toEqual({ kind: "reading", text: "たべる", preferred: true });
    const wrong = checkSpelling(taberu, "たべろ");
    expect(wrong.correct).toBe(false);
    expect(wrong.problems[0]).toMatchObject({ code: "wrong_reading", moraIndex: 2 });
    expect(wrong.nearMiss).toBe(false);
    expect(first(taberu, "tabe")).toBe("too_short");
    expect(first(taberu, "taberuu")).toBe("too_long");
  });

  it("长音写法：音一样但写法不同是 nearMiss，读音算对", () => {
    const father = target({ kana: "おとうさん", surface: "お父さん" });
    expect(checkSpelling(father, "otousan").correct).toBe(true);
    expect(checkSpelling(father, "otōsan").correct).toBe(true);
    const verdict = checkSpelling(father, "otoosan");
    expect(verdict).toMatchObject({ correct: false, nearMiss: true, readingOk: true });
    expect(verdict.problems[0].code).toBe("long_vowel");
    expect(first(father, "おとーさん")).toBe("long_vowel");
    expect(first(father, "おとおさん")).toBe("long_vowel");
  });

  it("假名种类：外来语写平假名、平假名词写片假名都不算对，但是 nearMiss", () => {
    const camera = target({ kana: "カメラ", surface: "カメラ", isLoanword: true, sourceText: "camera" });
    expect(checkSpelling(camera, "カメラ").correct).toBe(true);
    expect(checkSpelling(camera, "kamera").correct).toBe(true);
    expect(checkSpelling(camera, "かめら")).toMatchObject({ correct: false, nearMiss: true, readingOk: true });
    expect(first(camera, "かめら")).toBe("script");
    expect(first(taberu, "タベル")).toBe("script");
  });

  it("外来语写成英语 → source_language；写对罗马音不受影响", () => {
    const camera = target({ kana: "カメラ", surface: "カメラ", isLoanword: true, sourceText: "camera" });
    expect(first(camera, "camera")).toBe("source_language");
    expect(checkSpelling(camera, "kamera").correct).toBe(true);
    // 英语拼写恰好就是合法罗马音时（ペン / pen）不能误报
    const pen = target({ kana: "ペン", surface: "ペン", isLoanword: true, sourceText: "pen" });
    expect(checkSpelling(pen, "pen").correct).toBe(true);
  });

  it("另一个合法读音 → other_reading（nearMiss）", () => {
    const tomorrow = target({ kana: "あした", surface: "明日", altReadings: ["あす"] });
    for (const input of ["asu", "あす"]) {
      const verdict = checkSpelling(tomorrow, input);
      expect(verdict).toMatchObject({ correct: false, nearMiss: true });
      expect(verdict.problems[0].code).toBe("other_reading");
    }
  });

  it("空输入和字母假名混写", () => {
    expect(checkSpelling(taberu, "  ").problems[0].code).toBe("empty");
    const mixed = checkSpelling(taberu, "tabeる");
    expect(mixed.form).toBe("other");
    expect(mixed.problems[0].code).toBe("mixed_scripts");
  });
});

describe("拼写判定：汉字 / 混合写法", () => {
  const doing = target({
    kana: "おこなう", surface: "行う",
    forms: [{ surface: "行う", tag: "standard" }, { surface: "行なう", tag: "variant" }]
  });
  const application = target({
    kana: "もうしこみ", surface: "申し込み",
    forms: [{ surface: "申し込み", tag: "standard" }, { surface: "申込み", tag: "variant" }, { surface: "申込", tag: "variant" }]
  });

  it("被接受写法都对，非首选的标出来", () => {
    expect(checkSpelling(doing, "行う").matched).toMatchObject({ kind: "form", tag: "standard", preferred: true });
    const variant = checkSpelling(doing, "行なう");
    expect(variant.correct).toBe(true);
    expect(variant.matched).toMatchObject({ tag: "variant", preferred: false });
    for (const input of ["申し込み", "申込み", "申込"]) expect(checkSpelling(application, input).correct, input).toBe(true);
    expect(checkSpelling(application, "申込").form).toBe("kanji");
  });

  it("交ぜ書き：一部分汉字换成假名不是被接受的写法", () => {
    const food = target({ kana: "たべもの", surface: "食べ物" });
    expect(first(food, "たべ物")).toBe("partial_kana");
    expect(first(food, "食べもの")).toBe("partial_kana");
    expect(checkSpelling(food, "食べ物").correct).toBe(true);
    expect(checkSpelling(food, "たべもの").correct).toBe(true);
    expect(checkSpelling(food, "たべ物").nearMiss).toBe(true);
  });

  it("送り仮名 / 活用形", () => {
    expect(first(taberu, "食る")).toBe("okurigana");
    expect(first(taberu, "食べた")).toBe("conjugated");
    expect(first(taberu, "食べ")).toBe("conjugated");
    expect(first(taberu, "食べるな")).toBe("conjugated");
    expect(first(taberu, "食ベる")).toBe("script");
    const study = target({ kana: "べんきょう", surface: "勉強" });
    expect(first(study, "勉強する")).toBe("too_long");
  });

  it("中文简体 / 繁体字形：映回日文字形，nearMiss 不算对", () => {
    const economy = target({ kana: "けいざい", surface: "経済" });
    expect(checkSpelling(economy, "経済").correct).toBe(true);
    const simplified = checkSpelling(economy, "经济");
    expect(simplified).toMatchObject({ correct: false, nearMiss: true });
    expect(simplified.problems[0]).toMatchObject({ code: "chinese_form", typedChar: "经", expectedChar: "経" });
    const traditional = checkSpelling(economy, "經濟");
    expect(traditional.problems[0]).toMatchObject({ code: "traditional_form", typedChar: "經", expectedChar: "経" });
    expect(first(economy, "軽済")).toBe("wrong_kanji");
  });

  it("词库里被当作罕用写法收录的简体字形（烟草）不能算对；全角数字写法归一后能对上", () => {
    const tobacco = target({
      kana: "タバコ", surface: "タバコ", isLoanword: true,
      forms: [{ surface: "煙草", tag: "variant" }, { surface: "烟草", tag: "rare" }]
    });
    expect(checkSpelling(tobacco, "煙草").correct).toBe(true);
    const simplified = checkSpelling(tobacco, "烟草");
    expect(simplified).toMatchObject({ correct: false, nearMiss: true });
    expect(simplified.problems[0]).toMatchObject({ code: "chinese_form", typedChar: "烟", expectedChar: "煙" });
    const second = target({ kana: "ふつか", surface: "二日", forms: [{ surface: "二日", tag: "standard" }, { surface: "２日", tag: "variant" }] });
    for (const input of ["二日", "2日", "２日"]) expect(checkSpelling(second, input).correct, input).toBe(true);
  });

  it("同音词 / 同题面词（需要词库查询）", () => {
    const bridge = target({ kana: "はし", surface: "橋" });
    const chopsticks = { wordId: 2, surface: "箸", kana: "はし", meaning: "筷子" };
    const lookup: SpellingLookup = { bySurface: (surface) => surface === "箸" ? [chopsticks] : [], peers: () => [] };
    const verdict = checkSpelling(bridge, "箸", lookup);
    expect(verdict.problems[0]).toMatchObject({ code: "homophone", other: chopsticks });
    expect(verdict.nearMiss).toBe(false);
    // 不传 lookup 退成 wrong_kanji
    expect(first(bridge, "箸")).toBe("wrong_kanji");

    const police = target({ kana: "けいさつ", surface: "警察" });
    const officer = { wordId: 9, surface: "警察官", kana: "けいさつかん", meaning: "警察" };
    const peers: SpellingLookup = { bySurface: () => [], peers: () => [officer] };
    for (const input of ["警察官", "keisatsukan", "けいさつかん"]) {
      const verdict = checkSpelling(police, input, peers);
      expect(verdict.problems[0], input).toMatchObject({ code: "peer_word", other: officer });
      expect(verdict.nearMiss).toBe(true);
    }
    expect(checkSpelling(police, "keisatsu", peers).correct).toBe(true);
  });

  it("汉字和罗马音不会误判成对：词库没有这个汉字写法的假名词", () => {
    const dayAfter = target({ kana: "あさって", surface: "あさって", forms: [] });
    expect(first(dayAfter, "明後日")).toBe("wrong_kanji");
    const withForm = target({ kana: "あさって", surface: "あさって", forms: [{ surface: "明後日", tag: "variant" }] });
    expect(checkSpelling(withForm, "明後日")).toMatchObject({ correct: true, matched: { preferred: false } });
  });

  it("problems 按规格 §2 的顺序排（script 先于 long_vowel）", () => {
    // コーヒー 写成平假名且长音写法不同：两个问题同时存在，主要说文字种类
    const coffee = target({ kana: "コーヒー", surface: "コーヒー", isLoanword: true });
    const order = checkSpelling(coffee, "こうひい").problems.map((p) => p.code);
    expect(order[0]).toBe("script");
    expect(order).toContain("long_vowel");
  });
});
