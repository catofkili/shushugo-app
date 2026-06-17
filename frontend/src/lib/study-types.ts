import type { WordAnswer, WordLevelFilter, WordTypeFilter } from "../types/vocabulary";

export type StudyAnswer = WordAnswer;

export interface WordSessionOptions {
  level?: WordLevelFilter;
  type?: WordTypeFilter;
}

export interface GrammarStudyCard {
  id: number;
  key: string;
  pattern: string;
  meaning: string;
  prompt: string;
  formation: string;
  example: {
    jp: string;
    meaning: string;
  };
  notes: string;
  confusions: string[];
  level: string;
  score: number;
  importance: number;
  isFavorite: boolean;
}

export interface GrammarStudyStats {
  total: number;
  knownForever: number;
  unseenCount: number;
  lowCount: number;
  masteredToday: number;
  reviewedToday: number;
  mistakeCount: number;
  progressDone: number;
  progressTotal: number;
  studyDate: string;
}

export interface GrammarStudySession {
  card: GrammarStudyCard | null;
  stats: GrammarStudyStats;
}

export interface GrammarMistakeItem {
  id: number;
  grammarId: number;
  key: string;
  title: string;
  meaning: string;
  level: string;
  answer: StudyAnswer;
  answerLabel: string;
  scoreAfter: number;
  mistakeCount: number;
  lastSeenOn: string;
  example: {
    jp: string;
    meaning: string;
  };
}

export type FavoriteType = "word" | "grammar";

export interface FavoriteItem {
  type: FavoriteType;
  id: string;
  title: string;
  subtitle: string;
  meta: string;
}

export interface LevelProgressItem {
  level: string;
  total: number;
  completed: number;
  low: number;
  unseen: number;
}

export interface ProgressOverview {
  words: {
    total: number;
    completed: number;
    low: number;
    unseen: number;
  };
  wordsByLevel: LevelProgressItem[];
  grammar: LevelProgressItem[];
}
