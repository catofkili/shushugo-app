/**
 * 拼写判定：输入 → SpellingVerdict（docs/SPELLING_SPEC.md §1、§2）。纯函数。
 * 罗马音 / 假名交给 romaji.ts / kana.ts；这里负责分流、书写（汉字 / 混合）判据、诊断排序。
 */
import { classifyInput, compareKana, hasKanji, normalizeInput, toHiragana, type ReadingMatch } from "./kana";
import { toJapaneseForms } from "./kanji-form";
import { matchRomaji } from "./romaji";
import {
  NEAR_MISS_CODES,
  type SpellingInputForm, type SpellingLookup, type SpellingProblem, type SpellingProblemCode,
  type SpellingTarget, type SpellingVerdict
} from "./types";

/** 规格 §2：第一个是 UI 主要说的那个。 */
const PROBLEM_ORDER: SpellingProblemCode[] = [
  "peer_word", "other_reading", "chinese_form", "traditional_form", "script", "long_vowel", "okurigana",
  "partial_kana", "conjugated", "homophone", "wrong_kanji", "sokuon", "hatsuon", "wrong_reading",
  "too_short", "too_long", "source_language", "mixed_scripts", "empty"
];
const rank = (code: SpellingProblemCode) => PROBLEM_ORDER.indexOf(code);

const verdict = (
  form: SpellingInputForm,
  readingOk: boolean | null,
  problems: SpellingProblem[],
  matched?: SpellingVerdict["matched"]
): SpellingVerdict => {
  const sorted = [...problems].sort((a, b) => rank(a.code) - rank(b.code));
  const correct = Boolean(matched) && sorted.length === 0;
  return {
    correct,
    form,
    matched: correct ? matched : undefined,
    readingOk,
    nearMiss: !correct && sorted.length > 0 && sorted.every((p) => NEAR_MISS_CODES.has(p.code)),
    problems: sorted
  };
};

const READING_MATCHED = (target: SpellingTarget): SpellingVerdict["matched"] => ({ kind: "reading", text: target.kana, preferred: true });

const KANJI_CHAR = /[㐀-䶿一-鿿豈-﫿々〆\u{20000}-\u{2fa1f}]/u;
const kanjiOf = (s: string): string[] => [...s].filter((c) => KANJI_CHAR.test(c));
/** 最后一个汉字之后的假名（送り仮名）。 */
const tailOf = (s: string): string => {
  const chars = [...s];
  let end = chars.length;
  while (end > 0 && !KANJI_CHAR.test(chars[end - 1])) end -= 1;
  return chars.slice(end).join("");
};
const isSubsequence = (small: string[], big: string[]): boolean => {
  let at = 0;
  for (const c of big) if (at < small.length && small[at] === c) at += 1;
  return at === small.length;
};
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((c, i) => c === b[i]);

/** 被接受写法和输入走同一套归一（NFKC：JMdict 里的「２日」全角数字，和用户输入的「2日」是同一个写法）。 */
const written = (surface: string) => normalizeInput(surface).replace(/\s+/gu, "");

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/gu, "");

type Peer = ReturnType<SpellingLookup["peers"]>[number];

/** 输入（任何一种写法）是不是题面相同的另一个词。 */
const peerHit = (form: SpellingInputForm, text: string, lookup?: SpellingLookup): Peer | undefined => {
  if (!lookup) return undefined;
  const peers = lookup.peers();
  if (form === "romaji") return peers.find((p) => matchRomaji(p.kana, text).ok);
  if (form === "kana") return peers.find((p) => compareKana(p.kana, text).ok);
  return peers.find((p) => p.surface === text);
};

const withOther = (code: SpellingProblemCode, other: Peer): SpellingProblem => ({ code, other });

