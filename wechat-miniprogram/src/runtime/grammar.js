const core = require('../core/study-core');

function databaseStore() {
  return require('./database-store');
}

/*
 * 建表在 core 里(和 iOS 的 grammar_progress 逐列对齐,见 GRAMMAR_PROGRESS_COLUMNS)。
 * 这里只做转发,别再写第二份轻量表结构 —— 少一列就会在下一次推快照时把 iOS
 * 那一列从云端抹掉。
 */
const ensureGrammarSchema = core.ensureGrammarSchema;

/*
 * grammar_state 只保留语法运行时偏好；收藏和网页/App 共用 content_favorites。
 */
function grammarState(db, key, fallback = '') {
  return String(core.firstValue(db, 'SELECT value FROM grammar_state WHERE key = ?', [key], fallback) ?? fallback);
}

function setGrammarState(db, key, value) {
  db.run('INSERT OR REPLACE INTO grammar_state (key, value) VALUES (?, ?)', [key, String(value)]);
}

function migrateFavoritesFromAppState(db) {
  core.ensureFeatureSchema(db);
  const { grammarStringId } = require('./extended-features');
  // 0.1.0 开发版把语法收藏写成 grammar_state/app_state 的 favorite:<数字id>，
  // 网页用的是 grammar.ts 的字符串 id（pdf-n5-041-2）—— 搬进 content_favorites 时换算过去。
  for (const table of ['app_state', 'grammar_state']) {
    const stale = core.rowsFor(db, `SELECT key FROM ${table} WHERE key GLOB 'favorite:[0-9]*' AND value = '1'`);
    for (const row of stale) {
      const id = String(row.key).slice('favorite:'.length);
      if (/^\d+$/.test(id)) db.run("INSERT OR IGNORE INTO content_favorites (item_type, item_id) VALUES ('grammar', ?)", [grammarStringId(id)]);
    }
    db.run(`DELETE FROM ${table} WHERE key GLOB 'favorite:[0-9]*'`);
  }
}

function grammarRows(db, query = '', level = '', limit = 80) {
  core.ensureFeatureSchema(db);
  const text = String(query || '').trim();
  const params = [];
  const where = [];
  if (text) {
    where.push('(pattern LIKE ? OR meaning LIKE ? OR prompt LIKE ? OR example_jp LIKE ?)');
    const like = `%${text}%`;
    params.push(like, like, like, like);
  }
  if (/^N[1-5]$/.test(level)) {
    where.push('level = ?');
    params.push(level);
  }
  params.push(Math.min(Math.max(Number(limit) || 80, 1), 200));
  const rows = core.rowsFor(db, `
    SELECT g.id, g.pattern, g.meaning, g.prompt, g.formation,
           g.example_jp, g.example_meaning, g.example_furigana,
           g.notes, g.confusions, g.level, g.sort_order,
           COALESCE(p.seen_count, 0) AS seen_count,
           COALESCE(p.known_forever, 0) AS known_forever
    FROM grammar_points g
    LEFT JOIN grammar_progress p ON p.grammar_id = g.id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY CASE g.level WHEN 'N5' THEN 1 WHEN 'N4' THEN 2 WHEN 'N3' THEN 3 WHEN 'N2' THEN 4 WHEN 'N1' THEN 5 ELSE 6 END,
             g.sort_order ASC, g.id ASC
    LIMIT ?
  `, params);
  // 收藏存的是网页的字符串 id，SQL 里换算不了，查完在 JS 里打星。
  const favorites = require('./extended-features').favoriteGrammarNumericIds(db);
  return rows.map((row) => ({ ...row, favorite: favorites.has(Number(row.id)) ? 1 : 0 }));
}

function searchGrammar(query, options = {}) {
  const { getDatabase } = databaseStore();
  const db = getDatabase();
  ensureGrammarSchema(db);
  migrateFavoritesFromAppState(db);
  return grammarRows(db, query, options.level, options.limit);
}

async function markGrammar(grammarId, known = true) {
  const { getDatabase, saveDatabase } = databaseStore();
  const db = getDatabase();
  ensureGrammarSchema(db);
  const id = Number(grammarId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('语法编号无效');
  const day = core.localStudyDay(new Date());
  db.run(`INSERT OR IGNORE INTO grammar_progress (grammar_id) VALUES (?)`, [id]);
  db.run(`UPDATE grammar_progress SET seen_count = seen_count + 1, known_forever = ?, last_seen_on = ? WHERE grammar_id = ?`, [known ? 1 : 0, day, id]);
  await saveDatabase();
  return { grammarId: id, known };
}

// 收藏走网页同一份 favorites-api（字符串 id 由 extended-features 换算，墓碑也在那边补）。
function toggleGrammarFavorite(grammarId) {
  migrateFavoritesFromAppState(databaseStore().getDatabase());
  return require('./extended-features').toggleFavorite('grammar', grammarId);
}

function grammarSummary() {
  const { getDatabase } = databaseStore();
  const db = getDatabase();
  ensureGrammarSchema(db);
  return core.rowsFor(db, `
    SELECT g.level, COUNT(*) AS total,
           SUM(CASE WHEN COALESCE(p.known_forever, 0) = 1 THEN 1 ELSE 0 END) AS learned
    FROM grammar_points g LEFT JOIN grammar_progress p ON p.grammar_id = g.id
    GROUP BY g.level
    ORDER BY g.level
  `);
}

module.exports = {
  ensureGrammarSchema,
  grammarRows,
  grammarState,
  grammarSummary,
  markGrammar,
  migrateFavoritesFromAppState,
  searchGrammar,
  setGrammarState,
  toggleGrammarFavorite
};
