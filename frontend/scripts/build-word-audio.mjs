#!/usr/bin/env node
// 把整个词库的读音批量合成成音频文件。
//
// 为什么要预生成:设备自带的语音引擎会自己做形态分析,读音不可控 —— だいたい 被切成
// だ|いたい 读成「da itai」、はいざら 被切成 は|いざら 读成「wa izara」。喂片假名能
// 锁死音素(见 src/lib/speech.ts),但语调仍然拿不到词典里的声调型。预生成两样都能
// 解决,而且词库是固定的,一次性生成之后运行时不再联网、不再花钱。
//
// ── 引擎二选一 ────────────────────────────────────────────────
//
// VOICEVOX(默认;免费、离线、不需要任何付款方式):
//   1. 从 https://voicevox.hiroshiba.jp 下载 macOS 版并打开 App
//      (它自带引擎,默认监听 http://127.0.0.1:50021)
//   2. node scripts/build-word-audio.mjs --words 灰皿,大体,誠   # 试听
//   3. node scripts/build-word-audio.mjs                        # 全量
//   它支持显式指定重音核位置,所以音频的音高和卡片上画的那条音高线同源。
//
// Google Cloud TTS(需要绑卡):
//   export GOOGLE_TTS_API_KEY=... && node scripts/build-word-audio.mjs --engine google
//
// 通用选项:
//   --dry-run          只统计,不合成
//   --words 灰皿,大体   只做点名的词(试听用)
//   --limit 20         只做前 20 个
//   --no-accent        不按词典校正重音(仅 VOICEVOX;想 A/B 对比时用)
//   --diagnose         打印引擎对几个已知词返回的重音值,用来核对重音约定
//
// 断点续跑:已存在的文件直接跳过,中断了再跑一遍即可。

import { mkdirSync, existsSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
// 片假名转换、文件名规则都与 App 运行时共用同一份实现,免得两边漂移。
// Node 24 能直接 import .ts(类型擦除)。
import {
  pronunciationAudioName,
  pronunciationReading,
  speechText
} from "../src/lib/speech.ts";
import { splitMorae } from "../src/lib/pitch-accent.ts";

const here = dirname(fileURLToPath(import.meta.url));
const dbPath = join(here, "..", "public", "nihongo.db");
const audioRoot = join(here, "..", "public", "audio", "words");
const accentPath = join(here, "..", "src", "data", "pitch_accent.json");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};

const engine = value("--engine", "voicevox");
const dryRun = flag("--dry-run");
const diagnose = flag("--diagnose");
const useAccent = !flag("--no-accent");
const limit = Number(value("--limit", Infinity));
const onlyWords = flag("--words")
  ? new Set(value("--words", "").split(",").map((word) => word.trim()).filter(Boolean))
  : null;

// VOICEVOX 输出 WAV,一万条几百 MB,必须压;macOS 自带 afconvert 能编 AAC,
// 不需要额外装 ffmpeg。Google 直接返回 MP3,不用转。
//
// 封装用 ADTS(.aac)而不是 m4a:片段只有 0.7 秒左右,m4a 的容器头(moov 等)有 4.5KB,
// 比音频本身还大 —— 一万个文件光元数据就 50MB。实测同一段音频 m4a 48kbps 8724 字节、
// ADTS 24kbps 只要 3130 字节,小 64%,而 <audio> 和 Web Audio 都能直接播。
const extension = engine === "google" ? ".mp3" : ".aac";
const AUDIO_BITRATE = Number(process.env.AUDIO_BITRATE ?? "24000");

const voicevoxHost = process.env.VOICEVOX_HOST ?? "http://127.0.0.1:50021";
const voicevoxSpeaker = Number(process.env.VOICEVOX_SPEAKER ?? "3");
const googleKey = process.env.GOOGLE_TTS_API_KEY;
const googleToken = process.env.GOOGLE_TTS_ACCESS_TOKEN;
const googleVoice = process.env.GOOGLE_TTS_VOICE ?? "ja-JP-Neural2-B";
const speakingRate = Number(process.env.GOOGLE_TTS_RATE ?? "0.92");

// 每个声音一个子目录:换 speaker 重跑不会覆盖上一个声音,运行时按用户选的那个取文件。
const voiceId = engine === "google" ? `google-${googleVoice}` : `voicevox-${voicevoxSpeaker}`;
// 显示名从引擎问,拿不到就退回 id(--dry-run 时不联网,也走这条)
const voiceLabel = value("--label", "");
const outputDir = join(audioRoot, voiceId);

