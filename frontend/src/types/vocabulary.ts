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
  /** id 为 0 表示词库里没有对应词条（硬编码的辨析项），不能跳转过去。 */
  confusions: { id: number; kana: string; kanji: string; meaning: string; kind: string }[];
  /** 中文释义相近、需要在同一气泡里对照的词组。 */
  similarMeaning?: {
    title: string;
    distinction: string;
    /** manual = 手写的 38 组；auto = 题面首义撞车，仅供排片和题面索引使用。 */
    source: "manual" | "auto";
    items: { id: number; kana: string; kanji: string; meaning: string; note: string; manual?: boolean }[];
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
    /** 自选清单还剩几个（没勾过就是 0） */
    picked: number;
  };
  stage1ProgressDone: number;
  /** 今日计划里「新词」和「复习」两栏各自的完成/总数(主页今日大卡那一行小字) */
  stage1NewDone: number;
  stage1NewTotal: number;
  stage1ReviewDone: number;
  stage1ReviewTotal: number;
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
  /** 昨日表现奖励：进入前台计数板，但不伪造成正式复习流水或 FSRS 作答。 */
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
  /** Present only when the feature-flagged local kanji unit scheduler is active. */
  unitKey?: string | null;
  unitTarget?: {
    text: string;
    start: number;
    length: number;
    reading: string;
    unitType: "char" | "jukujikun";
    char: string;
    base: string;
    surface: string;
  } | null;
  /** 「上一个」按钮亮不亮:这一场里还剩几步可撤(最多两步,见 undo-stack) */
  canUndo?: boolean;
}
