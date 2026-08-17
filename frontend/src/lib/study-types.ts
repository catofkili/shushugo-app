import type { WordAnswer, WordLevelFilter, WordTypeFilter } from "../types/vocabulary";

export type StudyAnswer = WordAnswer;

export interface WordSessionOptions {
  level?: WordLevelFilter;
  type?: WordTypeFilter;
  focus?: "mistakes";
}

export type FavoriteType = "word" | "grammar";

export interface FavoriteItem {
  type: FavoriteType;
  id: string;
  title: string;
  subtitle: string;
  meta: string;
}

/**
 * 进度口径三件套,别混用:
 *   seen      学过(答过至少一次)—— 首页柱状图和「学了多少」说的是这个
 *   completed 已掌握(FSRS 间隔 ≥ 180 天,或手动点了「熟知」)—— 真正的退休线
 *   low       薄弱(本学习日内到期)
 * 以前 completed 是 `known_forever = 1`,而 FSRS 接管后正常学会的词永远不会置那一列,
 * 于是进度条只统计手动标熟知的那几百个,和实际学习量完全脱节。
 */
export interface LevelProgressItem {
  level: string;
  total: number;
  seen: number;
  completed: number;
  low: number;
  unseen: number;
}

export interface ProgressOverview {
  words: {
    total: number;
    seen: number;
    completed: number;
    low: number;
    unseen: number;
  };
  wordsByLevel: LevelProgressItem[];
  grammar: LevelProgressItem[];
}
