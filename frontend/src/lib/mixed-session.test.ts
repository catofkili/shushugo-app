/**
 * 混合学习的出卡裁判（mixed-session.ts）：四种卡一条队列。
 *
 * 钉三件事：
 * 1. 单词手上有卡时每 5 个单词轮到一张别的卡，三种轮着来，今天没了的跳过；
 * 2. 单词没了就一直出别的卡，**三种都没了才返回 null** —— 完成只能由这里说
 *    （2026-10-10：网页有三条出口没问这一句，33 条语法被晾着就进了完成页）；
 * 3. 「上一个」按作答顺序分派到各卡种自己的撤销栈。
 *
 * 语法走真实的 grammar-quiz（出厂库）；汉字 / 辨析的出厂素材在 node 里加载不了，
 * 换成可控的假会话（只关心「有没有下一张」和「答了 / 撤了几次」）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;
const prefStore = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => prefStore.get(k) ?? null,
  setItem: (k: string, v: string) => { prefStore.set(k, String(v)); },
  removeItem: (k: string) => { prefStore.delete(k); },
  clear: () => prefStore.clear()
};
(globalThis as any).window = {
  dispatchEvent: () => true, addEventListener: () => undefined, removeEventListener: () => undefined
};
vi.mock("./database", () => ({
  getDatabase: () => testDb, initDatabase: async () => testDb,
  exportDatabase: () => null, importDatabase: async () => undefined
}));
vi.mock("./storage", () => ({ scheduleSave: () => undefined, requestFullSnapshot: () => undefined, persistSoon: () => undefined }));
vi.mock("./progress-events", () => ({ PROGRESS_UPDATED_EVENT: "test", notifyProgressUpdated: () => undefined }));

const fake = { kanji: [] as string[], confusion: [] as string[], answered: [] as string[], undone: [] as string[] };
vi.mock("./mixed-cards", () => ({
  mixedCardDataLoaded: () => true,
  getKanjiCardSession: () => ({ card: fake.kanji[0] ? { char: fake.kanji[0] } : null }),
  getConfusionCardSession: () => ({ card: fake.confusion[0] ? { groupKey: fake.confusion[0] } : null }),
  submitKanjiCardAnswer: (char: string) => { fake.answered.push(`kanji:${char}`); fake.kanji.shift(); },
  submitConfusionCardAnswer: (key: string) => { fake.answered.push(`confusion:${key}`); fake.confusion.shift(); },
  undoKanjiCardAnswer: () => { const char = fake.answered.pop()!.slice(6); fake.undone.push(char); fake.kanji.unshift(char); },
  undoConfusionCardAnswer: () => { const key = fake.answered.pop()!.slice(10); fake.undone.push(key); fake.confusion.unshift(key); }
}));

import { ensureProgressInitialized, getWordStats } from "./word-api";
import { getGrammarQuizSession } from "./grammar-quiz";
import { saveStudyPreferences, defaultStudyPreferences } from "./studyPreferences";
import {
  answerMixedOther, canUndoMixed, MIXED_EVERY, mixedTurnDue, mixedUndoKind, pickMixedNext,
  recordMixedWordAnswer, resetMixedSession, undoMixedOther, undoMixedWord, type MixedOtherItem
} from "./mixed-session";

const SQL = await initSqlJs();
const seedPath = fileURLToPath(new URL("../../public/nihongo.db", import.meta.url));
const one = (sql: string, p: unknown[] = []) => testDb.exec(sql, p as never)[0]?.values?.[0]?.[0] ?? null;

/** 答一个单词：计数 + 作答顺序（单词本身记不记账这里不关心） */
const answerWord = (wordLeft = true) => {
  recordMixedWordAnswer();
  return pickMixedNext({ word: wordLeft, afterWord: true });
};
const kindOf = (pick: ReturnType<typeof pickMixedNext>) => pick === null ? null : pick === "word" ? "word" : pick.kind;

beforeEach(() => {
  testDb = new SQL.Database(new Uint8Array(readFileSync(seedPath)));
  prefStore.clear();
  // N5 语法每天 2 条新的、出厂库没有到期复习 → 今天语法正好 2 张
  saveStudyPreferences({ ...defaultStudyPreferences, jlptTarget: "N5", grammarDailyGoal: 2 });
  ensureProgressInitialized();
  getWordStats();
  fake.kanji = ["水", "火"];
  fake.confusion = ["g1"];
  fake.answered = [];
  fake.undone = [];
  resetMixedSession();
});

