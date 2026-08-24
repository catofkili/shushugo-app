const core = require('../core/study-core');

function databaseStore() {
  return require('./database-store');
}

function ensureGrammarSchema(db) {
  db.run(`
    CREATE TABLE IF NOT EXISTS grammar_progress (
      grammar_id INTEGER PRIMARY KEY,
      score REAL NOT NULL DEFAULT 0,
      seen_count INTEGER NOT NULL DEFAULT 0,
      known_forever INTEGER NOT NULL DEFAULT 0,
      last_seen_on TEXT
    )
  `);
  db.run(`CREATE TABLE IF NOT EXISTS grammar_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
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
  const key = `favorite:${Number(grammarId)}`;
  const current = core.getState(db, key, '0') === '1';
  core.setState(db, key, current ? '0' : '1');
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

module.exports = { ensureGrammarSchema, grammarRows, grammarSummary, markGrammar, searchGrammar, toggleGrammarFavorite };
