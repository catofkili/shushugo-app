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
 * ⚠️ 语法的开关存 grammar_state,不是 app_state。
 *
 * 老代码写用的是 core.getState/setState(那两个写的是 app_state),而列表查询
 * JOIN 的是 grammar_state —— **写进去的收藏一次都没显示出来过**,点了没反应。
 * 现在读写同一张表,并把已经写进 app_state 的那些 favorite: 值搬过来。
 */
function grammarState(db, key, fallback = '') {
  return String(core.firstValue(db, 'SELECT value FROM grammar_state WHERE key = ?', [key], fallback) ?? fallback);
}

function setGrammarState(db, key, value) {
  db.run('INSERT OR REPLACE INTO grammar_state (key, value) VALUES (?, ?)', [key, String(value)]);
}

function migrateFavoritesFromAppState(db) {
  const stale = core.rowsFor(db, "SELECT key, value FROM app_state WHERE key LIKE 'favorite:%'");
  if (!stale.length) return;
  for (const row of stale) {
    setGrammarState(db, String(row.key), String(row.value));
    db.run('DELETE FROM app_state WHERE key = ?', [String(row.key)]);
  }
}

function grammarRows(db, query = '', level = '', limit = 80) {
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
  return core.rowsFor(db, `
    SELECT g.id, g.pattern, g.meaning, g.prompt, g.formation,
           g.example_jp, g.example_meaning, g.example_furigana,
           g.notes, g.confusions, g.level, g.sort_order,
           COALESCE(p.seen_count, 0) AS seen_count,
           COALESCE(p.known_forever, 0) AS known_forever,
           CASE WHEN s.value = '1' THEN 1 ELSE 0 END AS favorite
    FROM grammar_points g
    LEFT JOIN grammar_progress p ON p.grammar_id = g.id
    LEFT JOIN grammar_state s ON s.key = ('favorite:' || g.id)
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY CASE g.level WHEN 'N5' THEN 1 WHEN 'N4' THEN 2 WHEN 'N3' THEN 3 WHEN 'N2' THEN 4 WHEN 'N1' THEN 5 ELSE 6 END,
             g.sort_order ASC, g.id ASC
    LIMIT ?
  `, params);
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

async function toggleGrammarFavorite(grammarId) {
  const { getDatabase, saveDatabase } = databaseStore();
  const db = getDatabase();
  ensureGrammarSchema(db);
  migrateFavoritesFromAppState(db);
  const key = `favorite:${Number(grammarId)}`;
  const current = grammarState(db, key, '0') === '1';
  setGrammarState(db, key, current ? '0' : '1');
  await saveDatabase();
  return !current;
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
