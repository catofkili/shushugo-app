import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from '../../frontend/node_modules/sql.js/dist/sql-wasm.js';

const root = path.resolve(import.meta.dirname, '..');
const seedPath = path.resolve(root, '../frontend/public/nihongo.db');
const wasmPath = path.resolve(root, '../frontend/node_modules/sql.js/dist/sql-wasm.wasm');
const bytes = new Uint8Array(fs.readFileSync(seedPath));
const SQL = await initSqlJs({ locateFile: () => wasmPath });
const db = new SQL.Database(bytes);

const required = ['words', 'progress', 'app_state'];
const names = new Set(db.exec("SELECT name FROM sqlite_master WHERE type='table'")[0].values.map(([name]) => name));
for (const table of required) {
  if (!names.has(table)) throw new Error(`missing required table: ${table}`);
}

for (const [name, type] of [
  ['fsrs_stability', 'REAL'],
  ['fsrs_difficulty', 'REAL'],
  ['fsrs_due', 'TEXT'],
  ['fsrs_last_review', 'TEXT'],
  ['fsrs_state', 'INTEGER'],
  ['fsrs_steps', 'INTEGER'],
  ['fsrs_reps', 'INTEGER'],
  ['fsrs_lapses', 'INTEGER']
]) {
  const columns = new Set(db.exec('PRAGMA table_info(progress)')[0].values.map((row) => row[1]));
  if (!columns.has(name)) db.run(`ALTER TABLE progress ADD COLUMN ${name} ${type}`);
}

const wordCount = db.exec('SELECT COUNT(*) FROM words')[0].values[0][0];
const dueCount = db.exec('SELECT COUNT(*) FROM progress WHERE fsrs_due IS NULL OR fsrs_due <= ?', [new Date().toISOString()])[0].values[0][0];
const exported = db.export();
db.close();

const restored = new SQL.Database(exported);
const restoredCount = restored.exec('SELECT COUNT(*) FROM words')[0].values[0][0];
restored.close();

if (wordCount !== restoredCount || wordCount <= 0) throw new Error('export/reopen mismatch');
console.log(JSON.stringify({ ok: true, wordCount, dueCount, bytes: exported.length }, null, 2));
