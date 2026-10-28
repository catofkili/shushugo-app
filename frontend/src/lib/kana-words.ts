// 五十音学到第三天起，往五十音卡里混简单单词（2026-10-28 用户：「第三天开始简单单词和假名混在一起考」）。
// 词走单词自己的 FSRS（submitQuickStudyBatch → submitWordAnswer，和背单词页同一条记账路），
// 假名走 kana_memory，两套记忆不混；只是在同一张卡上轮流出。口径见 docs/claude/daily-plans-and-study-modes.md「五十音考题」。
import { firstValue, rowsFor, today } from "./database/db-utils";
import { ensureProgressInitialized, submitQuickStudyBatch } from "./word-api";

export const KANA_WORD_START_DAY = 3;
export const KANA_WORDS_PER_DAY = 10;

export type KanaWord = { id: number; kana: string; kanji: string; meaning: string };
export type KanaWordQuestion = { word: KanaWord; choices: { label: string; correct: boolean }[] };

const firstMeaning = (meaning: string) => meaning.split(/[；;]/)[0].trim();

/** 学五十音的第几天：今天之前答过假名的天数 + 1。 */
export const kanaStudyDay = (day = today()): number =>
  firstValue<number>("SELECT COUNT(DISTINCT reviewed_on) FROM kana_reviews WHERE reviewed_on < ?", [day], 0) + 1;

/** 今天第一次见的单词有几个（不管从哪儿学的：背单词页、五十音卡都算）。 */
export const newWordsToday = (day = today()): number => firstValue<number>(
  `SELECT COUNT(DISTINCT word_id) FROM reviews WHERE reviewed_on = ?
     AND word_id NOT IN (SELECT word_id FROM reviews WHERE reviewed_on < ?)`, [day, day], 0);

/**
 * 「简单单词」= N5、读音只用已经教过的清音假名、没见过也没标「已熟知」的词，
 * 按重要度高、两拍以上的短词先出。读音里有濁点 / 小字 / ー 的不进：这些还没教。
 * ⚠️ 同音词不进（N5 里读音相同的词有好几组：ひ = 火 / 日，は = 歯 / 葉）：只看假名问意思，两个都对，
 * 10-28 浏览器里实测先教了「ひ 火」又教「ひ 日」。单拍词排在最后，大多是这种。
 */
export const simpleWords = (introduced: ReadonlySet<string>, limit = 40): KanaWord[] => {
  ensureProgressInitialized();
  return rowsFor(`SELECT w.id, w.kana, w.kanji, w.meaning FROM words w LEFT JOIN progress p ON p.word_id = w.id
    WHERE w.jlpt_level = 'N5' AND COALESCE(p.seen_count, 0) = 0 AND COALESCE(p.known_forever, 0) = 0
      AND w.kana NOT IN (SELECT kana FROM words WHERE jlpt_level = 'N5' GROUP BY kana HAVING COUNT(*) > 1)
    ORDER BY w.importance DESC, length(w.kana) < 2, length(w.kana), w.id`)
    .map((row) => ({ id: Number(row.id), kana: String(row.kana ?? ""), kanji: String(row.kanji ?? ""), meaning: firstMeaning(String(row.meaning ?? "")) }))
    .filter((word) => word.kana && word.meaning && [...word.kana].every((ch) => introduced.has(ch)))
    .slice(0, limit);
};

/** 看假名选意思。错项是别的 N5 词的第一个释义（不取同音词的，否则可能也对）。 */
export const wordMeaningQuestion = (word: KanaWord, random = Math.random): KanaWordQuestion => {
  const others = rowsFor("SELECT meaning FROM words WHERE jlpt_level = 'N5' AND id != ? AND kana != ? ORDER BY random() LIMIT 12", [word.id, word.kana])
    .map((row) => firstMeaning(String(row.meaning ?? "")))
    .filter((meaning, index, list) => meaning && meaning !== word.meaning && list.indexOf(meaning) === index)
    .slice(0, 3);
  const choices = [{ label: word.meaning, correct: true }, ...others.map((label) => ({ label, correct: false }))];
  for (let i = choices.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [choices[i], choices[j]] = [choices[j], choices[i]];
  }
  return { word, choices };
};

export const recordKanaWordAnswer = (wordId: number, correct: boolean): void => {
  submitQuickStudyBatch([{ wordId, answer: correct ? "know" : "forgot" }], "stage1");
};
