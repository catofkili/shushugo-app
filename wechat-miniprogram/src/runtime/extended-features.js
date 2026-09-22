/*
 * 网页已有、小程序此前缺失的功能层：收藏夹 / 备考计划 / 周报 / 柚子 / 词汇量 / 成就。
 *
 * ⚠️ 这里不再实现任何算法。判据、表结构、账本规则全部来自 src/shared/web.js ——
 * 那是 frontend/src/lib 同一份源码打出来的（scripts/build-shared.mjs）。这些表全是跨端
 * 同步的，小程序自己写一版「差不多」的结果就是网页看到一批口径不同的行
 * （曾经：achievement_unlocked vs achievements、词汇量没有猜测修正、周报 content_json
 * 是另一种形状）。本文件只做两件事：把 grammar_points 的数字 id 和网页的字符串 id
 * 互相换算，以及在小程序没有同步触发器的情况下手工补墓碑。
 */
const web = require('../shared/web');
const core = require('../core/study-core');
const grammarIds = require('../data/grammar_ids');

function databaseStore() { return require('./database-store'); }
function db() {
  const value = databaseStore().getDatabase();
  core.ensureStudySchema(value);
  return value;
}
function save() { return databaseStore().saveDatabase(); }

/* ---------------- 语法 id 换算：grammar_points.id (= bookOrder) ↔ grammar.ts 的字符串 id ---------------- */

const grammarIdByNumber = new Map(Object.entries(grammarIds).map(([number, id]) => [Number(number), String(id)]));
const grammarNumberById = new Map(Object.entries(grammarIds).map(([number, id]) => [String(id), Number(number)]));
const grammarStringId = (numericId) => grammarIdByNumber.get(Number(numericId)) || String(numericId);
const grammarNumericId = (stringId) => grammarNumberById.get(String(stringId)) ?? (/^\d+$/.test(String(stringId)) ? Number(stringId) : null);

/* ---------------- 收藏 ---------------- */

// 和网页 sync 触发器的 row_key 同一个分隔符（char(31)）
const tombstoneKey = (type, id) => `${type}\u001f${id}`;

/**
 * 网页那边删收藏由同步触发器留墓碑；小程序没有触发器，删完自己补一条，
 * 否则对端下一代快照会把这条收藏复活。加回来时把墓碑撤掉。
 */
function noteFavoriteTombstone(database, type, id, deleted) {
  const key = tombstoneKey(type, id);
  if (deleted) {
    database.run("INSERT OR REPLACE INTO sync_tombstones (entity, natural_key, deleted_at) VALUES ('content_favorites', ?, ?)", [key, new Date().toISOString()]);
  } else {
    database.run("DELETE FROM sync_tombstones WHERE entity = 'content_favorites' AND natural_key = ?", [key]);
  }
}

/**
 * 小程序没有网页那套「业务列变了就盖 sync_updated_at」的触发器，而 content_favorites /
 * favorite_folders 是 lww 合并：不盖时间戳，本机刚移的夹子会被对端一份旧的覆盖回去。
 * 所以每次写完自己盖一次。
 */
function stampFavorite(database, type, id) {
  database.run('UPDATE content_favorites SET sync_updated_at = ? WHERE item_type = ? AND item_id = ?', [new Date().toISOString(), type, id]);
}
function stampFolderRows(database, folder) {
  const now = new Date().toISOString();
  database.run('UPDATE favorite_folders SET sync_updated_at = ? WHERE name = ?', [now, folder]);
  database.run('UPDATE content_favorites SET sync_updated_at = ? WHERE folder = ?', [now, folder]);
}
function noteFolderTombstone(database, name, deleted) {
  if (deleted) database.run("INSERT OR REPLACE INTO sync_tombstones (entity, natural_key, deleted_at) VALUES ('favorite_folders', ?, ?)", [name, new Date().toISOString()]);
  else database.run("DELETE FROM sync_tombstones WHERE entity = 'favorite_folders' AND natural_key = ?", [name]);
}

