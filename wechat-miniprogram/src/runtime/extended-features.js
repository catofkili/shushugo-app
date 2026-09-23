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

/*
 * 小程序现在和网页一样装了同步触发器（core/study-core 的 ensureStudySchema →
 * web.syncSchema.ensureSyncSchema），所以 sync_updated_at 的盖章和删除墓碑都由触发器写，
 * **这里不要再手工补**。手工补过一版：容易漏（夹子改名、删夹子把收藏挪回未分类那两条就漏了），
 * 漏掉的那些在对端下一次合并时会被旧行盖回来。
 */
async function toggleFavorite(type, id, folder = web.favorites.UNFILED_FOLDER) {
  const database = db();
  const itemId = type === 'grammar' ? grammarStringId(id) : String(Number(id));
  const result = core.withDb(database, () => web.favorites.toggleFavorite(type, itemId, folder));
  await save();
  return result.isFavorite;
}

function isFavorite(type, id) {
  const database = db();
  const itemId = type === 'grammar' ? grammarStringId(id) : String(Number(id));
  return core.withDb(database, () => web.studyCore.isFavorite(type, itemId));
}

/** 已收藏的语法数字 id 集合，给语法列表打星用（列表 SQL 里换算不了字符串 id）。 */
function favoriteGrammarNumericIds(database = db()) {
  const out = new Set();
  for (const row of core.rowsFor(database, "SELECT item_id FROM content_favorites WHERE item_type = 'grammar'")) {
    const numeric = grammarNumericId(row.item_id);
    if (numeric != null) out.add(numeric);
  }
  return out;
}

const run = (task) => core.withDb(db(), task);

function listFavoriteFolders() { return run(() => web.favorites.listFavoriteFolders()); }
function unfiledFavoriteCount() { return run(() => web.favorites.unfiledFavoriteCount()); }
function lastFavoriteFolder() { return run(() => web.favorites.lastFavoriteFolder()); }

/** folder: 'all' = 不筛；'' = 未分类；其它 = 夹名。语法行用本地 grammar_points 补标题。 */
function listFavorites(type = 'all', folder = 'all') {
  const database = db();
  const items = core.withDb(database, () => web.favorites.getFavoriteItems(type, folder === 'all' ? undefined : String(folder)));
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

async function createFavoriteFolder(name) { const clean = run(() => web.favorites.createFavoriteFolder(name)); if (clean) await save(); return clean; }
async function renameFavoriteFolder(from, to) { const clean = run(() => web.favorites.renameFavoriteFolder(from, to)); if (clean && clean !== from) await save(); return clean; }
async function deleteFavoriteFolder(name) { run(() => web.favorites.deleteFavoriteFolder(name)); await save(); }
async function moveFavorite(type, id, folder = '') { run(() => web.favorites.setFavoriteFolder(type, String(id), String(folder))); await save(); }

/* ---------------- 备考计划：状态在 studyPreferences（wx 存储，键名同网页） ---------------- */

function jlptPlanStatus(now = new Date()) { return run(() => web.jlptStatus.getJlptPlanStatus(now)); }
function jlptPreferences() { return web.preferences.getJlptPlanPreferences(); }
function saveJlptPreferences(patch) {
  const current = web.preferences.getStudyPreferences();
  return web.preferences.saveStudyPreferences({ ...current, ...patch });
}

/* ---------------- 周报 ---------------- */

function weeklyReport(offset = 0, now = new Date()) {
  const snapshot = run(() => web.weeklyReports.generateWeeklyReport('local', offset, now));
  return snapshot ? snapshot.report : null;
}
function listWeeklyReports() { return run(() => web.weeklyReports.listWeeklyReports()); }
async function markWeeklyReportRead(weekStart) { const changed = run(() => web.weeklyReports.markWeeklyReportRead(weekStart)); if (changed) await save(); return changed; }

/* ---------------- 柚子 ---------------- */

async function settleYuzu() { const earned = run(() => web.yuzu.settleYuzu()); if (earned) await save(); return earned; }
function yuzuBalance() { return run(() => web.yuzu.yuzuBalance()); }
function yuzuShop() {
  return run(() => {
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
  });
}
async function buyYuzuItem(id) { const ok = run(() => web.yuzu.buyItem(id)); if (ok) await save(); return ok; }
async function equipYuzuItem(id) { run(() => web.yuzu.equipItem(id)); await save(); }
async function repairYuzuDay(day) { const ok = run(() => web.yuzu.repairDay(day)); if (ok) await save(); return ok; }
function equippedYuzu(category) { return run(() => web.yuzu.equippedItem(category)); }

/* ---------------- 词汇量 ---------------- */

const vocabTest = {
  ...web.vocabTest,
  start: () => run(() => web.vocabTest.startVocabTest()),
  session: () => run(() => web.vocabTest.getVocabTestSession()),
  submit: (state, selected, responseMs) => run(() => web.vocabTest.submitVocabTestAnswer(state, selected, responseMs)),
  finish: async () => { const session = run(() => { const value = web.vocabTest.finishVocabTest(); web.vocabTest.recordVocabTestRun(value); return value; }); await save(); return session; },
  clear: async () => { run(() => web.vocabTest.clearVocabTestSession()); await save(); },
  result: (session) => run(() => web.vocabTest.getVocabTestResult(session)),
  history: (limit) => run(() => web.vocabTest.getVocabTestHistory(limit))
};

/* ---------------- 成就 ---------------- */

function achievementBoard() { return run(() => web.achievements.achievementBoard()); }
function achievementSummary() { return run(() => web.achievements.achievementSummary()); }
async function evaluateAchievements() { const unlocked = run(() => web.achievements.evaluateAchievements()); if (unlocked.length) await save(); return unlocked; }

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