if (!dryRun && engine === "google" && !googleKey && !googleToken) {
  console.error("Google 引擎需要 GOOGLE_TTS_API_KEY 或 GOOGLE_TTS_ACCESS_TOKEN。");
  process.exit(1);
}

// —— 收集要合成的文本 ——
const SQL = await initSqlJs();
const db = new SQL.Database(new Uint8Array(readFileSync(dbPath)));
const rows = db.exec("SELECT kanji, kana FROM words")[0].values;
const accentTable = JSON.parse(readFileSync(accentPath, "utf8")).accents ?? {};

// 按「词」建条目,不按读音去重 —— 箸 和 橋 读音都是 ハシ,但重音 1 型 vs 2 型,
// 合成出来不是一回事,共用一个文件会教错音。文件名由 表记|假名 哈希而来,
// 运行时用同一个函数算出同样的名字。
const items = new Map();
for (const [rawKanji, rawKana] of rows) {
  const kanji = String(rawKanji ?? "");
  const kana = String(rawKana ?? "");
  if (onlyWords && !onlyWords.has(kanji) && !onlyWords.has(kana)) continue;
  const text = speechText(kanji, kana);
  const reading = pronunciationReading(kana);
  const key = `${kanji}|${kana}`;
  if (!text || !reading || items.has(key)) continue;

  const entry = accentTable[`${kanji || kana}|${kana}`];
  const accent = Array.isArray(entry) ? entry[0] : entry;
  items.set(key, {
    kanji,
    kana,
    text,
    reading,
    sample: `${kanji}/${kana}`,
    accent: typeof accent === "number" ? accent : null
  });
}

if (onlyWords && !items.size) {
  console.error(`--words 里这些词在词库里一个都没找到: ${[...onlyWords].join(", ")}`);
  process.exit(1);
}

const fileNameFor = (item) => `${pronunciationAudioName(item.kanji, item.kana)}${extension}`;
mkdirSync(outputDir, { recursive: true });

const pending = [...items.values()].filter((item) => !existsSync(join(outputDir, fileNameFor(item))));
const totalChars = pending.reduce((sum, item) => sum + [...item.text].length, 0);
const withAccent = pending.filter((item) => item.accent !== null).length;

console.log(`引擎 ${engine} | 词条 ${rows.length} 条 → 待处理词条 ${items.size} 个`);
console.log(`已存在 ${items.size - pending.length} 个,待合成 ${pending.length} 个(其中 ${withAccent} 个有重音数据)`);
if (engine === "google") {
  console.log(
    `共 ${totalChars} 字符,预估:Standard $${((totalChars / 1e6) * 4).toFixed(2)}` +
    ` / Neural2 $${((totalChars / 1e6) * 16).toFixed(2)}` +
    ` / Chirp3-HD $${((totalChars / 1e6) * 30).toFixed(2)}(每月各有 100 万字符免费额度)`
  );
} else {
  console.log("VOICEVOX 本地合成:不联网、不花钱。");
}

if (dryRun) {
  console.log("--dry-run:到此为止,没有调用任何引擎。");
  process.exit(0);
}

// —— VOICEVOX ——
// 两步:先 /audio_query 拿到分好拍的查询结构,把重音核位置按我们的数据改掉,
// 再 /synthesis 合成 —— 音频的音高和卡片上那条音高线就来自同一份数据。
async function voicevoxQuery(text) {
  const response = await fetch(
    `${voicevoxHost}/audio_query?text=${encodeURIComponent(text)}&speaker=${voicevoxSpeaker}`,
    { method: "POST" }
  );
  if (!response.ok) throw new Error(`audio_query HTTP ${response.status}`);
  return response.json();
}

async function voicevoxAccentPhrases(kanaNotation) {
  const response = await fetch(
    `${voicevoxHost}/accent_phrases?text=${encodeURIComponent(kanaNotation)}` +
    `&speaker=${voicevoxSpeaker}&is_kana=true`,
    { method: "POST" }
  );
  if (!response.ok) throw new Error(`accent_phrases HTTP ${response.status}`);
  return response.json();
}

const queryMoras = (query) => query.accent_phrases?.flatMap((phrase) => phrase.moras ?? []) ?? [];

