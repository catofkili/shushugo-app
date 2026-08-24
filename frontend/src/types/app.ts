export type Page =
  | "home"
  | "word"
  | "team"
  | "zoo-map"
  | "zoo-dex"
  | "hot-spring"
  | "quick-study"
  | "grammar"
  | "detail"
  | "study-modes"
  | "favorites"
  | "confusion"
  | "kanji-readings"
  | "word-list"
  | "jlpt-plan"
  | "profile"
  | "pro"
  | "account"
  | "personal-info"
  | "notifications"
  | "settings"
  | "privacy"
  | "privacy-policy"
  | "user-agreement"
  | "help"
  | "achievements"
  | "about";

export type GrammarMode = "learn" | "immersive" | "quiz";
export type ProgressFocus = "both" | "words" | "grammar";
// 「词汇学习」已删:它和经典模式走的是同一条代码路径(loadNext 只对 reverse/kanji 分支),
// 两个名字一套行为,选哪个都一样。老数据里存着 "vocabulary" 的,由 getStudyMode 归到经典。
export type StudyMode = "classic" | "mistakes" | "reverse" | "kanji" | "quick" | "picked";
