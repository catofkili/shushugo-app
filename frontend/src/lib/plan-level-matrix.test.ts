/**
 * 起点 × 目标的投放矩阵（2026-10-28 级别普查后补）。
 *
 * plan-level-order.test.ts 只测了「起点 N5、目标 N3」一格，所以汉字单元模式漏接计划（自带目标、默认 N1）
 * 一直没人发现。这里对每个新内容入口、每个起点 × 目标组合断言第一批新内容的级别：
 * 起点上一级先出；起点 ≥ 目标时（范围里没有可学的）单词接着往超纲走、语法 / 汉字字卡 / 辨析不出新的。
 * 新增任何「挑新内容」的入口，都要在这里加一行 —— 不加，就等于又一个各抄各的默认。
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
import { JLPT_TARGETS, type JlptTarget } from "./jlpt/plan";
import { createStage1Tasks } from "./word-api/stage1";
import { getGrammarQuizSession, PLAN_GRAMMAR_LEVEL, submitGrammarQuizAnswer } from "./grammar-quiz";
import { createKanjiCharTasks } from "./kanji-char-cards";
import { createConfusionTasks } from "./confusion-cards";
import { createKanjiUnitTasks, getKanjiUnitTargetLevelRank } from "./kanji-unit-scheduler";
import { kanjiUnitByKey, loadKanjiUnitIndex } from "./kanji-unit-index";

const seed = readFileSync(fileURLToPath(new URL("../../public/nihongo.db", import.meta.url)));
const rows = (sql: string, params: Array<string | number> = []) => {
  const result = testDb.exec(sql, params)[0];
  return result ? result.values.map((values) => Object.fromEntries(result.columns.map((column, index) => [column, values[index]]))) : [];
};

const STARTS: JlptTarget[] = ["N5", "N4", "N3"];
const TARGETS: JlptTarget[] = ["N4", "N3", "N2"];
const combos = STARTS.flatMap((start) => TARGETS.map((target) => [start, target] as const));

describe.each(combos)("起点 %s、考 %s：每个新内容入口的第一批", (start, target) => {
  const day = today();
  const startIndex = JLPT_TARGETS.indexOf(start);
  const targetIndex = JLPT_TARGETS.indexOf(target);
  const firstLevel = JLPT_TARGETS[startIndex + 1];
  const inScope = startIndex < targetIndex;

  beforeAll(async () => {
    store.clear();
    testDb = new (await initSqlJs()).Database(new Uint8Array(seed));
    ensureUserTables();
    await loadKanjiUnitIndex();
    await saveLevelPlanSettings({
      startingLevel: start,
      familiarity: { words: 75, grammar: 75, kanji: 75, confusion: 75 },
      target,
      examDate: "2026-12-06",
      startedOn: day
    });
  }, 60_000);

  it("目标跟着计划走（汉字单元没有自己的目标）", () => {
    expect(getKanjiUnitTargetLevelRank()).toBe(targetIndex);
  });

  it("单词：新词全是起点上一级（范围学完才往超纲走）", () => {
    createStage1Tasks(day);
    const levels = rows(`
      SELECT DISTINCT w.jlpt_level AS level FROM stage1_tasks t JOIN words w ON w.id = t.word_id
      WHERE t.reviewed_on = ? AND t.task_type = 'new'
    `, [day]).map((row) => row.level);
    expect(levels).toEqual([firstLevel]);
  });

  it("语法（混合模式）：范围内出起点上一级；起点 ≥ 目标时不出新的", () => {
    const newLevels = new Set<string>();
    let session = getGrammarQuizSession(PLAN_GRAMMAR_LEVEL);
    for (let step = 0; step < 40 && session.card; step += 1) {
      const card = session.card;
      if (Number(rows("SELECT seen_count FROM grammar_progress WHERE grammar_id = ?", [card.id])[0]?.seen_count ?? 0) === 0) newLevels.add(card.level);
      session = submitGrammarQuizAnswer(PLAN_GRAMMAR_LEVEL, card.id, "know");
    }
    expect([...newLevels]).toEqual(inScope ? [firstLevel] : []);
  });

  it("汉字字卡 / 辨析：范围内第一批是起点上一级；起点 ≥ 目标时不出新的", () => {
    createKanjiCharTasks({ fresh: 10, review: 0 }, targetIndex, day);
    createConfusionTasks({ fresh: 10, review: 0 }, targetIndex, day);
    for (const [tasks, memory, key] of [["kanji_char_tasks", "kanji_char_memory", "char"], ["confusion_tasks", "confusion_progress", "group_key"]]) {
      const ranks = rows(`
        SELECT DISTINCT m.level_rank AS rank FROM ${tasks} t JOIN ${memory} m ON m.${key} = t.${key}
        WHERE t.reviewed_on = ? AND m.seen_count = 0
      `, [day]).map((row) => Number(row.rank));
      expect(ranks, tasks).toEqual(inScope ? [startIndex + 1] : []);
    }
  });

  it("汉字单元：范围内第一批新字音是起点上一级；起点 ≥ 目标时用起点以下的，不跳去超纲", () => {
    createKanjiUnitTasks(day, 30);
    const ranks = rows(`
      SELECT t.unit_key AS unit FROM kanji_unit_tasks t JOIN kanji_unit_memory m ON m.unit_key = t.unit_key
      WHERE t.reviewed_on = ? AND COALESCE(m.seen_count, 0) = 0
    `, [day]).map((row) => kanjiUnitByKey(String(row.unit))!.levelRank);
    expect(ranks.length).toBeGreaterThan(0);
    if (inScope) expect(new Set(ranks)).toEqual(new Set([startIndex + 1]));
    else expect(Math.max(...ranks)).toBeLessThanOrEqual(startIndex);
  });
});
