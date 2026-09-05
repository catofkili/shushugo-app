export type Page =
  | "home"
  | "word"
  | "team"
  | "zoo-map"
  | "zoo-dex"
  | "hot-spring"
  | "quick-study"
  | "vocab-test"
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
// 「双栏」已删:两栏并排时每栏只有半个屏宽,五根柱子挤成竹签,而摘要那行还要折成
// 两行才放得下 —— 它比单栏看得更少。三档现在是「看什么」而不是「看几栏」。
export type ProgressFocus = "words" | "grammar" | "daily";
// 「词汇学习」已删:它和经典模式走的是同一条代码路径(loadNext 只对 reverse/kanji 分支),
// 两个名字一套行为,选哪个都一样。老数据里存着 "vocabulary" 的,由 getStudyMode 归到经典。
export type StudyMode = "classic" | "mixed" | "mistakes" | "reverse" | "kanji" | "quick" | "picked";
