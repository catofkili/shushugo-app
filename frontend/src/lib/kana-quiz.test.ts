import { describe, expect, it, vi } from "vitest";

vi.mock("./database", () => ({ getDatabase: () => { throw new Error("kana-quiz 不该碰数据库"); } }));
vi.mock("./storage", () => ({ requestFullSnapshot: vi.fn(), scheduleSave: vi.fn() }));

import { KANA } from "./kana-progress";
import { buildKanaQuestion, nextKanaStep, type KanaQuestionType } from "./kana-quiz";

const ALL = new Set(KANA.map(([kana]) => kana));
const ROMAJI = new Map<string, string>(KANA.map(([kana, romaji]) => [kana, romaji]));

describe("五十音考题", () => {
  it("92 个字的每种题都是四个不同选项、恰好一个对", () => {
    for (const [kana, romaji] of KANA) {
      const types: KanaQuestionType[] = ["read", "write", "pair"];
      for (const type of types) {
        const q = buildKanaQuestion(kana, type, ALL);
        expect(q.choices).toHaveLength(4);
        expect(new Set(q.choices.map((c) => c.label)).size).toBe(4);
        expect(q.choices.filter((c) => c.correct)).toHaveLength(1);
        const answer = q.choices.find((c) => c.correct)!.label;
        if (type === "read") expect(answer).toBe(romaji);
        if (type === "write") expect(answer).toBe(kana);
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

  it("模拟一个全答对的人：先教后考、不连出同一个字、每个字的两次考法不同、能学完", () => {
    const progress: Record<string, number> = {};
    const introduced = new Set<string>();
    const types = new Map<string, KanaQuestionType[]>();
    let recent: string[] = [];
    let questions = 0;
    let teaches = 0;
    for (let step = nextKanaStep(progress, introduced, recent); step; step = nextKanaStep(progress, introduced, recent)) {
      const symbol = step.kind === "teach" ? step.teach.symbol : step.question.symbol;
      expect(recent).not.toContain(symbol);
      if (step.kind === "teach") {
        expect(introduced.has(symbol)).toBe(false);
        teaches += 1;
      } else {
        expect(introduced.has(symbol)).toBe(true);
        // 读词题不能出现还没教过的字
        if (step.question.type === "word") expect([...step.question.prompt].every((ch) => introduced.has(ch))).toBe(true);
        if ((progress[symbol] ?? 0) < 2) types.set(symbol, [...types.get(symbol) ?? [], step.question.type]);
        progress[symbol] = Math.min(2, (progress[symbol] ?? 0) + 1);
        questions += 1;
      }
      introduced.add(symbol);
      recent = [symbol, ...recent].slice(0, 2);
      expect(questions).toBeLessThan(400);
    }
    expect(teaches).toBe(92);
    for (const [, [first, second]] of types) {
      expect(first).toBe("read");
      expect(second).not.toBe("read");
    }
    // 92 字 × 2 次 + 约五分之一回炉
    expect(questions).toBeGreaterThan(184);
  });

  it("老用户：答过但没学会的字直接考，不再教；答错的回炉字重新进入学习", () => {
    const progress: Record<string, number> = { あ: 2, い: 0, う: 1 };
    const step = nextKanaStep(progress, new Set(["あ", "い", "う"]), [], () => 0.99);
    expect(step?.kind).toBe("teach");
    expect(step?.kind === "teach" && step.teach.symbol).toBe("え");
    const full = Object.fromEntries(KANA.map(([kana]) => [kana, 2]));
    expect(nextKanaStep(full, ALL, [])).toBeNull();
  });
});