async function toggleFavorite(type, id, folder = web.favorites.UNFILED_FOLDER) {
  const database = db();
  const itemId = type === 'grammar' ? grammarStringId(id) : String(Number(id));
  const { isFavorite } = web.favorites.toggleFavorite(type, itemId, folder);
  noteFavoriteTombstone(database, type, itemId, !isFavorite);
  if (isFavorite) stampFavorite(database, type, itemId);
  await save();
  return isFavorite;
}

function isFavorite(type, id) {
  const itemId = type === 'grammar' ? grammarStringId(id) : String(Number(id));
  return Boolean(core.firstValue(db(), 'SELECT 1 FROM content_favorites WHERE item_type = ? AND item_id = ? LIMIT 1', [type, itemId], 0));
}

/** 已收藏的语法数字 id 集合，给语法列表打星用（列表 SQL 里换算不了字符串 id）。 */
function favoriteGrammarNumericIds(database = db()) {
  const out = new Set();
  core.ensureFeatureSchema(database);
  for (const row of core.rowsFor(database, "SELECT item_id FROM content_favorites WHERE item_type = 'grammar'")) {
    const numeric = grammarNumericId(row.item_id);
    if (numeric != null) out.add(numeric);
  }
  return out;
}

function listFavoriteFolders() { db(); return web.favorites.listFavoriteFolders(); }
function unfiledFavoriteCount() { db(); return web.favorites.unfiledFavoriteCount(); }
function lastFavoriteFolder() { db(); return web.favorites.lastFavoriteFolder(); }

/** folder: 'all' = 不筛；'' = 未分类；其它 = 夹名。语法行用本地 grammar_points 补标题。 */
function listFavorites(type = 'all', folder = 'all') {
  const database = db();
  const items = web.favorites.getFavoriteItems(type, folder === 'all' ? undefined : String(folder));
  return items.map((item) => {
    if (item.type !== 'grammar' || item.title) return { ...item, key: `${item.type}:${item.id}` };
    const numeric = grammarNumericId(item.id);
    const row = numeric == null ? null : core.rowsFor(database, `
      SELECT g.pattern, g.prompt, g.meaning, g.level,
        (SELECT COUNT(*) FROM grammar_points same_level WHERE same_level.level = g.level AND same_level.sort_order <= g.sort_order) AS level_ordinal
      FROM grammar_points g WHERE g.id = ?
    `, [numeric])[0];
    if (!row) return { ...item, title: item.id, key: `${item.type}:${item.id}` };
    return {
      ...item,
      title: String(row.prompt || row.pattern || ''),
      subtitle: String(row.meaning || ''),
      meta: `${String(row.level || '')} · ${String(Number(row.level_ordinal || 0)).padStart(3, '0')}`,
      key: `${item.type}:${item.id}`
    };
  });
}

async function createFavoriteFolder(name) {
  const database = db();
  const clean = web.favorites.createFavoriteFolder(name);
  if (clean) { noteFolderTombstone(database, clean, false); stampFolderRows(database, clean); await save(); }
  return clean;
}
async function renameFavoriteFolder(from, to) {
  const database = db();
  const clean = web.favorites.renameFavoriteFolder(from, to);
  if (clean && clean !== from) {
    noteFolderTombstone(database, from, true);
    noteFolderTombstone(database, clean, false);
    stampFolderRows(database, clean);
    await save();
  }
  return clean;
}
async function deleteFavoriteFolder(name) {
  const database = db();
  // 里面的收藏回到未分类，这也是一次改动，先记下是哪些行再盖时间戳
  const moved = core.rowsFor(database, 'SELECT item_type, item_id FROM content_favorites WHERE folder = ?', [name]);
  web.favorites.deleteFavoriteFolder(name);
  noteFolderTombstone(database, name, true);
  for (const row of moved) stampFavorite(database, String(row.item_type), String(row.item_id));
  await save();
}
async function moveFavorite(type, id, folder = '') {
  const database = db();
  web.favorites.setFavoriteFolder(type, String(id), String(folder));
  stampFavorite(database, type, String(id));
  await save();
}

/* ---------------- 备考计划：状态在 studyPreferences（wx 存储，键名同网页） ---------------- */

