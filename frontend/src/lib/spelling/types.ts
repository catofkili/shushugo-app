/**
 * 单词拼写（docs/SPELLING_SPEC.md）的公共契约：只有类型，没有实现。
 * 各模块（kana / romaji / forms / check / diff / store）都对着这份写，改这里要同步改规格。
 *
 * ⚠️ 实验功能：不进发布包。除 `lib/spelling/index.ts` 外，别处不许 import 本目录（规格 §7）。
 */

import type { WordAnswer } from "../../types/vocabulary";

/** 输入属于哪一类：由字符构成决定，和对错无关（规格 §1.2）。 */
export type SpellingInputForm =
  | "empty"
  | "romaji"   // 只有 ASCII 字母 / 长音符 / ' - 空格
  | "kana"     // 只有假名和 ー
  | "kanji"    // 含汉字、不含假名（纯汉字词）
  | "mixed"    // 汉字和假名都有（含送り仮名）
  | "other";   // 罗马音夹假名、含标点数字等无法归类的混杂

/** 一种被接受的书写（不含「纯假名读音」，那个由 kana 派生）。 */
export type WrittenFormTag =
  | "standard"  // 词库主表记（words.kanji 去注音后，或 orthography 的首选表记）
  | "variant"   // JMdict 里的其它常规写法：送り仮名省略（申込み）、许容写法（行なう）等
  | "rare"      // 少见写法（JMdict rK）
  | "ateji";    // 当て字 / 熟字訓式写法（JMdict ateji）

export interface AcceptedForm {
  surface: string;
  tag: WrittenFormTag;
}

/** 一个词「拼写判定」要用到的全部事实。由 forms.ts 从词库行 + spelling_forms.json 构造。 */
export interface SpellingTarget {
  wordId?: number;
  /** 词库读音，原样（外来语是片假名，其余是平假名）。已去掉 〜 ～ ~ ・ 和空白。 */
  kana: string;
  /** 卡面首选书写（orthography.preferredWordSurface 的口径），可能就是假名。 */
  surface: string;
  /** 全部被接受的非纯假名书写，必含 surface（surface 是假名时除外）。按「标准 → 变体 → 少见」排。 */
  forms: AcceptedForm[];
  /** 同一书写的其它合法读音（明日 あした / あす），片假名词为空。平假名。 */
  altReadings: string[];
  isLoanword: boolean;
  /** 外来语的英文等原词（words.kanji 里的拉丁字母部分），用来识别「写成了英语」。 */
  sourceText?: string;
}

export type SpellingProblemCode =
  | "empty"
  | "mixed_scripts"      // 罗马音夹着假名 / 汉字，或其它无法归类的混杂
  | "wrong_reading"      // 读音不对（罗马音 / 假名）；moraIndex 指向第一处对不上的拍
  | "long_vowel"         // 音一样但长音写法不对（おう / おお，ou / oo）
  | "sokuon"             // 促音 っ 多了或少了
  | "hatsuon"            // 拨音 ん 多了或少了
  | "script"             // 平假名 / 片假名用错（外来语写成平假名，反之亦然）
  | "other_reading"      // 同一写法的另一个合法读音（あす / あした）
  | "chinese_form"       // 用了中文简体字形
  | "traditional_form"   // 用了繁体 / 旧字体字形
  | "okurigana"          // 汉字对，送り仮名不对
  | "partial_kana"       // 一部分汉字被写成了假名（交ぜ書き），不是被接受的写法
  | "wrong_kanji"        // 汉字不对（不是这个词）
  | "homophone"          // 写成了另一个同音词（lookup 命中）
  | "peer_word"          // 写成了题面完全相同的另一个词
  | "conjugated"         // 写成了活用形 / 词尾不对
  | "source_language"    // 外来语写成了英语等原词拼写
  | "too_short"          // 前面都对，但少了字符
  | "too_long";          // 前面都对，但多了字符

