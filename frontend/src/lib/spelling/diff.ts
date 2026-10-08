/**
 * 把用户写的和答案逐字对一遍，只标出不一样的字（docs/SPELLING_SPEC.md §1.0）。
 * 我们只指出差别，不替用户判对错、不分「差一点」；认识不认识由用户自己选档位。
 * 纯函数。对照哪一种答案由输入的种类决定：写罗马音就和读音的罗马音比，写假名和假名读音比，其余和书写比。
 */
import { classifyInput } from "./kana";
import { kanaToRomaji } from "./romaji";
import type { SpellingTarget } from "./types";

export interface MarkedText { text: string; wrong: boolean }

export interface SpellingDiff {
  /** 对照的是哪一行答案：卡面写法 / 假名读音 / 罗马音。 */
  against: "surface" | "kana" | "romaji";
  /** 用户写的，不一样的字 wrong = true。 */
  typed: MarkedText[];
  /** 对照的那一条答案，用户漏写 / 写错的字 wrong = true；对上了就是空数组（界面直接显示原答案）。 */
  answer: MarkedText[];
}

const MAX_CHARS = 200;
const MACRON: Record<string, string> = { ā: "aa", ī: "ii", ū: "uu", ē: "ee", ō: "oo" };
/** 罗马音只比字母：大小写、空格、撇号、连字符都不算差别；长音符展开成双写（用户写 kaado 不该被标红）。 */
const plainRomaji = (text: string) => text.toLowerCase().replace(/[āīūēō]/gu, (c) => MACRON[c]).replace(/['’\-\s]/gu, "");

const lcs = (a: string[], b: string[]) => {
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      table[i][j] = a[i - 1] === b[j - 1] ? table[i - 1][j - 1] + 1 : Math.max(table[i - 1][j], table[i][j - 1]);
    }
  }
  const aWrong = a.map(() => true);
  const bWrong = b.map(() => true);
  let i = a.length;
  let j = b.length;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) { aWrong[i - 1] = false; bWrong[j - 1] = false; i -= 1; j -= 1; }
    else if (table[i - 1][j] >= table[i][j - 1]) i -= 1;
    else j -= 1;
  }
  return { length: table[a.length][b.length], aWrong, bWrong };
};

const segments = (chars: string[], wrong: boolean[]): MarkedText[] => {
  const result: MarkedText[] = [];
  chars.forEach((char, index) => {
    const last = result[result.length - 1];
    if (last && last.wrong === wrong[index]) last.text += char;
    else result.push({ text: char, wrong: wrong[index] });
  });
  return result;
};

const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

/**
 * @param matched 引擎认为写对了（罗马音的各种拼法、假名代替汉字都算）。对的就一个字都不标红，
 *                不然 si / shi 这类都被接受的拼法会被标成「错」。
 */
export const markDifferences = (target: SpellingTarget, typed: string, matched: boolean): SpellingDiff | null => {
  const { form, text } = classifyInput(typed);
  if (form === "empty") return null;
  const against = form === "romaji" ? "romaji" : form === "kana" ? "kana" : "surface";
  const written = Array.from(form === "romaji" ? plainRomaji(text) : text).slice(0, MAX_CHARS);
  if (matched) return { against, typed: segments(written, written.map(() => false)), answer: [] };

  const readings = [target.kana, ...target.altReadings];
  const candidates = against === "romaji" ? unique(readings.map((kana) => plainRomaji(kanaToRomaji(kana))))
    : against === "kana" ? unique(readings)
      : unique([target.surface, ...target.forms.map((f) => f.surface)]);
  if (!candidates.length) return { against, typed: segments(written, written.map(() => false)), answer: [] };

  let best: { chars: string[]; result: ReturnType<typeof lcs> } | null = null;
  for (const candidate of candidates) {
    const chars = Array.from(candidate);
    const result = lcs(written, chars);
    // 重合最多的那条；一样多取更短的（少标一些「漏写」）。
    if (!best || result.length > best.result.length || (result.length === best.result.length && chars.length < best.chars.length)) {
      best = { chars, result };
    }
  }
  return {
    against,
    typed: segments(written, best!.result.aWrong),
    answer: segments(best!.chars, best!.result.bWrong)
  };
};