function jlptPlanStatus(now = new Date()) { db(); return web.jlptStatus.getJlptPlanStatus(now); }
function jlptPreferences() { return web.preferences.getJlptPlanPreferences(); }
function saveJlptPreferences(patch) {
  const current = web.preferences.getStudyPreferences();
  return web.preferences.saveStudyPreferences({ ...current, ...patch });
}

/* ---------------- 周报 ---------------- */

function weeklyReport(offset = 0, now = new Date()) {
  db();
  const snapshot = web.weeklyReports.generateWeeklyReport('local', offset, now);
  return snapshot ? snapshot.report : null;
}
function listWeeklyReports() { db(); return web.weeklyReports.listWeeklyReports(); }
async function markWeeklyReportRead(weekStart) { db(); const changed = web.weeklyReports.markWeeklyReportRead(weekStart); if (changed) await save(); return changed; }

/* ---------------- 柚子 ---------------- */

async function settleYuzu() { db(); const earned = web.yuzu.settleYuzu(); if (earned) await save(); return earned; }
function yuzuBalance() { db(); return web.yuzu.yuzuBalance(); }
function yuzuShop() {
  db();
  const balance = web.yuzu.yuzuBalance();
  return {
    balance,
    repairPrice: web.yuzu.repairPrice(),
    repairableDays: web.yuzu.repairableDays(),
    items: web.yuzuCatalog.YUZU_ITEMS.map((item) => ({
      ...item,
      categoryLabel: web.yuzuCatalog.CATEGORY_LABEL[item.category],
      owned: web.yuzu.ownsItem(item.id),
      equipped: web.yuzuCatalog.EQUIPPABLE.has(item.category) && web.yuzu.equippedItem(item.category) === item.id,
      equippable: web.yuzuCatalog.EQUIPPABLE.has(item.category),
      canBuy: !item.soon && balance >= item.price
    }))
  };
}
async function buyYuzuItem(id) { db(); const ok = web.yuzu.buyItem(id); if (ok) await save(); return ok; }
async function equipYuzuItem(id) { db(); web.yuzu.equipItem(id); await save(); }
async function repairYuzuDay(day) { db(); const ok = web.yuzu.repairDay(day); if (ok) await save(); return ok; }
function equippedYuzu(category) { db(); return web.yuzu.equippedItem(category); }

/* ---------------- 词汇量 ---------------- */

const vocabTest = {
  ...web.vocabTest,
  start: () => { db(); return web.vocabTest.startVocabTest(); },
  session: () => { db(); return web.vocabTest.getVocabTestSession(); },
  submit: (state, selected, responseMs) => { db(); return web.vocabTest.submitVocabTestAnswer(state, selected, responseMs); },
  finish: async () => { db(); const session = web.vocabTest.finishVocabTest(); web.vocabTest.recordVocabTestRun(session); await save(); return session; },
  clear: async () => { db(); web.vocabTest.clearVocabTestSession(); await save(); },
  result: (session) => web.vocabTest.getVocabTestResult(session),
  history: (limit) => { db(); return web.vocabTest.getVocabTestHistory(limit); }
};

/* ---------------- 成就 ---------------- */

function achievementBoard() { db(); return web.achievements.achievementBoard(); }
function achievementSummary() { db(); return web.achievements.achievementSummary(); }
async function evaluateAchievements() { db(); const unlocked = web.achievements.evaluateAchievements(); if (unlocked.length) await save(); return unlocked; }

module.exports = {
  web,
  grammarStringId,
  grammarNumericId,
  toggleFavorite,
  isFavorite,
  favoriteGrammarNumericIds,
  listFavoriteFolders,
  unfiledFavoriteCount,
  lastFavoriteFolder,
  listFavorites,
  createFavoriteFolder,
  renameFavoriteFolder,
  deleteFavoriteFolder,
  moveFavorite,
  jlptPlanStatus,
  jlptPreferences,
  saveJlptPreferences,
  weeklyReport,
  listWeeklyReports,
  markWeeklyReportRead,
  settleYuzu,
  yuzuBalance,
  yuzuShop,
  buyYuzuItem,
  equipYuzuItem,
  repairYuzuDay,
  equippedYuzu,
  vocabTest,
  achievementBoard,
  achievementSummary,
  evaluateAchievements
};
