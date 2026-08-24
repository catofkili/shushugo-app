const { openAndValidate } = require('./sqlite');
const core = require('../core/study-core');

const CONTENT_VERSION_KEY = 'content_version';
const CONTENT_PROTOCOL_VERSION = 'content-merge-v1';

function wordKey(kanji, kana) {
  return `${String(kanji)}\u0000${String(kana)}`;
}

function readContentRows(db) {
  return core.rowsFor(db, `
    SELECT kanji, kana, meaning, pos, verb_type, importance, shuffle_rank,
           example_jp, example_meaning, example_furigana, example_tokens,
           example_lemmas, jlpt_level
    FROM words
    ORDER BY id ASC
  `);
}

function mergeContentDatabase(target, source, version) {
  core.ensureStudySchema(target);
  core.ensureStudySchema(source);
  const existing = new Map(
    core.rowsFor(target, 'SELECT id, kanji, kana FROM words')
      .map((row) => [wordKey(row.kanji, row.kana), Number(row.id)])
  );
  const rows = readContentRows(source);
  let updated = 0;
  let inserted = 0;
  target.run('BEGIN TRANSACTION');
  try {
    for (const row of rows) {
      const id = existing.get(wordKey(row.kanji, row.kana));
      if (id) {
        target.run(`
          UPDATE words SET meaning = ?, pos = ?, verb_type = ?, importance = ?, shuffle_rank = ?,
            example_jp = ?, example_meaning = ?, example_furigana = ?, example_tokens = ?,
            example_lemmas = ?, jlpt_level = ?
          WHERE id = ?
        `, [
          row.meaning, row.pos, row.verb_type, row.importance, row.shuffle_rank,
          row.example_jp, row.example_meaning, row.example_furigana || '',
          row.example_tokens || '', row.example_lemmas || '', row.jlpt_level, id
        ]);
        updated += 1;
      } else {
        target.run(`
          INSERT INTO words (
            meaning, kana, kanji, pos, verb_type, importance, shuffle_rank,
            example_jp, example_meaning, example_furigana, example_tokens,
            example_lemmas, jlpt_level
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          row.meaning, row.kana, row.kanji, row.pos, row.verb_type, row.importance,
          row.shuffle_rank, row.example_jp, row.example_meaning, row.example_furigana || '',
          row.example_tokens || '', row.example_lemmas || '', row.jlpt_level
        ]);
        const newId = Number(core.firstValue(target, 'SELECT last_insert_rowid()', [], 0));
        target.run('INSERT OR IGNORE INTO progress (word_id) VALUES (?)', [newId]);
        inserted += 1;
      }
    }
    core.setState(target, CONTENT_VERSION_KEY, version);
    core.setState(target, 'content_protocol_version', CONTENT_PROTOCOL_VERSION);
    target.run('COMMIT');
  } catch (error) {
    target.run('ROLLBACK');
    throw error;
  }
  return { version, sourceWords: rows.length, updated, inserted };
}

async function mergeContentBytes(bytes, version) {
  if (!version) throw new Error('内容更新缺少版本号');
  const { getDatabase, saveDatabase } = require('./database-store');
  const target = getDatabase();
  const source = await openAndValidate(bytes);
  try {
    const result = mergeContentDatabase(target, source, version);
    await saveDatabase();
    return result;
  } finally {
    source.close();
  }
}

function currentContentVersion() {
  const { getDatabase } = require('./database-store');
  return core.getState(getDatabase(), CONTENT_VERSION_KEY, 'seed');
}

async function fetchContentManifest() {
  const config = require('../config');
  const { requestJson } = require('./wx-promise');
  if (!config.contentManifestUrl) throw new Error('没有配置 contentManifestUrl');
  const manifest = await requestJson(config.contentManifestUrl);
  if (!manifest || typeof manifest.version !== 'string' || !manifest.databaseUrl) {
    throw new Error('内容 manifest 缺少 version/databaseUrl');
  }
  if (manifest.expectedWords != null && Number(manifest.expectedWords) <= 0) {
    throw new Error('内容 manifest 的 expectedWords 无效');
  }
  return manifest;
}

async function downloadContentBytes(manifest) {
  const { downloadFile, readFile, removeFile } = require('./wx-promise');
  const tempPath = await downloadFile(manifest.databaseUrl);
  try {
    const bytes = await readFile(tempPath);
    if (manifest.expectedBytes != null && bytes.byteLength !== Number(manifest.expectedBytes)) {
      throw new Error(`内容包大小不符：${bytes.byteLength} != ${manifest.expectedBytes}`);
    }
    return bytes;
  } finally {
    await removeFile(tempPath).catch(() => undefined);
  }
}

async function updateFromManifest() {
  const manifest = await fetchContentManifest();
  const current = currentContentVersion();
  if (manifest.version === current) return { updated: false, version: current };
  const bytes = await downloadContentBytes(manifest);
  const candidate = await openAndValidate(bytes);
  try {
    const words = Number(core.firstValue(candidate, 'SELECT COUNT(*) FROM words', [], 0));
    if (manifest.expectedWords != null && words !== Number(manifest.expectedWords)) {
      throw new Error(`内容词条数不符：${words} != ${manifest.expectedWords}`);
    }
  } finally {
    candidate.close();
  }
  const result = await mergeContentBytes(bytes, manifest.version);
  return { updated: true, ...result };
}

module.exports = {
  CONTENT_PROTOCOL_VERSION,
  CONTENT_VERSION_KEY,
  currentContentVersion,
  fetchContentManifest,
  downloadContentBytes,
  updateFromManifest,
  mergeContentDatabase,
  mergeContentBytes,
  readContentRows,
  wordKey
};
