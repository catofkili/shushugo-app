import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import initSqlJs from "sql.js";
import { assertFactoryContent, assertFactoryFsrs, loadFactoryRuntime } from "./factory-db-runtime.mjs";
import { findPopulatedUserTables } from "./user-data-tables.mjs";

const SQL = await initSqlJs();
const bytes = readFileSync(new URL("../public/nihongo.db", import.meta.url));
const runtime = await loadFactoryRuntime("export { ensureProgressInitialized } from './src/lib/word-api/bootstrap';");
const clone = () => new SQL.Database(new Uint8Array(bytes));

test("factory claims match forced real migrations and empty nullable FSRS structure", async () => {
  const db = clone();
  try {
    await assertFactoryContent(db, runtime);
    assertFactoryFsrs(db, runtime);
    assert.deepEqual(findPopulatedUserTables(sql => db.exec(sql)[0]?.values[0][0]), []);
    assert.equal(db.exec("SELECT value FROM app_state WHERE key='content_marker_repair'")[0].values[0][0], runtime.factoryRepairVersion);
  } finally { db.close(); }
});

test("current stamps cannot hide wrong content or a missing seed identity", async () => {
  for (const sql of [
    "UPDATE words SET pos='wrong' WHERE id=1",
    "DELETE FROM words WHERE id=1",
    "UPDATE grammar_points SET example_tokens='wrong' WHERE id=1",
    "UPDATE dictionary_entries SET meaning='wrong'",
    ...Object.keys(runtime.factoryVersions).map(key => `UPDATE app_state SET value='wrong' WHERE key='${key}'`)
  ]) {
    const db = clone();
    try {
      db.run(sql);
      await assert.rejects(() => assertFactoryContent(db, runtime), { name: "AssertionError" }, sql);
    } finally { db.close(); }
  }
});

test("missing FSRS columns or a non-null factory state fail verification", () => {
  for (const sql of [
    "ALTER TABLE progress DROP COLUMN fsrs_stability",
    "ALTER TABLE grammar_progress DROP COLUMN fsrs_reps; ALTER TABLE grammar_progress ADD COLUMN fsrs_reps INTEGER NOT NULL DEFAULT 1"
  ]) {
    const db = clone();
    try {
      db.run(sql);
      assert.throws(() => assertFactoryFsrs(db, runtime), { name: "AssertionError" }, sql);
    } finally { db.close(); }
  }
});

test("old factory schema with saved study records still repairs content and backfills FSRS", async () => {
  const db = clone();
  runtime.setDatabase(db);
  try {
    for (const table of ["progress", "kanji_reading_memory", "grammar_progress"]) {
      for (const [, name] of db.exec(`PRAGMA table_info(${table})`)[0].values) {
        if (String(name).startsWith("fsrs_")) db.run(`ALTER TABLE ${table} DROP COLUMN ${name}`);
      }
    }
    db.run("DELETE FROM app_state WHERE key='content_marker_repair'");
    const original = db.exec("SELECT pos,sense_key FROM words WHERE id=1")[0].values;
    db.run("UPDATE words SET pos='bad imported content',sense_key='' WHERE id=1");
    db.run("INSERT INTO progress(word_id,seen_count,right_count,forgot_count) VALUES(1,4,3,1)");
    db.run("INSERT INTO reviews(word_id,answer,score_after,reviewed_on,created_at) VALUES(1,'know',0,'2026-09-01','2026-09-01 04:00:00')");
    db.run("INSERT INTO grammar_progress(grammar_id,seen_count) VALUES(1,3)");
    db.run("INSERT INTO word_notes(word_id,note) VALUES(1,'saved archive note')");
    await runtime.ensureSeedData();
    runtime.ensureProgressInitialized();
    assert.deepEqual(db.exec("SELECT pos,sense_key FROM words WHERE id=1")[0].values, original);
    assert.deepEqual(db.exec("SELECT seen_count,right_count,forgot_count FROM progress WHERE word_id=1")[0].values, [[4,3,1]]);
    assert.equal(db.exec("SELECT COUNT(*) FROM reviews WHERE word_id=1")[0].values[0][0], 1);
    assert.equal(db.exec("SELECT seen_count FROM grammar_progress WHERE grammar_id=1")[0].values[0][0], 3);
    assert.equal(db.exec("SELECT note FROM word_notes WHERE word_id=1")[0].values[0][0], "saved archive note");
    assert.notEqual(db.exec("SELECT fsrs_stability FROM progress WHERE word_id=1")[0].values[0][0], null);
    assert.equal(db.exec("SELECT sync_updated_at FROM progress WHERE word_id=2")[0].values[0][0], null);
    assert.equal(db.exec("SELECT sync_updated_at FROM grammar_progress WHERE grammar_id=2")[0].values[0][0], null);
  } finally { await Promise.resolve(); db.close(); }
});
