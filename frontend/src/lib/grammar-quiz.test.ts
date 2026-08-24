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
(globalThis as any).window = { dispatchEvent: () => true };

vi.mock("./database", () => ({
  getDatabase: () => testDb,
  initDatabase: async () => testDb,
  exportDatabase: () => null,
  importDatabase: async () => undefined
}));
vi.mock("./storage", () => ({ scheduleSave: () => undefined }));

import {
  getGrammarQuizSession,
  grammarQuizRanking,
  shuffle,
  startGrammarQuizRound,
  submitGrammarQuizAnswer
} from "./grammar-quiz";

const SQL = await initSqlJs();
const seedPath = fileURLToPath(new URL("../../public/nihongo.db", import.meta.url));
const LEVEL = "N5";

/** 确定性随机源，让洗牌可复现 */
const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

const runWholeRound = (answer: (i: number) => "forgot" | "know") => {
  let session = getGrammarQuizSession(LEVEL);
  const seen: number[] = [];
  let guard = 0;
  while (session.card && guard++ < 500) {
    seen.push(session.card.id);
    session = submitGrammarQuizAnswer(LEVEL, session.card.id, answer(seen.length - 1));
  }
  return { seen, session };
};

describe("语法考题（无 FSRS，一轮乱序不重复）", () => {
  beforeEach(() => {
    testDb = new SQL.Database(new Uint8Array(readFileSync(seedPath)));
    testDb.run("DELETE FROM grammar_state WHERE key LIKE 'quiz_round:%'");
  });

  it("题面是句型，答案是接续 + 中文意", () => {
    const { card } = startGrammarQuizRound(LEVEL, seeded(7));
    expect(card).not.toBeNull();
    expect(card!.pattern).not.toBe("");
    expect(card!.formation).not.toBe("");
    expect(card!.meaning).not.toBe("");
    expect(card!.level).toBe(LEVEL);
  });

  it("一轮之内每条只出现一次，走完正好是该等级的条数", () => {
    const total = startGrammarQuizRound(LEVEL, seeded(1)).total;
    expect(total).toBe(120); // N5

    const { seen, session } = runWholeRound(() => "know");
    expect(seen).toHaveLength(total);
    expect(new Set(seen).size).toBe(total); // 不重复
    expect(session.card).toBeNull();        // 走完了
    expect(session.done).toBe(total);
  });

  it("答错也不会在本轮里再出现一次 —— 一轮不重复是这个模式的定义", () => {
    startGrammarQuizRound(LEVEL, seeded(3));
    const { seen } = runWholeRound(() => "forgot");
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("是乱序的，而且换一轮顺序会变", () => {
    const first = startGrammarQuizRound(LEVEL, seeded(11));
    const orderA: number[] = [];
    let s = first;
    while (s.card && orderA.length < 12) {
      orderA.push(s.card.id);
      s = submitGrammarQuizAnswer(LEVEL, s.card.id, "know");
    }
    // 和按 sort_order 的自然顺序不同
    const natural = testDb.exec("SELECT id FROM grammar_points WHERE level='N5' ORDER BY sort_order LIMIT 12")[0]
      .values.map((v) => Number(v[0]));
    expect(orderA).not.toEqual(natural);

    testDb.run("DELETE FROM grammar_state WHERE key LIKE 'quiz_round:%'");
    const second = startGrammarQuizRound(LEVEL, seeded(99));
    const orderB: number[] = [];
    let t = second;
    while (t.card && orderB.length < 12) {
      orderB.push(t.card.id);
      t = submitGrammarQuizAnswer(LEVEL, t.card.id, "know");
    }
    expect(orderB).not.toEqual(orderA);
  });

  it("重开一轮轮次号会往上加", () => {
    expect(startGrammarQuizRound(LEVEL, seeded(1)).seq).toBe(1);
    expect(startGrammarQuizRound(LEVEL, seeded(2)).seq).toBe(2);
    expect(startGrammarQuizRound(LEVEL, seeded(3)).seq).toBe(3);
  });

  it("答错累加 forgot_count，答对累加 right_count", () => {
    const session = startGrammarQuizRound(LEVEL, seeded(5));
    const id = session.card!.id;
    submitGrammarQuizAnswer(LEVEL, id, "forgot");
    const after = testDb.exec(
      "SELECT forgot_count, right_count, seen_count FROM grammar_progress WHERE grammar_id = ?", [id]
    )[0].values[0];
    expect(after).toEqual([1, 0, 1]);

    startGrammarQuizRound(LEVEL, seeded(5));
    submitGrammarQuizAnswer(LEVEL, id, "know");
    const later = testDb.exec(
      "SELECT forgot_count, right_count FROM grammar_progress WHERE grammar_id = ?", [id]
    )[0].values[0];
    expect(later).toEqual([1, 1]);
  });

  it("标了熟知就退出题库，下一轮不再出现", () => {
    const session = startGrammarQuizRound(LEVEL, seeded(13));
    const retired = session.card!.id;
    submitGrammarQuizAnswer(LEVEL, retired, "known_forever");

    const next = startGrammarQuizRound(LEVEL, seeded(13));
    expect(next.total).toBe(119);
    const { seen } = runWholeRound(() => "know");
    expect(seen).not.toContain(retired);
  });

  it("刷新之后接着上次那张，不会从头再来", () => {
    startGrammarQuizRound(LEVEL, seeded(21));
    let s = getGrammarQuizSession(LEVEL);
    s = submitGrammarQuizAnswer(LEVEL, s.card!.id, "know");
    s = submitGrammarQuizAnswer(LEVEL, s.card!.id, "know");
    const expected = s.card!.id;
    expect(getGrammarQuizSession(LEVEL).card!.id).toBe(expected);
    expect(getGrammarQuizSession(LEVEL).done).toBe(2);
  });

  it("外部排序：错得最多的排最前，没答过的排最后", () => {
    // 出厂库里 grammar_progress 是空的（它在 bake-seed-db 的 userDataTables 里，
    // 非空就拒绝烧库），所以得先让它把每条建一行，否则下面的 UPDATE 全打空。
    startGrammarQuizRound(LEVEL, seeded(1));
    const ids = testDb.exec("SELECT id FROM grammar_points WHERE level='N5' ORDER BY sort_order LIMIT 3")[0]
      .values.map((v) => Number(v[0]));
    testDb.run("UPDATE grammar_progress SET forgot_count = 5, seen_count = 6 WHERE grammar_id = ?", [ids[2]]);
    testDb.run("UPDATE grammar_progress SET forgot_count = 2, seen_count = 4 WHERE grammar_id = ?", [ids[0]]);

    const ranked = grammarQuizRanking(LEVEL);
    expect(ranked[0].id).toBe(ids[2]);
    expect(ranked[1].id).toBe(ids[0]);
    expect(ranked[ranked.length - 1].seenCount).toBe(0);
    expect(ranked).toHaveLength(120);
  });

  it("shuffle 不丢元素也不重复", () => {
    const input = Array.from({ length: 50 }, (_, i) => i);
    const out = shuffle(input, seeded(4));
    expect(out).toHaveLength(50);
    expect(new Set(out).size).toBe(50);
    expect(out).not.toEqual(input);
  });
});
