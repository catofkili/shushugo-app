#!/usr/bin/env node
/*
 * 给 N5/N4 刷题题库算注音，写回 src/data/jlpt/n5.json、n4.json 的 furigana / passageFurigana 字段。
 *
 * 为什么只做 N5/N4：JLPT 官方 N5/N4 文法、读解部分所有汉字都注假名，文字・語彙部分非本级汉字写假名；
 * N3 起都不注（2026-10-10 对照 2018 年版公式問題集）。我们在 N5/N4 统一「考点以外的汉字全注音」，
 * 效果同官方（学生不会被不认识的字卡住），不必靠一份非官方的汉字级别表逐字判断，也不改题目原文。
 * 不注音的只有被考的字：读音题（kanji-reading）的 [[考点]]、表记题（orthography）的四个选项。
 *
 * 题目文字一改，注音的下标就对不上了：verify-jlpt-bank.mjs 会拦，改完题跑一遍本脚本即可。
 * 读音错了在 READING_FIXES 里按「上下文片段 + 汉字」钉死（改完重跑、看一眼输出）。
 *
 * 用法（frontend/ 下）：node scripts/build-jlpt-furigana.mjs [--check]
 * 通读注音（新题入库后必做，校验只管下标对不对、管不了读音对不对）：
 *   node -e 'const show=(t,a=[])=>{let o="",c=0;for(const x of a){o+=t.slice(c,x.start)+t.slice(x.start,x.start+x.length)+"("+x.reading+")";c=x.start+x.length}return o+t.slice(c)};
 *     for(const n of ["n5","n4"]){const b=require("./src/data/jlpt/"+n+".json");for(const q of b.questions)if(q.furigana)console.log(q.id,show(q.stem,q.furigana.stem),q.options.map((o,i)=>show(o,(q.furigana.options||[])[i])).join(" / "))}' 
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildTokenizer, tokenizeSentence, loadOverrides, loadReadingFixes, hasKanji } from "./build-furigana.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const bankPath = (level) => path.join(here, "../src/data/jlpt", `${level}.json`);
export const FURIGANA_LEVELS = ["n5", "n4"];

// kuromoji 读错的地方（2026-10-11 Claude 逐句通读 N5/N4 后整理）。按「上下文片段 ctx 里的 base」钉读音：
// 文字里每次出现 ctx，就把其中 base 范围内原有的注音换成一条。数字＋量词的音变（三十分、三日、一晩）
// kuromoji 基本都读错，这里一并处理；whole 表示整段文字必须正好等于 ctx（单独一个「中」的选项）。
const READING_FIXES = [
  // 数字・量词
  { ctx: "三百円", base: "百", reading: "びゃく" },
  { ctx: "三十分", base: "十分", reading: "じゅっぷん" },
  { ctx: "二十分", base: "十分", reading: "じゅっぷん" },
  { ctx: "歩いて十分", base: "十分", reading: "じゅっぷん" },
  { ctx: "十分だけ", base: "十分", reading: "じゅっぷん" },
  { ctx: "八さい", base: "八", reading: "はっ" },
  { ctx: "九時", base: "九", reading: "く" },
  { ctx: "七時", base: "七", reading: "しち" },
  { ctx: "四人", base: "四人", reading: "よにん" },
  { ctx: "一人", base: "一人", reading: "ひとり" },
  { ctx: "一階", base: "一", reading: "いっ" },
  { ctx: "一か月", base: "一", reading: "いっ" },
  { ctx: "一晩", base: "一", reading: "ひと" },
  { ctx: "三本", base: "本", reading: "ぼん" },
  { ctx: "三日前", base: "三日", reading: "みっか" },
  { ctx: "二日間", base: "二日間", reading: "ふつかかん" },
  { ctx: "水ようび", base: "水", reading: "すい" },
  { ctx: "木ようび", base: "木", reading: "もく" },
  // 一字多音、训读
  { ctx: "今日中", base: "中", reading: "じゅう" },
  { ctx: "中", base: "中", reading: "ちゅう", whole: true },  // N5 文章「休み[14]は」的选项：休み中
  { ctx: "店をよく使", base: "店", reading: "みせ" },
  { ctx: "家を出ました", base: "家", reading: "いえ" },
  { ctx: "全部箱に", base: "箱", reading: "はこ" },
  { ctx: "まだ　行って", base: "行", reading: "い" },
  { ctx: "山道で", base: "山道", reading: "やまみち" },
  { ctx: "米など", base: "米", reading: "こめ" },
  { ctx: "机の下で", base: "下", reading: "した" },
  { ctx: "大勢", base: "大勢", reading: "おおぜい" },
  { ctx: "力を入れ", base: "力", reading: "ちから" },
  { ctx: "日本に", base: "日本", reading: "にほん" }
];

const applyFixes = (text, annotations) => {
  let result = annotations;
  for (const fix of READING_FIXES) {
    if (fix.whole && text !== fix.ctx) continue;
    for (let at = text.indexOf(fix.ctx); at >= 0; at = text.indexOf(fix.ctx, at + 1)) {
      const start = at + fix.ctx.indexOf(fix.base);
      const end = start + fix.base.length;
      result = [...result.filter((item) => item.start + item.length <= start || item.start >= end),
        { start, length: fix.base.length, reading: fix.reading }];
    }
  }
  return result.sort((left, right) => left.start - right.start);
};

// [[ ]] 和 [18] 换成等长空白再分词：下标不变，记号也不会把词切断。
const mask = (text) => text.replace(/\[\[|\]\]/g, "  ").replace(/\[\d+\]/g, (ref) => " ".repeat(ref.length));

const annotate = (tokenizer, text, problems, where) => {
  if (!hasKanji(text)) return [];
  const { annotations, unresolved } = tokenizeSentence(tokenizer, mask(text));
  for (const item of unresolved) problems.push(`${where}: 「${item.surface}」读音对不上（${item.reading}）`);
  return applyFixes(text, annotations);
};

/** 读音题的考点词范围：[[ ]] 里面的字不注音。 */
const targetRange = (stem) => {
  const match = /\[\[([^]*?)\]\]/u.exec(stem);
  return match ? [match.index + 2, match.index + 2 + match[1].length] : null;
};

