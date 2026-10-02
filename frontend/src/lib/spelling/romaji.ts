/** 罗马音拼写判定（docs/SPELLING_SPEC.md §1.3）。匹配从目标拍出发，不把答案反解成读音。 */
import { longContinuation, normalizeInput, splitMoras, toHiragana, vowelOfMora, type LongKind, type ReadingMatch } from "./kana";
import type { SpellingProblem } from "./types";

/** 词库中末尾「は」读 wa 的助词性词；不对其它词套用助词读法。 */
export const ROMAJI_PARTICLE_WORDS: ReadonlySet<string> = new Set([
  "あるいは", "こんにちは", "こんばんは", "じつは", "それでは", "ついては", "では",
  "なかには", "ならでは", "ひいては", "または", "もしくは", "ようは"
]);

const BASE_ALTS: Record<string, string[]> = {
  あ: ["a"], い: ["i"], う: ["u"], え: ["e"], お: ["o"],
  か: ["ka"], き: ["ki"], く: ["ku"], け: ["ke"], こ: ["ko"],
  さ: ["sa"], し: ["shi", "si"], す: ["su"], せ: ["se"], そ: ["so"],
  た: ["ta"], ち: ["chi", "ti"], つ: ["tsu", "tu"], て: ["te"], と: ["to"],
  な: ["na"], に: ["ni"], ぬ: ["nu"], ね: ["ne"], の: ["no"],
  は: ["ha"], ひ: ["hi"], ふ: ["fu", "hu"], へ: ["he"], ほ: ["ho"],
  ま: ["ma"], み: ["mi"], む: ["mu"], め: ["me"], も: ["mo"],
  や: ["ya"], ゆ: ["yu"], よ: ["yo"],
  ら: ["ra"], り: ["ri"], る: ["ru"], れ: ["re"], ろ: ["ro"],
  わ: ["wa"], ゐ: ["wi"], ゑ: ["we"], を: ["o", "wo"],
  が: ["ga"], ぎ: ["gi"], ぐ: ["gu"], げ: ["ge"], ご: ["go"],
  ざ: ["za"], じ: ["ji", "zi"], ず: ["zu"], ぜ: ["ze"], ぞ: ["zo"],
  だ: ["da"], ぢ: ["ji", "di", "dji", "zi"], づ: ["zu", "du"], で: ["de"], ど: ["do"],
  ば: ["ba"], び: ["bi"], ぶ: ["bu"], べ: ["be"], ぼ: ["bo"],
  ぱ: ["pa"], ぴ: ["pi"], ぷ: ["pu"], ぺ: ["pe"], ぽ: ["po"],
  ぁ: ["a"], ぃ: ["i"], ぅ: ["u"], ぇ: ["e"], ぉ: ["o"],
  ゃ: ["ya"], ゅ: ["yu"], ょ: ["yo"], ゎ: ["wa"], ゕ: ["ka"], ゖ: ["ke"],
  ゔ: ["vu"]
};

const COMPOUND_ALTS: Record<string, string[]> = {
  てぃ: ["thi", "ti"], でぃ: ["di", "dhi"],
  ふぁ: ["fa", "fwa"], ふぃ: ["fi", "fwi"], ふぇ: ["fe", "fwe"], ふぉ: ["fo", "fwo"],
  うぁ: ["wa"], うぃ: ["wi"], うぇ: ["we"], うぉ: ["wo"],
  ゔぁ: ["va"], ゔぃ: ["vi"], ゔぇ: ["ve"], ゔぉ: ["vo"], ゔゅ: ["vyu"],
  しぇ: ["she", "sye"], じぇ: ["je", "zye"], ちぇ: ["che", "tye", "cye"],
  つぁ: ["tsa"], つぃ: ["tsi"], つぇ: ["tse"], つぉ: ["tso"],
  てゅ: ["tyu", "thu"], とぅ: ["twu", "tu"], でゅ: ["dyu", "dhu"], どぅ: ["dwu", "du"],
  ぢゃ: ["dya"], ぢゅ: ["dyu"], ぢょ: ["dyo"]
};

