import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;

vi.mock("./database", () => ({ getDatabase: () => testDb }));
vi.mock("./storage", () => ({
  scheduleSave: () => undefined,
  saveRecoverySnapshot: async () => "test-recovery"
}));

import { getState } from "./database/db-utils";
import { migrateLegacyBiruDuplicate } from "./legacy-word-migrations";

const one = (sql: string, params: Array<string | number> = []) => (
  testDb.exec(sql, params)[0]?.values[0]?.[0]
);

const addFsrsColumns = (table: string) => {
  [
    ["fsrs_stability", "REAL"],
    ["fsrs_difficulty", "REAL"],
    ["fsrs_due", "TEXT"],
    ["fsrs_last_review", "TEXT"],
    ["fsrs_state", "INTEGER"],
    ["fsrs_steps", "INTEGER"],
    ["fsrs_reps", "INTEGER"],
    ["fsrs_lapses", "INTEGER"]
  ].forEach(([column, type]) => testDb.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`));
};

describe("旧版重复 ビル 迁移", () => {
  beforeEach(async () => {
    const SQL = await initSqlJs();
    testDb = new SQL.Database(new Uint8Array(readFileSync(
      fileURLToPath(new URL("../../public/nihongo.db", import.meta.url))
    )));
    testDb.run(`
      INSERT INTO words (id, meaning, kana, kanji, pos, importance)
      VALUES (2480, '大楼', 'ビル', 'ビル', '名词', 5)
    `);
    testDb.run("INSERT OR IGNORE INTO progress (word_id) VALUES (775), (2480)");
    addFsrsColumns("progress");
    testDb.run(`CREATE TABLE IF NOT EXISTS reverse_memory (
      word_id INTEGER PRIMARY KEY, seen_count INTEGER NOT NULL DEFAULT 0,
      right_count INTEGER NOT NULL DEFAULT 0, fuzzy_count INTEGER NOT NULL DEFAULT 0,
      forgot_count INTEGER NOT NULL DEFAULT 0, last_seen_on TEXT
    )`);
    addFsrsColumns("reverse_memory");
    testDb.run(`CREATE TABLE IF NOT EXISTS word_notes (
      word_id INTEGER PRIMARY KEY, note TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    testDb.run(`CREATE TABLE IF NOT EXISTS content_favorites (
      item_type TEXT NOT NULL, item_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (item_type, item_id)
    )`);
    testDb.run("DELETE FROM reviews");
    testDb.run("DELETE FROM stage1_tasks");
  });

  it("两边都有数据时保留 seen_count 更多的一边，并把所有流水挂到 775", () => {
    testDb.run(`UPDATE progress SET seen_count=2, right_count=2,
      fsrs_stability=2, fsrs_due='2026-08-14T04:00:00Z' WHERE word_id=775`);
    testDb.run(`UPDATE progress SET seen_count=5, right_count=3, fuzzy_count=1, forgot_count=1,
      fsrs_stability=9, fsrs_due='2026-08-20T04:00:00Z' WHERE word_id=2480`);
    testDb.run("INSERT INTO reviews (word_id,answer,score_after,reviewed_on) VALUES (775,'know',0,'2026-08-13')");
    testDb.run("INSERT INTO reviews (word_id,answer,score_after,reviewed_on) VALUES (2480,'fuzzy',0,'2026-08-12')");
    testDb.run("INSERT INTO stage1_tasks VALUES ('2026-08-13',775,'new',10)");
    testDb.run("INSERT INTO stage1_tasks VALUES ('2026-08-13',2480,'review',20)");
    testDb.run("INSERT INTO word_notes(word_id,note) VALUES (775,'新便签'),(2480,'旧卡便签')");
    testDb.run("INSERT INTO content_favorites(item_type,item_id) VALUES ('word','2480')");
    testDb.run("INSERT OR REPLACE INTO app_state(key,value) VALUES ('review_queue', ?)", [
      JSON.stringify([{ word_id: 775, due_after: 4 }, { word_id: 2480, due_after: 1 }])
    ]);
    testDb.run("INSERT OR REPLACE INTO app_state(key,value) VALUES ('current_card','2480')");

    const report = migrateLegacyBiruDuplicate();

    expect(report).toMatchObject({ migrated: true, winnerId: 2480, canonicalSeenCount: 2, legacySeenCount: 5, movedReviews: 1 });
    expect(Number(one("SELECT seen_count FROM progress WHERE word_id=775"))).toBe(5);
    expect(Number(one("SELECT fsrs_stability FROM progress WHERE word_id=775"))).toBe(9);
    expect(Number(one("SELECT COUNT(*) FROM reviews WHERE word_id=775"))).toBe(2);
    expect(Number(one("SELECT COUNT(*) FROM reviews WHERE word_id=2480"))).toBe(0);
    expect(String(one("SELECT task_type FROM stage1_tasks WHERE reviewed_on='2026-08-13' AND word_id=775"))).toBe("review");
    expect(String(one("SELECT note FROM word_notes WHERE word_id=775"))).toBe("旧卡便签");
    expect(Number(one("SELECT COUNT(*) FROM content_favorites WHERE item_type='word' AND item_id='775'"))).toBe(1);
    expect(Number(one("SELECT COUNT(*) FROM words WHERE id=2480"))).toBe(0);
    expect(getState("current_card", "0")).toBe("775");
    expect(JSON.parse(getState("review_queue", "[]"))).toEqual([{ word_id: 775, due_after: 1 }]);
  });

  it("775 点击更多时保留 775 的状态，但仍吸收旧卡流水并删除旧词", () => {
    testDb.run("UPDATE progress SET seen_count=8, right_count=7, fsrs_stability=12, fsrs_due='2026-09-01T04:00:00Z' WHERE word_id=775");
    testDb.run("UPDATE progress SET seen_count=3, right_count=2, fsrs_stability=4, fsrs_due='2026-08-15T04:00:00Z' WHERE word_id=2480");
    testDb.run("INSERT INTO reviews (word_id,answer,score_after,reviewed_on) VALUES (2480,'know',0,'2026-08-10')");

    const report = migrateLegacyBiruDuplicate();

    expect(report.winnerId).toBe(775);
    expect(Number(one("SELECT seen_count FROM progress WHERE word_id=775"))).toBe(8);
    expect(Number(one("SELECT fsrs_stability FROM progress WHERE word_id=775"))).toBe(12);
    expect(Number(one("SELECT COUNT(*) FROM reviews WHERE word_id=775"))).toBe(1);
    expect(Number(one("SELECT COUNT(*) FROM words WHERE id=2480"))).toBe(0);
    expect(migrateLegacyBiruDuplicate().migrated).toBe(false);
  });
});
