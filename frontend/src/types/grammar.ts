export type JLPTLevel = "N5" | "N4" | "N3" | "N2" | "N1";
export type JlptLevel = JLPTLevel; // 别名兼容

export type MasteryStatus = "new" | "learning" | "familiar" | "mastered";
export type MasteryState = MasteryStatus; // 别名兼容

export interface WordNote {
  word: string;
  reading?: string;
  note: string;
  text?: string; // 向后兼容
}

export interface ExampleSentence {
  jp: string;
  reading: string;
  cn: string;
  breakdown: WordNote[];
  // 向后兼容
  japanese?: string;
  chinese?: string;
  notes?: WordNote[];
}

export type QuizQuestion =
  | {
      type: "choice";
      id?: string;
      question: string;
      prompt?: string;
      options: string[];
      answer: number | string;
      explanation: string;
    }
  | {
      type: "input";
      id?: string;
      question: string;
      prompt?: string;
      answers: string[];
      explanation: string;
      hint?: string;
    }
  | {
      type: "truefalse" | "boolean";
      id?: string;
      question: string;
      prompt?: string;
      answer: boolean;
      explanation: string;
    };

export interface GrammarComparison {
  withId: string;
  withTitle: string;
  note: string;
}

export interface GrammarPoint {
  id: string;
  title: string;
  level: JLPTLevel;
  bookOrder?: number;
  meaning: string;
  structure: string;
  connection?: string;
  explanation: string;
  usageNotes?: string[];
  examples: ExampleSentence[];
  comparisons: (GrammarComparison | string)[];
  quiz: QuizQuestion[];
}

export interface ComparisonRow {
  aspect: string;
  a: string;
  b: string;
}

export interface PresetComparison {
  id: string;
  leftId?: string;
  rightId?: string;
  title?: string;
  titleA: string;
  titleB: string;
  summary: string;
  rows: ComparisonRow[];
  usage?: string;
  nuance?: string;
  structure?: string;
  examples?: string[];
}

export interface ReviewItem {
  grammarId: string;
  status: MasteryStatus;
  state?: MasteryState; // 别名
  dueAt: string;
  streak: number;
}

export interface MistakeItem {
  id: string;
  grammarId: string;
  questionId: string;
  prompt: string;
  userAnswer: string;
  correctAnswer: string;
  explanation: string;
}
