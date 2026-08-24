import payload from "../data/kanji_orthography.json";

export type OrthographyBand = "kana" | "low" | "alternate";

interface OrthographyEntry {
  band: OrthographyBand;
  score: number;
  preferredSurface: string;
}

interface WordSurface {
  kanji: string;
  kana: string;
}

const entries = (payload as { entries: Record<string, OrthographyEntry> }).entries;
const cjkPattern = /[\u3400-\u9fff]/u;

export const cleanWordSurface = (surface: string): string =>
  surface.replace(/\[[^\]]*\]/g, "").replace(/\s+/g, "") || surface;

export const isLoanwordSourceSurface = ({ kanji, kana }: WordSurface): boolean =>
  /[A-Za-z]/.test(kanji) && /[\u30a0-\u30ff]/u.test(kana);

export const orthographyEntry = ({ kanji, kana }: WordSurface): OrthographyEntry | null =>
  entries[`${kanji}|${kana}`] ?? null;

/** 经典卡和词库首先展示现代日语里更自然的主表记。 */
export const preferredWordSurface = (word: WordSurface): string => {
  if (isLoanwordSourceSurface(word)) return word.kana;
  return orthographyEntry(word)?.preferredSurface || cleanWordSurface(word.kanji) || word.kana;
};

/** 汉字读音题真正拿来遮读音的表记。低优先级词仍可练，但不改变它的汉字题面。 */
export const kanjiReadingSurface = (word: WordSurface): string => {
  const entry = orthographyEntry(word);
  if (entry?.band === "alternate") return entry.preferredSurface;
  return cleanWordSurface(word.kanji);
};

/** 强假名词和英文词源永不生成汉字卡；低优先级与标准异体修正仍可排在队尾学习。 */
export const shouldStudyKanjiReading = (word: WordSurface): boolean => {
  if (isLoanwordSourceSurface(word)) return false;
  const entry = orthographyEntry(word);
  if (entry?.band === "kana") return false;
  const surface = kanjiReadingSurface(word);
  return surface !== word.kana && cjkPattern.test(surface);
};

/** 只影响汉字方向内部的排片，不参与 FSRS 难度或到期时间计算。 */
export const kanjiReadingPriorityAdjustment = (word: WordSurface): number =>
  orthographyEntry(word)?.band === "low" ? -30 : 0;
