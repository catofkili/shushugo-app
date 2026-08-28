import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { findPopulatedUserTables } from "./user-data-tables.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const seedPath = path.join(here, "../src/data/jlpt_words_seed.json");
const dbPath = path.join(here, "../public/nihongo.db");
const pilotPaths = [
  path.join(here, "pilot_examples_100.json"),
  path.join(here, "pilot_examples_100_additional.json"),
];
const version = "2026-08-05-pilot-200";

const pilot = pilotPaths.flatMap((pilotPath) => JSON.parse(readFileSync(pilotPath, "utf8")));
const pilotByKey = new Map(pilot.map(([kanji, kana, jp, cn]) => [`${kanji}\u0000${kana}`, [jp, cn]]));
if (pilot.length !== 200 || pilotByKey.size !== 200) throw new Error(`试点例句应为 200 条且词条键唯一，实际 ${pilot.length}/${pilotByKey.size}`);

const seed = JSON.parse(readFileSync(seedPath, "utf8"));
const rewrittenSeed = seed.map((row) => {
  const [meaning, kana, kanji, pos, verbType, importance, , , level] = row;
  const example = pilotByKey.get(`${kanji}\u0000${kana}`) ?? ["", ""];
  return [meaning, kana, kanji, pos, verbType, importance, example[0], example[1], level];
});
const matchedSeed = rewrittenSeed.filter((row) => row[6]).length;
if (matchedSeed !== 200) throw new Error(`pilot 中有词条未匹配 seed，匹配到 ${matchedSeed} 条`);
writeFileSync(seedPath, `${JSON.stringify(rewrittenSeed)}\n`);

const SQL = await initSqlJs();
const db = new SQL.Database(new Uint8Array(readFileSync(dbPath)));
const populated = findPopulatedUserTables((sql) => Number(db.exec(sql)[0]?.values?.[0]?.[0] ?? 0));
if (populated.length) throw new Error(`拒绝清空含有用户数据的数据库：${populated.map(([table, count]) => `${table}=${count}`).join(", ")}`);

const rows = db.exec("SELECT id, kanji, kana FROM words ORDER BY id")[0]?.values ?? [];
db.run("BEGIN TRANSACTION");
db.run("UPDATE words SET example_jp = '', example_meaning = ''");
let matchedDb = 0;
for (const [id, kanji, kana] of rows) {
  const example = pilotByKey.get(`${kanji}\u0000${kana}`);
  if (!example) continue;
  db.run("UPDATE words SET example_jp = ?, example_meaning = ? WHERE id = ?", [example[0], example[1], id]);
  matchedDb += 1;
}
db.run("INSERT OR REPLACE INTO app_state (key, value) VALUES ('jlpt_word_metadata_version', ?)", [version]);
db.run("COMMIT");
db.run("VACUUM");
writeFileSync(dbPath, Buffer.from(db.export()));

console.log(`✅ 已清空旧例句；seed 仅保留试点 ${matchedSeed} 条，数据库匹配试点 ${matchedDb} 条`);
console.log(`✅ 其余词条例句为空；metadata=${version}`);
