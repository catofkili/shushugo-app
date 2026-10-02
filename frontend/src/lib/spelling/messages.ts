/**
 * 判定问题 → 一句话（界面文案）。每句只说一件事，不解释机制（见 CLAUDE.md 的文案纪律）。
 * 数据（哪一拍、哪个字、哪个词）由 SpellingProblem 带来，这里只拼句子。
 */
import type { SpellingProblem, SpellingProblemCode, SpellingTarget } from "./types";

const LABELS: Record<SpellingProblemCode, string> = {
  empty: "未写", mixed_scripts: "混写", wrong_reading: "读音", long_vowel: "长音",
  sokuon: "促音", hatsuon: "拨音", script: "假名", other_reading: "异读",
  chinese_form: "中文字形", traditional_form: "旧字形", okurigana: "送假名",
  partial_kana: "交写", wrong_kanji: "汉字", homophone: "同音词", peer_word: "同义词",
  conjugated: "活用", source_language: "原词", too_short: "少字", too_long: "多字"
};

export const problemLabel = (code: string): string =>
  Object.prototype.hasOwnProperty.call(LABELS, code) ? LABELS[code as SpellingProblemCode] : code;

/** 目标读音写的是片假名（词库里 74 个片假名词没有英文词源，isLoanword 为 false，不能靠它判断文字种类）。 */
const isKatakana = (kana: string) => /[\u30a1-\u30fa]/u.test(kana) && !/[\u3041-\u3096]/u.test(kana);

export const problemMessage = (problem: SpellingProblem, target: Pick<SpellingTarget, "isLoanword" | "kana">): string => {
  const at = problem.moraIndex !== undefined ? `第 ${problem.moraIndex + 1} 拍` : "";
  switch (problem.code) {
    case "empty": return "还没写";
    case "mixed_scripts": return "字母和假名别混着写";
    case "wrong_reading": return at ? `读音不对，${at}` : "读音不对";
    case "long_vowel": return "长音的写法不一样";
    case "sokuon": return "促音「っ」不对";
    case "hatsuon": return "「ん」不对";
    case "script": return target.isLoanword ? "外来语要写片假名" : isKatakana(target.kana) ? "这个词写片假名" : "这个词写平假名";
    case "other_reading": return "这个读法也对，但这张卡要写另一个";
    case "chinese_form": return `「${problem.typedChar}」是中文写法，日语写「${problem.expectedChar}」`;
    case "traditional_form": return `「${problem.typedChar}」是繁体，日语写「${problem.expectedChar}」`;
    case "okurigana": return "送假名不对";
    case "partial_kana": return "汉字不能只换一部分成假名";
    case "wrong_kanji": return problem.other ? `你写的是「${problem.other.surface}」（${problem.other.meaning}）` : "汉字不对";
    case "homophone": return problem.other ? `「${problem.other.surface}」（${problem.other.meaning}）读音一样，但不是这个词` : "读音一样，但不是这个词";
    case "peer_word": return problem.other ? `「${problem.other.surface}」意思也对，这张卡要写另一个词` : "意思也对，这张卡要写另一个词";
    case "conjugated": return "要写原形，不是活用形";
    case "source_language": return "写日语的读音，不是原词拼写";
    case "too_short": return "少了字";
    case "too_long": return "多了字";
  }
};
