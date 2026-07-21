// 把 scripts/grammar-rewrites/*.json 里的原创重写合并进 grammar_seed.json,
// 按 { level, byIndex } 定位(同级别内的第 N 条,1 起),整行覆盖
// pattern/meaning/formation/notes/confusions/example,替换 OCR 自版权教材的内容。
//
// 用法: node scripts/apply-grammar-rewrites.mjs
// 之后需同步 bump src/lib/study-core.ts 的 GRAMMAR_SEED_VERSION(脚本会提示)。

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const seedPath = path.join(here, "../src/data/grammar_seed.json");
const rewritesDir = path.join(here, "grammar-rewrites");

const seed = JSON.parse(readFileSync(seedPath, "utf8"));
// row 字段: [pattern, meaning, prompt, formation, exampleJp, exampleMeaning, notes, confusions, level, importance]
const F = { pattern: 0, meaning: 1, prompt: 2, formation: 3, exampleJp: 4, exampleMeaning: 5, notes: 6, confusions: 8 - 1, level: 8, importance: 9 };

// 按级别把行分组(保持原顺序),供 byIndex 定位
const rowsByLevel = {};
seed.rows.forEach((row, i) => {
  const lvl = row[F.level];
  (rowsByLevel[lvl] ||= []).push(i);
});

const batchFiles = readdirSync(rewritesDir).filter((f) => f.endsWith(".json")).sort();
let applied = 0;
const touched = new Set();

for (const file of batchFiles) {
  const batch = JSON.parse(readFileSync(path.join(rewritesDir, file), "utf8"));
  const level = batch.level;
  const indices = rowsByLevel[level] || [];
  for (const [idxStr, fields] of Object.entries(batch.byIndex)) {
    const n = Number(idxStr);
    const rowIdx = indices[n - 1];
    if (rowIdx === undefined) {
      throw new Error(`${file}: ${level} 第 ${n} 条越界(该级别共 ${indices.length} 条)`);
    }
    const key = `${level}#${n}`;
    if (touched.has(key)) throw new Error(`重复覆盖 ${key}(见 ${file})`);
    touched.add(key);
    const row = seed.rows[rowIdx];
    if (fields.pattern !== undefined) { row[F.pattern] = fields.pattern; row[F.prompt] = fields.pattern; }
    if (fields.meaning !== undefined) row[F.meaning] = fields.meaning;
    if (fields.formation !== undefined) row[F.formation] = fields.formation;
    if (fields.exampleJp !== undefined) row[F.exampleJp] = fields.exampleJp;
    if (fields.exampleMeaning !== undefined) row[F.exampleMeaning] = fields.exampleMeaning;
    if (fields.notes !== undefined) row[F.notes] = fields.notes;
    if (fields.confusions !== undefined) row[F.confusions] = fields.confusions;
    applied += 1;
  }
}

// grammar_points.pattern 带 UNIQUE 约束(见 study-core.ts ensureGrammarSeed),
// 重复 pattern 会在全新初始化时被丢弃。曾因 N2/N1 教材收录同一语法点混入 7 组
// 重复(2026-07-14 已去重),生成阶段必须直接失败,不能带病产出。
const patternCounts = new Map();
for (const row of seed.rows) {
  patternCounts.set(row[F.pattern], (patternCounts.get(row[F.pattern]) ?? 0) + 1);
}
const dupPatterns = [...patternCounts].filter(([, count]) => count > 1).map(([p]) => p);
if (dupPatterns.length) {
  throw new Error(`覆写后 seed 存在重复 pattern,请先去重再生成: ${dupPatterns.join("、")}`);
}

// bump 版本(日期戳 + rewrite 标记),供 study-core 触发 re-seed
const today = new Date().toISOString().slice(0, 10);
seed.version = `${today}-grammar-rewrite`;
writeFileSync(seedPath, JSON.stringify(seed, null, 0));

console.log(`✅ 已覆盖 ${applied} 条,来自 ${batchFiles.length} 个批次文件`);
console.log(`✅ grammar_seed.json version = ${seed.version}`);
console.log(`⚠️  记得把 src/lib/study-core.ts 的 GRAMMAR_SEED_VERSION 改为 "${seed.version}"`);
