// 将 manual-meaning-rewrite 中人工撰写的释义整理成运行时迁移覆盖表。
// 这里只做 ID -> 日语词形的机械映射；不生成、不改写释义文本。

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "../..");
const dbPath = path.join(here, "../public/nihongo.db");
const sourceDir = path.join(repoRoot, "manual-meaning-rewrite");
const outputPath = path.join(here, "../src/data/jlpt_meaning_overrides.json");

const SQL = await initSqlJs();
const db = new SQL.Database(new Uint8Array(readFileSync(dbPath)));
const rows = db.exec("SELECT id, kanji, kana FROM words")[0]?.values ?? [];
const wordById = new Map(rows.map(([id, kanji, kana]) => [Number(id), { kanji: String(kanji ?? ""), kana: String(kana ?? "") }]));

const batchFiles = readdirSync(sourceDir)
  .filter((name) => /^batch-\d{3}$/.test(name))
  .sort()
  .flatMap((name) => [path.join(sourceDir, name, "meanings.json")]);
const entries = batchFiles.flatMap((file) => JSON.parse(readFileSync(file, "utf8")));
const seenIds = new Set();
const seenPairs = new Set();
const overrides = entries.map((entry) => {
  if (seenIds.has(entry.id)) throw new Error(`重复人工释义 ID: ${entry.id}`);
  seenIds.add(entry.id);
  const word = wordById.get(Number(entry.id));
  if (!word) throw new Error(`人工释义找不到词条 ID: ${entry.id}`);
  const pair = `${word.kanji}\u0000${word.kana}`;
  if (seenPairs.has(pair)) throw new Error(`人工释义重复词形: ${word.kanji} / ${word.kana}`);
  seenPairs.add(pair);
  return { kanji: word.kanji, kana: word.kana, meaning: String(entry.meaning_zh).trim() };
}).sort((left, right) => `${left.kanji}\u0000${left.kana}`.localeCompare(`${right.kanji}\u0000${right.kana}`));

if (overrides.length !== 5163) throw new Error(`人工释义数量异常: ${overrides.length}`);
writeFileSync(outputPath, `${JSON.stringify(overrides, null, 2)}\n`);
console.log(`✅ 写入 ${outputPath}: ${overrides.length} 条人工释义覆盖`);
