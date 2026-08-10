// 把 src/data 里的种子修正烧进 public/nihongo.db,并写入版本戳,
// 让新装用户首次启动不需要动态加载种子 JSON、不需要重放 11k 条 UPDATE。
//
// 用法: node scripts/bake-seed-db.mjs   (在 frontend/ 目录下执行)
//
// 注意:这里的 SQL 与 src/lib/study-core.ts 的 syncJlptWordMetadata 保持一致,
// 改动种子逻辑或版本号时两边要同步更新,然后重新跑本脚本。

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import initSqlJs from "sql.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(here, "../public/nihongo.db");
const seedPath = path.join(here, "../src/data/jlpt_words_seed.json");
const meaningOverridesPath = path.join(here, "../src/data/jlpt_meaning_overrides.json");

// 与 src/lib/study-core.ts 保持一致
const JLPT_SEED_VERSION = "2026-06-15-jlpt10k";
const JLPT_WORD_METADATA_VERSION = "2026-08-10-manual-meanings-5163";

const nounSuruCorrections = [
  ["運動", "うんどう"], ["計画", "けいかく"], ["研究", "けんきゅう"], ["故障", "こしょう"],
  ["授業", "じゅぎょう"], ["生活", "せいかつ"], ["選択", "せんたく"], ["卒業", "そつぎょう"],
  ["留学", "りゅうがく"], ["旅行", "りょこう"], ["練習", "れんしゅう"], ["連絡", "れんらく"],
  ["遅刻", "ちこく"], ["出発", "しゅっぱつ"], ["到着", "とうちゃく"], ["見学", "けんがく"],
  ["復習", "ふくしゅう"], ["予習", "よしゅう"], ["予約", "よやく"], ["翻訳", "ほんやく"],
  ["信号", "しんごう"], ["洗濯", "せんたく"], ["勉強", "べんきょう"], ["活動", "かつどう"],
  ["帰国", "きこく"], ["挨拶", "あいさつ"], ["営業", "えいぎょう"], ["希望", "きぼう"],
  ["成功", "せいこう"], ["入学", "にゅうがく"], ["約束", "やくそく"], ["利用", "りよう"],
  ["急行", "きゅうこう"], ["協力", "きょうりょく"], ["教育", "きょういく"], ["緊張", "きんちょう"],
  ["行動", "こうどう"], ["信用", "しんよう"], ["努力", "どりょく"], ["輸出", "ゆしゅつ"],
  ["輸入", "ゆにゅう"], ["冷蔵", "れいぞう"], ["朝寝坊", "あさねぼう"], ["誕生", "たんじょう"],
  ["飲食", "いんしょく"], ["出張", "しゅっちょう"], ["ごちそう", "ごちそう"], ["影響", "えいきょう"],
  ["遠足", "えんそく"], ["学習", "がくしゅう"], ["観光", "かんこう"], ["競争", "きょうそう"],
  ["見物", "けんぶつ"], ["合格", "ごうかく"], ["集合", "しゅうごう"], ["体操", "たいそう"],
  ["暖房", "だんぼう"], ["報告", "ほうこく"], ["放送", "ほうそう"], ["提出", "ていしゅつ"],
  ["転職", "てんしょく"], ["優勝", "ゆうしょう"], ["外出", "がいしゅつ"], ["研修", "けんしゅう"],
  ["広告", "こうこく"], ["残業", "ざんぎょう"], ["就職", "しゅうしょく"], ["彫刻", "ちょうこく"],
  ["流行", "りゅうこう"], ["担当", "たんとう"], ["企画", "きかく"], ["泥棒", "どろぼう"],
  ["看病", "かんびょう"]
];

const SQL = await initSqlJs();
const databaseBytes = readFileSync(dbPath);
const db = new SQL.Database(new Uint8Array(databaseBytes));
const seed = JSON.parse(readFileSync(seedPath, "utf8"));
const meaningOverrides = new Map(
  JSON.parse(readFileSync(meaningOverridesPath, "utf8"))
    .map(({ kanji, kana, meaning }) => [`${kanji}\u0000${kana}`, meaning])
);

const firstValue = (query, params = []) => {
  const result = db.exec(query, params);
  return result[0]?.values?.[0]?.[0];
};

const userDataTables = [
  "progress", "reviews", "checkins", "critical_reviews", "word_notes", "word_study_time",
  "kanji_progress", "kanji_memory", "kanji_char_overrides", "stage1_tasks", "stage2_progress",
  "moji_migrated_reviews", "grammar_progress", "grammar_reviews", "grammar_points_archive"
];
const populatedUserTables = userDataTables
  .map((table) => [table, Number(firstValue(`SELECT COUNT(*) FROM ${table}`))])
  .filter(([, count]) => count > 0);
