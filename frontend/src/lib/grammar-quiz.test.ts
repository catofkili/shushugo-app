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
  extendGrammarQuizPlan,
  getGrammarQuizSession,
  grammarNewQuota,
  grammarQuizRanking,
  submitGrammarQuizAnswer,
  undoLastGrammarQuizAnswer,
  type GrammarQuizAnswer
} from "./grammar-quiz";
import { today } from "./study-core";

const SQL = await initSqlJs();
const seedPath = fileURLToPath(new URL("../../public/nihongo.db", import.meta.url));
const LEVEL = "N5";

const progressOf = (id: number, columns: string) =>
  testDb.exec(`SELECT ${columns} FROM grammar_progress WHERE grammar_id = ?`, [id])[0].values[0];

/** 一直答到今天没有卡为止 */
const drain = (answer: (index: number) => GrammarQuizAnswer) => {
  let session = getGrammarQuizSession(LEVEL);
  const seen: number[] = [];
  let guard = 0;
  while (session.card && guard++ < 600) {
    seen.push(session.card.id);
    session = submitGrammarQuizAnswer(LEVEL, session.card.id, answer(seen.length - 1));
  }
  return { seen, session };
};

describe("语法考题（和单词同一套 FSRS）", () => {
  beforeEach(() => {
    testDb = new SQL.Database(new Uint8Array(readFileSync(seedPath)));
    prefStore.clear();
  });

  it("题面是句型，答案是接续 + 中文意 + 例句", () => {
    const { card } = getGrammarQuizSession(LEVEL);
    expect(card).not.toBeNull();
    expect(card!.pattern).not.toBe("");
    expect(card!.formation).not.toBe("");
    expect(card!.meaning).not.toBe("");
    expect(card!.exampleJp).not.toBe("");
    expect(card!.level).toBe(LEVEL);
    // 全新库里第一批全是没学过的
    expect(card!.isNew).toBe(true);
  });

  it("⚠️ 一天只放新语法配额那么多条，不再是「把整个等级洗一遍」", () => {
    const quota = grammarNewQuota(LEVEL);
    expect(quota).toBeGreaterThan(0);
    expect(quota).toBeLessThan(120); // N5 一共 120 条
    // 首答就点认识 = Easy，当天直接毕业，所以一场正好走完配额
    const { seen } = drain(() => "know");
    expect(new Set(seen).size).toBe(quota);
  });

  it("当天首答点认识就毕业；答错的当天还要再出", () => {
    const first = getGrammarQuizSession(LEVEL).card!;
    submitGrammarQuizAnswer(LEVEL, first.id, "know");
    const due = String(progressOf(first.id, "fsrs_due")[0]);
    expect(new Date(due).getTime()).toBeGreaterThan(Date.now() + 3600_000);

    const second = getGrammarQuizSession(LEVEL).card!;
    expect(second.id).not.toBe(first.id);
    submitGrammarQuizAnswer(LEVEL, second.id, "forgot");
    // 忘记 → 学习步骤里，下次到期就在几分钟后（当天还得再刷）
    const retryDue = new Date(String(progressOf(second.id, "fsrs_due")[0])).getTime();
    expect(retryDue).toBeLessThan(Date.now() + 3600_000);
    const { seen } = drain(() => "know");
    expect(seen).toContain(second.id);
  });

  it("四档评分都记账：模糊有自己的一栏（以前没有调度器接 Hard 档）", () => {
    const ids = drain(() => "know").seen;
    testDb.run("DELETE FROM grammar_reviews");
    const [a, b, c] = ids;
    testDb.run("UPDATE grammar_progress SET seen_count = 0, right_count = 0, fsrs_due = NULL");
    submitGrammarQuizAnswer(LEVEL, a, "fuzzy");
    submitGrammarQuizAnswer(LEVEL, b, "forgot");
    submitGrammarQuizAnswer(LEVEL, c, "know");
    expect(progressOf(a, "fuzzy_count, right_count, forgot_count")).toEqual([1, 0, 0]);
    expect(progressOf(b, "fuzzy_count, right_count, forgot_count")).toEqual([0, 0, 1]);
    expect(progressOf(c, "fuzzy_count, right_count, forgot_count")).toEqual([0, 1, 0]);
  });

  it("每次作答都记一条 grammar_reviews 流水 —— 备考页的「今天做了多少」读的是它", () => {
    const card = getGrammarQuizSession(LEVEL).card!;
    submitGrammarQuizAnswer(LEVEL, card.id, "know");
    const row = testDb.exec(
      "SELECT grammar_id, answer, reviewed_on FROM grammar_reviews"
    )[0].values[0];
    expect(row).toEqual([card.id, "know", today()]);
  });

  it("标了熟知就退出题库，不再出现", () => {
    const retired = getGrammarQuizSession(LEVEL).card!.id;
    submitGrammarQuizAnswer(LEVEL, retired, "known_forever");
    expect(progressOf(retired, "known_forever")).toEqual([1]);
    const { seen } = drain(() => "know");
    expect(seen).not.toContain(retired);
  });

  it("答错的不会当场再问一遍 —— 贴脸重复只是抄写，不是回忆", () => {
    const first = getGrammarQuizSession(LEVEL).card!.id;
    expect(submitGrammarQuizAnswer(LEVEL, first, "forgot").card!.id).not.toBe(first);
  });

  it("但连着错到阈值就当场接着刷 —— 顽固卡越出越密才攻得下来", () => {
    const id = getGrammarQuizSession(LEVEL).card!.id;
    submitGrammarQuizAnswer(LEVEL, id, "forgot");
    submitGrammarQuizAnswer(LEVEL, id, "forgot");
    const session = submitGrammarQuizAnswer(LEVEL, id, "forgot");
    expect(session.card!.id).toBe(id);
  });

  it("刷新之后接着到期的那批，不会从头再来", () => {
    const first = getGrammarQuizSession(LEVEL).card!.id;
    submitGrammarQuizAnswer(LEVEL, first, "know");
    const next = getGrammarQuizSession(LEVEL).card!.id;
    expect(getGrammarQuizSession(LEVEL).card!.id).toBe(next);
    expect(next).not.toBe(first);
  });

  it("上一个会回到刚答的那条，FSRS 状态和流水一起回滚", () => {
    const first = getGrammarQuizSession(LEVEL).card!.id;
    submitGrammarQuizAnswer(LEVEL, first, "forgot");
    expect(progressOf(first, "seen_count, forgot_count")).toEqual([1, 0 + 1]);

    const restored = undoLastGrammarQuizAnswer(LEVEL);
    expect(restored.card!.id).toBe(first);
    expect(restored.canUndo).toBe(false);
    expect(progressOf(first, "seen_count, forgot_count, mistake_streak")).toEqual([0, 0, 0]);
    // 撤销必须连 FSRS 一起回滚：只回滚计数的话，这条会带着一个凭空出现的 due 留在调度里
    expect(progressOf(first, "fsrs_due")).toEqual([null]);
    expect(testDb.exec("SELECT COUNT(*) FROM grammar_reviews")[0].values[0]).toEqual([0]);
  });

  it("撤销熟知会恢复原卡，不会被题库过滤后跳到别处", () => {
    const id = getGrammarQuizSession(LEVEL).card!.id;
    const next = submitGrammarQuizAnswer(LEVEL, id, "known_forever");
    expect(next.card?.id).not.toBe(id);

    const restored = undoLastGrammarQuizAnswer(LEVEL);
    expect(restored.card!.id).toBe(id);
    expect(progressOf(id, "known_forever, seen_count")).toEqual([0, 0]);
  });

  it("没有可撤销历史时，上一个原样停在当前卡，不重新抽题", () => {
    const card = getGrammarQuizSession(LEVEL).card!;
    const same = undoLastGrammarQuizAnswer(LEVEL);
    expect(same.card!.id).toBe(card.id);
    expect(same.canUndo).toBe(false);
  });

  it("今天的过完了就没卡了；加餐才会再放新的进来", () => {
    const { session } = drain(() => "know");
    expect(session.card).toBeNull();
    expect(session.remaining).toBe(0);

    const extended = extendGrammarQuizPlan(LEVEL, 5);
    expect(extended.card).not.toBeNull();
    expect(extended.card!.isNew).toBe(true);
    expect(extended.remaining).toBe(5);
  });

  it("卡上带着「接续标在 `～` 头上」那一段（判据在 grammar-formation）", () => {
    const annotated = (["N5", "N4", "N3", "N2", "N1"] as const)
      .flatMap((level) => grammarQuizRanking(level))
      .filter((row) => row.attachment);
    // 出厂库 741 条里 554 条标得出来，其余的判不准，宁可不标
    expect(annotated.length).toBeGreaterThan(500);
    annotated.forEach((row) => {
      expect(row.pattern).toMatch(/[～〜~]/);
      // 标的每一段都必须是接续原文里真有的字，不能是拼出来的
      row.attachment!.split("／").forEach((part) => expect(row.formation).toContain(part));
    });
  });

  it("外部排序：错得最多的排最前，没答过的排最后", () => {
    getGrammarQuizSession(LEVEL); // 建 grammar_progress 行
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
});
