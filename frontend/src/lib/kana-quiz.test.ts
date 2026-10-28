import { describe, expect, it, vi } from "vitest";

vi.mock("./database", () => ({ getDatabase: () => { throw new Error("kana-quiz 不该碰数据库"); } }));
vi.mock("./storage", () => ({ requestFullSnapshot: vi.fn(), scheduleSave: vi.fn() }));

import { KANA, kanaStateFrom, type KanaState } from "./kana-progress";
import { buildKanaQuestion, nextKanaStep, type KanaQuestionType } from "./kana-quiz";

const ALL = new Set(KANA.map(([kana]) => kana));
const ROMAJI = new Map<string, string>(KANA.map(([kana, romaji]) => [kana, romaji]));

describe("五十音考题", () => {
  it("92 个字的每种题都是四个不同选项、恰好一个对", () => {
    for (const [kana, romaji] of KANA) {
      const types: KanaQuestionType[] = ["read", "write", "pair", "listen"];
      for (const type of types) {
        const q = buildKanaQuestion(kana, type, ALL);
        expect(q.choices).toHaveLength(4);
        expect(new Set(q.choices.map((c) => c.label)).size).toBe(4);
        expect(q.choices.filter((c) => c.correct)).toHaveLength(1);
        const answer = q.choices.find((c) => c.correct)!.label;
        if (type === "read") expect(answer).toBe(romaji);
        if (type === "write" || type === "listen") expect(answer).toBe(kana);
        if (type !== "word") expect(q.sound).toBe(romaji);
        // 写字题、平片题的错项读音都不能和正确项相同，否则两个都算对
        if (type !== "read") expect(new Set(q.choices.map((c) => ROMAJI.get(c.label))).size).toBe(4);
      }
    }
  });

  it("干扰项带上形近字：ぬ 的题里一定有 め，シ 的题里一定有 ツ", () => {
    for (let n = 0; n < 20; n += 1) {
      expect(buildKanaQuestion("ぬ", "write", ALL).choices.map((c) => c.label)).toContain("め");
      expect(buildKanaQuestion("ぬ", "read", ALL).choices.map((c) => c.label)).toContain("me");
      expect(buildKanaQuestion("シ", "write", ALL).choices.map((c) => c.label)).toContain("ツ");
      expect(buildKanaQuestion("ネ", "pair", ALL).choices.map((c) => c.label)).toEqual(expect.arrayContaining(["ね", "れ", "わ"]));
    }
  });

  it("读词题：词只由学过的字组成，四个读法不同，错项是换了一个字", () => {
    const introduced = new Set(["い", "ぬ", "ね", "こ", "あ", "お"]);
    for (let n = 0; n < 20; n += 1) {
      const q = buildKanaQuestion("ぬ", "word", introduced);
      expect(q.prompt).toBe("いぬ");
      expect(q.choices.find((c) => c.correct)!.label).toBe("inu");
      expect(new Set(q.choices.map((c) => c.label)).size).toBe(4);
      expect(q.reveal).toContain("狗");
    }
  });

  it("听音题的错项是同行 / 同段的音，不是形近字", () => {
    for (let n = 0; n < 20; n += 1) {
      const labels = buildKanaQuestion("ぬ", "listen", ALL).choices.map((c) => c.label);
      expect(labels).not.toContain("め");
      expect(labels.filter((k) => k !== "ぬ").every((k) => ROMAJI.get(k)!.startsWith("n") || ROMAJI.get(k)!.endsWith("u"))).toBe(true);
    }
  });

  it("模拟一个全答对的人按天学：最快第三天学完；第二天进度先掉回去；不连出同一个字", () => {
    const reviews = new Map<string, { answer: string; reviewed_on: string }[]>();
    const statesOn = (day: string): Record<string, KanaState> =>
      Object.fromEntries(KANA.map(([kana]) => [kana, kanaStateFrom(reviews.get(kana) ?? [], day)]));
    const known = (states: Record<string, KanaState>) => Object.values(states).filter((s) => s.stage === "passed" || s.stage === "mastered").length;
    const introduced = new Set<string>();
    const log: { day: number; startKnown: number; endKnown: number; questions: number; teaches: number }[] = [];
    let finishedOn = 0;
    for (let day = 1; day <= 6 && !finishedOn; day += 1) {
      const date = `d${day}`;
      let recent: string[] = [];
      let questions = 0;
      let teaches = 0;
      const startKnown = known(statesOn(date));
      for (let step = nextKanaStep(statesOn(date), introduced, recent); step && step.kind !== "rest"; step = nextKanaStep(statesOn(date), introduced, recent)) {
        const symbol = step.kind === "teach" ? step.teach.symbol : step.question.symbol;
        expect(recent).not.toContain(symbol);
        if (step.kind === "teach") teaches += 1;
        else {
          if (step.question.type === "word") expect([...step.question.prompt].every((ch) => introduced.has(ch))).toBe(true);
          reviews.set(symbol, [...reviews.get(symbol) ?? [], { answer: "know", reviewed_on: date }]);
          questions += 1;
        }
        introduced.add(symbol);
        recent = [symbol, ...recent].slice(0, 2);
        expect(questions).toBeLessThan(600);
      }
      if (nextKanaStep(statesOn(date), introduced, []) === null) finishedOn = day;
      log.push({ day, startKnown, endKnown: known(statesOn(date)), questions, teaches });
    }
    expect(finishedOn).toBe(3);
    expect(log[0]).toMatchObject({ startKnown: 0, endKnown: 92, teaches: 92 });
    // 第二天一开始，前一天的「会了」全部打回
    expect(log[1].startKnown).toBe(0);
    expect(log[1].teaches).toBe(0);
    // 第二、三天每个字至少重考一次
    expect(log[1].questions).toBeGreaterThanOrEqual(92);
  });

  it("老用户：答过但没过关的字直接考，不再教", () => {
    const states: Record<string, KanaState> = {
      あ: { stage: "passed", days: 1, todayCorrect: 2 }, い: { stage: "learning", days: 0, todayCorrect: 0 }, う: { stage: "learning", days: 0, todayCorrect: 1 }
    };
    const step = nextKanaStep(states, new Set(["あ", "い", "う"]), [], () => 0.99);
    expect(step?.kind === "teach" && step.teach.symbol).toBe("え");
    const full = Object.fromEntries(KANA.map(([kana]) => [kana, { stage: "mastered", days: 3, todayCorrect: 0 } as KanaState]));
    expect(nextKanaStep(full, ALL, [])).toBeNull();
  });
});
