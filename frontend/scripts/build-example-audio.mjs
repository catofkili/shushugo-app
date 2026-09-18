#!/usr/bin/env node
// 把全部例句(words.example_jp + grammar_points.example_jp,约 11,660 句)用 VOICEVOX 合成成音频。
// 流程照抄 build-word-audio.mjs;不同的只有三处:
//
//   1. 读音标准答案来自 example_furigana,不是 kana 列。振假名展开成整句片假名,和引擎
//      audio_query 读出来的拍逐拍比;拍数一致就用明确假名把差异锁回去,拍数不一致先试
//      「把汉字替换成振假名再喂」,还不行就进 example-audio-review.json 的 pending 等人判。
//      振假名盖不住的字(简体字、数字、Ｔシャツ)校不了,照引擎的读法生成,列进 unverified。
//   2. 静音垫从 0.1s 收到 0.02/0.05s。单词那 136 MB 里三分之一是静音,例句别再交这份学费。
//   3. 句调迁移(prosody-transfer.mjs):VOICEVOX 的句子听着死板,借 Kyoko 的短语级起伏写进
//      mora.pitch,重音型不动。--no-prosody 关掉(A/B 对比用)。
//   4. 文件名 = 句子原文的哈希(speech.ts 的 exampleAudioName)。改一句只换一个文件,
//      目录里不在清单上的文件当孤儿删掉。
//
// 编码沿用 ADTS AAC-LC 24 kbps:实测 afconvert 的 HE-AAC 在 24k 反而更大(它会垫到 30k),
// 16k 只小 16%,不值得赌 Firefox/Linux 的解码器。一句约 4 秒 ≈ 14 KB,一个声音 ≈ 160 MB。
//
//   node scripts/build-example-audio.mjs --dry-run          # 只统计
//   node scripts/build-example-audio.mjs --limit 20         # 试听
//   VOICEVOX_SPEAKER=8 node scripts/build-example-audio.mjs  # 全量(默认 8 = 春日部つむぎ)
//
// 断点续跑:已存在的文件直接跳过。人判完 review.json 里的 speak 字段再跑一遍只补那些。

import { mkdirSync, existsSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { exampleAudioName } from "../src/lib/speech.ts";
import { queryMoras, pronunciationMismatch, explicitKanaNotation, intendedReading, kanaSubstituted } from "./voicevox-reading.mjs";
// 句调借参考引擎的,重音型仍是词典的。为什么、怎么比出来的见文件头。
import { referenceWav, trackF0, transferPhraseContour } from "./prosody-transfer.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const dbPath = join(here, "..", "public", "nihongo.db");
const audioRoot = join(here, "..", "public", "audio", "examples");
const reviewPath = join(here, "example-audio-review.json");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const dryRun = flag("--dry-run");
const limit = Number(value("--limit", Infinity));
const useProsody = !flag("--no-prosody");
// 短语内部起伏放大倍数。1.3 是实听定的:1.0 还是偏平,1.7 开始「演」。
const PROSODY_STRENGTH = Number(process.env.PROSODY_STRENGTH ?? "1.3");

const voicevoxHost = process.env.VOICEVOX_HOST ?? "http://127.0.0.1:50021";
const voicevoxSpeaker = Number(process.env.VOICEVOX_SPEAKER ?? "8");
const AUDIO_BITRATE = Number(process.env.AUDIO_BITRATE ?? "24000");
const extension = ".aac";
const voiceId = `voicevox-${voicevoxSpeaker}`;
const outputDir = join(audioRoot, voiceId);
const readJson = (path) => { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; } };
const previousLabel = readJson(join(outputDir, "index.json"))?.label ?? "";
const previousDefault = readJson(join(audioRoot, "index.json"))?.default ?? null;
// 单词库的显示名照搬:同一个 speaker 就是同一个人,设置页里只有一份声音列表。
const wordLabel = readJson(join(here, "..", "public", "audio", "words", voiceId, "index.json"))?.label ?? "";
const voiceLabel = value("--label", "") || previousLabel || wordLabel || voiceId;

