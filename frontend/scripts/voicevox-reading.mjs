// VOICEVOX 读音校验与「明确假名」记法。单词(build-word-audio)和例句(build-example-audio)
// 共用这一份:「引擎读出来的拍」和「我们要它读的拍」怎么比、比不上时怎么锁回去,
// 两边漂移了就会出现一边放行、一边判错的同一个音。

import { splitMorae } from "../src/lib/pitch-accent.ts";

export const queryMoras = (query) => query.accent_phrases?.flatMap((phrase) => phrase.moras ?? []) ?? [];

// VOICEVOX 会把正字法的 オウ/エイ 规范成实际长音,这不是误读;真正危险的是拍数变化、
// ツ→ッ,以及把词里的 は/へ 当成助词读成 ワ/エ(花芽→ワナメ、へま→エマ)。
//
// 注意:这里**绝不能**无条件放行 ワ↔ハ 或 エ↔ヘ。单词那边真·助词的 は/へ 在 speechText 里
// 已经改写成 ワ/エ 写进 intended 了(こんにちは→コンニチワ),所以 intended 里剩下的 ハ/ヘ
// 一定是必须照读的音。曾经放行过这两条,结果 10 个词被合成成了错音。
// 例句里助词满地都是,但只有「原文就是平假名 は/へ、不在振假名底下」的那一拍才允许
// (particle=true),汉字读出来的 ハ(母、葉)照旧不许变 ワ。
export function equivalentMora(actual, intended, previousActual, particle = false) {
  if (actual.text === intended) return true;
  if (actual.text === "オ" && intended === "ヲ") return true; // を 现代日语一律读 o
  if ((actual.text === "ジ" && intended === "ヂ") || (actual.text === "ズ" && intended === "ヅ")) return true;
  if (particle && ((actual.text === "ワ" && intended === "ハ") || (actual.text === "エ" && intended === "ヘ"))) return true;
  const previousVowel = previousActual?.vowel?.toLowerCase();
  if (intended === "ー" && actual.vowel?.toLowerCase() === previousVowel) return true;
  if (actual.text === "オ" && intended === "ウ" && previousVowel === "o") return true;
  if (actual.text === "エ" && intended === "イ" && previousVowel === "e") return true;
  return false;
}

/** intended:片假名拍数组;particles:允许按助词读的拍下标。返回 null = 一致。 */
export function pronunciationMismatch(query, intended, particles = new Set()) {
  const actual = queryMoras(query);
  if (actual.length !== intended.length) {
    return `拍数 ${actual.length} != ${intended.length}(${actual.map((mora) => mora.text).join("")} != ${intended.join("")})`;
  }
  for (let index = 0; index < intended.length; index += 1) {
    if (!equivalentMora(actual[index], intended[index], actual[index - 1], particles.has(index))) {
      return `第 ${index + 1} 拍 ${actual[index].text} != ${intended[index]}`;
    }
  }
  return null;
}

/**
 * 把结构化查询重新写成官方 AquesTalk 风格明确假名,之后 synthesis 不再猜分词。
 * accent 只对单短语生效(单词);例句传 null,沿用引擎自己的重音。
 * 短语之间:引擎在这里停顿过(pause_mora)就写 `、`,否则 `/`;疑问句尾加 `？`。
 * 单词永远只有一个短语,这两条对它不起作用。
 */
export function explicitKanaNotation(query, accent, intended, particles = new Set()) {
  const phrases = query.accent_phrases ?? [];
  const actual = queryMoras(query);
  if (actual.length !== intended.length) {
    throw new Error(
      `VOICEVOX 读音校验失败:拍数 ${actual.length} != ${intended.length}` +
      `(${actual.map((mora) => mora.text).join("")} != ${intended.join("")})`
    );
  }
  let flatIndex = 0;
  let out = "";
  phrases.forEach((phrase, phraseIndex) => {
    const morae = phrase.moras ?? [];
    const chosenAccent =
      phrases.length === 1 && accent !== null
        ? accent === 0
          ? morae.length
          : Math.min(Math.max(accent, 1), morae.length)
        : Math.min(Math.max(phrase.accent ?? morae.length, 1), morae.length);
    out += morae.map((mora, index) => {
      const target = intended[flatIndex];
      const previous = actual[flatIndex - 1];
      // 保留正常的长音/助词规范化;其余差异(こういう→こうゆう、ツ→ッ 等)
      // 直接锁回指定的这一拍。
      const lockedText = equivalentMora(mora, target, previous, particles.has(flatIndex)) ? mora.text : target;
      flatIndex += 1;
      const devoiced = mora.vowel === "I" || mora.vowel === "U" ? "_" : "";
      return `${devoiced}${lockedText}${index + 1 === chosenAccent ? "'" : ""}`;
    }).join("");
    if (phraseIndex + 1 < phrases.length) out += phrase.pause_mora ? "、" : "/";
    else if (phrase.is_interrogative) out += "？";
  });
  return out;
}

// —— 例句:振假名 → 整句读音 ——
const toKatakana = (text) => text.replace(/[ぁ-ゖ]/g, (char) => String.fromCodePoint(char.codePointAt(0) + 0x60));
const KANA = /^[ぁ-ゖァ-ヺー]$/;
const SKIP = /^[、。，．！？!?「」『』（）()・\s…〜～~"'“”‘’]$/;

/**
 * 振假名展开成整句读音。返回 { morae, particles } —— particles 是允许按助词读(は→ワ、へ→エ)
 * 的拍下标:只有原文就是平假名、不在振假名底下的 は/へ 才算。汉字读出的 ハ(母)不许变。
 * 有盖不住的字就返回 null:那句没法校验。
 */
export function intendedReading(item) {
  const chars = [...item.text];
  const byStart = new Map(item.furigana.map(([start, length, reading]) => [start, { length, reading }]));
  let kana = "";
  const particleAt = new Set(); // kana 串里的字符下标
  for (let index = 0; index < chars.length; ) {
    const segment = byStart.get(index);
    if (segment) {
      kana += segment.reading;
      index += segment.length;
      continue;
    }
    const char = chars[index];
    if (KANA.test(char)) {
      if (char === "は" || char === "へ") particleAt.add([...kana].length);
      kana += char;
    } else if (!SKIP.test(char)) {
      return null;
    }
    index += 1;
  }
  // 拍下标 ≠ 字符下标(拗音并拍),按拍重新对一遍
  const morae = splitMorae(toKatakana(kana));
  const particles = new Set();
  let charIndex = 0;
  morae.forEach((mora, moraIndex) => {
    if (particleAt.has(charIndex)) particles.add(moraIndex);
    charIndex += [...mora].length;
  });
  return { morae, particles };
}

/** 汉字全部换成振假名的句子 —— 拍数对不上时的第二次尝试。 */
export const kanaSubstituted = (item) =>
  [...item.furigana].sort((a, b) => b[0] - a[0]).reduce((text, [start, length, reading]) => {
    const chars = [...text];
    return chars.slice(0, start).join("") + reading + chars.slice(start + length).join("");
  }, item.text);

