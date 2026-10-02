/**
 * 假名层：输入分流、拍切分、假名比较（docs/SPELLING_SPEC.md §1.1 / §1.4）。
 * 罗马音在 romaji.ts，两边共用这里的拍切分和 ReadingMatch。
 */
import type { SpellingInputForm, SpellingProblem } from "./types";

/** ok = 读音和写法都对；readingOk = 读音对（写法可能有瑕疵，如 script）。 */
export interface ReadingMatch { ok: boolean; readingOk: boolean; problems: SpellingProblem[] }

const VOICED_WA_KATAKANA: Record<string, string> = { ヷ: "ゔぁ", ヸ: "ゔぃ", ヹ: "ゔぇ", ヺ: "ゔぉ" };
export const toHiragana = (s: string): string =>
  s.replace(/[ァ-ヺ]/gu, (c) => VOICED_WA_KATAKANA[c] ?? String.fromCharCode(c.charCodeAt(0) - 0x60));

export const toKatakana = (s: string): string =>
  s.replace(/[ぁ-ゖ]/gu, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

/** NFKC、去掉词缀符号，再 trim；内部空白保留。 */
export const normalizeInput = (s: string): string =>
  s.normalize("NFKC").replace(/[〜～~・]/gu, "").trim();

const SMALL_COMBINING = new Set([...
  "ぁぃぅぇぉゃゅょゎゕゖァィゥェォャュョヮヵヶ"
]);
const NOT_COMBINABLE = /^[っッんンー]/u;

/**
 * 拗音并入前一拍；っ ん ー 各算一拍；片假名外来音（ティ ファ ウィ ヴァ シェ フォ デュ…）整体算一拍。
 * 小假名一律并进前一拍，不查组合表：词库里没有孤立的小假名，查了只会多出一张要维护的表。
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
const VOWEL_OF = new Map<string, string>(VOWEL_ROWS.flatMap(([chars, vowel]) =>
  [...chars].map((c) => [c, vowel] as [string, string])
));
const VOWEL_KANA: Record<string, string> = { a: "あ", i: "い", u: "う", e: "え", o: "お" };

/** 一拍的母音（看它最后一个字符：しゃ → a、てぃ → i）。っ ん ー 和非假名返回 ""。 */
export const vowelOfMora = (mora: string): string => VOWEL_OF.get(toHiragana([...mora].pop() ?? "")) ?? "";

/** ー 展开成前一拍母音的假名（らーめん → らあめん）；无法推母音时保留原符号。 */
export const expandLongMarks = (hira: string): string => {
  const out: string[] = [];
  for (const mora of splitMoras(hira)) {
    if (mora !== "ー") { out.push(mora); continue; }
    const vowel = out.length ? vowelOfMora(out[out.length - 1]) : "";
    out.push(vowel ? VOWEL_KANA[vowel] : mora);
  }
  return out.join("");
};

/** 这一拍是否延续前一拍的长音；罗马音层用它把延续并进前一个 token。 */
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

const ROMAJI_CHARS = /^[A-Za-zĀĪŪĒŌÂÎÛÊÔāīūēōâîûêô'’`\- ]+$/u;
const KANA_CHARS = /^[ぁ-ゖァ-ヺー]+$/u;
const KANJI_CHAR = /[㐀-䶿一-鿿豈-﫿々〆\u{20000}-\u{2fa1f}]/u;
const KANJI_MIX_CHARS = /^[ぁ-ゖァ-ヺー㐀-䶿一-鿿豈-﫿々〆\u{20000}-\u{2fa1f}]+$/u;

/** 规格 §1.1 的分流。text = normalizeInput 之后的文本；罗马音保留内部空白，其余路径去掉全部空白。 */
export const classifyInput = (raw: string): { form: SpellingInputForm; text: string } => {
  const normalized = normalizeInput(raw);
  if (!normalized) return { form: "empty", text: "" };
  if (ROMAJI_CHARS.test(normalized)) return { form: "romaji", text: normalized };

  const compact = normalized.replace(/\s+/gu, "");
  if (KANA_CHARS.test(compact)) return { form: "kana", text: compact };
  if (KANJI_MIX_CHARS.test(compact)) {
    return { form: KANJI_CHAR.test(compact) && /[ぁ-ゖァ-ヺー]/u.test(compact) ? "mixed" : "kanji", text: compact };
  }
  return { form: "other", text: compact };
};

/** 草稿兼容导出；调用方可用它识别和式汉字输入。 */
export const hasKanji = (text: string): boolean => KANJI_CHAR.test(text);

const problem = (code: SpellingProblem["code"], extra: Partial<SpellingProblem> = {}): SpellingProblem => ({ code, ...extra });
const firstDifference = (a: string[], b: string[]): number => {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) if (a[i] !== b[i]) return i;
  return length;
};
const same = (a: string[], b: string[]): boolean => a.length === b.length && a.every((mora, i) => mora === b[i]);

/** 去掉长音延续的拍：おとうさん / おとおさん / おとーさん 都变成 おとさん。 */
const withoutLong = (moras: string[]): string[] => {
  const out: string[] = [];
  for (const mora of moras) {
    if (out.length && longContinuation(out[out.length - 1], mora)) continue;
    out.push(mora);
  }
  return out;
};

/** 两串读音不等时归类；只有长音互换算读音等价。 */
export const diagnoseReading = (target: string, typed: string): { problem: SpellingProblem; readingOk: boolean } => {
  const a = splitMoras(target);
  const b = splitMoras(typed);
  const at = firstDifference(a, b);
  if (same(withoutLong(a), withoutLong(b))) return { problem: problem("long_vowel", { moraIndex: at }), readingOk: true };

  if (same(a.filter((mora) => mora !== "っ"), b.filter((mora) => mora !== "っ"))) {
    return { problem: problem("sokuon", { moraIndex: at }), readingOk: false };
  }
  if (same(a.filter((mora) => mora !== "ん"), b.filter((mora) => mora !== "ん"))) {
    return { problem: problem("hatsuon", { moraIndex: at }), readingOk: false };
  }
  if (at === b.length && b.length < a.length) return { problem: problem("too_short", { moraIndex: at }), readingOk: false };
  if (at === a.length && a.length < b.length) return { problem: problem("too_long", { moraIndex: at }), readingOk: false };
  return { problem: problem("wrong_reading", { moraIndex: at }), readingOk: false };
};

const readingForm = (kana: string, expandBars: boolean): string => {
  const hira = toHiragana(kana);
  return expandBars ? expandLongMarks(hira) : hira;
};

type KanaScript = "hira" | "kata" | "neutral";
/** ー 两种文字都用，不算任何一种（おとーさん 的 ー 不能让平假名词被判成「写了片假名」）。 */
const scriptOf = (char: string): KanaScript => {
  if (/[ぁ-ゖ]/u.test(char)) return "hira";
  if (/[ァ-ヺ]/u.test(char)) return "kata";
  return "neutral";
};

/**
 * 文字种类用对没有：纯平假名词不许出现片假名、纯片假名词（外来语）不许出现平假名；
 * 词库里偶有平片混写的读音（てぃーシャツ），这类才逐字符比。逐字符比的前提是两边对得上位置，
 * 所以只在混写目标上用——长音写法不同时（おとうさん / おとーさん）两边长度本来就不一样。
 */
const scriptMatches = (target: string, typed: string): boolean => {
  const has = (s: string, script: KanaScript) => [...s].some((c) => scriptOf(c) === script);
  const targetHira = has(target, "hira");
  const targetKata = has(target, "kata");
  if (targetHira && targetKata) {
    const expected = [...target];
    const actual = [...typed];
    for (let i = 0; i < Math.min(expected.length, actual.length); i += 1) {
      const a = scriptOf(expected[i]);
      const b = scriptOf(actual[i]);
      if (a !== "neutral" && b !== "neutral" && a !== b) return false;
    }
    return true;
  }
  if (targetKata) return !has(typed, "hira");
  if (targetHira) return !has(typed, "kata");
  return true;
};

/** 规格 §1.4。altReadings 是目标的其它合法读音（平假名），命中报 other_reading。 */
export const compareKana = (targetKana: string, input: string, altReadings: readonly string[] = []): ReadingMatch => {
  const target = normalizeInput(targetKana).replace(/\s+/gu, "");
  const typed = normalizeInput(input).replace(/\s+/gu, "");
  if (!typed) return { ok: false, readingOk: false, problems: [problem("empty")] };

  // 目标含长音符时才允许用前一拍母音假名替代；普通词里的 ー 仍然是拼写错误。
  const expandBars = target.includes("ー");
  const targetReading = readingForm(target, expandBars);
  const typedReading = readingForm(typed, expandBars);
  if (targetReading === typedReading) {
    return scriptMatches(target, typed)
      ? { ok: true, readingOk: true, problems: [] }
      : { ok: false, readingOk: true, problems: [problem("script")] };
  }

  if (altReadings.some((alt) => readingForm(normalizeInput(alt).replace(/\s+/gu, ""), expandBars) === typedReading)) {
    return { ok: false, readingOk: true, problems: [problem("other_reading")] };
  }

  const diagnosis = diagnoseReading(targetReading, typedReading);
  const problems = [diagnosis.problem];
  if (diagnosis.readingOk && !scriptMatches(target, typed)) problems.unshift(problem("script"));
  return { ok: false, readingOk: diagnosis.readingOk, problems };
};
