// 把 scripts/grammar-rewrites/*.json 的原创重写灌进 src/data/grammar.ts
// (Library/语法详情/沉浸学习页的数据源)。按 id pdf-{level}-NNN ↔ byIndex[N] 匹配,
// 整条重建 meaning/接续/讲解/例句/测验,清除 OCR 内容与「真題」考试引用。
//
// 用法: node scripts/apply-grammar-ts-rewrites.mjs

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const gtPath = path.join(here, "../src/data/grammar.ts");
const rewritesDir = path.join(here, "grammar-rewrites");

const src = readFileSync(gtPath, "utf8");
const m = src.match(/GrammarPoint\[\]\s*=\s*/);
const start = src.indexOf("[", m.index + m[0].length);
const tailAnchor = src.indexOf("export const grammarPoints");
const end = src.lastIndexOf("]", tailAnchor);
const header = src.slice(0, start);
const footer = src.slice(end + 1); // 包含 `;\n\nexport const grammarPoints = ...`
const data = JSON.parse(src.slice(start, end + 1));

// 载入所有批次重写: level -> { index -> fields }
const rewrites = {};
for (const file of readdirSync(rewritesDir).filter((f) => f.endsWith(".json"))) {
  const batch = JSON.parse(readFileSync(path.join(rewritesDir, file), "utf8"));
  rewrites[batch.level] ||= {};
  Object.assign(rewrites[batch.level], batch.byIndex);
}

const distractors = ["只表示过去完成", "只表示并列名词", "只表示最高级比较"];
let applied = 0;

for (const entry of data) {
  const mm = (entry.id || "").match(/^pdf-(n[1-5])-(\d+)$/i);
  if (!mm) continue;
  const level = mm[1].toUpperCase();
  const idx = String(Number(mm[2])); // 去掉前导零
  const r = rewrites[level]?.[idx];
  if (!r) continue;

  const pattern = r.pattern ?? entry.title;
  const notes = r.confusions ? `${r.notes}\n【辨析】${r.confusions}` : r.notes;

  entry.title = pattern;
  entry.meaning = r.meaning;
  entry.structure = r.formation;
  entry.connection = r.formation;
  entry.explanation = notes;
  entry.usageNotes = r.confusions ? [r.notes, `【辨析】${r.confusions}`] : [r.notes];
  entry.examples = [{
    jp: r.exampleJp,
    reading: "",
    cn: r.exampleMeaning,
    breakdown: [],
    japanese: r.exampleJp,
    chinese: r.exampleMeaning,
    notes: []
  }];
  entry.comparisons = [];
  entry.quiz = [{
    id: `${entry.id}-meaning-q1`,
    type: "choice",
    question: `「${pattern}」的核心意思是？`,
    prompt: `「${pattern}」的核心意思是？`,
    options: [r.meaning, ...distractors],
    answer: r.meaning,
    explanation: `接续：${r.formation}\n注意：${notes}`
  }];
  applied += 1;
}

writeFileSync(gtPath, header + JSON.stringify(data, null, 2) + footer);
console.log(`✅ grammar.ts 已重建 ${applied} 条`);
