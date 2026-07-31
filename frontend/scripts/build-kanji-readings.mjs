#!/usr/bin/env node
// 从 KANJIDIC2 抽出「汉字 → 音读/训读」表,给假名切分(src/lib/furigana.ts)用。
//
// 输入不进仓库(1.5MB gz),自己下:
//   curl -O http://www.edrdg.org/kanjidic/kanjidic2.xml.gz
//   node frontend/scripts/build-kanji-readings.mjs ./kanjidic2.xml.gz
//
// 只保留本词库 words 表里实际出现过的汉字 + 常用字,整表压到 ~100KB。读音统一转
// 平假名;训读保留 送り仮名 的点(はし.る),对齐时要靠它区分词干和送り仮名。
//
// 数据来源 KANJIDIC2 © Electronic Dictionary Research and Development Group,
// 授权 CC BY-SA 4.0 —— 随 App 分发必须署名,见生成文件里的 license 字段。

import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";

const here = dirname(fileURLToPath(import.meta.url));
const outputPath = join(here, "..", "src", "data", "kanji_readings.json");
const dbPath = join(here, "..", "public", "nihongo.db");

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("用法: node scripts/build-kanji-readings.mjs <kanjidic2.xml.gz>");
  process.exit(1);
}

const katakanaToHiragana = (text) =>
  text.replace(/[ァ-ヶ]/g, (char) => String.fromCodePoint(char.codePointAt(0) - 0x60));

// 词库里实际用到的汉字 —— 表只收这些,别把 12000 个汉字全塞进 App。
const SQL = await initSqlJs();
const db = new SQL.Database(new Uint8Array(readFileSync(dbPath)));
const used = new Set();
for (const [surface] of db.exec("SELECT kanji FROM words")[0].values) {
  for (const char of String(surface ?? "")) {
    if (char >= "一" && char <= "鿿") used.add(char);
  }
}
console.log(`词库用到汉字 ${used.size} 个`);

const xml = gunzipSync(readFileSync(inputPath)).toString("utf8");
const table = {};
let kept = 0;

for (const block of xml.split("<character>").slice(1)) {
  const literal = block.match(/<literal>(.*?)<\/literal>/)?.[1];
  if (!literal || !used.has(literal)) continue;

  const on = [];
  const kun = [];
  for (const [, type, reading] of block.matchAll(
    /<reading r_type="(ja_on|ja_kun)"[^>]*>(.*?)<\/reading>/g
  )) {
    (type === "ja_on" ? on : kun).push(katakanaToHiragana(reading).replace(/-/g, ""));
  }
  if (!on.length && !kun.length) continue;
  // 名乗り(人名读音)不收:数量大、日常词用不上,收了反而让对齐乱认。
  table[literal] = kun.length ? { on, kun } : { on };
  kept += 1;
}

const missing = [...used].filter((char) => !(char in table));
console.log(`收录 ${kept} 个;KANJIDIC2 里查不到的 ${missing.length} 个: ${missing.join("")}`);

writeFileSync(
  outputPath,
  `${JSON.stringify({
    source: "http://www.edrdg.org/kanjidic/kanjidic2.xml.gz",
    license: "KANJIDIC2 © EDRDG, CC BY-SA 4.0 (https://www.edrdg.org/edrdg/licence.html)",
    generated_by: "frontend/scripts/build-kanji-readings.mjs",
    readings: Object.fromEntries(
      Object.entries(table).sort(([left], [right]) => left.codePointAt(0) - right.codePointAt(0))
    )
  })}\n`,
  "utf8"
);
console.log(`✅ 写出 ${outputPath}`);
