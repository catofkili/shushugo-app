import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import initSqlJs, { type Database } from "sql.js";
import { readFileSync } from "node:fs";
import { problemLabel } from "./messages";
import { spellingErrorStats } from "./stats";
import { today } from "../study-core";
import type { SpellingProblemCode } from "./types";

let db: Database;
let SQL: Awaited<ReturnType<typeof initSqlJs>>;
vi.mock("../database", () => ({ getDatabase: () => db }));
vi.mock("../storage", () => ({ scheduleSave: () => undefined }));
beforeAll(async () => { SQL = await initSqlJs(); });
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 3, 3));
  db = new SQL.Database();
  db.run("CREATE TABLE spelling_reviews (word_id INTEGER, reviewed_on TEXT, problem TEXT); CREATE TABLE spelling_tasks (word_id INTEGER); CREATE TABLE spelling_memory (word_id INTEGER, known_forever INTEGER);");
});
afterEach(() => { db.close(); vi.useRealTimers(); });
// 统计只需要查询；真实表迁移在 store.test.ts 使用出厂库覆盖。
vi.mock("./store", () => ({ ensureSpellingTables: () => undefined }));

describe("最近常错", () => {
  it("以四点学习日为结束，包含 N 天边界，排除放弃与正确，次数降序后按 code 排", () => {
    for (const [day, problem] of [
      ["2026-09-19", "sokuon"], ["2026-10-02", "sokuon"], ["2026-10-01", "long_vowel"],
      ["2026-10-02", "hatsuon"], ["2026-09-18", "wrong_kanji"], ["2026-10-03", "wrong_kanji"],
      [today(), ""], [today(), "gave_up"]
    ]) db.run("INSERT INTO spelling_reviews VALUES (1, ?, ?)", [day, problem]);
    expect(spellingErrorStats()).toEqual([{ code: "sokuon", count: 2 }, { code: "hatsuon", count: 1 }, { code: "long_vowel", count: 1 }]);
    expect(spellingErrorStats(1)).toEqual([{ code: "hatsuon", count: 1 }, { code: "sokuon", count: 1 }]);
    expect(spellingErrorStats(0)).toEqual([]); expect(spellingErrorStats(NaN)).toEqual([]);
  });
  it("空库没有统计", () => expect(spellingErrorStats()).toEqual([]));
  it("每个契约问题都有短标签，新增问题没有测试样例就失败", () => {
    const labels: Record<SpellingProblemCode, string> = {
      empty: "未写", mixed_scripts: "混写", wrong_reading: "读音", long_vowel: "长音", sokuon: "促音", hatsuon: "拨音",
      script: "假名", other_reading: "异读", chinese_form: "中文字形", traditional_form: "旧字形", okurigana: "送假名",
      partial_kana: "交写", wrong_kanji: "汉字", homophone: "同音词", peer_word: "同义词", conjugated: "活用",
      source_language: "原词", too_short: "少字", too_long: "多字"
    };
    const types = readFileSync(new URL("./types.ts", import.meta.url), "utf8");
    const codes = [...types.split("export type SpellingProblemCode =")[1].split("/** 一个问题")[0].matchAll(/\| "([a-z_]+)"/g)].map((match) => match[1]);
    expect(Object.keys(labels).sort()).toEqual(codes.sort());
    for (const [code, label] of Object.entries(labels)) expect(problemLabel(code)).toBe(label);
    expect(problemLabel("unknown")).toBe("unknown"); expect(problemLabel("__proto__")).toBe("__proto__");
  });
});
