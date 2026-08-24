import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";
import indexPayload from "../data/kanji_reading_unit_index.json";
import type { KanjiReadingUnitIndex } from "./kanji-reading-units";

let testDb: Database;
let SQL: Awaited<ReturnType<typeof initSqlJs>>;
const index = indexPayload as KanjiReadingUnitIndex;
const seedPath = fileURLToPath(new URL("../../public/nihongo.db", import.meta.url));

vi.mock("./database", () => ({
  getDatabase: () => testDb,
  initDatabase: async () => testDb
}));

import {
  createKanjiUnitTasks,
  ensureKanjiUnitTables,
  isKanjiUnitSchedulerEnabled,
  kanjiUnitCardByKey,
  materializeKanjiUnitIndex,
  recordKanjiUnitReview,
  setKanjiUnitKnownForever,
  setKanjiUnitSchedulerEnabled
} from "./kanji-unit-scheduler";
import { loadKanjiUnitIndex } from "./kanji-unit-index";

const one = (sql: string, params: unknown[] = []) => {
  const result = testDb.exec(sql, params as never)[0];
  return result?.values?.[0]?.[0] ?? null;
};

beforeAll(async () => {
  SQL = await initSqlJs();
  // 运行时索引改成惰性加载(动态 import 单独成 chunk),读之前必须先 load
  await loadKanjiUnitIndex();
});

beforeEach(() => {
  testDb = new SQL.Database(new Uint8Array(readFileSync(seedPath)));
});

describe("local kanji unit scheduler", () => {
  it("materializes content without fabricating memory history", () => {
    expect(materializeKanjiUnitIndex()).toBe(index.units.length);
    expect(Number(one("SELECT COUNT(*) FROM kanji_units"))).toBe(index.units.length);
    expect(Number(one("SELECT COUNT(*) FROM kanji_unit_memory WHERE seen_count <> 0"))).toBe(0);
  });

  it("selects a deterministic coverage-ranked daily task set", () => {
    const first = createKanjiUnitTasks("2026-08-22", 12).units;
    expect(first).toHaveLength(12);
    expect(new Set(first).size).toBe(12);
    expect(createKanjiUnitTasks("2026-08-22", 12).units).toEqual(first);
  });

  it("exposes a unit card view model; the feature flag defaults on and can be switched off", () => {
    const [unitKey] = createKanjiUnitTasks("2026-08-22", 1).units;
    const card = kanjiUnitCardByKey(unitKey);
    expect(card?.unit.unitKey).toBe(unitKey);
    expect(card?.exampleWordId).toBeGreaterThan(0);
    expect(card?.targetSegment.text).toBeTruthy();
    // 默认开:单位队列才是汉字模式现在的口径,旧的词级队列只排「今天恰好到期的」
    expect(isKanjiUnitSchedulerEnabled()).toBe(true);
    const flags = new Map<string, string>();
    (globalThis as any).localStorage = { getItem: (key: string) => flags.get(key) ?? null, setItem: (key: string, value: string) => flags.set(key, value) };
    setKanjiUnitSchedulerEnabled(true);
    expect(isKanjiUnitSchedulerEnabled()).toBe(true);
    setKanjiUnitSchedulerEnabled(false);
    expect(isKanjiUnitSchedulerEnabled()).toBe(false);
  });

  it("keeps unit FSRS local and removes a declared forever-known unit", () => {
    const [unitKey] = createKanjiUnitTasks("2026-08-22", 1).units;
    recordKanjiUnitReview(unitKey, "know", new Date("2026-08-22T10:00:00.000Z"));
    expect(Number(one("SELECT seen_count FROM kanji_unit_memory WHERE unit_key = ?", [unitKey]))).toBe(1);
    expect(one("SELECT fsrs_due FROM kanji_unit_memory WHERE unit_key = ?", [unitKey])).not.toBeNull();
    setKanjiUnitKnownForever(unitKey, true);
    ensureKanjiUnitTables();
    expect(Number(one("SELECT known_forever FROM kanji_unit_flags WHERE unit_key = ?", [unitKey]))).toBe(1);
  });

  it("does not write sync metadata or mutate word-level progress", () => {
    const before = one("SELECT seen_count FROM progress WHERE word_id = 1");
    const [unitKey] = createKanjiUnitTasks("2026-08-22", 1).units;
    setKanjiUnitKnownForever(unitKey, true);
    const tableNames = testDb.exec("SELECT name FROM sqlite_master WHERE type = 'table'")[0].values.flat().map(String);
    expect(tableNames).toContain("kanji_unit_flags");
    expect(tableNames).not.toContain("sync_tombstones");
    expect(one("SELECT seen_count FROM progress WHERE word_id = 1")).toBe(before);
  });
});
