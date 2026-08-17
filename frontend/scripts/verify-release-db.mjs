// 发布前阻止把开发者自己的学习记录、笔记或迁移痕迹带进安装包。
// `npm run build` 会自动执行本检查；出厂词库只应包含 words 和种子版本信息。

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import initSqlJs from "sql.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, "../public");
const dbPath = path.join(publicDir, "nihongo.db");

// public/ 下的**一切**都会被原样复制进 dist/ 并公开可下载。
//
// 以前这里只拦 .db/.sqlite,结果是「不是数据库的东西」照样能溜出去 ——
// 网页原型、设计稿、导出的 HTML 放进 public/ 都会随网页版一起公开。
// 所以改成白名单:只有明确列出的顶层条目允许存在,新增任何东西都必须
// 先在这里登记,顺便逼着人想一遍「这个真的要对外公开吗」。
const ALLOWED_PUBLIC_ENTRIES = new Set([
  "nihongo.db",   // 出厂词库
  "audio",        // 预生成单词读音
  ".DS_Store"
]);

const strayEntries = readdirSync(publicDir, { withFileTypes: true })
  .map((entry) => entry.name)
  .filter((name) => !ALLOWED_PUBLIC_ENTRIES.has(name));

if (strayEntries.length) {
  throw new Error(
    `拒绝构建：public/ 下存在未登记的条目（${strayEntries.join(", ")}）。\n` +
    `public/ 的内容会原样发布到网站上。确认可以公开的,加进 verify-release-db.mjs ` +
    `的 ALLOWED_PUBLIC_ENTRIES；否则请移出 public/（设计稿/原型放 design/）。`
  );
}

const userDataTables = [
  "progress",
  "reviews",
  "checkins",
  "critical_reviews",
  "word_notes",
  "word_study_time",
  "kanji_progress",
  "kanji_memory",
  "kanji_char_overrides",
  "stage1_tasks",
  "stage2_progress",
  "moji_migrated_reviews",
  "grammar_progress",
  "grammar_reviews",
  "grammar_points_archive",
  "dictionary_discovered_words"
];

const SQL = await initSqlJs();
const bytes = readFileSync(dbPath);
const db = new SQL.Database(new Uint8Array(bytes));
const scalar = (query, params = []) => Number(db.exec(query, params)[0]?.values[0]?.[0] ?? 0);

const grammarSource = readFileSync(path.join(here, "../src/data/grammar.ts"), "utf8")
  .replace(/^import[^\n]+\n/, "")
  .replace("const GRAMMAR_POINTS: GrammarPoint[] =", "globalThis.GRAMMAR_POINTS =")
  .replace(/export const grammarPoints = GRAMMAR_POINTS;\s*$/, "");
const grammarSandbox = {};
vm.createContext(grammarSandbox);
vm.runInContext(grammarSource, grammarSandbox, { filename: "grammar.ts" });
const grammarPoints = Array.isArray(grammarSandbox.GRAMMAR_POINTS) ? grammarSandbox.GRAMMAR_POINTS : [];
const grammarRows = db.exec(`
  SELECT pattern, meaning, example_jp, level, sort_order, example_tokens, example_lemmas
  FROM grammar_points ORDER BY sort_order
`)[0]?.values ?? [];
const grammarMismatches = [];
const orderedPoints = [...grammarPoints].sort((left, right) => Number(left.bookOrder) - Number(right.bookOrder));
if (grammarRows.length !== orderedPoints.length) {
  grammarMismatches.push(`条数 ${grammarRows.length} != grammar.ts ${orderedPoints.length}`);
} else {
  grammarRows.forEach(([pattern, meaning, exampleJp, level, sortOrder, exampleTokens, exampleLemmas], index) => {
    const point = orderedPoints[index];
    const example = point.examples?.[0] ?? {};
    const patternMatches = String(pattern ?? "") === String(point.title ?? "")
      || String(pattern ?? "").startsWith(`${String(point.title ?? "")}（`);
    const expected = [point.meaning, example.jp ?? example.japanese ?? "", point.level, point.bookOrder, example.tokenLengths ?? "", example.tokenLemmas ?? ""];
    const actual = [meaning, exampleJp, level, sortOrder, exampleTokens, exampleLemmas];
    if (!patternMatches || expected.some((value, field) => String(value ?? "") !== String(actual[field] ?? ""))) {
      grammarMismatches.push(`sort_order=${sortOrder} (${point.id}) 正文与 grammar.ts 不一致`);
    }
  });
}

