/*
 * 疑难辨析运行时分组。
 *
 * 和 iOS 一样从本地 words 表现算：自他动词、同音、同形多读、同词根和中文
 * 首义相同都是真实分组，不把 1,907 个静态壳子硬编码进小程序。内容更新后
 * 清掉 WeakMap 缓存即可得到新分组。
 */
const core = require('../core/study-core');
const { preferredWordSurface } = require('../core/orthography');

function databaseStore() { return require('./database-store'); }

const TYPE_META = Object.freeze({
  pair: { name: '自他动词', hint: '看助词：が 多是自动词，を 多是他动词。', emoji: '🔀' },
  homophone: { name: '同音异义', hint: '读音一样，要靠语境判断汉字。', emoji: '🔊' },
  'kanji-choice': { name: '汉字用法', hint: '读音相同、汉字不同，用例句看区别。', emoji: '✍️' },
  'reading-register': { name: '读音语体', hint: '同一个写法的两种读法，正式度不同。', emoji: '🎩' },
  'reading-sense': { name: '一形多读', hint: '同一汉字写法、读音和意思不同。', emoji: '🔤' },
  stem: { name: '同词根', hint: '共用词根，比较助词和动作方向。', emoji: '🌱' },
  synonym: { name: '中文提示相同', hint: '中文相同但语体、场合可能不同。', emoji: '🤝' }
});
const TYPE_ORDER = ['pair', 'kanji-choice', 'reading-register', 'reading-sense', 'homophone', 'stem', 'synonym'];
const CJK = /[㐀-鿿]/;
const LATIN = /[A-Za-z]/;
const MAX_MEMBERS = 8;
const cache = new WeakMap();

function firstSense(meaning) { return String(meaning || '').split(/[；;，,、]/)[0].trim(); }

function loadRows(db) {
  return core.rowsFor(db, `
    SELECT id, kanji, kana, meaning, pos, verb_type, importance,
           example_jp, example_meaning, jlpt_level
    FROM words WHERE kana IS NOT NULL AND kana NOT GLOB '*[A-Za-z]*'
  `).map((row) => ({
    id: Number(row.id), kanji: String(row.kanji || ''), kana: String(row.kana || ''),
    meaning: String(row.meaning || ''), pos: String(row.pos || ''),
    verbType: String(row.verb_type || ''), importance: Number(row.importance || 0),
    exampleJp: String(row.example_jp || ''), exampleMeaning: String(row.example_meaning || ''),
    level: String(row.jlpt_level || '')
  }));
}

function displayForm(row) { return preferredWordSurface({ kanji: row.kanji, kana: row.kana }); }
function rank(row) { return (row.exampleJp ? 0 : 2) + (row.level ? 0 : 1); }

function buildGroups(db) {
  const allRows = loadRows(db);
  const by = (items, keyOf) => {
    const map = new Map();
    items.forEach((item) => { const key = keyOf(item); if (!key) return; const list = map.get(key) || []; list.push(item); map.set(key, list); });
    return map;
  };
  // 和 iOS 的 variantMerges 同一口径：重复词条在分组前全局压掉，不能只在某一组里
  // 去重，否则同一份脏数据会从 synonym 路径重新漏回来。
  const suppressed = new Set();
  by(allRows, (row) => `${row.kanji}\u0000${row.kana}`).forEach((members) => {
    if (members.length < 2) return;
    [...members].sort((a, b) => rank(a) - rank(b) || a.id - b.id).slice(1).forEach((row) => suppressed.add(row.id));
  });
  const remaining = allRows.filter((row) => !suppressed.has(row.id));
  by(remaining, (row) => `${row.kana}\u0000${firstSense(row.meaning)}`).forEach((members) => {
    if (members.length < 2) return;
    const withKanji = members.filter((row) => CJK.test(row.kanji));
    if (withKanji.length && withKanji.length < members.length) members.filter((row) => !CJK.test(row.kanji)).forEach((row) => suppressed.add(row.id));
    else if (!withKanji.length) [...members].sort((a, b) => rank(a) - rank(b) || a.id - b.id).slice(1).forEach((row) => suppressed.add(row.id));
  });
  by(remaining.filter((row) => !suppressed.has(row.id)), (row) => row.kana).forEach((members) => {
    if (members.length !== 2) return;
    const latin = members.filter((row) => LATIN.test(row.kanji));
    const bare = members.filter((row) => row.kanji === row.kana);
    if (latin.length === 1 && bare.length === 1) {
      const loser = [...members].sort((a, b) => rank(a) - rank(b) || a.id - b.id)[1];
      suppressed.add(loser.id);
    }
  });
  const rows = allRows.filter((row) => !suppressed.has(row.id));
  const groups = [];
  const add = (type, label, members) => {
    const unique = [...new Map(members.map((row) => {
      const form = type === 'reading-register' || type === 'reading-sense' ? row.kana : displayForm(row);
      return [`${form}\u0000${LATIN.test(row.kanji) ? row.kanji : ''}`, row];
    })).values()];
    if (unique.length < 2 || unique.length > MAX_MEMBERS) return;
    groups.push({
      key: `${type}:${label}`,
      type,
      label,
      members: unique.sort((a, b) => rank(a) - rank(b) || a.id - b.id).map((row) => ({
        id: row.id, kanji: row.kanji, kana: row.kana, meaning: row.meaning,
        exampleJp: row.exampleJp, exampleMeaning: row.exampleMeaning, level: row.level
      }))
    });
  };

  // 与 iOS 共用的自他提示表；两边都要求词形和读音同时命中，避免把同汉字异读塞错。
  const hints = require('../data/verb_pair_hints.json');
  const seenPairs = new Set();
  rows.forEach((row) => {
    const hint = hints[row.kanji] || hints[row.kana];
    if (!hint) return;
    const partner = rows.filter((other) => (other.kanji === hint[1] && (!hint[2] || other.kana === hint[2])) || other.kana === hint[1]);
    if (!partner.length) return;
    const label = [row.kanji, partner[0].kanji].sort().join(' / ');
    if (seenPairs.has(label)) return;
    seenPairs.add(label);
    add('pair', label, [row, ...partner]);
  });

  by(rows, (row) => row.kana).forEach((members, kana) => {
    if (members.length < 2) return;
    const senses = new Set(members.map((row) => firstSense(row.meaning)));
    if (senses.size > 1) add('homophone', kana, members);
    else if (members.every((row) => CJK.test(row.kanji))) add('kanji-choice', kana, members);
  });
  by(rows.filter((row) => CJK.test(row.kanji)), (row) => row.kanji).forEach((members, kanji) => {
    if (new Set(members.map((row) => row.kana)).size < 2) return;
    const senses = new Set(members.map((row) => firstSense(row.meaning)));
    add(senses.size === 1 ? 'reading-register' : 'reading-sense', kanji, members);
  });

  const verbs = rows.filter((row) => ['godan', 'ichidan'].includes(row.verbType) && CJK.test(row.kanji));
  by(verbs, (row) => row.kanji.match(CJK)?.[0] || '').forEach((members, stem) => {
    const chars = (row) => new Set(firstSense(row.meaning).match(/[㐀-鿿]/g) || []);
    add('stem', stem, members.filter((row) => members.some((other) => other.id !== row.id && [...chars(other)].some((char) => chars(row).has(char)))));
  });
  by(rows, (row) => firstSense(row.meaning)).forEach((members, sense) => {
    if (new Set(members.map((row) => row.pos)).size === 1) add('synonym', sense, members);
  });

  // 同一成员集合只保留信息量更大的类型，与 iOS 的 TYPE_PRIORITY 一致。
  const unique = new Map();
  groups.forEach((group) => {
    const fingerprint = group.members.map((member) => member.id).sort((a, b) => a - b).join(',');
    const previous = unique.get(fingerprint);
    if (!previous || TYPE_ORDER.indexOf(group.type) < TYPE_ORDER.indexOf(previous.type)) unique.set(fingerprint, group);
  });
  return [...unique.values()].sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.label.localeCompare(b.label));
}

