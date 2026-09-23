/*
 * 词库页的数据层 = 网页的 lib/word-library（src/shared/web.js）。
 *
 * ⚠️ 以前这里手抄了一份：记忆色阶的分档 SQL、罗马字转假名的搜索、词性收敛、排序。
 * 抄的时候是一样的，之后网页那边改了（比如「词库里未学的词不算到期」那条）
 * 小程序不会跟着改 —— 而它和网页看的是同一张 progress 表，用户会看到两套颜色。
 * 现在只剩「把 db-first 的调用惯例翻译过去」+「补一列收藏」+「WXML 要的 bandLabel」。
 */
const core = require('../core/study-core');

function databaseStore() { return require('./database-store'); }

const web = core.web;
const MEMORY_BANDS = web.wordLibrary.MEMORY_BANDS;
const POS_BUCKETS = web.wordLibrary.POS_BUCKETS;
const DEFAULT_FILTERS = web.wordLibrary.DEFAULT_LIBRARY_FILTERS;
const classifyPos = web.wordLibrary.classifyPos;

const currentDb = (db) => db || databaseStore().getDatabase();
const run = (db, task) => {
  const database = currentDb(db);
  core.ensureStudySchema(database);
  return core.withDb(database, task);
};

function normalizeFilters(filters = {}) {
  const source = { ...DEFAULT_FILTERS, ...filters };
  return {
    level: ['all', 'N5', 'N4', 'N3', 'N2', 'N1', 'unranked'].includes(source.level) ? source.level : 'all',
    band: ['all', ...MEMORY_BANDS.map((item) => item.id), 'due', 'leech'].includes(source.band) ? source.band : 'all',
    pos: ['all', ...POS_BUCKETS.map((item) => item.id)].includes(source.pos) ? source.pos : 'all',
    search: String(source.search ?? '').trim(),
    sort: ['level', 'weakest', 'recent', 'kana'].includes(source.sort) ? source.sort : 'level'
  };
}

/** 收藏是另一张表（content_favorites，和网页 / App 共用），一页一次查完再贴上。 */
function favoriteFlags(ids) {
  if (!ids.length) return new Set();
  const placeholders = ids.map(() => '?').join(',');
  return new Set(web.dbUtils.rowsFor(
    `SELECT item_id FROM content_favorites WHERE item_type = 'word' AND item_id IN (${placeholders})`,
    ids.map((id) => String(id))
  ).map((row) => Number(row.item_id)));
}

const withDisplay = (row, favorites) => ({
  ...row,
  level: row.level || '未分级',
  bandLabel: web.wordLibrary.bandMeta(row.band).label,
  favorite: favorites.has(row.id)
});

function queryWordLibraryWithDb(db, filters = {}, offset = 0, limit = 50) {
  return run(db, () => {
    const rows = web.wordLibrary.queryWordLibrary(normalizeFilters(filters), Number(offset) || 0, Math.min(Math.max(Number(limit) || 50, 1), 100));
    const favorites = favoriteFlags(rows.map((row) => row.id));
    return rows.map((row) => withDisplay(row, favorites));
  });
}

function tallyWordLibraryWithDb(db, filters = {}) {
  return run(db, () => web.wordLibrary.tallyWordLibrary(normalizeFilters(filters)));
}

function wordLibraryDetailWithDb(db, wordId) {
  return run(db, () => {
    const detail = web.wordLibrary.wordLibraryDetail(Number(wordId));
    if (!detail) return null;
    return withDisplay(detail, favoriteFlags([detail.id]));
  });
}

function libraryIdsWithDb(db, filters = {}, limit = 300) {
  return run(db, () => web.wordLibrary.wordLibraryIds(normalizeFilters(filters), Math.min(Math.max(Number(limit) || 300, 1), 300)));
}

const queryWordLibrary = (filters, offset, limit) => queryWordLibraryWithDb(null, filters, offset, limit);
const tallyWordLibrary = (filters) => tallyWordLibraryWithDb(null, filters);
const wordLibraryDetail = (wordId) => wordLibraryDetailWithDb(null, wordId);
const wordLibraryIds = (filters, limit) => libraryIdsWithDb(null, filters, limit);
const ensureLibrarySchema = (db) => core.ensureStudySchema(currentDb(db));

/** 收藏走网页同一份 favorites-api（墓碑由同步触发器写）。 */
function toggleWordFavorite(wordId) {
  return require('./extended-features').toggleFavorite('word', wordId);
}

/**
 * 「熟知」= 这个词进过队列、第一次出现就答了熟知（写一条 known_forever 流水后退出 FSRS）。
 * 判据和撤销规则都在网页的 setWordsKnownForever 里，别在这里另写一份。
 */
async function setWordsKnownForever(wordIds, known = true) {
  const ids = (Array.isArray(wordIds) ? wordIds : [wordIds]).map(Number).filter(Number.isFinite);
  const changed = run(null, () => web.wordApi.setWordsKnownForever(ids, Boolean(known)));
  await databaseStore().saveDatabase();
  return changed;
}

module.exports = {
  MEMORY_BANDS,
  POS_BUCKETS,
  DEFAULT_FILTERS,
  classifyPos,
  normalizeFilters,
  ensureLibrarySchema,
  queryWordLibraryWithDb,
  tallyWordLibraryWithDb,
  wordLibraryDetailWithDb,
  libraryIdsWithDb,
  queryWordLibrary,
  tallyWordLibrary,
  wordLibraryDetail,
  wordLibraryIds,
  toggleWordFavorite,
  setWordsKnownForever
};
