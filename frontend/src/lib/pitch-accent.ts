// 音高重音(アクセント)。日语靠音高区分词义:橋(はし↓)和 箸(は↓し)假名完全一样,
// 只有音高不同 —— 中文母语者没有这个维度的感知,不标出来就只能靠蒙。
//
// 数据是「重音核在第几拍」的标准记法(见 scripts/build-pitch-accent.mjs),
// 这里把它展开成逐拍的高低,交给卡片画成 OJAD 那样的音高线。
//
// 表 237KB,和读音表一样走动态 import 单独成 chunk,不进主包。

import { useEffect, useState } from "react";

type AccentEntry = number | number[];

let table: Record<string, AccentEntry> | null = null;
let loading: Promise<void> | null = null;

export const loadPitchAccent = (): Promise<void> => {
  if (table) return Promise.resolve();
  loading ??= import("../data/pitch_accent.json").then((module) => {
    table = (module.default as { accents: Record<string, AccentEntry> }).accents;
  });
  return loading;
};

export const pitchAccentLoaded = () => table !== null;

/** 词典收了多个可接受重音时取首选。查不到返回 null —— 不标胜过标错。 */
export function lookupAccent(kanji: string, kana: string): number | null {
  if (!table) return null;
  const entry = table[`${kanji || kana}|${kana}`];
  if (entry === undefined) return null;
  return Array.isArray(entry) ? entry[0] ?? null : entry;
}

// 拗音的小假名不单独成拍(きょ 是一拍),其余(っ ん ー)都各算一拍。
const SMALL_KANA = /[ぁぃぅぇぉゃゅょゎァィゥェォャュョヮヵヶ]/;

/** 把读音切成拍(モーラ)。重音核的位置是按拍数的,不是按字数。 */
export function splitMorae(reading: string): string[] {
  const morae: string[] = [];
  for (const char of reading) {
    if (morae.length && SMALL_KANA.test(char)) morae[morae.length - 1] += char;
    else morae.push(char);
  }
  return morae;
}

export interface MoraPitch {
  /** 这一拍是不是高音 */
  high: boolean;
  /** 这一拍之后是否下降(重音核所在拍) */
  drop: boolean;
}

/**
 * 逐拍高低。标准规则:
 *   0(平板) 第一拍低,之后一直高,不降 —— 后接助词也保持高
 *   1(头高) 第一拍高,之后全低
 *   n(中高/尾高) 第一拍低,第 2..n 拍高,第 n 拍后降
 */
export function pitchPattern(moraCount: number, accent: number): MoraPitch[] {
  return Array.from({ length: moraCount }, (_, index) => {
    const position = index + 1;
    const high = accent === 1 ? position === 1 : position > 1 && (accent === 0 || position <= accent);
    return { high, drop: accent !== 0 && position === accent };
  });
}

/** 表是异步加载的:加载完触发一次重渲染,音高线补上。 */
export function usePitchAccentReady(): boolean {
  const [ready, setReady] = useState(pitchAccentLoaded());
  useEffect(() => {
    if (ready) return;
    let alive = true;
    loadPitchAccent().then(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [ready]);
  return ready;
}