const Y_SMALL: Record<string, string> = { ゃ: "a", ゅ: "u", ょ: "o" };
const unique = (values: string[]): string[] => [...new Set(values)];

const moraAlts = (mora: string): string[] => {
  const hira = toHiragana(mora);
  if (hira === "ー") return ["-"];
  const direct = COMPOUND_ALTS[hira];
  if (direct) return direct;
  const chars = [...hira];
  if (chars.length === 2 && Y_SMALL[chars[1]]) {
    const suffix = Y_SMALL[chars[1]];
    const yoon = suffix === "a" ? "ya" : suffix === "u" ? "yu" : "yo";
    if (chars[0] === "し") return [suffix === "a" ? "sha" : suffix === "u" ? "shu" : "sho", `s${yoon}`];
    if (chars[0] === "ち") return [suffix === "a" ? "cha" : suffix === "u" ? "chu" : "cho", `t${yoon}`, `c${yoon}`];
    if (chars[0] === "じ") return [suffix === "a" ? "ja" : suffix === "u" ? "ju" : "jo", `j${yoon}`, `z${yoon}`];
    if (chars[0] === "ぢ") return [`d${yoon}`];
    const first = BASE_ALTS[chars[0]] ?? [];
    const variants = first.filter((alt) => alt.endsWith("i")).map((alt) => `${alt.slice(0, -1)}${yoon}`);
    return unique(variants.length ? variants : [hira]);
  }
  return BASE_ALTS[hira] ?? [hira];
};

type MoraToken = {
  kind: "mora";
  moraIndex: number;
  longIndex?: number;
  sourceMora: string;
  baseAlts: string[];
  alts: string[];
  wrongLongAlts: string[];
  canonical: string;
};
type SpecialToken = { kind: "sok" | "hat"; moraIndex: number; sourceMora: string };
type RomajiToken = MoraToken | SpecialToken;

const MACRON: Record<string, string> = { a: "ā", i: "ī", u: "ū", e: "ē", o: "ō" };
const CIRCUMFLEX: Record<string, string> = { a: "â", i: "î", u: "û", e: "ê", o: "ô" };
const VOWELS = new Set(["a", "i", "u", "e", "o"]);
const markVowel = (base: string, marks: Record<string, string>): string => {
  const vowel = base.slice(-1);
  return VOWELS.has(vowel) ? `${base.slice(0, -1)}${marks[vowel]}` : base;
};

const longForms = (baseAlts: string[], vowel: string, kind: LongKind): { alts: string[]; wrong: string[] } => {
  const valid: string[] = [];
  const wrong: string[] = [];
  for (const base of baseAlts) {
    if (!base.endsWith(vowel)) continue;
    const doubled = `${base}${vowel}`;
    const macron = markVowel(base, MACRON);
    const circumflex = markVowel(base, CIRCUMFLEX);
    if (kind === "same") {
      valid.push(doubled, macron, circumflex);
      if (vowel === "o") wrong.push(`${base}u`);
      if (vowel === "e") wrong.push(`${base}i`);
    } else if (kind === "ou") {
      valid.push(`${base}u`, macron, circumflex, `${base}h`);
      wrong.push(doubled);
    } else if (kind === "ei") {
      valid.push(`${base}i`, macron, circumflex);
      wrong.push(doubled);
    } else {
      valid.push(doubled, macron, circumflex, `${base}-`);
      if (vowel === "o") valid.push(`${base}u`);
      if (vowel === "e") valid.push(`${base}i`);
    }
  }
  return { alts: unique(valid), wrong: unique(wrong) };
};

