#!/usr/bin/env node
/*
 * 「一字多音」的说明表:一个汉字的几个读音各自什么时候用。
 *
 * 边界和 build-kanji-reading-unit-index.mjs 一样:**只读出厂库**,绝不碰
 * frontend/.local/live.db —— 那里面是个人学习状态和自导词表,不能变成随包分发的内容。
 *
 * 用法(在 frontend/ 下):
 *   node scripts/build-kanji-reading-usage.mjs
 *
 * 产出两个文件:
 *   src/data/kanji_reading_usage.json          运行时数据(懒加载,不进主包)
 *   scripts/kanji-reading-usage-manual-review.json 的 pending 段(要人写的清单)
 *
 * ── 为什么例词烧在构建期,而不像 confusion-groups 那样运行时现算 ──
 * 「月跟在数字后面读がつ」是日语的通则,不是用户词库的函数;而且现算要全表扫一遍
 * 再做假名对齐(那正是 kanji_reading_unit_index 干的活,112ms 起步)。代价是用户
 * 导入的词表不会出现在例词里 —— 通则不会因此变错,只是例子还是出厂那些。
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";

const here = new URL(".", import.meta.url);
const frontend = fileURLToPath(new URL("..", here));
const defaultDb = resolve(frontend, "public/nihongo.db");
const indexPath = resolve(frontend, "src/data/kanji_reading_unit_index.json");
const manualPath = resolve(frontend, "scripts/kanji-reading-usage-manual-review.json");
const outputPath = resolve(frontend, "src/data/kanji_reading_usage.json");

export const VERSION = "2026-08-24-kanji-reading-usage-v1";

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const dbPath = resolve(frontend, argValue("--db", defaultDb));
if (dbPath !== resolve(defaultDb) || /(^|[\\/])(?:\.local|live\.db)(?:[\\/]|$)/u.test(relative(frontend, dbPath))) {
  throw new Error(`拒绝从个人实时库生成发布内容: ${dbPath}。只允许 ${resolve(defaultDb)}`);
}

/* ────────────────────────── 判据 ────────────────────────── */

/**
 * 一个读音的「什么时候用」判据。**顺序就是优先级,越靠前越具体。**
 *
 * 最后两条 on/kun 就是音训通则本身 —— 汉语复合词读音读,单独用/带送假名/和语词
 * 里读训读。没有它,训读一旦出现在**没有送假名的和语复合词**里(屋根・近道・昼寝・
 * 植木)就掉出全部判据:原型跑下来 72 个字待写,一半是被这条漏掉的,不是真难点。
 *
 * ⚠️ `list`(在当前词库主要见于这些词)**只对音读用**。对训读用会把例词少的基本读法说成
 * 冷僻音 —— 原型把 月(つき) 写成「只出现在 毎月・月・年月・三日月」,而 つき 是月亮,
 * 是这个字最基本的读法。训读天生比音读少出现在复合词里,例词少不等于冷僻。
 */
export const CLAUSES = ["num", "oku", "list", "on", "kun"];

const pct = (a, b) => (b ? a / b : 0);

/** 送假名判据的门限。0.8 太严:训读在和语复合词里(近道・昼寝)本来就不带送假名 */
const OKURIGANA_SHARE = 0.6;

export const clauseOf = (reading, siblings) => {
  const { n, num, oku, kinds, okus } = reading;
  if (pct(num, n) >= 0.7) return { code: "num", arg: "" };
  if (pct(oku, n) >= OKURIGANA_SHARE) {
    // 送假名形态就是判据本身。生きる/生まれる/生える —— 三个都「带送假名」,
    // 但假名不同,所以要连形态一起写出来,否则三行长得一模一样等于没说。
    //
    // ⚠️ **形态要挑能和兄弟读音分开的那些,不能只报最常见的一个。**
    // 冷(ひ) 最常见形态是「える」,可它还有 冷やす・冷たい —— 写「带送假名 〜え」
    // 等于只说了一半,看到 冷やす 的人对不上号。全库 356 个读音有这个毛病。
    // 同一个字上还有别的送假名读音时,只列**这个读音独有**的形态(冷: ひ→える/やす、
    // さ→ます/める);没有兄弟要分的时候形态是装饰,报最常见的那个就够。
    const rival = siblings.filter((o) => o !== reading && pct(o.oku, o.n) >= OKURIGANA_SHARE);
    // 形态按**例词的熟悉度顺序**取,并按首假名去重。直接按出现次数排的话:
    // 冷(ひ) 四个例词各出现一次,并列后按字典序取前两个 = 「え／える」——
    // 那是同一个词尾的两种切法(冷え込む 切出「え」、冷える 切出「える」),
    // 说了两遍一样的话,还把真正另一支的 冷やす 整个漏掉。
    const ranked = reading.formsByExample;
    if (!rival.length) return { code: "oku", arg: ranked[0]?.[0] ?? "" };
    // ⚠️ 只要有**一个**形态是两个读音共用的,这个字就整体交给人写 ——
    // 不能只把共用的那个从两边悄悄删掉。止める 既是 とめる 又是 やめる,
    // 删掉之后 と 写「〜まる」、や 写「〜む」,看着分得清清楚楚,
    // 而真正会卡住人的 止める 两边都不提,等于假装它不存在。
    // 全库这样的只有 6 个字:入・行・開・止・降・描。
    if ([...okus.keys()].some((form) => rival.some((o) => o.okus.has(form)))) return null;
    return { code: "oku", arg: ranked.slice(0, 2).join("／") };
  }

  // 冷门音只在两三个词里出现时,「找规律」是徒劳,直接列词表才是有用的说明。
  // 要求存在一个压倒性的常见音读,否则 便 びん(6)/べん(5) 这种势均力敌的会被
  // 误判成「べん 只出现在…」—— 那两个音其实都常见,是真要人写的那批。
  if (kinds.includes("on") && n <= 4
      && siblings.some((o) => o !== reading && o.kinds.includes("on") && o.n >= n * 2 && o.n >= 5)) {
    return { code: "list", arg: "" };
  }
  if (kinds.includes("on")) return { code: "on", arg: "" };
  return { code: "kun", arg: "" };
};

