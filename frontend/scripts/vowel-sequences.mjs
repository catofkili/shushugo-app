// 「同一个元音连着两拍」的连接点:识别、判定表、以及合成时怎么撑开。
//
// VOICEVOX 会把这种连接点的第二拍压到 40~90ms(正常一拍 120~220ms)。对长音这是对的
// (優勝 ユウ 的 ウ 48ms);但**语素边界**上的连元音被同样压掉就少了一拍 ——
// 湖(水+海)听起来成了ミズーミ,薄々(うす+うす)成了ウスース。声学上两类分不开
// (实测时长分布完全重叠),只能按语素边界判,而语素边界机器判不全,所以有一份人工表。
//
// 判据(判新词照这条):
//   两个实词拼起来        → 两拍,要撑开   水+海、地+域、うろ+覚え、うす+うす
//   一个语素内部/活用音便  → 长音,原样     椎=シイ、引いて(引きて的イ音便)、大=おお、氷=こおり
//
// 判定表 vowel-sequence-manual-review.json 由 audit-vowel-sequences.mjs 生成和更新,
// build-word-audio.mjs 合成时读它。两边共用本文件,免得「怎么算一个连接点」漂移。

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pronunciationReading } from "../src/lib/speech.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const reviewPath = join(here, "vowel-sequence-manual-review.json");

const VOWEL_ROWS = {
  a: "あかさたなはまやらわがざだばぱ", i: "いきしちにひみりぎじぢびぴ",
  u: "うくすつぬふむゆるぐずづぶぷ", e: "えけせてねへめれげぜでべぺ",
  o: "おこそとのほもよろごぞどぼぽを"
};
const VOWEL_KANA = { a: "あ", i: "い", u: "う", e: "え", o: "お" };
const SMALL_KANA = /[ゃゅょぁぃぅぇぉャュョァィゥェォ]/;
const vowelOf = (char) => Object.keys(VOWEL_ROWS).find((v) => VOWEL_ROWS[v].includes(char)) ?? null;
const toHiragana = (text) => text.replace(/[ァ-ヶ]/g, (char) => String.fromCodePoint(char.codePointAt(0) - 0x60));
const isKanji = (char) => (char >= "一" && char <= "鿿") || char === "々";

/** 连接点一律按**清理过的读音**算(和喂给引擎的是同一个串),否则 〜通り 的波浪号会让拍序错位。 */
export const readingOf = (kana) => pronunciationReading(String(kana ?? ""));

/** 读音里所有「这一拍的元音 == 下一拍(且下一拍是单元音)」的连接点下标 */
export function junctions(reading) {
  const found = [];
  for (let i = 0; i + 1 < reading.length; i += 1) {
    if (SMALL_KANA.test(reading[i + 1])) continue;   // 拗音的小假名跟着前一拍,不在这里断
    const vowel = vowelOf(reading[i]);
    if (vowel && reading[i + 1] === VOWEL_KANA[vowel]) found.push(i);
  }
  return found;
}

const readings = JSON.parse(readFileSync(join(here, "..", "src", "data", "kanji_readings.json"), "utf8")).readings;

/** 这个词里哪个汉字的哪条读音盖住了这两拍。盖不住 = 连接点在两个单位之间。 */
export function coveringReading(surface, pair) {
  for (const char of surface) {
    if (!isKanji(char)) continue;
    for (const kind of ["on", "kun"]) {
      for (const raw of readings[char]?.[kind] ?? []) {
        // 训读表里带送假名点(あそ.ぶ)和后缀连字符,都不是读音本身
        const reading = toHiragana(raw).replace(/[.\-・]/g, "");
        if (reading.includes(pair)) return { char, kind, reading };
      }
    }
  }
  return null;
}

/**
 * 判定的粒度是「读音单位」不是词:ゆう 在 60 个词里是同一个决定,不该判 60 次。
 * 盖不住的(纯假名边界)才退回按词判 —— 假名两拍太粗,いい 里既有 言い方(长音)
 * 又有 世界遺産(せかい|いさん)。
 */
export function groupKeyFor(surface, reading, at) {
  const cover = coveringReading(surface, reading.slice(at, at + 2));
  return cover ? `${cover.char}=${cover.reading}` : `${surface}/${reading}@${at}`;
}

/** 两拍音读(優=ユウ)一定是长音,不用人判。 */
export function autoLong(surface, reading, at) {
  const cover = coveringReading(surface, reading.slice(at, at + 2));
  return cover?.kind === "on" && cover.reading.length === 2;
}

export function loadDecisions() {
  if (!existsSync(reviewPath)) return {};
  return JSON.parse(readFileSync(reviewPath, "utf8")).decisions ?? {};
}

/**
 * 这个词里要撑开的连接点,返回**第二拍在拍序列里的下标**(不是假名下标:拗音占两个字)。
 */
export function separatedMoraIndices(surface, kana, decisions) {
  const reading = readingOf(kana);
  const indices = [];
  for (const at of junctions(reading)) {
    if (decisions[groupKeyFor(surface, reading, at)] !== "separate") continue;
    indices.push([...reading.slice(0, at + 1)].filter((char) => !SMALL_KANA.test(char)).length);
  }
  return indices;
}

// 撑到多长:实测 ズ 0.10 / ウ 0.12 秒时 湖 听起来是四拍(试听样本 F),再长就拖了。
// 只设下限不缩短 —— 引擎给够了的(新しい 的 しい 138ms)就别动它。
const SECOND_MORA_MIN = 0.12;
const FIRST_MORA_MIN = 0.10;

/** 把这些连接点的两拍撑到和别的拍差不多宽。改的是 vowel_length,辅音长度不动。 */
export function stretchMoras(query, moraIndices) {
  if (!moraIndices.length) return 0;
  const moras = (query.accent_phrases ?? []).flatMap((phrase) => phrase.moras ?? []);
  let changed = 0;
  for (const index of moraIndices) {
    const second = moras[index];
    const first = moras[index - 1];
    if (!second || !first) continue;
    second.vowel_length = Math.max(second.vowel_length, SECOND_MORA_MIN);
    first.vowel_length = Math.max(first.vowel_length, FIRST_MORA_MIN);
    changed += 1;
  }
  return changed;
}
