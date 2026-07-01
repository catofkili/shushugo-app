export type JLPTLevel = "N5" | "N4" | "N3" | "N2" | "N1";
export type MasteryStatus = "new" | "learning" | "familiar" | "mastered";
export type QuizType = "choice" | "input" | "boolean";

export interface WordNote {
  text: string;
  note: string;
}

export interface ExampleSentence {
  japanese: string;
  reading: string;
  chinese: string;
  notes: WordNote[];
}

export interface QuizQuestion {
  id: string;
  type: QuizType;
  prompt: string;
  options?: string[];
  answer: string | boolean;
  explanation: string;
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
  examples: ExampleSentence[];
  comparisons: string[];
  usageNotes?: string[];
  studyGroup?: string;
  quizzes: QuizQuestion[];
}

export interface GrammarStudyGroup {
  id: string;
  title: string;
  level: JLPTLevel;
  question: string;
  pointIds: string[];
  hint: string;
}

export interface ReviewItem {
  grammarId: string;
  status: MasteryStatus;
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
  createdAt: string;
}
