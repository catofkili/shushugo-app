#!/usr/bin/env node
// 重新生成 src/data/kanji_variants.json(和式汉字 → 简体字对照表)。
//
// 历史坑:第一版用的是 OpenCC 的 JPVariants.txt,那个文件只收「日本独有异体」,
// 不收新字体。结果 語→语 这种一眼就看得出不同的进了表,毎/每、歩/步、収/收、
// 徳/德、黒/黑 这些「几乎一模一样、中国人最容易写混」的反而全漏了。OpenCC 后来把
// 新字体表拆成 JPShinjitaiCharacters.txt,这里改用它,链路是:
//
//   和式字 --JPShinjitaiCharacters--> 繁体/正字 --TSCharacters--> 简体字
//
// 关键约束:繁简表查不到旧字形时**不能**把旧字形当简体吐出来 —— 挙→擧、鉱→鑛、
// 研→硏 这类全是这么来的,擧/鑛/硏 根本不是中文写法。查不到就判定"无自动结论",
// 交给旧表或 MANUAL 兜底。
//
// 旧表(Unihan 派生的 6670 条)整体保留作底,自动链路的结论覆盖其上 —— 旧表里
// 戸→户、著→着 这类正确条目不能丢,而 闇→𬮴、鑑→𰾫 这种 Unihan 生僻异体会被
// 自动链路修正成 闇→暗、鑑→鉴。
//
// 源文件已 vendor 进 kanji-variant-sources/(Apache-2.0),脚本不联网,可离线重跑:
//
//   node frontend/scripts/build-kanji-variants.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sourceDir = join(here, "kanji-variant-sources");
const outputPath = join(here, "..", "src", "data", "kanji_variants.json");

const SOURCES = {
  opencc_jp_shinjitai:
    "https://raw.githubusercontent.com/BYVoid/OpenCC/master/data/dictionary/JPShinjitaiCharacters.txt",
  opencc_ts_characters:
    "https://raw.githubusercontent.com/BYVoid/OpenCC/master/data/dictionary/TSCharacters.txt",
  unihan_legacy: "https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip"
};

/** OpenCC 词典格式:`key<TAB>value1 value2 ...`,# 开头是注释。只要单字条目。 */
function readOpenCCDict(fileName) {
  const map = new Map();
  for (const line of readFileSync(join(sourceDir, fileName), "utf8").split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const [key, rawValues] = line.split("\t");
    if (!key || !rawValues) continue;
    if ([...key].length !== 1) continue;
    const values = rawValues.trim().split(/\s+/).filter((value) => [...value].length === 1);
    if (values.length) map.set(key, values);
  }
  return map;
}

// 自动链路给不出、或会给错的条目。空串 = 从表里删掉(不标记)。
const MANUAL = {
  // —— 多义/语义合并,机械取首值会教错 ——
  弁: "辨/瓣/辯", // 弁当写「便当」属借用,不列进来
  欠: "", // 欠点=缺点是词义对应,字本身中日同形,标了是噪音
  缶: "", // 缶(かん)对中文「罐」,但 缶 本身也是规范汉字
  予: "", // 予/豫、余/餘、台/臺 现代中文都已合并成日文这一形,不算字形差异
  余: "",
  台: "",
  覆: "",
  瞭: "",
  // —— 旧表 Unihan 派生的生僻异体,换成中文实际写法 ——
  働: "动", // 和製漢字,労働=劳动
  // —— 自动链路查不到繁简条目、但中文确实另有写法 ——
  鉱: "矿",
  粋: "粹",
  籠: "笼",
  匂: "" // 和製漢字,中文无对应字形
};

const shinjitai = readOpenCCDict("JPShinjitaiCharacters.txt");
const traditionalToSimplified = readOpenCCDict("TSCharacters.txt");

// 现代中文用字白名单。取自本词库 11057 条释义 + 例句译文里出现过的全部汉字
// (纯中文文本,不含日文),3334 字。生成方式:
//   sqlite3 frontend/public/nihongo.db "select meaning||example_meaning from words"
// 再取 [一-鿿] 去重排序。用途只有一个:判定"这个字中国人到底写不写"。
const modernChinese = new Set(
  readFileSync(join(sourceDir, "cn-modern-chars.txt"), "utf8").trim()
);

const legacy =
  JSON.parse(readFileSync(join(sourceDir, "legacy-unihan.json"), "utf8")).japanese_to_simplified ?? {};
const table = { ...legacy };

const candidates = new Set([...shinjitai.keys(), ...traditionalToSimplified.keys()]);
for (const japanese of candidates) {
  const traditional = shinjitai.get(japanese)?.[0];
  // 「新字体→正字→简体」;繁简表查不到正字时,正字本身多半就是中文写法
  // (歩→步、毎→每、収→收 都走这条),再退到「本字就是繁体」(語→语)。
  const simplified =
    (traditional && (traditionalToSimplified.get(traditional)?.[0] ?? traditional)) ??
    traditionalToSimplified.get(japanese)?.[0];
  // 自动链路给不出结论(新字体表里自映射、繁简表也没有)时不动旧表 —— 戸→户、
  // 舗→铺、粧→妆 这些只有旧表有,自动链路一律"沉默",不许把它们抹掉。
  if (!simplified || simplified === japanese) continue;
  // 闸门:上一步可能吐出 擧/硏/槪/鑛 这种「旧字体的旧字体」,它们不是中文写法,
  // 写进表等于教错字。用词库中文释义里实际出现过的汉字当白名单挡掉。
  if (!modernChinese.has(simplified)) continue;
  table[japanese] = simplified;
}

for (const [japanese, simplified] of Object.entries(MANUAL)) {
  if (simplified) table[japanese] = simplified;
  else delete table[japanese];
}

const sorted = Object.fromEntries(
  Object.entries(table).sort(([left], [right]) => left.codePointAt(0) - right.codePointAt(0))
);

writeFileSync(
  outputPath,
  `${JSON.stringify(
    {
      source: SOURCES,
      generated_by: "frontend/scripts/build-kanji-variants.mjs",
      japanese_to_simplified: sorted
    },
    null,
    2
  )}\n`,
  "utf8"
);

console.log(`kanji_variants.json: ${Object.keys(sorted).length} 条`);
