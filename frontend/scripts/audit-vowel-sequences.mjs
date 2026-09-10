#!/usr/bin/env node
// 体检:全库「同一个元音连着两拍」的连接点,哪些被 VOICEVOX 压扁了、压得对不对。
// 判据和撑开逻辑都在 vowel-sequences.mjs（合成时 build-word-audio.mjs 读同一份）。
//
// ⚠️ **只有引擎真的压扁了的连接点才进名单。** 新しい 的 しい 引擎给足 228+138ms,
// 判它没有意义;全库 520 个连接点里被压的只有两百来个。所以要 VOICEVOX 开着。
//
// 输出 vowel-sequence-manual-review.json:
//   decisions   人判过的(键 = 组名,值 separate/long)。这是唯一的真相,别手删。
//   pending     还没判的,按组给例词和第二拍时长。判完写进 decisions 再跑一次即可。
//   auto_long   两拍音读(優=ユウ),自动算长音,不进人工表。
//
//   node scripts/audit-vowel-sequences.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { junctions, readingOf, groupKeyFor, autoLong, loadDecisions, reviewPath } from "./vowel-sequences.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const HOST = process.env.VOICEVOX_HOST ?? "http://127.0.0.1:50021";
const SPEAKER = Number(process.env.VOICEVOX_SPEAKER ?? "8");
// 第二拍短于这个就算被压扁。实测:长音的第二拍 40~90ms,正常一拍 120~220ms。
const COMPRESSED_SECONDS = 0.09;
const SMALL_KANA = /[ゃゅょぁぃぅぇぉ]/;

async function moraDurations(reading) {
  const response = await fetch(`${HOST}/audio_query?text=${encodeURIComponent(reading)}&speaker=${SPEAKER}`, { method: "POST" });
  if (!response.ok) throw new Error(`audio_query HTTP ${response.status}`);
  const query = await response.json();
  return (query.accent_phrases ?? []).flatMap((phrase) => phrase.moras ?? [])
    .map((mora) => (mora.consonant_length ?? 0) + mora.vowel_length);
}

const SQL = await initSqlJs();
const db = new SQL.Database(new Uint8Array(readFileSync(join(here, "..", "public", "nihongo.db"))));
const rows = db.exec("SELECT kanji, kana FROM words")[0].values;
const decisions = loadDecisions();

const groups = new Map();
let uncompressed = 0;
let scanned = 0;
for (const [rawKanji, rawKana] of rows) {
  const surface = String(rawKanji ?? "");
  const reading = readingOf(rawKana);
  const spots = junctions(reading);
  if (!spots.length) continue;
  scanned += 1;
  if (scanned % 200 === 0) console.log(`  已量 ${scanned} 个词…`);
  let durations;
  try {
    durations = await moraDurations(reading);
  } catch (error) {
    console.error(`  ✗ ${surface}/${reading}: ${error.message}`);
    continue;
  }
  for (const at of spots) {
    const moraIndex = [...reading.slice(0, at + 1)].filter((char) => !SMALL_KANA.test(char)).length;
    const seconds = durations[moraIndex];
    if (!(seconds < COMPRESSED_SECONDS)) { uncompressed += 1; continue; }   // 引擎已经给足两拍
    const group = groupKeyFor(surface, reading, at);
    const verdict = decisions[group] ?? (autoLong(surface, reading, at) ? "auto_long" : "pending");
    const bucket = groups.get(group) ?? { group, pair: reading.slice(at, at + 2), verdict, words: [] };
    bucket.words.push(`${surface}/${reading}@${at} 第二拍${Math.round(seconds * 1000)}ms`);
    groups.set(group, bucket);
  }
}

const all = [...groups.values()].sort((a, b) => b.words.length - a.words.length);
const pick = (verdict) => all.filter((g) => g.verdict === verdict)
  .map(({ group, pair, words }) => ({ group, pair, count: words.length, words: words.slice(0, 8) }));

writeFileSync(reviewPath, JSON.stringify({
  note: "decisions 里填 \"separate\"(两个实词拼起来,两拍要撑开)或 \"long\"(一个语素内部/活用音便,原样)。键 = pending 里的 group。",
  decisions,
  pending: pick("pending"),
  decided_separate: pick("separate"),
  decided_long: pick("long"),
  auto_long: pick("auto_long")
}, null, 1));

const count = (list) => list.reduce((sum, g) => sum + g.count, 0);
const line = (label, list) => console.log(`  ${label} ${list.length} 组 / ${count(list)} 个连接点`);
console.log(`\n扫了 ${scanned} 个词;引擎已给足两拍、不用管的连接点 ${uncompressed} 个`);
line("待人工判 pending  ", pick("pending"));
line("已判 separate(撑开)", pick("separate"));
line("已判 long(原样)   ", pick("long"));
line("自动 long(两拍音读)", pick("auto_long"));
console.log(`→ ${reviewPath}`);
