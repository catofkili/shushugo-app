// 把 src/data 里的种子修正烧进 public/nihongo.db,并写入版本戳,
// 让新装用户首次启动不需要动态加载种子 JSON、不需要重放 11k 条 UPDATE。
//
// 用法: node scripts/bake-seed-db.mjs   (在 frontend/ 目录下执行)
//
// 注意:这里的 SQL 与 src/lib/study-core.ts 的 syncJlptWordMetadata 保持一致,
// 改动种子逻辑或版本号时两边要同步更新,然后重新跑本脚本。

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import initSqlJs from "sql.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(here, "../public/nihongo.db");
const seedPath = path.join(here, "../src/data/jlpt_words_seed.json");

// 与 src/lib/study-core.ts 保持一致
const JLPT_SEED_VERSION = "2026-06-15-jlpt10k";
const JLPT_WORD_METADATA_VERSION = "2026-06-24-noun-suru-pos-fix";

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
const db = new SQL.Database(new Uint8Array(readFileSync(dbPath)));
const seed = JSON.parse(readFileSync(seedPath, "utf8"));

const firstValue = (query, params = []) => {
  const result = db.exec(query, params);
  return result[0]?.values?.[0]?.[0];
};

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
seed.forEach(([, kana, kanji, pos, verbType, importance, exampleJp, exampleMeaning, jlptLevel]) => {
  db.run(`
    UPDATE words
    SET pos = ?,
        verb_type = ?,
        importance = MAX(importance, ?),
        example_jp = COALESCE(NULLIF(example_jp, ''), ?),
        example_meaning = COALESCE(NULLIF(example_meaning, ''), ?),
        jlpt_level = COALESCE(jlpt_level, ?)
    WHERE kanji = ? AND kana = ?
  `, [pos, verbType, importance, exampleJp, exampleMeaning, jlptLevel, kanji, kana]);
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
db.run("CREATE INDEX IF NOT EXISTS idx_words_jlpt_level ON words(jlpt_level)");
db.run("CREATE INDEX IF NOT EXISTS idx_words_pos ON words(pos)");
db.run("INSERT OR REPLACE INTO app_state (key, value) VALUES ('jlpt_word_metadata_version', ?)", [JLPT_WORD_METADATA_VERSION]);
db.run("INSERT OR REPLACE INTO app_state (key, value) VALUES ('jlpt_seed_version', ?)", [JLPT_SEED_VERSION]);
db.run("COMMIT");
db.run("VACUUM");

writeFileSync(dbPath, Buffer.from(db.export()));
console.log(`✅ 已烧入版本戳 seed=${JLPT_SEED_VERSION} metadata=${JLPT_WORD_METADATA_VERSION}`);
console.log(`✅ 已写回 ${dbPath}`);