/** 两个读音的说明**逐字相同** = 判据没说话,必须由人来写 */
export const collides = (a, b) => a && b && a.code === b.code && a.arg === b.arg;

/* ────────────────────────── 主流程 ────────────────────────── */

const idx = JSON.parse(readFileSync(indexPath, "utf8"));
const SQL = await initSqlJs();
const db = new SQL.Database(new Uint8Array(readFileSync(dbPath)));
const words = new Map();
for (const row of db.exec("SELECT id, kanji, kana, meaning, jlpt_level, importance FROM words")[0].values) {
  words.set(row[0], {
    kanji: String(row[1] ?? ""),
    kana: String(row[2] ?? ""),
    // 「哪个音」靠送假名,「哪个意思」靠这一列 —— 冷える(变冷) / 冷ます(晾凉)
    // 的区别送假名说不出来,而释义本来就躺在 words 表里,不用人写一个字。
    meaning: String(row[3] ?? ""),
    lv: String(row[4] ?? ""),
    imp: Number(row[5] ?? 0)
  });
}

const LEVELS = ["N5", "N4", "N3", "N2", "N1"];
const rankOf = (lv) => {
  const at = LEVELS.indexOf(lv);
  return at >= 0 ? at : 5;
};
const NUMERAL = /[一二三四五六七八九十百千万数何幾０-９0-9〜～]/u;
const HIRAGANA = /[ぁ-ゖ]/u;

const unitByKey = new Map(idx.units.map((u) => [u.unitKey, u]));
const stats = new Map();
for (const occ of idx.occurrences) {
  const word = words.get(occ.exampleWordId);
  if (!word) continue;
  const unit = unitByKey.get(occ.unitKey);
  if (!unit || unit.unitType !== "char") continue;

  const entry = stats.get(occ.unitKey) ?? {
    base: unit.base, kinds: unit.kinds, char: unit.char,
    n: 0, num: 0, head: 0, tail: 0, alone: 0, oku: 0, best: 9,
    okus: new Map(), examples: []
  };
  const surface = word.kanji;
  const { start, length } = occ.targetSegment;
  entry.n += 1;
  if (surface.length === length) entry.alone += 1;
  else {
    if (start === 0) entry.head += 1;
    if (start + length === surface.length) entry.tail += 1;
  }
  if (start > 0 && NUMERAL.test(surface[start - 1])) entry.num += 1;
  let okurigana = "";
  if (start + length < surface.length && HIRAGANA.test(surface[start + length])) {
    entry.oku += 1;
    okurigana = surface.slice(start + length).match(/^[ぁ-ゖ]+/u)?.[0] ?? "";
    if (okurigana) entry.okus.set(okurigana, (entry.okus.get(okurigana) ?? 0) + 1);
  }
  entry.best = Math.min(entry.best, rankOf(word.lv));
  entry.examples.push({ surface, kana: word.kana, meaning: word.meaning, okurigana, imp: word.imp, rank: rankOf(word.lv) });
  stats.set(occ.unitKey, entry);
};

/** 最眼熟的排前面:先按级别(N5 在前),同级按 importance。形态和例词共用这一个顺序 */
const byFamiliarity = (a, b) => a.rank - b.rank || b.imp - a.imp || a.surface.length - b.surface.length;