if (populatedUserTables.length) {
  throw new Error(`拒绝更新出厂词库：其中含有用户数据（${populatedUserTables.map(([table, count]) => `${table}=${count}`).join(", ")}）`);
}

const total = Number(firstValue("SELECT COUNT(*) FROM words"));
const leveled = Number(firstValue(
  "SELECT COUNT(*) FROM words WHERE jlpt_level IN ('N5','N4','N3','N2','N1')"
));
if (total < 10000 || leveled < 10000) {
  throw new Error(`words 表不完整(total=${total}, leveled=${leveled}),不应直接烧版本戳`);
}

console.log(`words: ${total} 条(${leveled} 条有 JLPT 等级)`);
console.log(`当前 metadata 版本: ${firstValue("SELECT value FROM app_state WHERE key='jlpt_word_metadata_version'") ?? "(无)"}`);

db.run("BEGIN TRANSACTION");
const syncedKeys = new Set();
seed.forEach(([, kana, kanji, pos, verbType, importance, exampleJp, exampleMeaning, jlptLevel]) => {
  const key = `${kanji}\u0000${kana}`;
  if (syncedKeys.has(key)) return;
  syncedKeys.add(key);
  db.run(`
    UPDATE words
    SET meaning = COALESCE(?, meaning),
        pos = ?,
        verb_type = ?,
        importance = MAX(importance, ?),
        example_jp = ?,
        example_meaning = ?,
        jlpt_level = COALESCE(jlpt_level, ?)
    WHERE kanji = ? AND kana = ?
  `, [meaningOverrides.get(key) ?? null, pos, verbType, importance, exampleJp, exampleMeaning, jlptLevel, kanji, kana]);
});
// 手写释义覆盖表包含词库中不在当前 JLPT seed 行里的词形（例如同读音的
// 异体字）。单独再按表记+读音回写，确保出厂库和老用户迁移都不会漏掉这些行。
meaningOverrides.forEach((meaning, key) => {
  const separator = key.indexOf("\u0000");
  const kanji = key.slice(0, separator);
  const kana = key.slice(separator + 1);
  db.run("UPDATE words SET meaning = ? WHERE kanji = ? AND kana = ?", [meaning, kanji, kana]);
});
db.run(`
  UPDATE words
  SET pos = '名词',
      verb_type = NULL
  WHERE pos = '名词・する动词'
    AND (
      (kanji = '戦争' AND kana = 'せんそう') OR
      (kanji = 'チェック' AND kana = 'チェック') OR
      (kanji = 'コピー' AND kana = 'コピー')
    )
`);
nounSuruCorrections.forEach(([kanji, kana]) => {
  db.run(`
    UPDATE words
    SET pos = '名词・する动词',
        verb_type = 'suru'
    WHERE kanji = ?
      AND kana = ?
      AND pos = '动词'
      AND verb_type = 'godan'
  `, [kanji, kana]);
});
// 外来語词条被录了两遍:同一个假名,一行的 kanji 存片假名(コート),另一行存
// 英文原词(coat)。因为 kanji 不同,按 (kanji, kana) 去重抓不到。
//
// 两行各有各的东西,所以是合并不是删除:
//  - 英文行有 JLPT 等级和例句(104/104),片假名行一个都没有;
//    而且 englishOrigin() 靠 kanji 里的拉丁字母产出「英语原词」板块,
//    isLoanwordSourceCard 已经保证卡面渲染的是假名而不是英文,不会显示错。
//  - 片假名行带着重写过的释义(97/104),英文行多半还是旧的。
// 所以保留英文行,把片假名行的释义搬过去,再删掉片假名行。
//
// 被删的 id 写进 loanword-merge-map.json:人工释义是按 id 记的,
// build-manual-meaning-overrides.mjs 要靠这份映射把释义挂到存活的那行上,
// 否则老用户的英文行永远拿不到重写后的释义。
const loanwordMergeMap = {};
const mergeLoanwordRows = () => {
  const result = db.exec(`
    SELECT kana, GROUP_CONCAT(id) AS ids
    FROM words
    GROUP BY kana
    HAVING COUNT(*) > 1
  `);
  let merged = 0;
  (result[0]?.values ?? []).forEach(([kana, ids]) => {
    const members = String(ids).split(",").map(Number).map((id) => {
      const row = db.exec("SELECT id, kanji, meaning FROM words WHERE id = ?", [id])[0]?.values?.[0];
      return { id, kanji: String(row?.[1] ?? ""), meaning: String(row?.[2] ?? "") };
    });
    const latin = members.filter((m) => /[A-Za-z]/.test(m.kanji));
    // 「裸行」= kanji 原样重复了假名,这是同一个词被录第二遍的形态特征。
    // 不能改用「首义相同」当判据:两行里往往一行是旧释义、一行是重写后的
    // (照相机/相机、派对/聚会),首义本来就不一样。
    const bare = members.filter((m) => m.kanji === String(kana));
    if (latin.length !== 1 || bare.length !== 1 || members.length !== 2) return;

    const keep = latin[0];
    const drop = bare[0];
    // 释义取重写过的那条:覆盖表里有这个词形就说明它是人工重写的。
    const dropWasRewritten = meaningOverrides.has(`${drop.kanji}\u0000${kana}`);
    if (dropWasRewritten) db.run("UPDATE words SET meaning = ? WHERE id = ?", [drop.meaning, keep.id]);
    db.run("DELETE FROM progress WHERE word_id = ?", [drop.id]);
    db.run("DELETE FROM words WHERE id = ?", [drop.id]);
    loanwordMergeMap[drop.id] = keep.id;
    merged += 1;
  });
  return merged;
};