// review.json:{ pending: {句: {engine, intended, reason}}, speak: {句: 喂给引擎的替代文本}, unverified: [句] }
const review = readJson(reviewPath) ?? { pending: {}, speak: {}, unverified: [] };
review.pending ??= {}; review.speak ??= {}; review.unverified ??= [];

// —— 收集句子 ——
const SQL = await initSqlJs();
const db = new SQL.Database(new Uint8Array(readFileSync(dbPath)));
const items = new Map();
for (const table of ["words", "grammar_points"]) {
  for (const [jp, furigana] of db.exec(`SELECT example_jp, example_furigana FROM ${table} WHERE example_jp <> ''`)[0].values) {
    const text = String(jp).trim();
    if (!text || items.has(text)) continue;
    items.set(text, { text, furigana: furigana ? JSON.parse(String(furigana)) : [] });
  }
}

const fileNameFor = (item) => `${exampleAudioName(item.text)}${extension}`;
mkdirSync(outputDir, { recursive: true });

const pendingItems = [...items.values()].filter((item) => !existsSync(join(outputDir, fileNameFor(item))));
const unverifiable = [...items.values()].filter((item) => !intendedReading(item)).length;
console.log(`例句 ${items.size} 句(振假名盖不住、校不了的 ${unverifiable} 句)`);
console.log(`已存在 ${items.size - pendingItems.length} 句,待合成 ${pendingItems.length} 句,人判队列里 ${Object.keys(review.pending).length} 句`);
if (dryRun) {
  console.log("--dry-run:到此为止。");
  process.exit(0);
}

// —— VOICEVOX ——
async function voicevoxQuery(text) {
  const response = await fetch(`${voicevoxHost}/audio_query?text=${encodeURIComponent(text)}&speaker=${voicevoxSpeaker}`, { method: "POST" });
  if (!response.ok) throw new Error(`audio_query HTTP ${response.status}`);
  return response.json();
}
async function voicevoxAccentPhrases(kanaNotation) {
  const response = await fetch(
    `${voicevoxHost}/accent_phrases?text=${encodeURIComponent(kanaNotation)}&speaker=${voicevoxSpeaker}&is_kana=true`,
    { method: "POST" }
  );
  if (!response.ok) throw new Error(`accent_phrases HTTP ${response.status}`);
  return response.json();
}

class NeedsReview extends Error {}

