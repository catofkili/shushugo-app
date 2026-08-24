import { rowsFor } from "../database/db-utils";
import { promptMeaning, questionMeaning } from "./word-card";

/**
 * 「题面显示的那行中文完全相同」的词条索引。
 *
 * 用户看到的题面是 promptMeaning(meaning, id, label, kana) —— 人工题面覆盖、首义裁剪和
 * 8 字截断之后的结果。**撞车必须按这个字符串算**：拿 words.meaning 原文分组会把
 * 题面根本不显示的假名注记、英文原词也算进去，分出来的组和用户看到的对不上。
 *
 * 曾经这份索引是脚本预生成的 auto_similar_meaning_groups.json（428 KB，被答案面
 * 和排片两处静态 import，直接进主包 +210 KB）。改成运行时现算有三个好处：
 *
 *  1. 主包里不再有这坨派生数据 —— 它本来就是从 words 表算出来的；
 *  2. 只有一份 promptMeaning 实现。预生成脚本复制过一份清理逻辑，
 *     改了 word-card.ts 那边 JSON 不会重算，撞车组会和真实题面悄悄对不上；
 *  3. 导入词单新增的词自动进组（旧的静态 JSON 覆盖不到）。
 *
 * 代价是首次使用时扫一遍全表跑正则。只做一次并缓存，导入词单后由
 * resetQuestionMeaningIndex 作废。
 */

/**
 * ⚠️ 这个文件里有**两份**分组，它们回答的不是同一个问题，别合并：
 *
 *  1. `questionMeaningKeyOf` / `questionMeaningPeers` —— 按 **promptMeaning**
 *     （首义 + 8 字截断）分组。回答的是「这两个词的意思近到会互相干扰吗」，
 *     排片的干扰隔离用它（interference.ts）。宽是故意的：準備「准备」和
 *     備える「准备；具备」显示的不是同一行，但连着出仍然会打架。
 *
 *  2. `displayedPromptKeyOf` / `displayedPromptPeers` —— 按 **questionMeaning**
 *     （学习页真正渲染的那一行）分组。回答的是「题面这行字在问哪个词」，
 *     只有一字不差才算。给拍数消歧、撞车面板、改写题面入口用。
 *
 * 实测用户库 11,056 个词：口径 1 有 2,264 个词（20.5%）撞车，口径 2 只有
 * 745 个（6.7%），交集 721。差出来的 1,543 个是 経済「经济」/ economy
 * 「经济；经济舱」这种 —— 会干扰，但用户一眼能看出题面不一样。
 * **对着这批词说「你们共用同一行题面」是假话**，所以面板必须走口径 2。
 */
interface QuestionMeaningIndex {
  /** wordId → 题面首义 */
  keyByWord: Map<number, string>;
  /** 题面首义 → 同题面的全部 wordId（只保留 ≥2 个成员的，单独一个不算撞车） */
  wordsByKey: Map<string, number[]>;
}

let cached: QuestionMeaningIndex | null = null;

export const resetQuestionMeaningIndex = (): void => {
  cached = null;
  displayedCached = null;
};

const buildIndex = (): QuestionMeaningIndex => {
  const keyByWord = new Map<number, string>();
  const wordsByKey = new Map<string, number[]>();

  rowsFor("SELECT id, kanji, kana, meaning FROM words").forEach((row) => {
    const id = Number(row.id ?? 0);
    if (!id) return;
    // 和 rowObjectToCard 里的 label 口径一致：kanji 缺省时退回 kana。
    const label = String(row.kanji || row.kana || "");
    const key = promptMeaning(String(row.meaning ?? ""), id, label, String(row.kana ?? ""));
    if (!key) return;
    keyByWord.set(id, key);
    const peers = wordsByKey.get(key);
    if (peers) peers.push(id);
    else wordsByKey.set(key, [id]);
  });

  wordsByKey.forEach((ids, key) => {
    if (ids.length < 2) {
      wordsByKey.delete(key);
      keyByWord.delete(ids[0]);
    }
  });

  return { keyByWord, wordsByKey };
};

const index = (): QuestionMeaningIndex => {
  cached ??= buildIndex();
  return cached;
};

/**
 * 这个词的题面首义。只有和别的词撞了才返回 —— 独一份的题面不构成干扰，
 * 排片没必要为它建组。
 */
export const questionMeaningKeyOf = (wordId: number): string | undefined =>
  index().keyByWord.get(wordId);

/** 和这个词题面首义相同的其他词（不含自己） */
export const questionMeaningPeers = (wordId: number): number[] => {
  const key = index().keyByWord.get(wordId);
  if (!key) return [];
  return (index().wordsByKey.get(key) ?? []).filter((id) => id !== wordId);
};

// ---- 口径 2：题面上一字不差的那一行 ----

let displayedCached: QuestionMeaningIndex | null = null;

const buildDisplayedIndex = (): QuestionMeaningIndex => {
  const keyByWord = new Map<number, string>();
  const wordsByKey = new Map<string, number[]>();

  rowsFor("SELECT id, kanji, kana, meaning FROM words").forEach((row) => {
    const id = Number(row.id ?? 0);
    if (!id) return;
    const label = String(row.kanji || row.kana || "");
    // 学习页渲染的是 `card.questionMeaning || card.meaning`，所以空串要退回原文，
    // 否则两个释义都被清洗成空的词会被算成「共用空题面」。
    const key = questionMeaning(String(row.meaning ?? ""), label, String(row.kana ?? ""), id)
      || String(row.meaning ?? "").trim();
    if (!key) return;
    keyByWord.set(id, key);
    const peers = wordsByKey.get(key);
    if (peers) peers.push(id);
    else wordsByKey.set(key, [id]);
  });

  wordsByKey.forEach((ids, key) => {
    if (ids.length < 2) {
      wordsByKey.delete(key);
      keyByWord.delete(ids[0]);
    }
  });

  return { keyByWord, wordsByKey };
};

const displayedIndex = (): QuestionMeaningIndex => {
  displayedCached ??= buildDisplayedIndex();
  return displayedCached;
};

/** 题面上和别的词一字不差的那一行。独一份返回 undefined。 */
export const displayedPromptKeyOf = (wordId: number): string | undefined =>
  displayedIndex().keyByWord.get(wordId);

/** 题面一字不差的其他词（不含自己）。 */
export const displayedPromptPeers = (wordId: number): number[] => {
  const key = displayedIndex().keyByWord.get(wordId);
  if (!key) return [];
  return (displayedIndex().wordsByKey.get(key) ?? []).filter((id) => id !== wordId);
};