// VOICEVOX 会把正字法的 オウ/エイ 规范成实际长音,这不是误读;真正危险的是拍数变化、
// ツ→ッ,以及把词里的 は/へ 当成助词读成 ワ/エ(花芽→ワナメ、へま→エマ)。
//
// 注意:这里**绝不能**放行 ワ↔ハ 或 エ↔ヘ。真·助词的 は/へ 在 speechText 里已经改写成
// ワ/エ 写进 intended 了(こんにちは→コンニチワ),所以 intended 里剩下的 ハ/ヘ 一定是
// 必须照读的音。曾经放行过这两条,结果 10 个词被合成成了错音。
function equivalentMora(actual, intended, previousActual) {
  if (actual.text === intended) return true;
  if (actual.text === "オ" && intended === "ヲ") return true; // を 现代日语一律读 o
  if ((actual.text === "ジ" && intended === "ヂ") || (actual.text === "ズ" && intended === "ヅ")) return true;
  const previousVowel = previousActual?.vowel?.toLowerCase();
  if (intended === "ー" && actual.vowel?.toLowerCase() === previousVowel) return true;
  if (actual.text === "オ" && intended === "ウ" && previousVowel === "o") return true;
  if (actual.text === "エ" && intended === "イ" && previousVowel === "e") return true;
  return false;
}

function pronunciationMismatch(query, intendedText) {
  const actual = queryMoras(query);
  const intended = splitMorae(intendedText);
  if (actual.length !== intended.length) {
    return `拍数 ${actual.length} != ${intended.length}(${actual.map((mora) => mora.text).join("")} != ${intended.join("")})`;
  }
  for (let index = 0; index < intended.length; index += 1) {
    if (!equivalentMora(actual[index], intended[index], actual[index - 1])) {
      return `第 ${index + 1} 拍 ${actual[index].text} != ${intended[index]}`;
    }
  }
  return null;
}

/** 把结构化查询重新写成官方 AquesTalk 风格明确假名。之后 synthesis 不再猜分词。 */
function explicitKanaNotation(query, accent, intendedText) {
  const phrases = query.accent_phrases ?? [];
  const actual = queryMoras(query);
  const intended = splitMorae(intendedText);
  if (actual.length !== intended.length) {
    throw new Error(
      `VOICEVOX 读音校验失败:拍数 ${actual.length} != ${intended.length}` +
      `(${actual.map((mora) => mora.text).join("")} != ${intended.join("")})`
    );
  }
  let flatIndex = 0;
  return phrases.map((phrase) => {
    const morae = phrase.moras ?? [];
    const chosenAccent =
      phrases.length === 1 && accent !== null
        ? accent === 0
          ? morae.length
          : Math.min(Math.max(accent, 1), morae.length)
        : Math.min(Math.max(phrase.accent ?? morae.length, 1), morae.length);
    return morae.map((mora, index) => {
      const target = intended[flatIndex];
      const previous = actual[flatIndex - 1];
      // 保留正常的长音/助词规范化；其余差异(こういう→こうゆう、ツ→ッ 等)
      // 直接锁回词库指定的这一拍。
      const lockedText = equivalentMora(mora, target, previous) ? mora.text : target;
      flatIndex += 1;
      const devoiced = mora.vowel === "I" || mora.vowel === "U" ? "_" : "";
      return `${devoiced}${lockedText}${index + 1 === chosenAccent ? "'" : ""}`;
    }).join("");
  }).join("/");
}

const cleanSurface = (text) => text.replace(/\[[^\]]*\]/g, "").replace(/[〜～~\s]/g, "");

/** 走完除合成外的全部流程,返回最终交给引擎的明确假名记法。--verify 用它复核已生成的音频。 */
async function voicevoxNotationFor(item) {
  const { reading, text: intendedText, accent, kanji } = item;
  let query = await voicevoxQuery(reading);
  if (pronunciationMismatch(query, intendedText)) {
    const surface = cleanSurface(kanji);
    if (surface && surface !== reading) {
      const surfaceQuery = await voicevoxQuery(surface);
      if (!pronunciationMismatch(surfaceQuery, intendedText)) query = surfaceQuery;
    }
  }
  return explicitKanaNotation(query, useAccent ? accent : null, intendedText);
}