const buildTokens = (targetKana: string): { tokens: RomajiToken[]; moras: string[] } => {
  const target = toHiragana(normalizeInput(targetKana).replace(/\s+/gu, ""));
  const moras = splitMoras(target);
  const tokens: RomajiToken[] = [];
  const particleWa = ROMAJI_PARTICLE_WORDS.has(target);

  for (let i = 0; i < moras.length; i += 1) {
    const mora = moras[i];
    if (mora === "っ") { tokens.push({ kind: "sok", moraIndex: i, sourceMora: mora }); continue; }
    if (mora === "ん") { tokens.push({ kind: "hat", moraIndex: i, sourceMora: mora }); continue; }

    const previous = moras[i - 1];
    const continuation = previous ? longContinuation(previous, mora) : null;
    const previousToken = tokens[tokens.length - 1];
    if (continuation && previousToken?.kind === "mora" && previousToken.longIndex === undefined) {
      const vowel = vowelOfMora(previous);
      const forms = longForms(previousToken.baseAlts, vowel, continuation);
      const canonical = markVowel(previousToken.baseAlts[0], MACRON);
      previousToken.canonical = canonical;
      previousToken.alts = unique([canonical, ...forms.alts]);
      previousToken.wrongLongAlts = forms.wrong.filter((alt) => !previousToken.alts.includes(alt));
      previousToken.longIndex = i;
      continue;
    }

    let baseAlts = moraAlts(mora);
    if (particleWa && i === moras.length - 1 && mora === "は") baseAlts = unique(["wa", ...baseAlts]);
    if (particleWa && i === moras.length - 1 && mora === "へ") baseAlts = unique(["e", ...baseAlts]);
    const canonical = baseAlts[0];
    tokens.push({ kind: "mora", moraIndex: i, sourceMora: mora, baseAlts, alts: baseAlts, wrongLongAlts: [], canonical });
  }

  return { tokens, moras };
};

const SEPARATORS = new Set([" ", "'", "’", "`", "-"]);
const isSeparator = (char: string | undefined): boolean => char !== undefined && SEPARATORS.has(char);
const nextSignificant = (input: string, start: number): number => {
  let index = start;
  while (isSeparator(input[index])) index += 1;
  return index;
};

/** 分隔符可落在 token 的任意位置；特别保留 n' 和长音符号 - 的「被 token 吃掉」路径。 */
const literalEnds = (input: string, start: number, literal: string): number[] => {
  let positions = new Set([start]);
  for (const expected of literal) {
    const next = new Set<number>();
    for (const position of positions) {
      let cursor = position;
      while (true) {
        if (input[cursor] === expected) next.add(cursor + 1);
        if (!isSeparator(input[cursor])) break;
        cursor += 1;
      }
    }
    positions = next;
    if (!positions.size) break;
  }
  return [...positions];
};

const geminated = (spelling: string): string[] => {
  if (spelling.startsWith("ch")) return [`t${spelling}`, `c${spelling}`];
  if (spelling.startsWith("sh")) return [`s${spelling}`];
  if (spelling.startsWith("ts")) return [`t${spelling}`];
  if (/^[bcdfghjklmnpqrstvwxyz]/u.test(spelling)) return [`${spelling[0]}${spelling}`];
  return [];
};

type MatchRun = { matched: boolean; furthestToken: number; exhaustedAt: number; completedWithExtra: boolean; wrongLongIndex?: number };
type MatchOptions = { allowWrongLong?: boolean; requireWrongLong?: boolean };

