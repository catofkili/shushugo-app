let table = null;

function load() {
  if (!table) table = require('../data/pitch_accent.json').accents || {};
  return table;
}

function splitMorae(reading) {
  const morae = [];
  const small = /[ぁぃぅぇぉゃゅょゎァィゥェォャュョヮヵヶ]/;
  for (const char of String(reading || '')) {
    if (morae.length && small.test(char)) morae[morae.length - 1] += char;
    else morae.push(char);
  }
  return morae;
}

function lookupAccent(kanji, kana) {
  const entry = load()[`${kanji || kana}|${kana}`];
  if (entry === undefined) return null;
  return Array.isArray(entry) ? Number(entry[0]) : Number(entry);
}

function pitchPattern(kanji, kana) {
  const accent = lookupAccent(kanji, kana);
  if (accent === null || !Number.isFinite(accent)) return null;
  const morae = splitMorae(kana);
  return {
    accent,
    morae: morae.map((text, index) => {
      const position = index + 1;
      const high = accent === 1 ? position === 1 : position > 1 && (accent === 0 || position <= accent);
      return { text, high, drop: accent !== 0 && position === accent };
    })
  };
}

module.exports = { lookupAccent, pitchPattern, splitMorae };