async function voicevoxSynthesize(item) {
  const { reading, text: intendedText, accent, kanji } = item;
  // 先用词库原始 kana 获取自然的长音和元音无声化。不能喂 speechText 的全片假名:
  // VOICEVOX 会把 ユシュツ 误拆成 ユ/シュッ,而 ゆしゅつ 能正确得到 ユシュツ。
  let query = await voicevoxQuery(reading);

  // 纯假名偶尔会被误分词(はは→ワワ、つかう→ツカア)。这时让表记参与第二次判断:
  // 母/木の葉/流派/使う 会恢复正确音素；若汉字存在多读(角、開く),只有与卡片
  // 指定读音完全相符时才采用，绝不让引擎替卡片挑读音。
  let mismatch = pronunciationMismatch(query, intendedText);
  if (mismatch) {
    const surface = cleanSurface(kanji);
    if (surface && surface !== reading) {
      const surfaceQuery = await voicevoxQuery(surface);
      if (!pronunciationMismatch(surfaceQuery, intendedText)) {
        query = surfaceQuery;
        mismatch = null;
      }
    }
  }

  // 拍数一致时用明确假名把剩余差异锁回词库读音；拍数改变则宁可失败也不猜。
  const notation = explicitKanaNotation(query, useAccent ? accent : null, intendedText);
  query.accent_phrases = await voicevoxAccentPhrases(notation);
  query.kana = notation;
  mismatch = pronunciationMismatch(query, intendedText);
  if (mismatch) throw new Error(`VOICEVOX 明确假名校验失败:${mismatch}`);
  query.outputSamplingRate = 24000;
  query.outputStereo = false;
  const applied = useAccent && accent !== null && query.accent_phrases?.length === 1;

  const response = await fetch(`${voicevoxHost}/synthesis?speaker=${voicevoxSpeaker}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(query)
  });
  if (!response.ok) throw new Error(`synthesis HTTP ${response.status}`);
  return { wav: Buffer.from(await response.arrayBuffer()), applied };
}

// —— Google ——
async function googleSynthesize(text, attempt = 1) {
  const endpoint = "https://texttospeech.googleapis.com/v1/text:synthesize";
  const response = await fetch(googleKey ? `${endpoint}?key=${googleKey}` : endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(googleToken ? { Authorization: `Bearer ${googleToken}` } : {})
    },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: "ja-JP", name: googleVoice },
      audioConfig: { audioEncoding: "MP3", speakingRate }
    })
  });

  if (response.status === 429 || response.status >= 500) {
    if (attempt > 5) throw new Error(`重试 5 次仍失败(HTTP ${response.status})`);
    await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 500));
    return googleSynthesize(text, attempt + 1);
  }
  if (!response.ok) {
    // 出错正文里可能带 key,只取 message 字段
    const detail = await response.json().catch(() => ({}));
    throw new Error(`HTTP ${response.status}: ${detail?.error?.message ?? "未知错误"}`);
  }
  const { audioContent } = await response.json();
  if (!audioContent) throw new Error("响应里没有 audioContent");
  return Buffer.from(audioContent, "base64");
}

/** WAV → ADTS AAC(.aac)。macOS 自带 afconvert,不用装 ffmpeg。 */
function toAac(wav, targetPath) {
  const temp = `${targetPath}.wav`;
  writeFileSync(temp, wav);
  try {
    execFileSync("afconvert", ["-f", "adts", "-d", "aac", "-b", String(AUDIO_BITRATE), temp, targetPath], {
      stdio: "pipe"
    });
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
}

// —— 诊断:核对引擎的重音约定 ——
if (diagnose) {
  if (engine !== "voicevox") {
    console.error("--diagnose 只对 VOICEVOX 有意义。");
    process.exit(1);
  }
  console.log("\n引擎自己给出的重音(用来核对约定):");
  for (const [word, reading] of [["箸", "はし"], ["橋", "はし"], ["日本語", "にほんご"], ["心", "こころ"], ["輸出", "ゆしゅつ"]]) {
    const query = await voicevoxQuery(reading);
    const phrase = query.accent_phrases?.[0];
    const ours = accentTable[`${word}|${reading}`];
    console.log(
      `  ${word}(${reading}) → ${queryMoras(query).map((mora) => `${mora.text}:${mora.vowel}`).join(" ")}` +
      `,引擎 accent=${phrase?.accent},我们的数据=${ours ?? "无"}`
    );
  }
  console.log("\n预期约定:accent 是 1 起的重音核位置,平板型 = 拍数。对不上就告诉我。");
  process.exit(0);
}

// —— 复核:不合成,只把每个词走一遍流程,看最终交给引擎的假名是不是卡片指定的读音 ——
// 只比音素,不看重音。长音的写法差异(コウハイ↔コオハイ)不算错,ハ 被读成 ワ 这种算错。
if (flag("--verify")) {
  const bad = [];
  let index = 0;
  for (const item of items.values()) {
    index += 1;
    if (index % 1000 === 0) console.log(`  已复核 ${index}/${items.size}…`);
    try {
      // 走完整流程拿到最终交给引擎的明确假名,再用管线自己的判定规则核对音素。
      // 长音、ヅ/ヂ、を→オ 这些等价写法由 equivalentMora 放行,不算错。
      const notation = await voicevoxNotationFor(item);
      const check = pronunciationMismatch({ accent_phrases: await voicevoxAccentPhrases(notation) }, item.text);
      if (check) bad.push({ item, detail: `${check}(记法 ${notation})` });
    } catch (error) {
      bad.push({ item, detail: `流程报错:${error.message}` });
    }
  }
  console.log(`\n复核 ${items.size} 个词,音素与卡片不符的 ${bad.length} 个:`);
  for (const { item, detail } of bad) console.log(`  ${item.sample}  应读 ${item.text}  ${detail}`);
  process.exit(bad.length ? 1 : 0);
}

const queue = pending.slice(0, Number.isFinite(limit) ? limit : pending.length);
console.log(
  `本次合成 ${queue.length} 个` +
  (engine === "voicevox"
    ? `,speaker=${voicevoxSpeaker}${useAccent ? ",按词典重音校正" : ",不校正重音"}`
    : `,音色 ${googleVoice}`) + "\n"
);

let done = 0;
let failed = 0;
let accentApplied = 0;
// VOICEVOX 是本地 CPU 推理,并发开高只会互相抢;Google 是网络请求,6 路合适。
const CONCURRENCY = engine === "voicevox" ? 2 : 6;

async function worker() {
  while (queue.length) {
    const item = queue.shift();
    if (!item) return;
    const { text, sample, accent } = item;
    const target = join(outputDir, fileNameFor(item));
    try {
      if (engine === "voicevox") {
        const { wav, applied } = await voicevoxSynthesize(item);
        toAac(wav, target);
        if (applied) accentApplied += 1;
      } else {
        writeFileSync(target, await googleSynthesize(text));
      }
      done += 1;
      if (done % 100 === 0 || done === 1) console.log(`  ${done} 个完成…(最近:${text} ← ${sample})`);
    } catch (error) {
      failed += 1;
      console.error(`  ✗ ${text}(${sample}): ${error.message}`);
      if (failed === 1 && engine === "voicevox") {
        console.error(`    连不上 VOICEVOX?确认 App 已打开,或设 VOICEVOX_HOST(当前 ${voicevoxHost})`);
      }
      if (failed > 20) {
        console.error("失败过多,停止。修好后再跑一遍,已完成的会跳过。");
        queue.length = 0;
      }
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));

// —— 索引 ——
// 本声音自己的 index.json(数量/引擎/生成日期),外加 words/index.json 汇总所有声音:
// 运行时先读汇总表,知道有哪些声音可选、扩展名是什么;汇总表不存在就一个请求都不发,
// 直接走系统语音,免得每个词都白撞一次 404。
const generated = [...items.values()].filter((item) => existsSync(join(outputDir, fileNameFor(item))));
writeFileSync(
  join(outputDir, "index.json"),
  JSON.stringify({
    id: voiceId,
    label: voiceLabel || voiceId,
    ext: extension,
    engine,
    voice: engine === "voicevox" ? `voicevox:${voicevoxSpeaker}` : googleVoice,
    bitrate: engine === "google" ? null : AUDIO_BITRATE,
    count: generated.length,
    generatedAt: new Date().toISOString().slice(0, 10)
  })
);

// 扫一遍 words/ 下的每个声音目录,重建汇总表(顺带把已删掉的声音自动清出去)
const voices = readdirSync(audioRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    try {
      return JSON.parse(readFileSync(join(audioRoot, entry.name, "index.json"), "utf8"));
    } catch {
      return null;
    }
  })
  .filter((voice) => voice && voice.count > 0)
  .sort((a, b) => a.id.localeCompare(b.id));

writeFileSync(
  join(audioRoot, "index.json"),
  JSON.stringify({
    voices: voices.map(({ id, label, ext, engine: eng, count }) => ({ id, label, ext, engine: eng, count })),
    default: voices[0]?.id ?? null
  })
);
// 文件名是哈希,肉眼认不出是哪个词;留一份对照表纯粹为了排查,运行时不读。
writeFileSync(
  join(outputDir, "manifest.json"),
  JSON.stringify(
    Object.fromEntries([...items.values()].map((item) => [fileNameFor(item), item])),
    null,
    1
  )
);

console.log(`\n✅ 完成 ${done} 个,失败 ${failed} 个;${voiceId} 目录里共 ${generated.length} 个`);
console.log(`   现有声音:${voices.map((v) => `${v.label}(${v.count})`).join("、") || "无"}`);
if (accentApplied) console.log(`   其中 ${accentApplied} 个按词典重音做了校正`);
if (failed) console.log("再跑一遍脚本会只补失败的那些。");
if (onlyWords || Number.isFinite(limit)) {
  console.log("\n试听(macOS):");
  for (const item of items.values()) {
    console.log(`  afplay ${join(outputDir, fileNameFor(item))}   # ${item.sample} → ${item.text}` +
      (item.accent !== null ? ` (${item.accent}型)` : ""));
  }
}