const invalidTokenRows = (candidateDb) => {
  const rows = candidateDb.exec(`
    SELECT example_jp, example_tokens, example_lemmas
    FROM words WHERE COALESCE(example_jp, '') != ''
    UNION ALL
    SELECT example_jp, example_tokens, example_lemmas
    FROM grammar_points WHERE COALESCE(example_jp, '') != ''
  `)[0]?.values ?? [];
  return rows.filter(([sentenceValue, tokenValue]) => {
    const sentence = String(sentenceValue ?? "");
    const lengths = String(tokenValue ?? "").split(",").map(Number);
    return !lengths.length
      || lengths.some((length) => !Number.isInteger(length) || length === 0)
      || lengths.reduce((sum, length) => sum + Math.abs(length), 0) !== sentence.length;
  }).length;
};
const invalidPublicTokenRows = invalidTokenRows(db);
if (invalidPublicTokenRows) grammarMismatches.push(`public 边界串无效 ${invalidPublicTokenRows} 条`);
const grammarSeed = JSON.parse(readFileSync(path.join(here, "../src/data/grammar_seed.json"), "utf8"));
const dictionarySupplementSeed = JSON.parse(readFileSync(
  path.join(here, "../src/data/dictionary_supplement_seed.json"),
  "utf8"
));
const dictionaryMismatches = [];
const dictionaryRows = db.exec(`
  SELECT entry_key,headword,kana,meaning,pos,verb_type,category,usage_note,
    example_jp,example_meaning,priority,source_name,source_url,license,seed_version
  FROM dictionary_entries
  WHERE entry_key LIKE 'builtin:%'
  ORDER BY entry_key
`)[0]?.values ?? [];
const expectedDictionaryRows = dictionarySupplementSeed.entries.map((entry) => [
  entry.entryKey,
  entry.headword,
  entry.kana,
  entry.meaning,
  entry.pos,
  entry.verbType,
  entry.category,
  entry.usageNote,
  entry.exampleJp,
  entry.exampleMeaning,
  entry.priority,
  dictionarySupplementSeed.source.name,
  dictionarySupplementSeed.source.url,
  dictionarySupplementSeed.source.license,
  dictionarySupplementSeed.version
]).sort((left, right) => String(left[0]).localeCompare(String(right[0])));
if (JSON.stringify(dictionaryRows) !== JSON.stringify(expectedDictionaryRows)) {
  dictionaryMismatches.push(`public 补充词典与 seed 不一致(${dictionaryRows.length}/${expectedDictionaryRows.length})`);
}
const shippedDictionaryVersion = db.exec(
  "SELECT value FROM app_state WHERE key = 'dictionary_supplement_version'"
)[0]?.values?.[0]?.[0] ?? "";
if (String(shippedDictionaryVersion) !== String(dictionarySupplementSeed.version)) {
  dictionaryMismatches.push(`public 补充词典版本 ${shippedDictionaryVersion} != ${dictionarySupplementSeed.version}`);
}
const shippedGrammarVersion = db.exec("SELECT value FROM grammar_state WHERE key = 'dataset_version'")[0]?.values?.[0]?.[0] ?? "";
if (String(shippedGrammarVersion) !== String(grammarSeed.version)) {
  grammarMismatches.push(`grammar_state=${shippedGrammarVersion} != grammar_seed=${grammarSeed.version}`);
}

// iOS embeds a second copy which is ignored by git but ships in the native
// bundle. Verify it too so a web-only bake can never leave the app with stale
// grammar text.
const iosDbPath = path.join(here, "../ios/App/App/public/nihongo.db");
if (existsSync(iosDbPath)) {
  const iosDb = new SQL.Database(new Uint8Array(readFileSync(iosDbPath)));
  const iosRows = iosDb.exec(`
    SELECT pattern, meaning, example_jp, level, sort_order, example_tokens, example_lemmas
    FROM grammar_points ORDER BY sort_order
  `)[0]?.values ?? [];
  if (JSON.stringify(iosRows) !== JSON.stringify(grammarRows)) {
    grammarMismatches.push("iOS nihongo.db 与 public/nihongo.db 的语法正文不一致");
  }
  const iosVersion = iosDb.exec("SELECT value FROM grammar_state WHERE key = 'dataset_version'")[0]?.values?.[0]?.[0] ?? "";
  if (String(iosVersion) !== String(grammarSeed.version)) {
    grammarMismatches.push(`iOS grammar_state=${iosVersion} != grammar_seed=${grammarSeed.version}`);
  }
  const invalidIosTokenRows = invalidTokenRows(iosDb);
  if (invalidIosTokenRows) grammarMismatches.push(`iOS 边界串无效 ${invalidIosTokenRows} 条`);
  const iosDictionaryRows = iosDb.exec(`
    SELECT entry_key,headword,kana,meaning,pos,verb_type,category,usage_note,
      example_jp,example_meaning,priority,source_name,source_url,license,seed_version
    FROM dictionary_entries
    WHERE entry_key LIKE 'builtin:%'
    ORDER BY entry_key
  `)[0]?.values ?? [];
  if (JSON.stringify(iosDictionaryRows) !== JSON.stringify(dictionaryRows)) {
    dictionaryMismatches.push("iOS nihongo.db 与 public/nihongo.db 的补充词典不一致");
  }
  const iosDictionaryVersion = iosDb.exec(
    "SELECT value FROM app_state WHERE key = 'dictionary_supplement_version'"
  )[0]?.values?.[0]?.[0] ?? "";
  if (String(iosDictionaryVersion) !== String(dictionarySupplementSeed.version)) {
    dictionaryMismatches.push(`iOS 补充词典版本 ${iosDictionaryVersion} != ${dictionarySupplementSeed.version}`);
  }
  iosDb.close();
}

const populated = userDataTables
  .map((table) => [table, scalar(`SELECT COUNT(*) FROM ${table}`)])
  .filter(([, count]) => count > 0);
const personalMarkers = ["project1", "personal_data_migrated", "/Users/"];
const databaseText = new TextDecoder().decode(bytes);
const foundMarkers = personalMarkers.filter((marker) => databaseText.includes(marker));

if (populated.length || foundMarkers.length || grammarMismatches.length || dictionaryMismatches.length) {
  const details = [
    populated.length && `含有用户记录: ${populated.map(([table, count]) => `${table}=${count}`).join(", ")}`,
    foundMarkers.length && `含有个人迁移标记: ${foundMarkers.join(", ")}`,
    grammarMismatches.length && `语法正文不一致: ${grammarMismatches.slice(0, 5).join("；")}${grammarMismatches.length > 5 ? "；…" : ""}`,
    dictionaryMismatches.length && `补充词典不一致: ${dictionaryMismatches.join("；")}`
  ].filter(Boolean).join("；");
  throw new Error(`拒绝构建：public/nihongo.db 不是干净的出厂词库（${details}）。请先清空个人数据。`);
}

console.log("✓ 出厂词库检查通过：未发现个人学习数据或迁移痕迹。");
