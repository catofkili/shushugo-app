/**
 * 混合学习里「另外两种卡」的会话入口（docs/MIXED_STUDY_PLAN.md 第 2 节）：
 * 单独汉字卡、疑难连线卡。语法走 grammar-quiz 自己那套，单词走 stage1。
 *
 * 每日新学数和复习上限从 studyPreferences 读（kanjiDailyGoal / kanjiReviewCap …，0 = 到期全出）。
 * 汉字的候选按备考目标等级过滤。
 */
import { getStudyPreferences } from "./studyPreferences";
import { today } from "./study-core";
import {
  createKanjiCharTasks, kanjiCharCard, kanjiCharDataLoaded, kanjiCharProgress, loadKanjiCharData,
  materializeKanjiChars, pickKanjiCharNext, recordKanjiCharReview, undoLastKanjiCharReview, clearKanjiCharTasks, type KanjiCharCard
} from "./kanji-char-cards";
import {
  confusionCardProgress, createConfusionTasks, matchingCard, materializeConfusionCards,
  pickConfusionNext, recordConfusionReview, undoLastConfusionReview, clearConfusionTasks, type MatchingCard
} from "./confusion-cards";
import type { WordAnswer } from "../types/vocabulary";

const LEVEL_RANK: Record<string, number> = { N5: 0, N4: 1, N3: 2, N2: 3, N1: 4 };
export const targetLevelRank = () => LEVEL_RANK[getStudyPreferences().jlptTarget] ?? 2;

const UNLIMITED = 100000;

export const loadMixedCardData = loadKanjiCharData;
export const mixedCardDataLoaded = kanjiCharDataLoaded;

let materializedFor: object | null = null;
/** 每个库实例物化一次（同 oncePerDatabase 的道理：合并 / 恢复会换掉 db 实例） */
const materializeOnce = (db: object) => {
  if (materializedFor === db) return;
  materializeKanjiChars();
  materializeConfusionCards();
  materializedFor = db;
};

export interface KanjiCardSession { card: KanjiCharCard | null; done: number; remaining: number; total: number }
export interface ConfusionCardSession { card: MatchingCard | null; done: number; remaining: number; total: number }

export const getKanjiCardSession = (db: object, day = today()): KanjiCardSession => {
  materializeOnce(db);
  const prefs = getStudyPreferences();
  createKanjiCharTasks({ fresh: prefs.kanjiDailyGoal, review: prefs.kanjiReviewCap > 0 ? prefs.kanjiReviewCap : UNLIMITED }, targetLevelRank(), day);
  const next = pickKanjiCharNext(day);
  const progress = kanjiCharProgress(day);
  return { card: next ? kanjiCharCard(next) : null, ...progress };
};

export const submitKanjiCardAnswer = (char: string, answer: WordAnswer) => recordKanjiCharReview(char, answer);
export const undoKanjiCardAnswer = () => undoLastKanjiCharReview();

export const getConfusionCardSession = (db: object, day = today()): ConfusionCardSession => {
  materializeOnce(db);
  const prefs = getStudyPreferences();
  createConfusionTasks({ fresh: prefs.confusionDailyGoal, review: prefs.confusionReviewCap > 0 ? prefs.confusionReviewCap : UNLIMITED }, day);
  const next = pickConfusionNext(day);
  const progress = confusionCardProgress(day);
  return { card: next ? matchingCard(next) : null, ...progress };
};

export const submitConfusionCardAnswer = (groupKey: string, answer: WordAnswer) => recordConfusionReview(groupKey, answer);
export const undoConfusionCardAnswer = () => undoLastConfusionReview();

/** 改了每日量之后重排今天两种卡的清单（同 refreshTodayWordPlan 的道理：额度是排计划那一刻定的）。 */
export const refreshMixedCardTasks = (db: object) => {
  if (!mixedCardDataLoaded()) return;
  clearKanjiCharTasks();
  clearConfusionTasks();
  getKanjiCardSession(db);
  getConfusionCardSession(db);
};

/** 今天两种卡还剩几张（主页角标 / 小路的分母）。没建清单的日子先建再数，代价是几条 SQL。 */
export const mixedCardCounts = (db: object, day = today()) => {
  const kanji = getKanjiCardSession(db, day);
  const confusion = getConfusionCardSession(db, day);
  return {
    kanjiDone: kanji.done, kanjiRemaining: kanji.remaining,
    confusionDone: confusion.done, confusionRemaining: confusion.remaining
  };
};