export const furiganaFor = (tokenizer, question, problems = []) => {
  const where = question.id;
  let stem = annotate(tokenizer, question.stem, problems, where);
  if (question.kind === "kanji-reading") {
    const range = targetRange(question.stem);
    if (range) stem = stem.filter((item) => item.start + item.length <= range[0] || item.start >= range[1]);
  }
  const options = question.kind === "orthography"
    ? []
    : question.options.map((option, index) => annotate(tokenizer, option, problems, `${where} 选项${index + 1}`));
  const result = {};
  if (stem.length) result.stem = stem;
  if (options.some((list) => list.length)) result.options = options;
  return Object.keys(result).length ? result : undefined;
};

const main = async () => {
  const check = process.argv.includes("--check");
  loadReadingFixes(loadOverrides().readings);
  const tokenizer = await buildTokenizer();
  const problems = [];
  let stale = 0;
  for (const level of FURIGANA_LEVELS) {
    const file = bankPath(level);
    const bank = JSON.parse(readFileSync(file, "utf8"));
    const before = JSON.stringify(bank);
    for (const question of bank.questions) {
      const furigana = furiganaFor(tokenizer, question, problems);
      if (furigana) question.furigana = furigana;
      else delete question.furigana;
    }
    bank.passageFurigana = Object.fromEntries(Object.entries(bank.passages)
      .map(([id, text]) => [id, annotate(tokenizer, text, problems, `文章 ${id}`)]));
    const after = JSON.stringify(bank);
    if (after === before) continue;
    stale += 1;
    if (!check) writeFileSync(file, `${JSON.stringify(bank, null, 2)}\n`);
  }
  for (const problem of problems) console.warn(`⚠️ ${problem}`);
  if (check) {
    console.log(stale ? `注音过期：${stale} 个级别，跑 node scripts/build-jlpt-furigana.mjs` : "注音是最新的");
    process.exitCode = stale ? 1 : 0;
  } else {
    console.log(`已写入 ${FURIGANA_LEVELS.join("、")}；读音对不上 ${problems.length} 处`);
  }
};

await main();
