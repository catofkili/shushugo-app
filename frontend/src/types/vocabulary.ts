import type { FuriganaAnnotation, TokenBoundary } from "./furigana";

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
  importance: number;
  importanceScore: number;
  isFavorite: boolean;
  note: string;
  example: {
    jp: string;
    meaning: string;
    furigana?: FuriganaAnnotation[];
    tokens?: TokenBoundary[];
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
  /** 中文释义相近、需要在同一气泡里对照的词组。 */
  similarMeaning?: {
    title: string;
    distinction: string;
    items: { id: number; kana: string; kanji: string; meaning: string; note: string }[];
  } | null;
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
  /** 错题本不走今日计划，进度得自己算 */
  mistakes: {
    /** 长期薄弱词池大小 */
    poolSize: number;
    /** 今天已攻掉的薄弱词数（不同词） */
    answeredToday: number;
  };
  /** 模式切换器的角标：每个模式现在还能练多少（队列没建时算「进去之后会有多少」） */
  modeCounts: {
    classic: number;
    mistakes: number;
    quick: number;
    reverse: number;
    kanji: number;
  };
  stage1ProgressDone: number;
  stage1ProgressTotal: number;
  phase: string;
  stage1Done: boolean;
  /** 今日正向流(含减负与压轴)是否全部完成。stage1Done只表示前置今日计划完成,供压轴门槛使用。 */
  dailyPlanDone: boolean;
  stage2Total: number;
  stage2Completed: number;
  kanjiTotal: number;
  kanjiCompleted: number;
  studyDate: string;
  checkins: string[];
  dailyStudyStats: { date: string; seconds: number; wordCount: number }[];
  wordStudySecondsToday: number;
  taskDone: boolean;
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
  /** 昨日表现奖励：只用于前端开场演出，不进入真实任务进度或复习流水。 */
  dailyRelief: {
    total: number;
    completed: number;
    pending: number;
  };
}

export interface WordSessionResponse {
  card: WordCard | null;
  phase: string;
  stats: WordStats;
  /** 「上一个」按钮亮不亮:这一场里还剩几步可撤(最多两步,见 undo-stack) */
  canUndo?: boolean;
}