/** DP 状态数为 token 数 × 输入位置（另加一位长音诊断状态），重叠拼法不会指数回溯。 */
const runMatch = (tokens: RomajiToken[], input: string, options: MatchOptions = {}): MatchRun => {
  const memo = new Map<string, number | null>();
  let furthestToken = 0;
  let exhaustedAt = -1;
  let completedWithExtra = false;

  const visit = (tokenIndex: number, inputIndex: number, firstWrongLong: number): number | null => {
    furthestToken = Math.max(furthestToken, tokenIndex);
    const key = `${tokenIndex}:${inputIndex}:${firstWrongLong}`;
    if (memo.has(key)) return memo.get(key) ?? null;
    if (tokenIndex === tokens.length) {
      if (inputIndex === input.length) {
        const result = options.requireWrongLong && firstWrongLong < 0 ? null : firstWrongLong;
        memo.set(key, result);
        return result;
      }
      if (isSeparator(input[inputIndex])) {
        const result = visit(tokenIndex, inputIndex + 1, firstWrongLong);
        memo.set(key, result);
        return result;
      }
      completedWithExtra = true;
      memo.set(key, null);
      return null;
    }

    const significant = nextSignificant(input, inputIndex);
    if (significant === input.length) exhaustedAt = Math.max(exhaustedAt, tokenIndex);

    let result: number | null = null;
    const tryEnds = (spelling: string, wrongLong = false): void => {
      for (const end of literalEnds(input, inputIndex, spelling)) {
        const nextWrong = wrongLong && firstWrongLong < 0 ? (tokens[tokenIndex].kind === "mora" ? tokens[tokenIndex].longIndex ?? tokens[tokenIndex].moraIndex : firstWrongLong) : firstWrongLong;
        const matched = visit(tokenIndex + 1, end, nextWrong);
        if (matched !== null && (result === null || matched < result)) result = matched;
      }
    };

    const token = tokens[tokenIndex];
    if (token.kind === "mora") {
      for (const spelling of token.alts) tryEnds(spelling);
      if (options.allowWrongLong) for (const spelling of token.wrongLongAlts) tryEnds(spelling, true);
    } else if (token.kind === "hat") {
      tryEnds("nn");
      tryEnds("n'");
      for (const end of literalEnds(input, inputIndex, "n")) {
        const next = nextSignificant(input, end);
        if (next === input.length || !/[aeiouy]/u.test(input[next])) {
          const matched = visit(tokenIndex + 1, end, firstWrongLong);
          if (matched !== null && (result === null || matched < result)) result = matched;
        }
      }
      for (const end of literalEnds(input, inputIndex, "m")) {
        const next = nextSignificant(input, end);
        if (/[bmp]/u.test(input[next] ?? "")) {
          const matched = visit(tokenIndex + 1, end, firstWrongLong);
          if (matched !== null && (result === null || matched < result)) result = matched;
        }
      }
    } else {
      for (const spelling of ["xtu", "ltu", "xtsu", "ltsu"]) tryEnds(spelling);
      const nextToken = tokens[tokenIndex + 1];
      if (nextToken?.kind === "mora") {
        for (const spelling of nextToken.alts) {
          for (const doubled of geminated(spelling)) {
            for (const end of literalEnds(input, inputIndex, doubled)) {
              const matched = visit(tokenIndex + 2, end, firstWrongLong);
              if (matched !== null && (result === null || matched < result)) result = matched;
            }
          }
        }
      }
    }

    // 先试跳过，再继续尝试 token：- 也可能是目标 ー 的字面输入。
    if (isSeparator(input[inputIndex])) {
      const skipped = visit(tokenIndex, inputIndex + 1, firstWrongLong);
      if (skipped !== null && (result === null || skipped < result)) result = skipped;
    }
    memo.set(key, result);
    return result;
  };

  const matched = visit(0, 0, -1);
  return { matched: matched !== null, furthestToken, exhaustedAt, completedWithExtra, wrongLongIndex: matched !== null && matched >= 0 ? matched : undefined };
};

const compactSeparators = (input: string): string => [...input].filter((char) => !isSeparator(char)).join("");
const missingKindIndex = (tokens: RomajiToken[], input: string, kind: "sok" | "hat"): number | null => {
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].kind === kind && runMatch(tokens.filter((_, index) => index !== i), input).matched) return tokens[i].moraIndex;
  }
  const first = tokens.find((token) => token.kind === kind);
  if (first && runMatch(tokens.filter((token) => token.kind !== kind), input).matched) return first.moraIndex;
  return null;
};

const hasExtraSokuon = (tokens: RomajiToken[], input: string): boolean => {
  const compact = compactSeparators(input);
  for (const explicit of ["xtsu", "ltsu", "xtu", "ltu"]) {
    const at = compact.indexOf(explicit);
    if (at >= 0 && runMatch(tokens, compact.slice(0, at) + compact.slice(at + explicit.length)).matched) return true;
  }
  for (let i = 0; i + 1 < compact.length; i += 1) {
    if (compact[i] === compact[i + 1] && /[bcdfghjklmnpqrstvwxyz]/u.test(compact[i]) && compact[i] !== "n") {
      if (runMatch(tokens, compact.slice(0, i) + compact.slice(i + 1)).matched) return true;
    }
  }
  return false;
};

