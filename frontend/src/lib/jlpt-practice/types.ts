// JLPT 刷题（实验功能，`__EXP_JLPT__`）：题库格式和对外接口的类型。
// 这份是数据层、界面、题库导入三方共用的约定，改字段要三边一起改。规格见 docs/JLPT_PRACTICE_SPEC.md。

export type JlptLevel = "N5" | "N4" | "N3" | "N2" | "N1";
export type JlptSection = "vocab" | "grammar";
export type JlptKind =
  | "kanji-reading"   // 漢字読み
  | "orthography"     // 表記
  | "word-formation"  // 語形成（只有 N2）
  | "context"         // 文脈規定
  | "paraphrase"      // 言い換え類義
  | "usage"           // 用法
  | "grammar-form"    // 文法形式の判断
  | "sentence-order"  // 文の組み立て（★）
  | "passage";        // 文章の文法

export const JLPT_LEVELS: readonly JlptLevel[] = ["N5", "N4", "N3", "N2", "N1"];

/** 考试里的顺序就是这个顺序，模拟卷和题型列表都按它排。 */
export const JLPT_KINDS: readonly JlptKind[] = [
  "kanji-reading", "orthography", "word-formation", "context", "paraphrase", "usage",
  "grammar-form", "sentence-order", "passage"
];

export const KIND_LABEL: Record<JlptKind, string> = {
  "kanji-reading": "漢字読み",
  orthography: "表記",
  "word-formation": "語形成",
  context: "文脈規定",
  paraphrase: "言い換え類義",
  usage: "用法",
  "grammar-form": "文法形式の判断",
  "sentence-order": "文の組み立て",
  passage: "文章の文法"
};

export const KIND_SECTION: Record<JlptKind, JlptSection> = {
  "kanji-reading": "vocab", orthography: "vocab", "word-formation": "vocab", context: "vocab",
  paraphrase: "vocab", usage: "vocab",
  "grammar-form": "grammar", "sentence-order": "grammar", passage: "grammar"
};

export const SECTION_LABEL: Record<JlptSection, string> = {
  vocab: "文字・語彙",
  grammar: "文法"
};

export type OptionNo = 1 | 2 | 3 | 4;

export interface JlptQuestion {
  /** 稳定 id，作答记录按它记。内容修订时 id 不变；整题换掉才换 id。形如 `n3-v-trial1-07`。 */
  id: string;
  level: JlptLevel;
  kind: JlptKind;
  /** 出自哪一套。模拟卷按套组卷。 */
  setId: string;
  /**
   * 题干标记：`[[…]]` 划线；`（　　）` 挖空；排序题四个空写 `＿＿`、★ 那个空写 `★＿＿` 或单独一个 `★`；
   * 文章题的 stem 就是 `[n]`（n 是这道题在文章里的空号）。
   */
  stem: string;
  options: [string, string, string, string];
  answer: OptionNo;
  /** 为什么对（中文一句）。 */
  explanation: string;
  /** 每个干扰项为什么错，键是选项号。 */
  distractors: Partial<Record<"1" | "2" | "3" | "4", string>>;
  /** 排序题：按正确顺序排的选项号。其它题为 undefined。 */
  order?: OptionNo[];
  /** 文章题：指向 bank.passages 的键。 */
  passageId?: string;
  /** 考点：词指 words.id，语法指 grammar_points.id。文章题可以为 null。 */
  target: { type: "word" | "grammar"; id: number; surface: string } | null;
}

export interface JlptSet {
  id: string;
  /** 给人看的名字，比如「试做卷 1」。 */
  title: string;
}

export interface JlptBank {
  /** 题库内容版本，导入脚本写入，比如 `2026-10-02-trial`。 */
  version: string;
  level: JlptLevel;
  sets: JlptSet[];
  /** 文章题的全文，空写成 `[n]`。 */
  passages: Record<string, string>;
  questions: JlptQuestion[];
}

export type JlptMode = "drill" | "mock" | "mistakes";

export interface JlptAnswer {
  questionId: string;
  /** 0 = 没答（模拟卷时间到 / 交卷时空着）。 */
  chosen: 0 | OptionNo;
}

export interface JlptKindStats {
  kind: JlptKind;
  /** 题库里这一类有几题。 */
  total: number;
  /** 答过的题数（按题去重）。 */
  done: number;
  /** 答过的题里，最近一次答对的题数。 */
  correct: number;
  /** 最近一次答错（含没答）的题数，就是错题本里的数。 */
  mistakes: number;
}

export interface JlptMockPart {
  section: JlptSection;
  /** 建议用时（分钟），到时自动交这一部分。 */
  minutes: number;
  questions: JlptQuestion[];
}

/** 题干解析结果，界面逐段渲染。 */
export type StemPart =
  | { type: "text"; text: string }
  | { type: "underline"; text: string }
  | { type: "blank" }
  | { type: "slot"; star: boolean }
  | { type: "ref"; n: number };
