#!/usr/bin/env node
// 从 JMdict 抽「动词 → 自/他」,给单词卡上的自他标注用。
//
// 输入不进仓库(10MB gz),自己下:
//   curl -O http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz
//   node frontend/scripts/build-verb-transitivity.mjs ./JMdict_e.gz
//
// 只留本词库 words 表里真实存在的动词,产出 src/data/verb_transitivity.json。
// 键是「表记|假名」而不是单独的表记 —— 開く 有 ひらく(自他)和 あく(自)两个读音,
// 只按表记查会把两者混成一个答案。
//
// 数据来源 JMdict © Electronic Dictionary Research and Development Group,
// 授权 CC BY-SA 4.0 —— 随 App 分发必须署名,见生成文件里的 license 字段。

import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";

const here = dirname(fileURLToPath(import.meta.url));
const outputPath = join(here, "..", "src", "data", "verb_transitivity.json");
const dbPath = join(here, "..", "public", "nihongo.db");

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("用法: node scripts/build-verb-transitivity.mjs <JMdict_e.gz>");
  process.exit(1);
}

const SQL = await initSqlJs();
const db = new SQL.Database(new Uint8Array(readFileSync(dbPath)));
const verbs = db
  .exec("SELECT kanji, kana FROM words WHERE pos LIKE '%动词%'")[0]
  .values.map(([kanji, kana]) => [String(kanji ?? ""), String(kana ?? "")]);
console.log(`词库动词 ${verbs.length} 条`);

// JMdict 一条 entry 会把多个表记(k_ele)挂在同一个读音下,vi/vt 标在义项(sense)上。
// 開ける/空ける/明ける 共用 あける,前两个是他动词、明ける 是自动词 —— 按 entry 整体
// 取并集会把 開ける 标成「自他」,是错的。所以要逐义项算,并认两种限定:
//   <stagk>開ける</stagk>   义项只属于这个表记(结构化,准)
//   <s_inf>esp. 明ける</s_inf>  义项主要用于这个表记(自由文本,但 JMdict 大量在用)
// 某个表记只要有限定到它头上的义项,就只认这些义项,不再吃 entry 里的通用义项。
const xml = gunzipSync(readFileSync(inputPath)).toString("utf8");
const collect = (block, tag) => [...block.matchAll(new RegExp(`<${tag}>(.*?)</${tag}>`, "g"))].map((m) => m[1]);

const evidence = new Map(); // "表记|假名" → { restricted:Set, general:Set }
// 只按假名的兜底索引:词库里 する/ある/なる 这些没写汉字表记,而 JMdict 挂在
// 為る/有る/成る 上,「表记|假名」键匹配不到。冲突的(かえる = 帰る自/変える他)
// 记成 null 表示"说不准",宁可不标也不标错。
const byKana = new Map();

for (const block of xml.split("<entry>").slice(1)) {
  if (!block.includes("&vi;") && !block.includes("&vt;")) continue;
  const kebs = collect(block, "keb");
  const rebs = collect(block, "reb");

  for (const sense of block.split("<sense>").slice(1)) {
    const voices = [];
    if (sense.includes("&vi;")) voices.push("自");
    if (sense.includes("&vt;")) voices.push("他");
    if (!voices.length) continue;

    const stagk = collect(sense, "stagk");
    const espForms = collect(sense, "s_inf").flatMap((note) => kebs.filter((keb) => note.includes(keb)));
    const restrictedTo = stagk.length ? stagk : espForms;
    const stagr = collect(sense, "stagr");

    const surfaces = restrictedTo.length ? restrictedTo : kebs.length ? kebs : rebs;
    const readings = stagr.length ? stagr : rebs;
    const bucket = restrictedTo.length || stagr.length ? "restricted" : "general";

    for (const reading of readings) {
      for (const surface of surfaces) {
        const key = `${surface}|${reading}`;
        if (!evidence.has(key)) evidence.set(key, { restricted: new Set(), general: new Set() });
        voices.forEach((voice) => evidence.get(key)[bucket].add(voice));
      }
      voices.forEach((voice) => {
        if (byKana.has(reading) && byKana.get(reading) !== voice) byKana.set(reading, null);
        else if (!byKana.has(reading)) byKana.set(reading, voice);
      });
    }
  }
}

