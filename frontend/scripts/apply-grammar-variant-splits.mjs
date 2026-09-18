// 把 scripts/grammar-variant-splits.json 里的拆分应用到 grammar.ts 和 grammar_key_points.json。
// 一次性脚本：跑过之后再跑会因为找不到旧标题而直接失败，不会重复插入。
//
// 用法: node scripts/apply-grammar-variant-splits.mjs
// 之后: 改 GRAMMAR_DATASET_VERSION / GRAMMAR_SEED_VERSION / GRAMMAR_SEED_ROW_COUNT，
//       再跑 node scripts/build-furigana.mjs（它会按 grammar.ts 重建出厂库的 grammar_points）。

import { readFileSync, writeFileSync } from "node:fs";

const grammarPath = "src/data/grammar.ts";
const keyPointsPath = "src/data/grammar_key_points.json";
const splits = JSON.parse(readFileSync("scripts/grammar-variant-splits.json", "utf8"));

const source = readFileSync(grammarPath, "utf8");
const marker = "const GRAMMAR_POINTS: GrammarPoint[] =";
const start = source.indexOf("[", source.indexOf("= [", source.indexOf(marker)));
const end = source.lastIndexOf("]", source.indexOf("export const grammarPoints"));
const points = JSON.parse(source.slice(start, end + 1).replace(/,\s*([}\]])/g, "$1"));
const keyPoints = JSON.parse(readFileSync(keyPointsPath, "utf8"));
// 抓手先按 id 攒着，最后再按 pattern 落表：「～とは」在 N3（定义）和 N1（吃惊）各有一条，
// 边拆边按标题写会让后写的把先写的盖掉。
const keyPointById = new Map();

const example = (ref, original) => {
  if (typeof ref === "number") {
    if (!original[ref]) throw new Error(`例句下标越界: ${ref}`);
    return original[ref];
  }
  return { jp: ref.jp, reading: "", cn: ref.cn, breakdown: [], japanese: ref.jp, chinese: ref.cn, notes: [] };
};

const fill = (point, spec, original) => {
  point.title = spec.title;
  point.meaning = spec.meaning;
  point.structure = spec.structure;
  point.connection = spec.structure;
  point.explanation = spec.explanation;
  point.usageNotes = [spec.explanation];
  point.examples = spec.examples.map((ref) => example(ref, original));
  point.comparisons = [];
};

for (const split of splits.splits) {
  const index = points.findIndex((point) => point.id === split.id);
  if (index < 0) throw new Error(`grammar.ts 找不到 ${split.id}`);
  const keep = points[index];
  if (!(keep.title in keyPoints.points)) throw new Error(`抓手表里没有「${keep.title}」—— 是不是已经拆过了？`);
  delete keyPoints.points[keep.title];
  const original = keep.examples;
  fill(keep, split.keep, original);
  keyPointById.set(keep.id, split.keep.keyPoint);
  const added = split.new.map((spec) => {
    if (points.some((point) => point.id === spec.id)) throw new Error(`id 已存在: ${spec.id}`);
    const point = { id: spec.id, title: spec.title, level: keep.level, bookOrder: 0 };
    fill(point, spec, original);
    keyPointById.set(spec.id, spec.keyPoint);
    return point;
  });
  points.splice(index + 1, 0, ...added);
}

points.forEach((point, index) => { point.bookOrder = index + 1; });

// 重名消歧和 build-furigana.mjs 的 syncGrammarDbContent 同一套：第二条起带「（等级-序号）」。
// 抓手表按 pattern 查，重名的第二条要靠 aliases（id → 带后缀的 pattern）。
const seen = new Map();
keyPoints.aliases = {};
for (const point of points) {
  const count = seen.get(point.title) ?? 0;
  seen.set(point.title, count + 1);
  if (!count) continue;
  keyPoints.aliases[point.id] = `${point.title}（${point.level}-${count + 1}）`;
}
for (const point of points) {
  const pattern = keyPoints.aliases[point.id] ?? point.title;
  if (keyPointById.has(point.id)) keyPoints.points[pattern] = keyPointById.get(point.id);
  if (!keyPoints.points[pattern]) throw new Error(`${point.id} 没有抓手`);
}
keyPoints.version = splits.version;

writeFileSync(grammarPath, `${source.slice(0, start)}${JSON.stringify(points, null, 2)}${source.slice(end + 1)}`);
writeFileSync(keyPointsPath, `${JSON.stringify(keyPoints)}\n`);
console.log(`✅ grammar.ts ${points.length} 条；抓手 ${Object.keys(keyPoints.points).length} 条，别名 ${Object.keys(keyPoints.aliases).length} 条`);
