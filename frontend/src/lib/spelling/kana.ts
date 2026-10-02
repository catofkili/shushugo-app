/**
 * 假名层：输入分流、拍切分、假名比较（docs/SPELLING_SPEC.md §1.1 / §1.4）。
 * 罗马音在 romaji.ts，两边共用这里的拍切分和 ReadingMatch。
 */
import type { SpellingInputForm, SpellingProblem } from "./types";

/** ok = 读音和写法都对；readingOk = 读音对（写法可能有瑕疵，如 script）。 */
export interface ReadingMatch { ok: boolean; readingOk: boolean; problems: SpellingProblem[] }

export const toHiragana = (s: string): string =>
  s.replace(/[ァ-ヶ]/gu, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

export const toKatakana = (s: string): string =>
  s.replace(/[ぁ-ゖ]/gu, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

/** NFKC（全角字母、半角片假名收进来）→ 去零宽字符 → 去词缀符号 〜 ～ ~ ・ → trim；内部空白保留。 */
export const normalizeInput = (s: string): string =>
  s.normalize("NFKC").replace(/[​-‍⁠﻿]/gu, "").replace(/[〜～~・･]/gu, "").trim();

const SMALL_COMBINING = new Set([..."ぁぃぅぇぉゃゅょゎァィゥェォャュョヮ"]);
const NOT_COMBINABLE = /^[っッんンー]/u;

/**
 * 拗音并入前一拍；っ ん ー 各算一拍；片假名外来音（ティ ファ ウィ ヴァ シェ フォ デュ…）整体算一拍。
 * 小假名一律并进前一拍，不查「这个组合存在不存在」：词库里没有孤立的小假名，查了也只多出一张要维护的表。
 */
export const splitMoras = (kana: string): string[] => {
  const out: string[] = [];
  for (const ch of kana) {
    const previous = out[out.length - 1];
    if (SMALL_COMBINING.has(ch) && previous !== undefined && !NOT_COMBINABLE.test(previous)) out[out.length - 1] = previous + ch;
    else out.push(ch);
  }
  return out;
};

const VOWEL_ROWS: Array<[string, string]> = [
  ["あかさたなはまやらわがざだばぱぁゃゎ", "a"],
  ["いきしちにひみりぎじぢびぴぃ", "i"],
  ["うくすつぬふむゆるぐずづぶぷぅゅゔ", "u"],
  ["えけせてねへめれげぜでべぺぇ", "e"],
  ["おこそとのほもよろをごぞどぼぽぉょ", "o"]
];
const VOWEL_OF = new Map<string, string>(VOWEL_ROWS.flatMap(([chars, vowel]) => [...chars].map((c) => [c, vowel] as [string, string])));

/** 一拍的母音（看它最后一个字符：しゃ → a、てぃ → i）。っ ん ー 和非假名返回 ""。 */
export const vowelOfMora = (mora: string): string => VOWEL_OF.get(toHiragana([...mora].pop() ?? "")) ?? "";

const VOWEL_KANA: Record<string, string> = { a: "あ", i: "い", u: "う", e: "え", o: "お" };

/** ー 展开成前一拍母音的假名（らーめん → らあめん）。开头或前面不是带母音的拍的 ー 原样留着。 */
export const expandLongMarks = (hira: string): string => {
  const moras = splitMoras(hira);
  const out: string[] = [];
  moras.forEach((mora, index) => {
    if (mora !== "ー") { out.push(mora); return; }
    const vowel = index > 0 ? vowelOfMora(out[out.length - 1]) : "";
    out.push(vowel ? VOWEL_KANA[vowel] : mora);
  });
  return out.join("");
};

/**
 * 这一拍是不是前一拍的长音延续（おう おお えい ええ ああ いい うう ー）。
 * 返回延续的种类；romaji.ts 把它和前一拍并成一个 token，这里的假名比较用它去掉长音做诊断。
 */
export type LongKind = "same" | "ou" | "ei" | "bar";
export const longContinuation = (previousMora: string, mora: string): LongKind | null => {
  if (mora === "ー") return previousMora && vowelOfMora(previousMora) ? "bar" : null;
  const vowel = vowelOfMora(previousMora);
  if (!vowel) return null;
  if (mora === VOWEL_KANA[vowel]) return "same";
  if (vowel === "o" && mora === "う") return "ou";
  if (vowel === "e" && mora === "い") return "ei";
  return null;
};

const ROMAJI_CHARS = /^[A-Za-zĀ-ſâîûêôÂÎÛÊÔ'’ʼ`´\- ]+$/u;
const KANA_CHARS = /^[ぁ-ゖァ-ヺー]+$/u;
const KANJI_CHAR = /[㐀-䶿一-鿿豈-﫿々〆\u{20000}-\u{2fa1f}]/u;
const KANJI_MIX_CHARS = /^[ぁ-ゖァ-ヺー㐀-䶿一-鿿豈-﫿々〆\u{20000}-\u{2fa1f}]+$/u;

/** 规格 §1.1 的分流。text = normalizeInput 之后的文本；罗马音保留内部空白，其余路径去掉全部空白。 */
export const classifyInput = (raw: string): { form: SpellingInputForm; text: string } => {
  const normalized = normalizeInput(raw);
  if (!normalized) return { form: "empty", text: "" };
  if (/[A-Za-zĀ-ſÂÊÎÔÛâêîôû]/u.test(normalized) && ROMAJI_CHARS.test(normalized)) {
    return { form: "romaji", text: normalized };
  }
  const compact = normalized.replace(/\s+/gu, "");
  if (KANA_CHARS.test(compact)) return { form: "kana", text: compact };
  if (KANJI_MIX_CHARS.test(compact)) {
    return { form: /[ぁ-ゖァ-ヺー]/u.test(compact) ? "mixed" : "kanji", text: compact };
  }
  return { form: "other", text: compact };
};

export const hasKanji = (text: string): boolean => KANJI_CHAR.test(text);

type ScriptClass = "hira" | "kata" | "mixed" | "none";
const scriptClass = (s: string): ScriptClass => {
  const hira = /[ぁ-ゖ]/u.test(s);
  const kata = /[ァ-ヺ]/u.test(s);
  return hira && kata ? "mixed" : hira ? "hira" : kata ? "kata" : "none";
};

const problem = (code: SpellingProblem["code"], extra: Partial<SpellingProblem> = {}): SpellingProblem => ({ code, ...extra });

const firstDifference = (a: string[], b: string[]): number => {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) if (a[i] !== b[i]) return i;
  return length;
};

/** 去掉长音延续的拍：おとうさん / おとおさん / おとーさん 都变成 おとさん。 */
const withoutLong = (moras: string[]): string[] => {
  const out: string[] = [];
  for (const mora of moras) {
    if (out.length && longContinuation(out[out.length - 1], mora)) continue;
    out.push(mora);
  }
  return out;
};

/**
 * 两串读音（都是平假名）为什么不等：按「长音 → 促音 → 拨音 → 长短 → 其它」给第一个原因。
 * 返回 readingOk 说明「发音等价、只是长音写法不同」。
 */
export const diagnoseReading = (target: string, typed: string): { problem: SpellingProblem; readingOk: boolean } => {
  const a = splitMoras(target);
  const b = splitMoras(typed);
  const at = firstDifference(a, b);
  const withoutLongEqual = (() => { const x = withoutLong(a); const y = withoutLong(b); return x.length === y.length && x.every((m, i) => m === y[i]); })();
  if (withoutLongEqual) return { problem: problem("long_vowel", { moraIndex: at }), readingOk: true };
  const strip = (moras: string[], mark: string) => moras.filter((m) => m !== mark);
  const same = (x: string[], y: string[]) => x.length === y.length && x.every((m, i) => m === y[i]);
  if (same(strip(a, "っ"), strip(b, "っ"))) return { problem: problem("sokuon", { moraIndex: at }), readingOk: false };
  if (same(strip(a, "ん"), strip(b, "ん"))) return { problem: problem("hatsuon", { moraIndex: at }), readingOk: false };
  if (at === b.length && b.length < a.length) return { problem: problem("too_short", { moraIndex: at }), readingOk: false };
  if (at === a.length && a.length < b.length) return { problem: problem("too_long", { moraIndex: at }), readingOk: false };
  return { problem: problem("wrong_reading", { moraIndex: at }), readingOk: false };
};

const readingForm = (kana: string, hasBars: boolean): string => {
  const hira = toHiragana(kana);
  return hasBars ? expandLongMarks(hira) : hira;
};

/** 规格 §1.4。altReadings 是目标的其它合法读音（平假名），命中报 other_reading。 */
export const compareKana = (targetKana: string, input: string, altReadings: readonly string[] = []): ReadingMatch => {
  const target = normalizeInput(targetKana).replace(/\s+/gu, "");
  const typed = normalizeInput(input).replace(/\s+/gu, "");
  if (!typed) return { ok: false, readingOk: false, problems: [problem("empty")] };
  // 目标含 ー（片假名词）时，输入的 ー 与「前一拍母音」互通；目标不含 ー，输入的 ー 不收（おとーさん ≠ おとうさん）
  const expandBoth = target.includes("ー");
  const t = readingForm(target, expandBoth);
  const u = readingForm(typed, expandBoth);
  if (t === u) {
    const targetScript = scriptClass(target);
    const typedScript = scriptClass(typed);
    const scriptOk = targetScript === "mixed" || targetScript === "none" || typedScript === "none" || targetScript === typedScript;
    return scriptOk
      ? { ok: true, readingOk: true, problems: [] }
      : { ok: false, readingOk: true, problems: [problem("script")] };
  }
  if (altReadings.some((alt) => readingForm(normalizeInput(alt).replace(/\s+/gu, ""), false) === u)) {
    return { ok: false, readingOk: true, problems: [problem("other_reading")] };
  }
  const diagnosis = diagnoseReading(t, u);
  const problems = [diagnosis.problem];
  const targetScript = scriptClass(target);
  const typedScript = scriptClass(typed);
  if (diagnosis.readingOk && targetScript !== "mixed" && targetScript !== "none" && typedScript !== "none" && targetScript !== typedScript) {
    problems.unshift(problem("script"));
  }
  return { ok: false, readingOk: diagnosis.readingOk, problems };
};
