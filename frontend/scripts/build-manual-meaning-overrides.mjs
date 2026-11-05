// 释义覆盖表的唯一写入口；只合并源头，不生成、不改写释义文本。
// 优先级（后者覆盖前者）：manual-meaning-rewrite/batch-*/meanings.json →
// manual-meaning-polish/batch-*.json → corrections.json →
// manual-meaning-reviewed/distinction-source.json → 同目录其他释义 JSON（文件名升序）。
// legacy-append-order.json 只保存历史追加顺序，不参与释义优先级。
// 用法：node frontend/scripts/build-manual-meaning-overrides.mjs [--check]
// --check 只读并逐字节断言产物一致；不能先写再检查，否则手改产物会被静默抹掉。
// 这里只做 ID -> 日语词形的机械映射；不生成、不改写释义文本。

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { buildDistinctionMeaningSources } from "../../question-meaning-review/sync-distinction-meanings.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "../..");
const dbPath = path.join(here, "../public/nihongo.db");
const sourceDir = path.join(repoRoot, "manual-meaning-rewrite");
const polishDir = path.join(repoRoot, "manual-meaning-polish");
const correctionPath = path.join(polishDir, "corrections.json");
const outputPath = path.join(here, "../src/data/jlpt_meaning_overrides.json");
const reviewedDir = path.join(here, "manual-meaning-reviewed");
const distinctionPath = path.join(reviewedDir, "distinction-source.json");
const orderPath = path.join(reviewedDir, "legacy-append-order.json");
const checkOnly = process.argv.includes("--check");

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
if (byPair.size !== expectedTotal) throw new Error(`人工释义数量异常: ${byPair.size}，期望 ${expectedTotal}`);
if (entries.length !== 5163) throw new Error(`人工释义条目数异常: ${entries.length}`);
const distinctionEntries = JSON.parse(readFileSync(distinctionPath, "utf8"));
assert.deepEqual(distinctionEntries, buildDistinctionMeaningSources(),
  "辨析源头已过期：先运行 node question-meaning-review/sync-distinction-meanings.mjs");
const reviewedFiles = readdirSync(reviewedDir)
  .filter((name) => name.endsWith(".json") && !["distinction-source.json", "legacy-append-order.json"].includes(name))
  .sort();
for (const [file, records] of [
  ["distinction-source.json", distinctionEntries],
  ...reviewedFiles.map((name) => [name, JSON.parse(readFileSync(path.join(reviewedDir, name), "utf8"))]),
]) {
  const seenPairs = new Set();
  for (const entry of records) {
    const { kanji, kana, meaning, provenance } = entry;
    assert.ok(typeof kanji === "string" && typeof kana === "string" && kana.length > 0
      && typeof meaning === "string" && meaning.trim().length > 0, `释义源头格式错误: ${file}`);
    assert.ok(provenance?.kind && provenance?.reference
      && (provenance.commit === undefined || /^[a-f0-9]{40}$/.test(provenance.commit)),
      `释义源头缺出处或提交号格式错误: ${file}: ${kanji} / ${kana}`);
    const pair = `${kanji}\u0000${kana}`;
    assert.ok(!seenPairs.has(pair), `同一源头文件重复词形: ${file}: ${kanji} / ${kana}`);
    seenPairs.add(pair);
    byPair.set(pair, { kanji, kana, meaning });
  }
}

// 旧表是「6,252 条排序结果 + 397 条历史补入 + 受験移到末尾」。只保存这 398 条
// 的排版顺序，不读取旧产物来决定释义或顺序；否则 CI 无法发现有人直接改了产物。
const appendedPairs = JSON.parse(readFileSync(orderPath, "utf8"))
  .map(({ kanji, kana }) => `${kanji}\u0000${kana}`);
assert.equal(new Set(appendedPairs).size, appendedPairs.length, "历史追加顺序存在重复词形");
for (const pair of appendedPairs) assert.ok(byPair.has(pair), `历史追加词形缺少释义源头: ${pair}`);
const appendedSet = new Set(appendedPairs);
const overrides = [
  ...[...byPair.keys()].filter((pair) => !appendedSet.has(pair))
    // 固定 locale，避免本机中文环境和 GitHub Ubuntu 默认环境产生不同排序。
    .sort((left, right) => left.localeCompare(right, "en")),
  ...appendedPairs,
].map((pair) => {
  const { kanji, kana, meaning } = byPair.get(pair);
  return { kanji, kana, meaning };
});
const output = `${JSON.stringify(overrides, null, 2)}\n`;
if (checkOnly) {
  assert.ok(Buffer.from(output).equals(readFileSync(outputPath)),
    "释义覆盖表与源头生成结果不一致；只改源头，再运行 node frontend/scripts/build-manual-meaning-overrides.mjs");
} else {
  writeFileSync(outputPath, output);
}
db.close();
console.log(`✅ ${checkOnly ? "逐字节校验通过" : "写入"} ${outputPath}: ${overrides.length} 条释义覆盖`);