// 形态按例词熟悉度排序,并按**首假名**去重:冷(ひ) 的 える/え 是同一支(冷える·冷え込む),
// やす/やかす 是另一支(冷やす·冷やかす)。留一支一个代表,「〜える／〜やす」才说清了两边。
for (const entry of stats.values()) {
  const seenHead = new Set();
  entry.formsByExample = [...entry.examples]
    .sort(byFamiliarity)
    .map((ex) => ex.okurigana)
    .filter((form) => form && (seenHead.has(form[0]) ? false : (seenHead.add(form[0]), true)));
}

// 每个汉字的「有效读音」—— 只出现过一次的读音是噪音,不进说明
const byChar = new Map();
for (const entry of stats.values()) {
  if (entry.n < 2) continue;
  if (!byChar.has(entry.char)) byChar.set(entry.char, []);
  byChar.get(entry.char).push(entry);
}

const manual = existsSync(manualPath)
  ? JSON.parse(readFileSync(manualPath, "utf8"))
  : { notes: {}, pending: [] };
const notes = manual.notes ?? {};

const EXAMPLE_CAP = 4;
const pickExamples = (entry) => {
  const seen = new Set();
  return entry.examples
    .filter((ex) => (seen.has(ex.surface) ? false : (seen.add(ex.surface), true)))
    .sort(byFamiliarity)
    .slice(0, EXAMPLE_CAP)
    .map((ex) => {
      const senses = ex.meaning.split(/[；;]/u).map((part) => part.trim()).filter(Boolean);
      let gloss = senses.slice(0, 2).join("；");
      if (gloss.length > 14) gloss = `${senses[0] ?? ""}`.slice(0, 14);
      return `${ex.surface}|${ex.kana}|${gloss}`;
    });
};

const chars = [];
const pending = [];
let autoChars = 0;
let partialChars = 0;

for (const [char, readings] of [...byChar].sort((a, b) => a[0].localeCompare(b[0], "ja"))) {
  if (readings.length < 2) continue;
  readings.sort((a, b) => b.n - a.n);
  const clauses = readings.map((r) => clauseOf(r, readings));

  // 撞车:说明逐字相同的那些读音。同一句话说不清两个音 = 交给人写。
  const collided = new Set();
  for (let i = 0; i < readings.length; i += 1) {
    for (let j = i + 1; j < readings.length; j += 1) {
      if (collides(clauses[i], clauses[j])) { collided.add(i); collided.add(j); }
    }
  }
  const charNote = notes[char] ?? null;
  const unresolved = readings
    .map((r, i) => (!clauses[i] || collided.has(i) ? r.base : null))
    .filter(Boolean)
    .filter((base) => !charNote?.readings?.[base]);

  if (unresolved.length) pending.push({ char, readings: unresolved, all: readings.map((r) => `${r.base}(${r.n})`) });
  if (!unresolved.length && !charNote) autoChars += 1;
  if (charNote) partialChars += 1;

  chars.push([
    char,
    Math.min(...readings.map((r) => r.best)),
    charNote?.summary ?? "",
    readings.map((r, i) => [
      r.base,
      (r.kinds.includes("on") ? 1 : 0) | (r.kinds.includes("kun") ? 2 : 0),
      // 人写的说明优先:撞车的那些本来就没有可用的自动判据
      charNote?.readings?.[r.base] ? -1 : CLAUSES.indexOf(clauses[i]?.code ?? ""),
      charNote?.readings?.[r.base] ?? clauses[i]?.arg ?? "",
      r.n,
      pickExamples(r)
    ])
  ]);
}

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const payload = {
  version: VERSION,
  generatedBy: "frontend/scripts/build-kanji-reading-usage.mjs",
  source: {
    database: "public/nihongo.db",
    liveDatabase: false,
    sha256: sha256(dbPath),
    indexSha256: sha256(indexPath),
    indexVersion: idx.version
  },
  clauses: CLAUSES,
  levels: LEVELS,
  exampleCap: EXAMPLE_CAP,
  chars
};
writeFileSync(outputPath, `${JSON.stringify(payload)}\n`, "utf8");

pending.sort((a, b) => a.char.localeCompare(b.char, "ja"));
writeFileSync(
  manualPath,
  `${JSON.stringify({ notes, pending }, null, 2)}\n`,
  "utf8"
);

const size = (readFileSync(outputPath).length / 1024).toFixed(0);
console.log(`多音字 ${chars.length} 个 → ${outputPath.replace(frontend, "")} (${size} KB)`);
console.log(`  判据齐活、不用人管的: ${autoChars}`);
console.log(`  已有人工说明的:      ${partialChars}`);
console.log(`  还缺人工说明的:      ${pending.length}  →  scripts/kanji-reading-usage-manual-review.json`);
if (pending.length) {
  console.log("\n还缺的(前 40):");
  for (const item of pending.slice(0, 40)) {
    console.log(`  ${item.char}  缺 ${item.readings.join("/")}   [全部: ${item.all.join(" ")}]`);
  }
}
