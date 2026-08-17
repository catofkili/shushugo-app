#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import initSqlJs from "sql.js";

const paths = process.argv.slice(2).filter(Boolean);
const projectArg = paths.find((arg) => arg.startsWith("--project-days="));
if (projectArg) paths.splice(paths.indexOf(projectArg), 1);
const projectDays = projectArg ? Math.max(1, Number(projectArg.slice("--project-days=".length)) || 365) : null;
if (!paths.length) {
  console.error("usage: node scripts/measure-sync-blob.mjs <database.db> [...database.db]");
  process.exit(2);
}

const USER_TABLES = [
  "progress", "reviews", "grammar_progress", "grammar_reviews", "stage1_tasks",
  "stage2_progress", "kanji_progress", "kanji_memory", "reverse_memory", "word_notes",
  "checkins", "word_study_time", "word_study_time_by_device", "app_state", "grammar_state",
  "critical_reviews", "content_favorites", "moji_migrated_reviews", "sync_tombstones",
  "sync_device", "sync_context"
];

const SQL = await initSqlJs({ locateFile: (file) => new URL(`../node_modules/sql.js/dist/${file}`, import.meta.url).pathname });
const queryRows = (db, sql) => {
  const result = db.exec(sql)[0];
  if (!result) return [];
  return result.values.map((value) => Object.fromEntries(result.columns.map((column, index) => [column, value[index]])));
};
const shiftDay = (value, offset) => {
  const date = new Date(`${String(value)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};
const shiftTimestamp = (value, offset) => {
  const date = new Date(String(value).replace(" ", "T") + (String(value).endsWith("Z") ? "" : "Z"));
  if (Number.isNaN(date.getTime())) return value;
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString();
};
const projectDatabase = (input, targetDays) => {
  const db = new SQL.Database(input);
  const reviewRows = queryRows(db, "SELECT word_id, answer, score_after, reviewed_on, created_at, COALESCE(direction, 'forward') AS direction FROM reviews");
  const sourceDays = [...new Set(reviewRows.map((row) => String(row.reviewed_on)))].sort();
  const observedDays = sourceDays.length;
  if (!observedDays || targetDays <= observedDays) return db;
  const tasks = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='stage1_tasks'").length
    ? queryRows(db, "SELECT reviewed_on, word_id, task_type, order_index FROM stage1_tasks") : [];
  const checkins = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='checkins'").length
    ? queryRows(db, "SELECT checked_on FROM checkins") : [];
  const insertReview = "INSERT INTO reviews (word_id, answer, score_after, reviewed_on, created_at, direction) VALUES (?, ?, ?, ?, ?, ?)";
  const insertTask = "INSERT OR IGNORE INTO stage1_tasks (reviewed_on, word_id, task_type, order_index) VALUES (?, ?, ?, ?)";
  const insertCheckin = "INSERT OR IGNORE INTO checkins (checked_on) VALUES (?)";
  db.run("BEGIN");
  try {
    for (let offset = observedDays; offset < targetDays; offset += observedDays) {
      const span = Math.min(observedDays, targetDays - offset);
      for (const row of reviewRows) {
        const sourceIndex = sourceDays.indexOf(String(row.reviewed_on));
        if (sourceIndex >= span) continue;
        db.run(insertReview, [row.word_id, row.answer, row.score_after, shiftDay(row.reviewed_on, offset), shiftTimestamp(row.created_at, offset), row.direction]);
      }
      for (const row of tasks) {
        const sourceIndex = sourceDays.indexOf(String(row.reviewed_on));
        if (sourceIndex < 0 || sourceIndex >= span) continue;
        db.run(insertTask, [shiftDay(row.reviewed_on, offset), row.word_id, row.task_type, row.order_index]);
      }
      for (const row of checkins) {
        db.run(insertCheckin, [shiftDay(row.checked_on, offset)]);
      }
    }
    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }
  return db;
};
const measure = (path) => {
  if (!existsSync(path)) return { path, error: "file not found" };
  const input = new Uint8Array(readFileSync(path));
  const db = new SQL.Database(input);
  const tables = new Set(db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")[0]?.values.flat() ?? []);
  const counts = {};
  for (const table of USER_TABLES) {
    if (tables.has(table)) counts[table] = Number(db.exec(`SELECT COUNT(*) FROM "${table}"`)[0].values[0][0]);
  }
  const empty = new SQL.Database(input);
  for (const table of USER_TABLES) {
    if (tables.has(table)) {
      try { empty.run(`DELETE FROM "${table}"`); } catch { /* old DB may not have a referenced table */ }
    }
  }
  try { empty.exec("VACUUM"); } catch { /* sql.js builds without VACUUM are still useful */ }
  const dictionaryBytes = empty.export().byteLength;
  empty.close();

  let exportMs = 0;
  let indexedDbWriteProxyMs = 0;
  for (let i = 0; i < 8; i += 1) {
    let start = performance.now();
    const bytes = db.export();
    exportMs += performance.now() - start;
    start = performance.now();
    // Node file write is only a byte-copy proxy. It is deliberately not called iPhone IndexedDB.
    writeFileSync("/tmp/shushugo-sync-blob-measure.tmp", bytes);
    indexedDbWriteProxyMs += performance.now() - start;
  }
  db.close();
  const fullBytes = input.byteLength;
  const reviews = counts.reviews ?? 0;
  return {
    path,
    fullBytes,
    fullMiB: Number((fullBytes / 1048576).toFixed(3)),
    dictionaryBytes,
    dictionaryShare: Number((dictionaryBytes / fullBytes).toFixed(3)),
    userBytesAfterVacuum: fullBytes - dictionaryBytes,
    userShare: Number(((fullBytes - dictionaryBytes) / fullBytes).toFixed(3)),
    reviews,
    counts,
    exportMsMean: Number((exportMs / 8).toFixed(3)),
    indexedDbWriteProxyMsMean: Number((indexedDbWriteProxyMs / 8).toFixed(3)),
    notes: ["dictionaryBytes is measured by deleting listed user rows and VACUUMing a copy", "write timing is a Node byte-write proxy, not iPhone IndexedDB"]
  };
};

const measurements = paths.map((path) => measure(path));
const projections = [];
if (projectDays) {
  for (const path of paths) {
    if (!existsSync(path)) continue;
    const input = new Uint8Array(readFileSync(path));
    const projected = projectDatabase(input, projectDays);
    const bytes = projected.export();
    const dictionary = new SQL.Database(input);
    for (const table of USER_TABLES) {
      try { dictionary.run(`DELETE FROM "${table}"`); } catch { /* optional table */ }
    }
    try { dictionary.exec("VACUUM"); } catch { /* optional */ }
    const dictionaryBytes = dictionary.export().byteLength;
    dictionary.close();
    projections.push({ path, targetDays: projectDays, fullBytes: bytes.byteLength, fullMiB: Number((bytes.byteLength / 1048576).toFixed(3)), reviews: Number(projected.exec("SELECT COUNT(*) FROM reviews")[0].values[0][0]), dictionaryBytes, userBytesAfterVacuum: bytes.byteLength - dictionaryBytes });
    projected.close();
  }
}
const valid = measurements.filter((item) => !item.error);
const latest = valid.at(-1);
let extrapolation365;
if (latest) {
  const dayMatch = latest.path.match(/day(\d+)/i);
  const observedDays = dayMatch ? Number(dayMatch[1]) : null;
  if (observedDays && latest.reviews > 0) {
    const reviewsPerDay = latest.reviews / observedDays;
    extrapolation365 = {
      basisDays: observedDays,
      reviewsPerDay: Number(reviewsPerDay.toFixed(2)),
      estimatedReviewsAt100Days: Math.round(reviewsPerDay * 100),
      estimatedReviewsAt365Days: Math.round(reviewsPerDay * 365),
      method: "linear review-row extrapolation; run a real 100/365-day behavior simulation before treating as a size guarantee"
    };
  }
}
console.log(JSON.stringify({ measurements, projections, extrapolation365 }, null, 2));