// 同一个 (kanji, kana) 出现多行 = 数据 bug,不是多义词。整条流水线都拿这一对当
// 唯一键:ensureJlptWordSeed 按它判断要不要插入,syncJlptWordMetadata 和释义覆盖
// 表按它 UPDATE(会同时写中所有重复行)。留着重复行的后果是同一个词一天考两遍,
// 而且答案面的近义词对照卡会把它自己列出来两次。保留 id 最小的那行。
const duplicateRows = [];
{
  const result = db.exec(`
    SELECT kanji, kana, GROUP_CONCAT(id) AS ids, COUNT(*) AS n
    FROM words
    GROUP BY kanji, kana
    HAVING n > 1
  `);
  const rows = result[0]?.values ?? [];
  rows.forEach(([kanji, kana, ids]) => {
    const sorted = String(ids).split(",").map(Number).sort((a, b) => a - b);
    const [keep, ...drop] = sorted;
    duplicateRows.push({ kanji, kana, keep, drop });
    drop.forEach((id) => {
      db.run("DELETE FROM progress WHERE word_id = ?", [id]);
      db.run("DELETE FROM words WHERE id = ?", [id]);
      // 和外来語合并同理:人工释义按 id 记,删掉的行要能解析到存活行。
      loanwordMergeMap[id] = keep;
    });
  });
}
// 先完全重复去重、再合并外来語:同一个假名下有三行(片假名×2 + 英文)时,
// 合并那一步会因为「不是恰好两行」跳过,得等去重把第三行清掉。
const mergedLoanwords = mergeLoanwordRows();
if (mergedLoanwords) {
  console.log(`   外来語重复行合并 ${mergedLoanwords} 组(保留英文原词行,搬入重写释义)`);
}

if (duplicateRows.length) {
  duplicateRows.forEach(({ kanji, kana, keep, drop }) => {
    console.log(`   去重 ${kanji}(${kana}): 保留 id=${keep}, 删除 ${drop.join(", ")}`);
  });
}

// 两步去重（外来語合并 + 完全重复行）删掉的 id → 存活 id。
// 人工释义是按 id 记的，build-manual-meaning-overrides.mjs 靠这份映射
// 把释义改挂到存活行上，否则老用户的库永远拿不到那部分重写释义。
{
  const mapPath = path.join(here, "loanword-merge-map.json");
  const previous = existsSync(mapPath) ? JSON.parse(readFileSync(mapPath, "utf8")) : {};
  writeFileSync(mapPath, `${JSON.stringify({ ...previous, ...loanwordMergeMap }, null, 2)}\n`);
}

db.run("CREATE INDEX IF NOT EXISTS idx_words_jlpt_level ON words(jlpt_level)");
db.run("CREATE INDEX IF NOT EXISTS idx_words_pos ON words(pos)");
db.run("INSERT OR REPLACE INTO app_state (key, value) VALUES ('jlpt_word_metadata_version', ?)", [JLPT_WORD_METADATA_VERSION]);
db.run("INSERT OR REPLACE INTO app_state (key, value) VALUES ('jlpt_seed_version', ?)", [JLPT_SEED_VERSION]);
db.run("COMMIT");
db.run("VACUUM");

writeFileSync(dbPath, Buffer.from(db.export()));
console.log(`✅ 已烧入版本戳 seed=${JLPT_SEED_VERSION} metadata=${JLPT_WORD_METADATA_VERSION}`);
console.log(`✅ 已写回 ${dbPath}`);
