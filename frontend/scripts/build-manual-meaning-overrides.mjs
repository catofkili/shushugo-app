// 将 manual-meaning-rewrite 中人工撰写的释义整理成运行时迁移覆盖表。
// 这里只做 ID -> 日语词形的机械映射；不生成、不改写释义文本。

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "../..");
const dbPath = path.join(here, "../public/nihongo.db");
const sourceDir = path.join(repoRoot, "manual-meaning-rewrite");
const polishDir = path.join(repoRoot, "manual-meaning-polish");
const correctionPath = path.join(polishDir, "corrections.json");
const outputPath = path.join(here, "../src/data/jlpt_meaning_overrides.json");

const SQL = await initSqlJs();
const db = new SQL.Database(new Uint8Array(readFileSync(dbPath)));
const rows = db.exec("SELECT id, kanji, kana FROM words")[0]?.values ?? [];
const wordById = new Map(rows.map(([id, kanji, kana]) => [Number(id), { kanji: String(kanji ?? ""), kana: String(kana ?? "") }]));

const batchFiles = readdirSync(sourceDir)
  .filter((name) => /^batch-\d{3}$/.test(name))
  .sort()
  .flatMap((name) => [path.join(sourceDir, name, "meanings.json")]);
// 外来語重复行合并后（bake-seed-db.mjs），片假名那一行被删掉了，但人工释义是按
// 它的 id 记的。用这份映射改挂到存活的英文原词行上 —— 否则这 97 条重写释义在
// 老用户的库里永远落不下去（他们的英文行不在覆盖表的键里）。
const mergeMapPath = path.join(here, "loanword-merge-map.json");
const mergeMap = existsSync(mergeMapPath)
  ? Object.fromEntries(Object.entries(JSON.parse(readFileSync(mergeMapPath, "utf8")))
      .map(([from, to]) => [Number(from), Number(to)]))
  : {};

const entries = batchFiles.flatMap((file) => JSON.parse(readFileSync(file, "utf8")));
const polishFiles = existsSync(polishDir)
  ? readdirSync(polishDir)
    .filter((name) => /^batch-\d{3}\.json$/.test(name))
    .sort()
    .map((name) => path.join(polishDir, name))
  : [];
const polishEntries = polishFiles.flatMap((file) => JSON.parse(readFileSync(file, "utf8")));
const correctionEntries = existsSync(correctionPath)
  ? JSON.parse(readFileSync(correctionPath, "utf8"))
  : [];
const seenIds = new Set();
const byPair = new Map();
entries.forEach((entry) => {
  if (seenIds.has(entry.id)) throw new Error(`重复人工释义 ID: ${entry.id}`);
  seenIds.add(entry.id);
  // 链式解析:先被「完全重复去重」并掉一次(2282 → 196),存活行又被
  // 「外来語合并」并掉一次(196 → 776),要一路跟到最终存活的那行。
  let resolved = Number(entry.id);
  const hops = new Set([resolved]);
  while (mergeMap[resolved] !== undefined) {
    resolved = mergeMap[resolved];
    if (hops.has(resolved)) throw new Error(`合并映射成环: ${entry.id}`);
    hops.add(resolved);
  }
  const merged = resolved !== Number(entry.id);
  const word = wordById.get(resolved);
  if (!word) throw new Error(`人工释义找不到词条 ID: ${entry.id}`);
  const pair = `${word.kanji}\u0000${word.kana}`;
  // 合并过的组里，英文行和片假名行可能各写过一条。bake 把**片假名行**的释义
  // 搬到了存活行上，这里必须选同一条，否则出厂库和老用户迁移会得到不同的释义。
  const previous = byPair.get(pair);
  if (previous && !merged) return;
  if (previous && previous.merged) throw new Error(`同一词形有两条合并来源的释义: ${word.kanji} / ${word.kana}`);
  byPair.set(pair, { kanji: word.kanji, kana: word.kana, meaning: String(entry.meaning_zh).trim(), merged });
});
const seenPolishIds = new Set();
polishEntries.forEach((entry) => {
  if (seenPolishIds.has(entry.id)) throw new Error(`重复剩余释义 ID: ${entry.id}`);
  seenPolishIds.add(entry.id);
  const word = wordById.get(Number(entry.id));
  if (!word) throw new Error(`剩余释义找不到词条 ID: ${entry.id}`);
  if (String(entry.word) !== word.kanji || String(entry.reading) !== word.kana) {
    throw new Error(`剩余释义词形不匹配: id=${entry.id}`);
  }
  const pair = `${word.kanji}\u0000${word.kana}`;
  if (byPair.has(pair)) throw new Error(`剩余释义覆盖了已有释义: ${word.kanji} / ${word.kana}`);
  byPair.set(pair, { kanji: word.kanji, kana: word.kana, meaning: String(entry.meaning_zh).trim(), merged: false });
});
correctionEntries.forEach((entry) => {
  const word = wordById.get(Number(entry.id));
  if (!word) throw new Error(`释义修正找不到词条 ID: ${entry.id}`);
  if (String(entry.word) !== word.kanji || String(entry.reading) !== word.kana) {
    throw new Error(`释义修正词形不匹配: id=${entry.id}`);
  }
  const pair = `${word.kanji}\u0000${word.kana}`;
  byPair.set(pair, { kanji: word.kanji, kana: word.kana, meaning: String(entry.meaning_zh).trim(), merged: false });
});
const overrides = [...byPair.values()]
  .map(({ kanji, kana, meaning }) => ({ kanji, kana, meaning }))
  .sort((left, right) => `${left.kanji}\u0000${left.kana}`.localeCompare(`${right.kanji}\u0000${right.kana}`));

// 5,163 条人工释义里，落在被合并掉的行上的那些会归并到同一个存活词形，
// 所以期望值是「解析后互不相同的词形数」——链式合并可能三条并成一条，
// 按 map 的条目数去减会算错。
const resolveId = (id) => {
  let current = Number(id);
  while (mergeMap[current] !== undefined) current = mergeMap[current];
  return current;
};
const expected = new Set(entries.map((entry) => resolveId(entry.id))).size;
const expectedTotal = expected + polishEntries.length;
if (overrides.length !== expectedTotal) throw new Error(`人工释义数量异常: ${overrides.length}，期望 ${expectedTotal}`);
if (entries.length !== 5163) throw new Error(`人工释义条目数异常: ${entries.length}`);
writeFileSync(outputPath, `${JSON.stringify(overrides, null, 2)}\n`);
console.log(`✅ 写入 ${outputPath}: ${overrides.length} 条人工释义覆盖（剩余风格修订 ${polishEntries.length} 条，释义纠错 ${correctionEntries.length} 条）`);