/** 一个问题。只进流水当诊断用，界面不对用户说（规格 §1.0：我们只标红不同的字，对错档位由用户自己选）。 */
export interface SpellingProblem {
  code: SpellingProblemCode;
  /** wrong_reading / sokuon / hatsuon / long_vowel：第一处对不上的拍（0 起，按 splitMoras(target.kana)） */
  moraIndex?: number;
  /** chinese_form / traditional_form：用户写的字与应写的日文字形 */
  typedChar?: string;
  expectedChar?: string;
  /** okurigana / partial_kana / conjugated：最接近的被接受写法 */
  suggestion?: string;
  /** homophone / peer_word：被写出来的那个词 */
  other?: { wordId: number; surface: string; kana: string; meaning: string };
}

export interface SpellingVerdict {
  correct: boolean;
  form: SpellingInputForm;
  /**
   * correct 时命中了什么。reading：罗马音 / 假名命中读音（text 是目标读音）；
   * form：命中某条书写（text 是那条书写，tag 是它的标签）。
   * preferred = 命中的是卡面首选写法（reading 命中恒为 true，form 命中看 tag === "standard"）。
   */
  matched?: { kind: "reading" | "form"; text: string; tag?: WrittenFormTag; preferred: boolean };
  /** 读音有没有对上：罗马音 / 假名输入给确切的 true / false；汉字输入判不了读音，给 null。 */
  readingOk: boolean | null;
  /** correct 时为空。按重要程度排，第一个是 UI 主要说的那个。 */
  problems: SpellingProblem[];
}

/** 判定时可选的词库查询（保持 check 是纯函数）。 */
export interface SpellingLookup {
  /** 按书写（汉字形或假名形）找词库里的词，最多几条即可。 */
  bySurface(surface: string): Array<{ wordId: number; surface: string; kana: string; meaning: string }>;
  /** 与目标词题面完全相同的其它词（displayedPromptPeers 的口径）。 */
  peers(): Array<{ wordId: number; surface: string; kana: string; meaning: string }>;
}

/** 题面形式：看释义写（默认）、听读音写（听写）、看挖空例句写（规格 §8）。 */
export type SpellingMode = "meaning" | "audio" | "cloze";

/** 挖空例句题的句子：目标词在句中的实际写法（可能是活用形）被挖掉，用户要写的就是它。 */
export interface SpellingCloze {
  /** 挖空之前 / 之后的原文（含标点，原样）。 */
  before: string;
  after: string;
  /** 例句中文译文（words.example_meaning）。 */
  translation: string;
  /** 目标词在句中的实际写法与读音（食べた / たべた）；`SpellingCard.target` 就是按它构造的。 */
  surface: string;
  reading: string;
}

/** 一张拼写卡给 UI 的全部内容。 */
export interface SpellingCard {
  wordId: number;
  /** 题面中文：questionMeaning 口径（含人工题面、用户改写）。audio / cloze 模式下 UI 默认不展示它（作提示用）。 */
  meaning: string;
  pos: string;
  moraCount: number;
  jlptLevel: string;
  /** 默认 "meaning"。 */
  mode: SpellingMode;
  /** 仅 mode === "cloze"。此时 target 是句中活用后的形态，不是词典形。 */
  cloze?: SpellingCloze;
  target: SpellingTarget;
}

/**
 * 一张卡的作答，评分的输入（规格 §1.0、§3）。
 * 评分由用户自己选（忘记 / 模糊 / 认识 / 熟知，和单词学习同一副档位），引擎的判定只用来决定标红哪些字、写进流水做诊断，不影响评分。
 */
export interface SpellingRound {
  /** 用户写的，没写（直接看了答案）是 ""。 */
  typed: string;
  /** typed 的引擎判定；没写时为 null。只进流水，不展示。 */
  verdict: SpellingVerdict | null;
  /** 这一轮实际展示的题面形式，写入 spelling_reviews.mode。 */
  mode?: SpellingMode;
  /** 用过几级提示（规格 §4），只记流水。 */
  hintsUsed: number;
  /** 用户自己选的档位。 */
  grade: WordAnswer;
  /** 从出题到选档位的毫秒数。 */
  elapsedMs: number;
}