const hasExtraHatsuon = (tokens: RomajiToken[], input: string): boolean => {
  const compact = compactSeparators(input);
  for (let i = 0; i < compact.length; i += 1) {
    if (compact[i] !== "n") continue;
    const next = compact[i + 1];
    // n 后接母音/ y 是普通な行，不把删掉这个辅音误诊成多出的拨音。
    if (next && /[aeiouy]/u.test(next)) continue;
    if (runMatch(tokens, compact.slice(0, i) + compact.slice(i + 1)).matched) return true;
  }
  return false;
};

const problem = (code: SpellingProblem["code"], moraIndex: number): ReadingMatch => ({
  ok: false,
  readingOk: false,
  problems: [{ code, moraIndex }]
});

/** 规格 §1.3：逐目标拍 DP。 */
export const matchRomaji = (targetKana: string, input: string): ReadingMatch => {
  const target = toHiragana(normalizeInput(targetKana).replace(/\s+/gu, ""));
  const answer = normalizeInput(input).toLowerCase();
  if (!answer) return { ok: false, readingOk: false, problems: [{ code: "empty" }] };

  const { tokens, moras } = buildTokens(target);
  const strict = runMatch(tokens, answer);
  if (strict.matched) return { ok: true, readingOk: true, problems: [] };

  const longMismatch = runMatch(tokens, answer, { allowWrongLong: true, requireWrongLong: true });
  if (longMismatch.matched) {
    const moraIndex = longMismatch.wrongLongIndex ?? Math.max(0, moras.length - 1);
    return { ok: false, readingOk: true, problems: [{ code: "long_vowel", moraIndex }] };
  }
  const missingSokuon = missingKindIndex(tokens, answer, "sok");
  if (missingSokuon !== null) return problem("sokuon", missingSokuon);
  const missingHatsuon = missingKindIndex(tokens, answer, "hat");
  if (missingHatsuon !== null) return problem("hatsuon", missingHatsuon);
  const failureToken = tokens[strict.furthestToken];
  const failureIndex = failureToken?.moraIndex ?? moras.length;
  if (hasExtraSokuon(tokens, answer)) return problem("sokuon", failureIndex);
  if (hasExtraHatsuon(tokens, answer)) return problem("hatsuon", failureIndex);
  if (strict.furthestToken === tokens.length && strict.completedWithExtra) return problem("too_long", moras.length);
  if (strict.exhaustedAt === strict.furthestToken && strict.furthestToken < tokens.length) {
    const failed = tokens[strict.furthestToken];
    if (failed?.kind === "mora" && failed.longIndex !== undefined) {
      const withoutContinuation = { ...failed, alts: failed.baseAlts, wrongLongAlts: [], longIndex: undefined };
      const shortMoras = [
        ...tokens.slice(0, strict.furthestToken), withoutContinuation,
        ...tokens.slice(strict.furthestToken + 1)
      ];
      if (runMatch(shortMoras, answer).matched) return problem("too_short", failed.longIndex);
    }
    return problem("too_short", failureIndex);
  }
  return problem("wrong_reading", failureIndex);
};

const isVowelOrY = (mora: string | undefined): boolean => !!mora && /^[あいうえおやゆよぁぃぅぇぉゃゅょを]/u.test(toHiragana(mora));

/** 标准 Hepburn 给 UI 看答案；长音用变音符，促音重复下一辅音，ん 在母音 / や行前加撇号。 */
export const kanaToRomaji = (kana: string): string => {
  const { tokens } = buildTokens(kana);
  let result = "";
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.kind === "mora") { result += token.canonical; continue; }
    if (token.kind === "hat") {
      result += isVowelOrY(tokens[i + 1]?.sourceMora) ? "n'" : "n";
      continue;
    }
    const next = tokens[i + 1];
    if (next?.kind === "mora") {
      result += geminated(next.canonical)[0] ?? "xtsu";
      i += 1;
    } else result += "xtsu";
  }
  return result;
};
