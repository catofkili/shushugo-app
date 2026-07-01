export type WordAnswer = "forgot" | "fuzzy" | "know" | "known_forever";

export interface WordCard {
  id: number;
  meaning: string;
  questionMeaning?: string;
  primaryMeaning: string;
  promptMeaning: string;
  honorificLabel?: string;
  kana: string;
  kanji: string;
  englishOrigin?: string;
  pos: string;
  score: number;
  importance: number;
  importanceScore: number;
  note: string;
  example: {
    jp: string;
    meaning: string;
  };
  kanjiComponents: {
    char: string;
    simplified: string;
    marked: boolean;
    source: string;
  }[];
  conjugations: { label: string; value: string }[];
  verbPair?: {
    voice: string;
    pairVoice: string;
    kana: string;
    kanji: string;
    meaning: string;
    note: string;
  } | null;
  confusions: { kana: string; kanji: string; meaning: string; kind: string }[];
}

export interface WordStats {
  total: number;
  knownForever: number;
  masteredToday: number;
  reviewedToday: number;
  lowCount: number;
  unseenCount: number;
  newToday: number;
  oldToday: number;
  newQuota: number;
  stage1ProgressDone: number;
  stage1ProgressTotal: number;
  phase: string;
  stage1Done: boolean;
  stage2Total: number;
  stage2Completed: number;
  kanjiTotal: number;
  kanjiCompleted: number;
  studyDate: string;
  checkins: string[];
  dailyStudyStats: { date: string; seconds: number; wordCount: number }[];
  wordStudySecondsToday: number;
  taskDone: boolean;
  settings?: {
    autoKnownEnabled: boolean;
  };
}

export interface WordSessionResponse {
  card: WordCard | null;
  phase: string;
  stats: WordStats;
  autoKnown?: {
    wordId: number;
    streak: number;
  } | null;
}
