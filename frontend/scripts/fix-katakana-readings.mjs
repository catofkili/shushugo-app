#!/usr/bin/env node
// 修词库里「片假名词的读音被写成平假名」的历史数据问题。
//
// 症状:エスカレーター 的读音列写的是 えすかれーたー、瑞西(スイス)写的是 すいす。
// 外来语和国名在日语里就是用片假名写的,卡片上显示平假名等于教错写法。
//
//   node scripts/fix-katakana-readings.mjs --dry-run   # 只报告不改
//   node scripts/fix-katakana-readings.mjs             # 改 public/nihongo.db
//
// 改 kana 会连带两件事,脚本会一并提示:
//   1. 音频文件名是 hash(表记|假名),读音一变文件名就变 → 这些词要补生成音频
//   2. 音高表 pitch_accent.json 也按「表记|假名」索引 → 要重新生成
//
// 用户学习进度按 word_id 记,改读音不影响进度。

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { pronunciationAudioName } from "../src/lib/speech.ts";

const here = dirname(fileURLToPath(import.meta.url));
const dbPath = join(here, "..", "public", "nihongo.db");
const dryRun = process.argv.includes("--dry-run");

const toKatakana = (text) =>
  text.replace(/[ぁ-ゖ]/g, (char) => String.fromCodePoint(char.codePointAt(0) + 0x60));
const toHiragana = (text) =>
  text.replace(/[ァ-ヶ]/g, (char) => String.fromCodePoint(char.codePointAt(0) - 0x60));
const hasKatakana = (text) => /[ァ-ヴ]/.test(text);

// 读音写法与表记对不上、需要人工判断的(ゴールデンウィーク←ごおるでんうぃいく 这种
// 用 おお/いい 代替长音的),不猜,列出来给人看。
const needsReview = [];

// 表记→正确读音的人工指定。两类:
//  1. 当て字外来语:表记是汉字但词本身是外来语(瑞西 = スイス)。没法机械判定 ——
//     二酸化炭素 的释义里也有外文 CO2,靠释义猜会误伤。
//  2. 长音写法不规范:读音里用 おお/おう/いい 代替了长音符,和表记对不上,
//     机械替换会触发安全闸。按表记改才对。
const MANUAL_READINGS = {
  "瑞西": "スイス",
  "ゴールデンウィーク": "ゴールデンウィーク",
  "ボールペン": "ボールペン"
};

const SQL = await initSqlJs();
const db = new SQL.Database(new Uint8Array(readFileSync(dbPath)));
const rows = db.exec("SELECT id, kanji, kana FROM words")[0].values;

const fixes = [];
for (const [id, rawKanji, rawKana] of rows) {
  const kanji = String(rawKanji ?? "");
  const kana = String(rawKana ?? "");
  if (!kanji || !kana || hasKatakana(kana)) continue; // 读音已经有片假名的不动

  let corrected = null;
  let kind = "";

  if (MANUAL_READINGS[kanji]) {
    corrected = MANUAL_READINGS[kanji];
    kind = "人工指定";
    // 人工指定的绕过下面的安全闸(长音写法本来就和原读音对不上)
    if (corrected !== kana) fixes.push({ id: Number(id), kanji, from: kana, to: corrected, kind });
    continue;
  } else if (!hasKatakana(kanji)) {
    continue; // 表记里根本没片假名,读音是平假名很正常
  } else if (toKatakana(kana) === kanji) {
    // 纯片假名词:读音就是表记本身(エスカレーター←えすかれーたー)
    corrected = kanji;
    kind = "纯片假名词";
  } else {
    // 混合表记(バス停/消しゴム/スペイン語):表记里的每一段片假名,在读音里对应同样
    // 的假名,只是被写成了平假名。把这些段原样换回片假名,汉字部分的读音保持平假名。
    corrected = kana;
    for (const run of kanji.match(/[ァ-ヴー]+/g) ?? []) {
      const asHiragana = toHiragana(run);
      if (!corrected.includes(asHiragana)) {
        needsReview.push(`${kanji} / ${kana}(片假名段「${run}」在读音里找不到对应)`);
        corrected = null;
        break;
      }
      corrected = corrected.replace(asHiragana, run);
    }
    if (!corrected) continue;
    kind = "混合表记";
  }

  if (!corrected || corrected === kana) continue;
  // 安全闸:改完的读音去掉片假名/平假名差异后必须和原读音一致,否则说明切错了
  if (toKatakana(corrected) !== toKatakana(kana)) {
    console.warn(`  ⚠️ 跳过 ${kanji}:${kana} → ${corrected}(音не一致)`);
    continue;
  }
  fixes.push({ id: Number(id), kanji, from: kana, to: corrected, kind });
}