const table = new Map();
for (const [key, { restricted, general }] of evidence) {
  const voices = restricted.size ? restricted : general;
  if (!voices.size) continue;
  table.set(key, voices.size > 1 ? "自他" : [...voices][0]);
}
console.log(`JMdict 里带 vi/vt 的词形 ${table.size} 个`);

const output = {};
let hit = 0;
const missed = [];
// 词库表记里有「濡[ぬ]れる」这种夹注音、「〜出す」这种带波浪号的写法,查表前先剥掉。
const normalize = (surface) => surface.replace(/\[[^\]]*\]/g, "").replace(/[〜～\s]/g, "");

// 自动匹配漏掉的高频词。漏的原因有两类:词库只写了假名而 JMdict 挂在汉字表记上
// (いる=居る、できる=出来る),或同音多词导致假名兜底判定为"说不准"(やる、まく)。
// 这里只补有把握的,拿不准的(はらむ / はばかる / かたどる)宁可不标 —— 标错比不标糟。
// サ变名词(行列/失格/満腹)和拟态词(わくわく)本身不是动词,不补。
const MANUAL = {
  "する|する": "自他",
  "いる|いる": "自",
  "できる|できる": "自",
  "あげる|あげる": "他",
  "くれる|くれる": "他",
  "やる|やる": "他",
  "おる|おる": "自",
  "よる|よる": "自",
  "やめる|やめる": "他",
  "しゃべる|しゃべる": "自他",
  "かぶる|かぶる": "他",
  "おいでになる|おいでになる": "自",
  "すく|すく": "自",
  "おごる|おごる": "他",
  "まく|まく": "他",
  "ひねる|ひねる": "他",
  "つぶやく|つぶやく": "自他",
  "思える|おもえる": "自",
  "気にする|きにする": "他",
  "やってくる|やってくる": "自",
  "応える|こたえる": "自",
  "思い浮かぶ|おもいうかぶ": "自",
  "張り切る|はりきる": "自",
  "語りかける|かたりかける": "自",
  "有り得る|ありうる": "自",
  "関わり合う|かかわりあう": "自",
  "あふれ出す|あふれだす": "自",
  "買い与える|かいあたえる": "他",
  "分け与える|わけあたえる": "他",
  "持って行く|もっていく": "他",
  "持って来る|もってくる": "他",
  "放っておく|ほうっておく": "他",
  "やり通す|やりとおす": "他",
  "しょい込む|しょいこむ": "他",
  "耐え抜く|たえぬく": "自",
  "報う|むくう": "他"
};

for (const [kanji, kana] of verbs) {
  // 输出键用词库原样的表记(运行时直接拼 `${label}|${kana}` 查,不用再做规整)。
  const rawKey = `${kanji || kana}|${kana}`;
  const voice =
    MANUAL[rawKey] ??
    table.get(`${normalize(kanji || kana)}|${kana}`) ??
    table.get(`${kana}|${kana}`) ??
    byKana.get(kana) ??
    null;
  if (voice) {
    output[rawKey] = voice;
    hit += 1;
  } else if (missed.length < 30) {
    missed.push(kanji || kana);
  }
}
console.log(`覆盖 ${hit}/${verbs.length} = ${((hit / verbs.length) * 100).toFixed(1)}%`);
console.log(`没匹配上的例子: ${missed.join(" ")}`);

writeFileSync(
  outputPath,
  `${JSON.stringify({
    source: "http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz",
    license: "JMdict © EDRDG, CC BY-SA 4.0 (https://www.edrdg.org/edrdg/licence.html)",
    generated_by: "frontend/scripts/build-verb-transitivity.mjs",
    transitivity: Object.fromEntries(Object.entries(output).sort(([left], [right]) => left.localeCompare(right)))
  })}\n`,
  "utf8"
);
console.log(`✅ 写出 ${outputPath}`);
