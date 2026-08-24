/*
 * 表记判定 —— 和 iOS 端 `frontend/src/lib/orthography.ts` 是同一份口径、同一份数据。
 *
 * 数据文件 `src/data/kanji_orthography.json` 由 `frontend/scripts/audit-kanji-orthography.mjs`
 * 从 JMdict 生成，人工判定写在 `frontend/scripts/kanji-orthography-manual-review.json`。
 * 这里只是把它拷进小程序包（19 KB），**不要在这一侧手改**：
 * `npm run check` 会比对两份文件，不一致直接报错。
 *
 * 三件事：
 *   1. 卡面显示哪个词形（外来語行的 kanji 存的是词源 camera / apartment house，要退回假名）
 *   2. 这个词该不该出「汉字读音」卡（现代日语里本来就写假名的词不出）
 *   3. 出的话拿哪个表记去遮读音
 */

const payload = require('../data/kanji_orthography.json');

const entries = payload.entries || {};
const CJK = /[㐀-鿿]/;
const LATIN = /[A-Za-z]/;
const KATAKANA = /[゠-ヿ]/;

function cleanWordSurface(surface) {
  const text = String(surface || '');
  return text.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, '') || text;
}

function isLoanwordSourceSurface(word) {
  return LATIN.test(String(word.kanji || '')) && KATAKANA.test(String(word.kana || ''));
}

function orthographyEntry(word) {
  return entries[`${String(word.kanji || '')}|${String(word.kana || '')}`] || null;
}

/** 经典卡和词库首先展示现代日语里更自然的主表记。 */
function preferredWordSurface(word) {
  if (isLoanwordSourceSurface(word)) return String(word.kana || '');
  const entry = orthographyEntry(word);
  return (entry && entry.preferredSurface)
    || cleanWordSurface(word.kanji)
    || String(word.kana || '');
}

/** 汉字读音题真正拿来遮读音的表记。 */
function kanjiReadingSurface(word) {
  const entry = orthographyEntry(word);
  if (entry && entry.band === 'alternate') return entry.preferredSurface;
  return cleanWordSurface(word.kanji);
}

/** 强假名词和外来語永不出汉字读音卡；低优先级的仍可练，只是排队尾。 */
function shouldStudyKanjiReading(word) {
  if (isLoanwordSourceSurface(word)) return false;
  const entry = orthographyEntry(word);
  if (entry && entry.band === 'kana') return false;
  const surface = kanjiReadingSurface(word);
  return surface !== String(word.kana || '') && CJK.test(surface);
}

/** 只影响汉字方向内部的排序，不参与 FSRS 难度或到期时间计算。 */
function kanjiReadingPriorityAdjustment(word) {
  const entry = orthographyEntry(word);
  return entry && entry.band === 'low' ? -30 : 0;
}

/**
 * 揭晓前的读音占位：汉字对应的那几拍不进 DOM，送り仮名/片假名照常露出。
 * 小程序没有 furigana 切分数据，所以这里按「表记里的汉字段」粗切：
 * 连续汉字 → 一个方块，其余字符原样。够用，因为要遮的就是汉字那几段。
 */
function concealedReadingParts(word) {
  const surface = kanjiReadingSurface(word);
  const parts = [];
  let buffer = '';
  for (const char of surface) {
    if (CJK.test(char)) {
      if (buffer) { parts.push({ text: buffer, hidden: false }); buffer = ''; }
      if (!parts.length || !parts[parts.length - 1].hidden) parts.push({ text: '', hidden: true });
    } else {
      buffer += char;
    }
  }
  if (buffer) parts.push({ text: buffer, hidden: false });
  return parts.length ? parts : [{ text: '', hidden: true }];
}

module.exports = {
  cleanWordSurface,
  concealedReadingParts,
  isLoanwordSourceSurface,
  kanjiReadingPriorityAdjustment,
  kanjiReadingSurface,
  orthographyEntry,
  preferredWordSurface,
  shouldStudyKanjiReading
};
