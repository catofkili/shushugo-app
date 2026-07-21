export type WordAnswer = "forgot" | "fuzzy" | "know" | "known_forever";
export type WordLevelFilter = "All" | "N5" | "N4" | "N3" | "N2" | "N1" | "Unleveled";
export type WordTypeFilter = "all" | "noun" | "verb" | "adjective" | "adverb" | "favorite";

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
  jlptLevel: string;
  score: number;
  importance: number;
  importanceScore: number;
  isFavorite: boolean;
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
  /** 回归模式（积压削峰）状态；未激活时为 undefined */
  comeback?: {
    active: boolean;
    dayIndex: number;
    planDays: number;
    /** 本轮回归的节奏档:gentle 由轻到重 / pressure 高强度快清 */
    mode: "gentle" | "pressure";
    todayTarget: number;
    estimatedMinutes: number;
    remainingBacklog: number;
    initialBacklog: number;
    announcedToday: boolean;
  };
  /** 完成今日计划后的「再来一批」信息 */
  encore?: {
    available: boolean;
    size: number;
    estimatedMinutes: number;
    remaining: number;
    /** 未见新词库存(积压清完后续杯改用新词) */
    unseenRemaining: number;
    /** 今日实际节奏(秒/词),供自定义数量时估算用时 */
    secondsPerWord: number;
    /** 累计学过的词数(里程碑钩子) */
    totalLearned: number;
    /** 本周加餐次数(连击文案) */
    weekEncoreCount: number;
    /** 今日已加餐词数(炫耀图徽章) */
    todayEncoreWords: number;
    fatigued: boolean;
  };
}

export interface WordSessionResponse {
  card: WordCard | null;
  phase: string;
  stats: WordStats;
}
