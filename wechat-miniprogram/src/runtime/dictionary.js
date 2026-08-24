function lookupDictionary(db, kanji, kana, limit = 6) {
  try {
    const result = db.exec(`
      SELECT entry_key, headword, kana, meaning, pos, category, usage_note,
             example_jp, example_meaning, source_name
      FROM dictionary_entries
      WHERE headword IN (?, ?) OR kana = ?
      ORDER BY priority DESC, headword ASC
      LIMIT ?
    `, [String(kanji || ''), String(kana || ''), String(kana || ''), Math.min(Math.max(Number(limit) || 6, 1), 20)]);
    const first = result[0];
    return first ? first.values.map((values) => Object.fromEntries(first.columns.map((column, index) => [column, values[index]]))) : [];
  } catch {
    return [];
  }
}

module.exports = { lookupDictionary };
