#!/usr/bin/env node
// 从 Kanjium 抽「词 → 音高重音核位置」,给单词卡上的声调曲线用。
//
// 音高重音是日语里区分词义的东西:橋(はし↓ 尾高)和 箸(は↓し 头高)假名一模一样,
// 靠音高分。中文母语者没有这个维度的感知,不标出来基本靠蒙 —— 词库里原本没有
// 这个字段,所以卡片上一直没有。
//
// 输入不进仓库(3.2MB),自己下:
//   curl -O https://raw.githubusercontent.com/mifunetoshiro/kanjium/master/data/source_files/raw/accents.txt
//   node frontend/scripts/build-pitch-accent.mjs ./accents.txt
//
// 数值是「重音核在第几拍」的标准记法:
//   0 = 平板型(はいざら:低高高高,后接助词也不降)
//   1 = 头高型(は↓し:第一拍高,之后降)
//   n = 中高/尾高(はし↓:第 n 拍后降)
//
// 数据来源 Kanjium © mifunetoshiro,授权 CC BY-SA 4.0 —— 随 App 分发必须署名,
// 见生成文件里的 license 字段。

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";

const here = dirname(fileURLToPath(import.meta.url));
const outputPath = join(here, "..", "src", "data", "pitch_accent.json");
const dbPath = join(here, "..", "public", "nihongo.db");

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("用法: node scripts/build-pitch-accent.mjs <accents.txt>");
  process.exit(1);
}

// 重音字段的形态:「0」「0,2」「(副)0,(名)0,3」。词性标注剥掉,只留数字;
// 一个词有多个可接受重音时全留,显示时用第一个(词典里的首选)。
function parseAccents(field) {
  const values = [];
  for (const part of field.split(",")) {
    const number = Number(part.replace(/（[^）]*）|\([^)]*\)/g, "").trim());
    if (Number.isInteger(number) && number >= 0 && !values.includes(number)) values.push(number);
  }
  return values;
}

const bySurfaceReading = new Map(); // 「表记\t读音」→ 重音数组
const byReading = new Map(); // 读音 → 重音集合(用于只有假名的词条;有歧义就不敢用)

for (const line of readFileSync(inputPath, "utf8").split("\n")) {
  const [surface, rawReading, field] = line.split("\t");
  if (!surface || !field) continue;
  // 片假名词条的读音列是空的(チェック\t\t1):表记本身就是读音
  const reading = rawReading || surface;
  const accents = parseAccents(field);
  if (!accents.length) continue;

  bySurfaceReading.set(`${surface}\t${reading}`, accents);
  const seen = byReading.get(reading);
  if (!seen) byReading.set(reading, new Set(accents));
  else accents.forEach((accent) => seen.add(accent));
}
console.log(`Kanjium 条目 ${bySurfaceReading.size} 个`);

const SQL = await initSqlJs();
const db = new SQL.Database(new Uint8Array(readFileSync(dbPath)));
const rows = db.exec("SELECT kanji, kana FROM words")[0].values;

// 词库表记里夹着 濡[ぬ]れる 的注音方括号、〜出す 的波浪号,查表前剥掉
const normalize = (text) => text.replace(/\[[^\]]*\]/g, "").replace(/[〜～~\s]/g, "");

const output = {};
let matched = 0;
let byReadingOnly = 0;
const missed = [];

for (const [rawKanji, rawKana] of rows) {
  const kanji = String(rawKanji ?? "");
  const kana = String(rawKana ?? "");
  const surface = normalize(kanji);
  const reading = normalize(kana); // 「〜回/〜かい」两列都带波浪号,都要剥
  if (!surface || !reading) continue;

  let accents =
    bySurfaceReading.get(`${surface}\t${reading}`) ?? bySurfaceReading.get(`${reading}\t${reading}`);

  // 表记对不上时,只有当这个读音在整个 Kanjium 里重音唯一才敢用 —— はし 有
  // 1(箸)和 2(橋)两种,这种情况宁可不标,标错等于教错。
  if (!accents) {
    const candidates = byReading.get(reading);
    if (candidates?.size === 1) {
      accents = [...candidates];
      byReadingOnly += 1;
    }
  }

  if (accents) {
    output[`${kanji}|${kana}`] = accents.length === 1 ? accents[0] : accents;
    matched += 1;
  } else if (missed.length < 25) {
    missed.push(`${kanji}/${kana}`);
  }
}

console.log(`词库 ${rows.length} 条 → 匹配上 ${matched} 条 (${((matched / rows.length) * 100).toFixed(1)}%)`);
console.log(`  其中靠"读音唯一"兜底匹配的 ${byReadingOnly} 条`);
console.log(`没匹配上的例子: ${missed.join(" ")}`);

writeFileSync(
  outputPath,
  `${JSON.stringify({
    source: "https://github.com/mifunetoshiro/kanjium",
    license: "Kanjium © mifunetoshiro, CC BY-SA 4.0",
    generated_by: "frontend/scripts/build-pitch-accent.mjs",
    note: "值是重音核在第几拍:0=平板,1=头高,n=第 n 拍后降。数组表示词典收了多个可接受重音,首项为首选。",
    accents: output
  })}\n`,
  "utf8"
);
console.log(`✅ 写出 ${outputPath}`);