/** 书写（汉字 / 混合）判据。text 已归一、去空白。 */
const checkWritten = (target: SpellingTarget, text: string, form: SpellingInputForm, lookup?: SpellingLookup): SpellingVerdict => {
  // 中文简体 / 繁体字形：先映回日文字形再去命中。放在精确命中之前——JMdict 里偶有把简体字形
  // 当作罕用写法收录的（烟草），那是中文字形，对学习者不能算对。
  const { text: japanese, changes } = toJapaneseForms(text);
  if (changes.length) {
    const hit = target.forms.find((f) => written(f.surface) === japanese);
    const first = changes[0];
    if (hit) {
      return verdict(form, null, [{
        code: first.kind === "simplified" ? "chinese_form" : "traditional_form",
        typedChar: first.typed, expectedChar: first.expected, suggestion: hit.surface
      }]);
    }
  }

  const exact = target.forms.find((f) => written(f.surface) === text);
  if (exact) return verdict(form, null, [], { kind: "form", text: exact.surface, tag: exact.tag, preferred: exact.tag === "standard" });

  const peer = peerHit(form, text, lookup);
  if (peer) return verdict(form, null, [withOther("peer_word", peer)]);

  const problems: SpellingProblem[] = [];
  const candidate = japanese;

  // 假名种类用错：食ベる → 食べる
  const scriptHit = target.forms.find((f) => f.surface !== candidate && toHiragana(f.surface) === toHiragana(candidate));
  if (scriptHit) return verdict(form, null, [{ code: "script", suggestion: scriptHit.surface }]);

  const inputKanji = kanjiOf(candidate);
  // 汉字序列相同的写法里挑最像的：先看词尾（送り仮名）
  const sameKanji = target.forms.filter((f) => sameList(kanjiOf(f.surface), inputKanji));
  if (sameKanji.length) {
    const inputTail = tailOf(candidate);
    const best = sameKanji[0];
    const formTail = tailOf(best.surface);
    if (formTail) {
      const diverges = inputTail && formTail[0] === inputTail[0] && inputTail !== formTail;
      const stemOnly = inputTail && formTail.startsWith(inputTail);
      const extended = inputTail && inputTail.startsWith(formTail);
      problems.push({ code: diverges || stemOnly || extended ? "conjugated" : "okurigana", suggestion: best.surface });
    } else {
      problems.push({ code: inputTail ? "too_long" : "okurigana", suggestion: best.surface });
    }
    return verdict(form, null, problems);
  }

  // 一部分汉字被写成了假名（交ぜ書き）：输入的汉字是某条被接受写法的汉字的真子序列
  const partial = target.forms.find((f) => {
    const formKanji = kanjiOf(f.surface);
    return inputKanji.length < formKanji.length && isSubsequence(inputKanji, formKanji);
  });
  if (partial) return verdict(form, null, [{ code: "partial_kana", suggestion: partial.surface }]);

  // 外来语写成了别的汉字 / 原词以外：先看是不是同音词，否则就是汉字不对
  const found = lookup?.bySurface(candidate).find((w) => w.wordId !== target.wordId);
  if (found) {
    const homophone = toHiragana(found.kana) === toHiragana(target.kana);
    return verdict(form, null, [{ code: homophone ? "homophone" : "wrong_kanji", other: found }]);
  }
  return verdict(form, null, [{ code: "wrong_kanji", suggestion: target.forms[0]?.surface }]);
};

const readingVerdict = (
  target: SpellingTarget, form: SpellingInputForm, match: ReadingMatch, text: string, lookup?: SpellingLookup
): SpellingVerdict => {
  if (match.ok) return verdict(form, true, [], READING_MATCHED(target));
  const peer = peerHit(form, text, lookup);
  if (peer) return verdict(form, match.readingOk, [withOther("peer_word", peer)]);
  const problems = [...match.problems];
  if (form === "romaji" && target.isLoanword && target.sourceText && squash(text) === squash(target.sourceText)) {
    problems.length = 0;
    problems.push({ code: "source_language" });
  }
  if (problems.length === 0) problems.push({ code: "wrong_reading" });
  return verdict(form, match.readingOk, problems);
};

export const checkSpelling = (target: SpellingTarget, input: string, lookup?: SpellingLookup): SpellingVerdict => {
  const { form, text } = classifyInput(input);
  if (form === "empty") return verdict("empty", null, [{ code: "empty" }]);
  if (form === "other") return verdict("other", null, [{ code: "mixed_scripts" }]);
  if (form === "romaji") {
    const main = matchRomaji(target.kana, text);
    if (!main.ok) {
      const alt = target.altReadings.find((reading) => matchRomaji(reading, text).ok);
      if (alt) return verdict("romaji", true, [{ code: "other_reading" }]);
    }
    return readingVerdict(target, "romaji", main, text, lookup);
  }
  if (form === "kana") return readingVerdict(target, "kana", compareKana(target.kana, text, target.altReadings), text, lookup);
  if (!hasKanji(text)) return verdict(form, null, [{ code: "mixed_scripts" }]);
  return checkWritten(target, text, form, lookup);
};