if (needsReview.length) {
  console.log(`\n需人工确认 ${needsReview.length} 条(读音写法与表记对不上,脚本不猜):`);
  for (const item of needsReview) console.log(`  ${item}`);
  console.log();
}

const byKind = fixes.reduce((acc, fix) => ({ ...acc, [fix.kind]: (acc[fix.kind] ?? 0) + 1 }), {});
console.log(`扫描 ${rows.length} 条,需要修 ${fixes.length} 条:`);
for (const [kind, count] of Object.entries(byKind)) console.log(`  ${kind}: ${count} 条`);
console.log();
for (const fix of fixes.slice(0, 15)) console.log(`  ${fix.kanji}  ${fix.from} → ${fix.to}`);
if (fixes.length > 15) console.log(`  …还有 ${fixes.length - 15} 条`);

if (dryRun) {
  console.log("\n--dry-run:没有改动数据库。");
  process.exit(0);
}

db.run("BEGIN TRANSACTION");
for (const fix of fixes) db.run("UPDATE words SET kana = ? WHERE id = ?", [fix.to, fix.id]);
db.run("COMMIT");
writeFileSync(dbPath, Buffer.from(db.export()));
console.log(`\n✅ 已更新 ${fixes.length} 条读音 → ${dbPath}`);

// 出厂库改了不代表已装好的库会跟着变 —— 老用户的本地库是安装时拷过去的,之后
// 只跟着迁移走。把修正清单写成数据文件,由 study-core 的迁移逐条 UPDATE 上去。
// 按「表记 + 旧读音」定位而不是 word_id:本地库可能来自导入/合并,id 不一定对得上。
writeFileSync(
  join(here, "..", "src", "data", "kana_reading_fixes.json"),
  `${JSON.stringify(
    {
      note: "片假名词读音被写成平假名的历史数据修正。由 scripts/fix-katakana-readings.mjs 生成。",
      version: new Date().toISOString().slice(0, 10),
      fixes: fixes.map((fix) => [fix.kanji, fix.from, fix.to])
    },
    null,
    1
  )}\n`
);
console.log(`已写出迁移清单 src/data/kana_reading_fixes.json(${fixes.length} 条)`);

// 读音变了,音频文件名跟着变。把要补生成的旧/新文件名列出来,方便清理和补齐。
const stale = fixes.map((fix) => ({
  word: `${fix.kanji}/${fix.to}`,
  old: pronunciationAudioName(fix.kanji, fix.from),
  now: pronunciationAudioName(fix.kanji, fix.to)
}));
writeFileSync(join(here, "..", "public", "audio", "words", "_stale-after-kana-fix.json"),
  JSON.stringify(stale, null, 1));
console.log(`\n接下来要做:`);
console.log(`  1. 重新生成音高表(需要 accents.txt):node scripts/build-pitch-accent.mjs <accents.txt>`);
console.log(`  2. 补生成这 ${fixes.length} 个词的音频(每个声音跑一次生成脚本即可,已存在的会跳过)`);
console.log(`  3. 旧文件名清单写在 public/audio/words/_stale-after-kana-fix.json,确认无误后可删`);