describe("出卡顺序", () => {
  it("单词手上有卡时每 5 个单词轮到一张，语法 → 汉字 → 辨析轮着来", () => {
    const kinds: (string | null)[] = [];
    for (let i = 0; i < MIXED_EVERY * 3; i += 1) kinds.push(kindOf(answerWord()));
    expect(kinds.filter((kind) => kind !== "word")).toEqual(["grammar", "kanji", "confusion"]);
    expect(kinds[MIXED_EVERY - 1]).toBe("grammar");
    expect(kinds.slice(0, MIXED_EVERY - 1).every((kind) => kind === "word")).toBe(true);
  });

  it("快路径预判和真正轮到的那一下对得上", () => {
    for (let i = 0; i < MIXED_EVERY - 1; i += 1) {
      expect(mixedTurnDue()).toBe(false);
      expect(answerWord()).toBe("word");
    }
    expect(mixedTurnDue()).toBe(true);
    expect(kindOf(answerWord())).toBe("grammar");
  });

  it("今天没了的那种跳过", () => {
    fake.kanji = [];
    const others = Array.from({ length: MIXED_EVERY * 2 }, () => kindOf(answerWord())).filter((kind) => kind !== "word");
    expect(others).toEqual(["grammar", "confusion"]);
  });

  it("单词没了：一直出别的卡，三种都答完才返回 null", () => {
    const seen: string[] = [];
    let pick = pickMixedNext({ word: false });
    while (pick && pick !== "word") {
      seen.push(pick.kind);
      answerMixedOther(pick, "known_forever");
      pick = pickMixedNext({ word: false });
    }
    expect(pick).toBeNull();
    // 语法 2 张、汉字 2 张、辨析 1 张，一张不落
    expect(seen.sort()).toEqual(["confusion", "grammar", "grammar", "kanji", "kanji"]);
    expect(getGrammarQuizSession("N5").card).toBeNull();
  });

  it("最后一个单词答完那一下就接上别的卡（10-10 那个 bug 的形状）", () => {
    // 计数还没到 5，但单词已经没了
    expect(kindOf(answerWord(true))).toBe("word");
    expect(kindOf(answerWord(false))).toBe("grammar");
  });
});

describe("「上一个」", () => {
  it("混合模式进页面还没答过：不亮", () => {
    expect(canUndoMixed(true, true)).toBe(false);
    expect(canUndoMixed(false, true)).toBe(true);
  });

  it("答完语法再撤：撤的是那条语法，并把它重新摆出来；再撤才轮到单词", () => {
    answerWord();
    const grammar = pickMixedNext({ word: false }) as MixedOtherItem;
    expect(grammar.kind).toBe("grammar");
    const gid = grammar.kind === "grammar" ? grammar.card.id : 0;
    answerMixedOther(grammar, "known_forever");
    expect(one("SELECT COUNT(*) FROM grammar_reviews WHERE grammar_id = ?", [gid])).toBe(1);
    expect(canUndoMixed(true, true)).toBe(true);

    const back = undoMixedOther();
    expect(back?.kind === "grammar" && back.card.id).toBe(gid);
    expect(one("SELECT COUNT(*) FROM grammar_reviews WHERE grammar_id = ?", [gid])).toBe(0);
    expect(mixedUndoKind()).toBe("word");
    expect(undoMixedOther()).toBeNull();
  });

  it("汉字 / 辨析按栈顶分派到各自那份", () => {
    fake.kanji = ["水"];
    answerMixedOther({ kind: "kanji", card: { char: "水" } } as MixedOtherItem, "know");
    answerMixedOther({ kind: "confusion", card: { groupKey: "g1" } } as MixedOtherItem, "know");
    expect(undoMixedOther()?.kind).toBe("confusion");
    expect(undoMixedOther()?.kind).toBe("kanji");
    expect(fake.undone).toEqual(["g1", "水"]);
  });

  it("撤掉带出别的卡的那个单词：计数和轮次一起退回，再答一次还是同一种", () => {
    for (let i = 0; i < MIXED_EVERY - 1; i += 1) answerWord();
    expect(kindOf(answerWord())).toBe("grammar");
    undoMixedWord({ otherShowing: true });
    expect(mixedTurnDue()).toBe(true);
    expect(kindOf(answerWord())).toBe("grammar");
  });

  it("撤销栈只留最近两笔（和各卡种自己的栈一样长）", () => {
    answerWord();
    answerMixedOther({ kind: "kanji", card: { char: "水" } } as MixedOtherItem, "know");
    answerMixedOther({ kind: "kanji", card: { char: "火" } } as MixedOtherItem, "know");
    undoMixedOther();
    undoMixedOther();
    expect(mixedUndoKind()).toBeNull();
  });

});
