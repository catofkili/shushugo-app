/**
 * 起点先验之后，四类新内容都要从先验没盖到的那一级接着顺推（2026-10-28 修）。
 * 之前：单词 N5/N4/N3 同档随机（起点 N5 考 N3 头 40 词 30 个 N3）、混合模式语法只出目标级、
 * 汉字只按出现次数、辨析只按学过成员数 —— 都不看起点。
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, String(value)), removeItem: (key: string) => store.delete(key) };
(globalThis as any).window = { dispatchEvent: () => true, addEventListener: () => undefined, removeEventListener: () => undefined };
let testDb: Database;
vi.mock("./database", () => ({ getDatabase: () => testDb, initDatabase: async () => testDb, exportDatabase: () => null, importDatabase: async () => undefined }));
vi.mock("./storage", () => ({ requestFullSnapshot: vi.fn(), scheduleSave: vi.fn() }));

import { ensureUserTables, today } from "./study-core";
import { saveLevelPlanSettings } from "./level-plan";
import { planLevelRanks } from "./plan-level-order";
import { createStage1Tasks } from "./word-api/stage1";
import { getGrammarQuizSession, PLAN_GRAMMAR_LEVEL, submitGrammarQuizAnswer } from "./grammar-quiz";
import { createKanjiCharTasks } from "./kanji-char-cards";
import { createConfusionTasks } from "./confusion-cards";

const rows = (sql: string, params: Array<string | number> = []) => {
  const result = testDb.exec(sql, params)[0];
  return result ? result.values.map((values) => Object.fromEntries(result.columns.map((column, index) => [column, values[index]]))) : [];
};

describe("planLevelRanks", () => {
  it("起点上一级排第一档，逐级顺推，超出目标的排最后", () => {
    expect(planLevelRanks("N5", 75, "N3")).toEqual([0, 0, 1, 103, 104]);
    expect(planLevelRanks("N4", 75, "N3")).toEqual([0, 0, 0, 103, 104]);
    // 目标 N4：N3 不能和 N4 混在一起
    expect(planLevelRanks("N5", 75, "N4")).toEqual([0, 0, 102, 103, 104]);
  });
  it("起点那一级熟悉度为 0 时先验不写它，从起点本级开始", () => {
    expect(planLevelRanks("N5", 0, "N3")).toEqual([0, 1, 2, 103, 104]);
  });
  it("没有 JLPT 起点（五十音 / 专业进阶 / 没设过）从 N5 顺推", () => {
    expect(planLevelRanks("kana", 0, "N3")).toEqual([0, 1, 2, 103, 104]);
    expect(planLevelRanks("", undefined, "N2")).toEqual([0, 1, 2, 3, 104]);
  });
});

describe("起点 N5、考 N3：先验之后新内容从 N4 开始", () => {
  const day = today();
  let carriedN3 = 0;

  beforeAll(async () => {
    const SQL = await initSqlJs();
    testDb = new SQL.Database(new Uint8Array(readFileSync(fileURLToPath(new URL("../../public/nihongo.db", import.meta.url)))));
    ensureUserTables();
    await saveLevelPlanSettings({
      startingLevel: "N5",
      familiarity: { words: 75, grammar: 75, kanji: 75, confusion: 75 },
      target: "N3",
      examDate: "2026-12-06",
      startedOn: day
    });
    // 修之前同档随机排进来、昨天没背到的 N3 词：「欠着的」不能插到 N4 前面。
    carriedN3 = Number(rows("SELECT w.id FROM words w JOIN progress p ON p.word_id = w.id WHERE w.jlpt_level = 'N3' AND p.seen_count = 0 LIMIT 1")[0].id);
    testDb.run("DELETE FROM stage1_tasks WHERE reviewed_on = ?", [day]);
    testDb.run("INSERT INTO stage1_tasks (reviewed_on, word_id, task_type, order_index) VALUES ('2026-01-01', ?, 'new', 1)", [carriedN3]);
  });

  it("单词：当天新词全是 N4（含昨天欠着的 N3 也不插队）", () => {
    createStage1Tasks(day);
    const levels = rows(`
      SELECT w.jlpt_level AS level, t.word_id AS id FROM stage1_tasks t JOIN words w ON w.id = t.word_id
      WHERE t.reviewed_on = ? AND t.task_type = 'new'
    `, [day]);
    expect(levels.length).toBeGreaterThan(0);
    expect(new Set(levels.map((row) => row.level))).toEqual(new Set(["N4"]));
    expect(levels.some((row) => Number(row.id) === carriedN3)).toBe(false);
  });

  it("语法：混合模式的新条目来自 N4，不是目标级 N3；复习先验里的 N5 不扣新语法名额", () => {
    const newLevels: string[] = [];
    let session = getGrammarQuizSession(PLAN_GRAMMAR_LEVEL);
    for (let step = 0; step < 80 && session.card; step += 1) {
      const card = session.card;
      const seen = Number(rows("SELECT seen_count FROM grammar_progress WHERE grammar_id = ?", [card.id])[0]?.seen_count ?? 0);
      if (seen === 0) newLevels.push(card.level);
      session = submitGrammarQuizAnswer(PLAN_GRAMMAR_LEVEL, card.id, "know");
    }
    expect(newLevels.length).toBeGreaterThan(0);
    expect(new Set(newLevels)).toEqual(new Set(["N4"]));
    expect(newLevels.length).toBe(session.newQuota);
  });

  it("汉字 / 辨析：新学先按级别顺推，第一张是 N4，后面不会倒回更低", () => {
    createKanjiCharTasks({ fresh: 10, review: 0 }, 2, day);
    createConfusionTasks({ fresh: 10, review: 0 }, 2, day);
    for (const [tasks, memory, key] of [["kanji_char_tasks", "kanji_char_memory", "char"], ["confusion_tasks", "confusion_progress", "group_key"]]) {
      const ranks = rows(`
        SELECT m.level_rank AS rank FROM ${tasks} t JOIN ${memory} m ON m.${key} = t.${key}
        WHERE t.reviewed_on = ? AND m.seen_count = 0 ORDER BY t.order_index
      `, [day]).map((row) => Number(row.rank));
      expect(ranks.length, tasks).toBeGreaterThan(0);
      expect(ranks[0], tasks).toBe(1);
      expect(ranks, tasks).toEqual([...ranks].sort((a, b) => a - b));
    }
  });
});
