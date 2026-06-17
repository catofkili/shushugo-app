#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import vm from "node:vm";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const documents = resolve(root, "..");
const sourceDb = join(documents, "japanese-learning-app", "japanese_words.sqlite3");
const targetDb = join(root, "frontend", "public", "nihongo.db");
const grammarTs = join(root, "frontend", "src", "data", "grammar.ts");
const distDb = join(root, "frontend", "dist", "nihongo.db");
const iosDb = join(root, "frontend", "ios", "App", "App", "public", "nihongo.db");

const runSql = (dbPath, sql) => execFileSync("sqlite3", [dbPath, sql], { stdio: "pipe" }).toString().trim();

const extractGrammar = () => {
  const source = readFileSync(grammarTs, "utf8");
  const match = source.match(/export const GRAMMAR_POINTS: GrammarPoint\[\] = (\[[\s\S]*?\n\]);/);
  if (!match) throw new Error("Cannot find GRAMMAR_POINTS in grammar.ts");
  return vm.runInNewContext(match[1], {});
};

const sqlEscape = (value) => String(value ?? "").replaceAll("'", "''");

const clearStateSql = `
DELETE FROM progress;
DELETE FROM reviews;
DELETE FROM critical_reviews;
DELETE FROM stage1_tasks;
DELETE FROM stage2_progress;
DELETE FROM kanji_progress;
DELETE FROM kanji_memory;
DELETE FROM word_notes;
DELETE FROM word_study_time;
DELETE FROM checkins;
DELETE FROM app_state;
DELETE FROM grammar_progress;
DELETE FROM grammar_reviews;
DELETE FROM grammar_state;
DELETE FROM moji_migrated_reviews;
DELETE FROM grammar_points;
DELETE FROM sqlite_sequence WHERE name IN ('reviews', 'grammar_reviews', 'grammar_points');
`;

mkdirSync(dirname(targetDb), { recursive: true });
copyFileSync(sourceDb, targetDb);
runSql(targetDb, "PRAGMA foreign_keys = OFF; BEGIN;" + clearStateSql + "COMMIT;");

const grammar = extractGrammar();
const insertRows = grammar.map((point, index) => {
  const firstExample = point.examples?.[0] ?? {};
  return `(
    '${sqlEscape(point.id)}',
    '${sqlEscape(point.meaning)}',
    '${sqlEscape(point.title)}',
    '${sqlEscape(point.structure)}',
    '${sqlEscape(firstExample.jp ?? firstExample.japanese ?? "")}',
    '${sqlEscape(firstExample.cn ?? firstExample.chinese ?? "")}',
    '${sqlEscape(point.explanation)}',
    '${sqlEscape(JSON.stringify(point.comparisons ?? []))}',
    '${sqlEscape(point.level)}',
    3,
    ${index}
  )`;
});

for (let index = 0; index < insertRows.length; index += 100) {
  const chunk = insertRows.slice(index, index + 100);
  runSql(targetDb, `
    INSERT INTO grammar_points (
      pattern, meaning, prompt, formation, example_jp, example_meaning,
      notes, confusions, level, importance, sort_order
    )
    VALUES ${chunk.join(",")};
  `);
}

runSql(targetDb, "VACUUM;");

for (const destination of [distDb, iosDb]) {
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(targetDb, destination);
}

const counts = runSql(targetDb, `
SELECT 'words', COUNT(*) FROM words
UNION ALL SELECT 'grammar_points', COUNT(*) FROM grammar_points
UNION ALL SELECT 'progress', COUNT(*) FROM progress
UNION ALL SELECT 'reviews', COUNT(*) FROM reviews
UNION ALL SELECT 'grammar_progress', COUNT(*) FROM grammar_progress
UNION ALL SELECT 'grammar_reviews', COUNT(*) FROM grammar_reviews;
`);

const levelCounts = runSql(targetDb, "SELECT level, COUNT(*) FROM grammar_points GROUP BY level ORDER BY level;");
const npmBuild = spawnSync("npm", ["run", "build"], {
  cwd: join(root, "frontend"),
  stdio: "inherit"
});

if (npmBuild.status !== 0) process.exit(npmBuild.status ?? 1);
copyFileSync(targetDb, distDb);
copyFileSync(targetDb, iosDb);

console.log(`Content synced from ${sourceDb}`);
console.log(`Target DB size: ${(statSync(targetDb).size / 1024 / 1024).toFixed(2)} MB`);
console.log(counts);
console.log(levelCounts);
