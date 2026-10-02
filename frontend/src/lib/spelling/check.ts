/**
 * 拼写判定：输入 → SpellingVerdict（docs/SPELLING_SPEC.md §1、§2）。纯函数。
 * 罗马音 / 假名交给 romaji.ts / kana.ts；这里负责分流、书写（汉字 / 混合）判据、诊断排序。
 */
import { classifyInput, compareKana, hasKanji, normalizeInput, toHiragana, type ReadingMatch } from "./kana";
import { simplifiedChangesFor, toJapaneseForms } from "./kanji-form";
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
const kanaCount = (text: string): number => [...text].filter((char) => /[ぁ-ゖ゙゚ァ-ヺー]/u.test(char)).length;
const kanaSequence = (text: string): string => [...text].filter((char) => /[ぁ-ゖ゙゚ァ-ヺー]/u.test(char)).map(toHiragana).join("");

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

const simplifiedMatch = (target: SpellingTarget, text: string) => {
  for (const accepted of target.forms) {
    const changes = simplifiedChangesFor(written(accepted.surface), text);
    if (changes) return { accepted, changes };
  }
  return undefined;
};

/** 书写（汉字 / 混合）判据。text 已归一、去空白。 */
const checkWritten = (target: SpellingTarget, text: string, form: SpellingInputForm, lookup?: SpellingLookup): SpellingVerdict => {
  const exact = target.forms.find((f) => written(f.surface) === text);
  const matchedForm = (accepted: NonNullable<typeof exact>) =>
    verdict(form, null, [], { kind: "form", text: accepted.surface, tag: accepted.tag, preferred: accepted.tag === "standard" });
  // 词库表记 / 常规变体 / 当て字的精确命中直接算对：「着る」同时是「著る」的简体字形，但它本身就是标准写法。
  if (exact && exact.tag !== "rare") return matchedForm(exact);

  // 中文简体 / 繁体字形：先于「罕用写法」的精确命中判。JMdict 里偶有把简体字形当作罕用写法收录的
  // （烟草、无），那是中文字形，对学习者不能算对。
  // 单字反查无法表达「动」对应 動 / 働 等多对一映射；按目标写法正向匹配可保留上下文。
  const simplifiedHit = simplifiedMatch(target, text);
  if (simplifiedHit) {
    const first = simplifiedHit.changes[0];
    return verdict(form, null, [{
      code: "chinese_form", typedChar: first.typed, expectedChar: first.expected, suggestion: simplifiedHit.accepted.surface
    }]);
  }
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
  if (exact) return matchedForm(exact);

  const peer = peerHit(form, text, lookup);
  if (peer) return verdict(form, null, [withOther("peer_word", peer)]);

  const problems: SpellingProblem[] = [];
  const candidate = japanese;
  const comparableForms = target.forms.map((accepted) => ({
    accepted,
    japanese: toJapaneseForms(written(accepted.surface)).text
  }));

  // 假名种类用错：食ベる → 食べる
  const scriptHit = comparableForms.find(({ japanese: surface }) => surface !== candidate && toHiragana(surface) === toHiragana(candidate));
  if (scriptHit) return verdict(form, null, [{ code: "script", suggestion: scriptHit.accepted.surface }]);

  const inputKanji = kanjiOf(candidate);
  // 少写一个汉字不能算交ぜ書き；假名数量必须增加，才表示用假名替代了汉字。
  const alreadyWrittenKana = comparableForms.some(({ japanese: surface }) => kanaSequence(surface) === kanaSequence(candidate));
  const partial = alreadyWrittenKana ? undefined : comparableForms.find(({ japanese: surface }) => {
    const formKanji = kanjiOf(surface);
    return inputKanji.length < formKanji.length && isSubsequence(inputKanji, formKanji) &&
      kanaCount(candidate) > kanaCount(surface);
  });
  const firstKanji = [...candidate].findIndex((char) => KANJI_CHAR.test(char));
  const kanaBeforeKanji = firstKanji > 0 && /[ぁ-ゖ゙゚ァ-ヺ]/u.test([...candidate].slice(0, firstKanji).join(""));

  // 汉字序列相同的写法里挑最像的：先看词尾（送り仮名）
  const sameKanji = comparableForms.filter(({ japanese: surface }) => sameList(kanjiOf(surface), inputKanji));
  if (sameKanji.length) {
    const inputTail = tailOf(candidate);
    // 规格把送り仮名诊断排在交ぜ書き之前；但「ヤマ山」一类只有词首替代假名时，尾部相同仍应判 partial_kana。
    if (partial && kanaBeforeKanji && sameKanji.every(({ japanese: surface }) => tailOf(surface) === inputTail)) {
      return verdict(form, null, [{ code: "partial_kana", suggestion: partial.accepted.surface }]);
    }
    const best = sameKanji[0].accepted;
    const formTail = tailOf(sameKanji[0].japanese);
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
  if (partial) return verdict(form, null, [{ code: "partial_kana", suggestion: partial.accepted.surface }]);

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
  if (form === "other") {
    const exact = target.forms.find((accepted) => written(accepted.surface) === text);
    if (exact) return verdict(form, null, [], { kind: "form", text: exact.surface, tag: exact.tag, preferred: exact.tag === "standard" });
    const simplified = simplifiedMatch(target, text);
    if (simplified) {
      const first = simplified.changes[0];
      return verdict(form, null, [{
        code: "chinese_form", typedChar: first.typed, expectedChar: first.expected, suggestion: simplified.accepted.surface
      }]);
    }
    return verdict("other", null, [{ code: "mixed_scripts" }]);
  }
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
