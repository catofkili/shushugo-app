/*
 * 网页的 WordCard → 小程序 WXML 要的那组字段。
 *
 * ⚠️ 这是**纯展示映射**，一条判据都不许写在这里：词形选哪一个（外来語行的 kanji 是词源）、
 * 汉字方向遮哪几拍、题面那行中文、例句振假名、音高重音、词典条目，全部取自网页的模块
 * （orthography / models/word-card / pitch-accent / token-dictionary / furigana-data）。
 * 以前小程序在自己的 study-core 里拼这些，于是同一个词在小程序和网页上显示的词形能不一样。
 */
const core = require('./../core/study-core');

const web = core.web;

/** 例句：把网页解析好的振假名标注切成 WXML 能循环的段。 */
function exampleSegments(text, annotations) {
  const sentence = String(text || '');
  if (!sentence) return [];
  const valid = (Array.isArray(annotations) ? annotations : [])
    .filter((row) => Number.isInteger(row.start) && row.length > 0 && row.start < sentence.length)
    .sort((a, b) => a.start - b.start);
  if (!valid.length) return [{ text: sentence, reading: '' }];
  const segments = [];
  let cursor = 0;
  for (const row of valid) {
    const start = Math.min(row.start, sentence.length);
    const end = Math.min(start + row.length, sentence.length);
    if (start < cursor || end <= start) continue;
    if (start > cursor) segments.push({ text: sentence.slice(cursor, start), reading: '' });
    segments.push({ text: sentence.slice(start, end), reading: String(row.reading || '') });
    cursor = end;
  }
  if (cursor < sentence.length) segments.push({ text: sentence.slice(cursor), reading: '' });
  return segments;
}

function concealFor(card, surface) {
  // 读音表（kanji_readings，分包）没加载完时 splitFurigana 返回 null，
  // concealedReadingParts 会整条隐藏 —— fail closed，绝不闪答案。
  const segments = web.furiganaSplit.kanjiReadingsLoaded()
    ? web.furiganaSplit.splitFurigana(surface, card.kana)
    : null;
  return web.wordStudyUtils.concealedReadingParts(segments);
}

function pitchOf(card) {
  if (!web.pitchAccent.pitchAccentLoaded()) return null;
  const accent = web.pitchAccent.lookupAccent(card.kanji, card.kana);
  if (accent === null) return null;
  const morae = web.pitchAccent.splitMorae(card.kana);
  return { accent, morae: web.pitchAccent.pitchPattern(morae.length, accent).map((mora, index) => ({ ...mora, text: morae[index] })) };
}

function dictionaryEntries(card) {
  try {
    return web.tokenDictionary.lookupTokenEntries(card.kanji || card.kana, card.kana, 6, '', []).map((entry) => ({
      entry_key: String(entry.id),
      headword: entry.kanji || entry.kana,
      kana: entry.kana,
      meaning: entry.meaning,
      pos: entry.pos,
      category: entry.category,
      usage_note: entry.usageNote,
      example_jp: entry.exampleJp,
      example_meaning: entry.exampleMeaning,
      source_name: entry.sourceName
    }));
  } catch {
    return [];
  }
}

/**
 * 三个方向的题面 / 答案面，口径和网页一致（也和老小程序一致）：
 *   forward 正向：题面是**中文题面层**（questionMeaning，人工审校那一层），答案是日文词形；
 *   reverse 反向：题面是日文词形（带假名），答案是中文释义；
 *   kanji   汉字读音：题面是中文 + 日文表记，只遮汉字对应的那几拍假名。
 * ⚠️ 正向题面必须用 questionMeaning 而不是 words.meaning —— 那 5,853 条人工题面
 * 就是为了把「冷却 / 冷却 / 冷却」这种分不开的释义写清楚的（见 CLAUDE.md 的释义两层）。
 */
function toView(card, { direction = 'forward', mode = '', relief = false, tail = false, taskType = '' } = {}) {
  if (!card) return null;
  const surface = direction === 'kanji' ? web.orthography.kanjiReadingSurface(card) : web.orthography.preferredWordSurface(card);
  const questionMeaning = card.questionMeaning || card.promptMeaning || card.meaning;
  const prompt = direction === 'reverse'
    ? surface + (card.kana && card.kana !== surface ? `（${card.kana}）` : '')
    : questionMeaning;
  const answerText = direction === 'reverse' ? card.meaning : surface;
  return {
    id: card.id,
    direction,
    mode,
    relief,
    tail,
    task_type: taskType,
    surface,
    prompt,
    answerText,
    kana: card.kana,
    kanji: card.kanji,
    meaning: card.meaning,
    questionMeaning,
    pos: card.pos,
    verb_type: card.verbPair ? card.verbPair.pairVoice : '',
    jlpt_level: card.jlptLevel,
    note: card.note || '',
    isFavorite: Boolean(card.isFavorite),
    example_jp: card.example ? card.example.jp : '',
    example_meaning: card.example ? card.example.meaning : '',
    exampleSegments: card.example ? exampleSegments(card.example.jp, card.example.furigana) : [],
    // 汉字读音方向的题面：只露表记里本来就是假名的部分。判据（对不齐就整条隐藏，
    // 绝不先把完整假名画出来）在网页的 word-study-utils.concealedReadingParts 里。
    concealedReading: direction === 'kanji' ? concealFor(card, surface) : null,
    wordOrigin: card.englishOrigin || '',
    pitch: pitchOf(card),
    dictionaryEntries: dictionaryEntries(card)
  };
}

module.exports = { toView, exampleSegments };