async function voicevoxSynthesize(item) {
  const intended = intendedReading(item);
  // 人判给了替代文本就直接用它;校不了的句子照引擎的读法
  let query = await voicevoxQuery(review.speak[item.text] ?? item.text);
  let verified = false;
  if (intended) {
    let mismatch = pronunciationMismatch(query, intended.morae, intended.particles);
    if (mismatch && !review.speak[item.text]) {
      // 拍数一致就能锁,不一致换个喂法再试一次
      const retry = await voicevoxQuery(kanaSubstituted(item));
      if (queryMoras(retry).length === intended.morae.length) { query = retry; mismatch = null; }
    }
    if (mismatch && queryMoras(query).length !== intended.morae.length) {
      throw new NeedsReview(`${mismatch}`);
    }
    const notation = explicitKanaNotation(query, null, intended.morae, intended.particles);
    query.accent_phrases = await voicevoxAccentPhrases(notation);
    query.kana = notation;
    mismatch = pronunciationMismatch(query, intended.morae, intended.particles);
    if (mismatch) throw new NeedsReview(`明确假名校验失败:${mismatch}`);
    verified = true;
  }
  // 迁移必须放在 accent_phrases 重算之后:那一步会换掉整份拍表,先写就被覆盖了。
  let prosody = 0;
  if (useProsody) prosody = transferPhraseContour(query, trackF0(await referenceWav(item.text)), PROSODY_STRENGTH);
  query.prePhonemeLength = 0.02;
  query.postPhonemeLength = 0.05;
  query.outputSamplingRate = 24000;
  query.outputStereo = false;
  const response = await fetch(`${voicevoxHost}/synthesis?speaker=${voicevoxSpeaker}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(query)
  });
  if (!response.ok) throw new Error(`synthesis HTTP ${response.status}`);
  return { wav: Buffer.from(await response.arrayBuffer()), verified, prosody, engineReading: queryMoras(query).map((m) => m.text).join("") };
}

function toAac(wav, targetPath) {
  const temp = `${targetPath}.wav`;
  writeFileSync(temp, wav);
  try {
    execFileSync("afconvert", ["-f", "adts", "-d", "aac", "-b", String(AUDIO_BITRATE), temp, targetPath], { stdio: "pipe" });
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
}

const queue = pendingItems.slice(0, Number.isFinite(limit) ? limit : pendingItems.length);
let done = 0;
let failed = 0;
let needsReview = 0;
let prosodyCount = 0;
const unverified = new Set(review.unverified);
const CONCURRENCY = Math.max(1, Number(process.env.VOICEVOX_CONCURRENCY ?? "2"));

async function worker() {
  while (queue.length) {
    const item = queue.shift();
    const target = join(outputDir, fileNameFor(item));
    try {
      const { wav, verified, prosody, engineReading } = await voicevoxSynthesize(item);
      toAac(wav, target);
      if (prosody) prosodyCount += 1;
      delete review.pending[item.text];
      if (verified) unverified.delete(item.text); else unverified.add(item.text);
      done += 1;
      if (done % 100 === 0 || done === 1) console.log(`  ${done} 句完成…(最近:${item.text} → ${engineReading})`);
    } catch (error) {
      if (error instanceof NeedsReview) {
        needsReview += 1;
        review.pending[item.text] = { reason: error.message, hint: "在 speak 里写一句替代文本(把读错的字换成假名)再跑" };
        continue;
      }
      failed += 1;
      console.error(`  ✗ ${item.text}: ${error.message}`);
      if (failed === 1) console.error(`    连不上 VOICEVOX?确认 App 已打开,或设 VOICEVOX_HOST(当前 ${voicevoxHost})`);
      if (failed > 20) { console.error("失败过多,停止。"); queue.length = 0; }
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

// 孤儿:句子改了、旧哈希的文件还在
const expected = new Set([...items.values()].map(fileNameFor));
let orphans = 0;
for (const name of readdirSync(outputDir)) {
  if (name.endsWith(extension) && !expected.has(name)) { unlinkSync(join(outputDir, name)); orphans += 1; }
}

review.unverified = [...unverified].sort();
writeFileSync(reviewPath, JSON.stringify(review, null, 1) + "\n");

// —— 索引(和 words/ 同一形状,运行时 loadAudioIndex("examples") 读) ——
const generated = [...items.values()].filter((item) => existsSync(join(outputDir, fileNameFor(item))));
writeFileSync(join(outputDir, "index.json"), JSON.stringify({
  id: voiceId, label: voiceLabel, ext: extension, engine: "voicevox", voice: `voicevox:${voicevoxSpeaker}`,
  bitrate: AUDIO_BITRATE, count: generated.length, generatedAt: new Date().toISOString().slice(0, 10)
}));
const voices = readdirSync(audioRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => readJson(join(audioRoot, entry.name, "index.json")))
  .filter((voice) => voice && voice.count > 0)
  .sort((a, b) => a.id.localeCompare(b.id));
writeFileSync(join(audioRoot, "index.json"), JSON.stringify({
  voices: voices.map(({ id, label, ext, engine, count }) => ({ id, label, ext, engine, count })),
  default: voices.some((voice) => voice.id === previousDefault) ? previousDefault : voices[0]?.id ?? null
}));
writeFileSync(join(outputDir, "manifest.json"), JSON.stringify(Object.fromEntries(generated.map((item) => [fileNameFor(item), item.text])), null, 1));

console.log(`\n✅ 完成 ${done} 句(句调迁移 ${prosodyCount} 句),失败 ${failed} 句,待人判 ${needsReview} 句(累计 ${Object.keys(review.pending).length}),校不了的 ${unverified.size} 句;清掉孤儿 ${orphans} 个`);
console.log(`   ${voiceId} 目录里共 ${generated.length} 句;人判表:${reviewPath}`);
if (Number.isFinite(limit)) {
  console.log("\n试听(macOS):");
  for (const item of queue.length ? [] : pendingItems.slice(0, limit)) console.log(`  afplay ${join(outputDir, fileNameFor(item))}   # ${item.text}`);
}
