import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";

let db: Database;
vi.mock("../database", () => ({ getDatabase: () => db }));
vi.mock("../storage", () => ({ requestFullSnapshot: vi.fn(), scheduleSave: vi.fn() }));

import { loadKanjiCharData, materializeKanjiChars } from "../kanji-char-cards";
import { materializeConfusionCards } from "../confusion-cards";
import { JLPT_TARGETS } from "../jlpt/plan";
import { CONTENT_BY_LEVEL, CONTENT_MATRIX, expectedContent, previewLevelPlan, VISIBLE_STARTS } from "./content-matrix";
import { collocationWordSql } from "../word-learning-scope";
import collocations from "../../data/jlpt_collocation_content.json";

const rankCounts = (table: string, column: string) => new Map(
  (db.exec(`SELECT ${column}, COUNT(*) FROM ${table} w ${table === "words" ? `WHERE NOT ${collocationWordSql()}` : ""} GROUP BY ${column}`)[0]?.values ?? [])
    .map(([level, count]) => [String(level), Number(count)])
);

describe("起点×目标预期学习量", () => {
  beforeAll(async () => {
    const SQL = await initSqlJs();
    db = new SQL.Database(new Uint8Array(readFileSync(fileURLToPath(new URL("../../../public/nihongo.db", import.meta.url)))));
    for (const entry of collocations.entries) db.run(
      "INSERT INTO words (kanji,kana,meaning,pos,jlpt_level) VALUES (?,?,?,'固定搭配',?)",
      [entry.surface, entry.kana, entry.meaning, entry.level]
    );
    await loadKanjiCharData();
    materializeKanjiChars();
    materializeConfusionCards();
  });

  it("固定表与出厂词、语法、汉字和辨析素材逐级一致", () => {
    const actual = {
      words: rankCounts("words", "jlpt_level"),
      grammar: rankCounts("grammar_points", "level"),
      kanji: rankCounts("kanji_char_memory", "level_rank"),
      confusion: rankCounts("confusion_progress", "level_rank")
    };
    JLPT_TARGETS.forEach((level, rank) => {
      for (const kind of Object.keys(actual) as Array<keyof typeof actual>) {
        const seedCount = actual[kind].get(kind === "words" || kind === "grammar" ? level : String(rank)) ?? 0;
        expect(CONTENT_BY_LEVEL[level][kind], `${kind} ${level}`).toBe(seedCount);
      }
    });
  });

  it("35 种起点×目标、四场考期都查同一份表，天数缩短时每日量不会变小", () => {
    const today = new Date(2026, 8, 23);
    const dates = [new Date(2026, 11, 6), new Date(2027, 6, 4), new Date(2027, 11, 5), new Date(2028, 6, 2)];
    let cases = 0;
    for (const start of VISIBLE_STARTS) for (const target of JLPT_TARGETS) {
      const content = expectedContent(start, target);
      expect(CONTENT_MATRIX[start][target]).toEqual(content);
      const previews = dates.map((examDate) => previewLevelPlan({ startingLevel: start, target, examDate, today }));
      expect(previews.every((item) => Object.values(item.daily).every((value) => Number.isFinite(value) && value >= 0))).toBe(true);
      expect(previews.map((item) => item.required.words)).toEqual([...previews.map((item) => item.required.words)].sort((a, b) => b - a));
      cases += previews.length;
    }
    expect(cases).toBe(140);
  });

  it("会五十音→2026-12-06 考 N3：3664 个普通词只剩 56 天，至少 66/天；50 上限明确报不可行", () => {
    const input = { startingLevel: "kana" as const, target: "N3" as const, examDate: new Date(2026, 11, 6), today: new Date(2026, 8, 23) };
    const plan = previewLevelPlan(input);
    expect(plan.content.words).toBe(3664);
    expect(plan.intakeDays).toBe(56);
    expect(plan.required.words).toBe(66);
    expect(plan.daily.words).toBe(50);
    expect(plan.feasible).toBe(false);
    expect(previewLevelPlan({ ...input, today: new Date(2026, 8, 24) }).required.words).toBe(67);
    expect(previewLevelPlan({ ...input, examDate: new Date(2027, 11, 5) }).required.words).toBe(9);
  });

  it("熟悉度设为 0 把起点本级也纳入新学；不会五十音额外预留假名时间", () => {
    expect(expectedContent("N4", "N3", { words: 0, grammar: 75, kanji: 75, confusion: 75 }).words).toBe(2752);
    expect(expectedContent("N4", "N3").words).toBe(1906);
    const base = { target: "N3" as const, examDate: new Date(2026, 11, 6), today: new Date(2026, 8, 23) };
    expect(previewLevelPlan({ ...base, startingLevel: "kana-none" }).intakeDays).toBe(49);
    expect(previewLevelPlan({ ...base, startingLevel: "kana" }).intakeDays).toBe(56);
  });

  it("三档搭配都不增加普通词推荐量，35 份静态表与开关无关", () => {
    for (const start of VISIBLE_STARTS) for (const target of JLPT_TARGETS) {
      expect(expectedContent(start, target, undefined, true)).toEqual(CONTENT_MATRIX[start][target]);
      expect(expectedContent(start, target, undefined, false)).toEqual(CONTENT_MATRIX[start][target]);
    }
    expect(expectedContent("N3", "N3", { words: 0, grammar: 75, kanji: 75, confusion: 75 }, true).words).toBe(1906);
    expect(expectedContent("kana", "N1", undefined, true).words).toBe(10919);
  });
});
