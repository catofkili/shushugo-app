/**
 * 单词拼写（docs/SPELLING_SPEC.md）的公共契约：只有类型，没有实现。
 * 各模块（kana / romaji / forms / check / grade / store）都对着这份写，改这里要同步改规格。
 *
 * ⚠️ 实验功能：不进发布包。除 `lib/spelling/index.ts` 外，别处不许 import 本目录（规格 §7）。
 */

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
  | "peer_word"          // 写成了题面完全相同的另一个词（不算作一次作答）
  | "conjugated"         // 写成了活用形 / 词尾不对
  | "source_language"    // 外来语写成了英语等原词拼写
  | "too_short"          // 前面都对，但少了字符
  | "too_long";          // 前面都对，但多了字符

/** 一个问题。UI 文案由 messages 另配（Claude 写），这里只带数据。 */
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

/**
 * 读音对但写法有瑕疵、或词认对了只差一步：UI 可以让用户改一次而不算忘记。
 * ⚠️ `chinese_form`（中文简体字形）**不在**这里：作者 2026-10-03 定「写成简体中文直接判错」。
 * 判错只是我们的参考意见——最终对不对由用户自己说了算（`SpellingRound.override`，规格 §1.0）。
 */
export const NEAR_MISS_CODES: ReadonlySet<SpellingProblemCode> = new Set<SpellingProblemCode>([
  "long_vowel", "script", "other_reading", "traditional_form",
  "okurigana", "partial_kana", "peer_word"
]);

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
  /** 不对时：所有 problems 都在 NEAR_MISS_CODES 里。correct 时恒为 false。 */
  nearMiss: boolean;
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

/** 一次作答的记录：落库、统计、评分都读它。 */
export interface SpellingAttempt {
  typed: string;
  verdict: SpellingVerdict;
}

/** 一张卡的作答过程（可多次提交 + 提示 + 放弃），评分的输入。 */
export interface SpellingRound {
  attempts: SpellingAttempt[];
  /** 用过几级提示（规格 §4）。 */
  hintsUsed: number;
  /** 点了「不会 / 看答案」。 */
  gaveUp: boolean;
  /**
   * 用户对我们判定的最终裁决（规格 §1.0：我们只指出错误，对错用户自己说了算）。
   * "correct"：最后一次提交我们判错了（或差一点），用户说他是对的 → 按那一次提交答对来评分；
   * "wrong"：我们判对了，但用户说其实不会（蒙的 / 手滑）→ 记 forgot。
   * 对「不会」放弃的轮次和用了揭晓级提示的轮次无效。
   */
  override?: "correct" | "wrong";
  /** 从出题到结束的毫秒数。 */
  elapsedMs: number;
}