function allGroups(db) {
  if (!cache.has(db)) cache.set(db, buildGroups(db));
  return cache.get(db);
}

function ensureConfusionSchema(db) {
  db.run(`CREATE TABLE IF NOT EXISTS confusion_mastered (group_key TEXT PRIMARY KEY, mastered_on TEXT NOT NULL)`);
}

function queryConfusionGroupsWithDb(db, query = '', type = '', offset = 0, limit = 40) {
  ensureConfusionSchema(db);
  const text = String(query || '').trim().toLowerCase();
  const rows = allGroups(db).filter((group) => (!type || group.type === type) && (!text || `${group.label} ${group.members.map((member) => `${member.kanji} ${member.kana} ${member.meaning}`).join(' ')}`.toLowerCase().includes(text)));
  const mastered = new Set(core.rowsFor(db, 'SELECT group_key FROM confusion_mastered').map((row) => String(row.group_key)));
  return rows.slice(Math.max(0, Number(offset) || 0), Math.max(0, Number(offset) || 0) + Math.min(Math.max(Number(limit) || 40, 1), 80))
    .map((group) => ({ ...group, mastered: mastered.has(group.key), typeName: TYPE_META[group.type]?.name || group.type, hint: TYPE_META[group.type]?.hint || '' }));
}

function confusionSummaryWithDb(db) {
  ensureConfusionSchema(db);
  return { total: allGroups(db).length, mastered: Number(core.firstValue(db, 'SELECT COUNT(*) FROM confusion_mastered', [], 0)) };
}

function confusionGroupsForWordWithDb(db, wordId) {
  ensureConfusionSchema(db);
  return allGroups(db).filter((group) => group.members.some((member) => Number(member.id) === Number(wordId)))
    .slice(0, 3)
    .map((group) => ({ key: group.key, type: group.type, typeName: TYPE_META[group.type]?.name || group.type, label: group.label, hint: TYPE_META[group.type]?.hint || '', members: group.members }));
}

async function setConfusionMastered(groupKey, mastered = true) {
  const { getDatabase, saveDatabase } = databaseStore();
  const db = getDatabase();
  ensureConfusionSchema(db);
  if (mastered) db.run('INSERT OR REPLACE INTO confusion_mastered (group_key, mastered_on) VALUES (?, ?)', [String(groupKey), core.localStudyDay(new Date())]);
  else db.run('DELETE FROM confusion_mastered WHERE group_key = ?', [String(groupKey)]);
  await saveDatabase();
  return mastered;
}

function queryConfusionGroups(query, type, offset, limit) { return queryConfusionGroupsWithDb(databaseStore().getDatabase(), query, type, offset, limit); }
function confusionSummary() { return confusionSummaryWithDb(databaseStore().getDatabase()); }

module.exports = {
  TYPE_META,
  TYPE_ORDER,
  ensureConfusionSchema,
  allGroups,
  queryConfusionGroupsWithDb,
  confusionSummaryWithDb,
  confusionGroupsForWordWithDb,
  queryConfusionGroups,
  confusionSummary,
  setConfusionMastered
};
