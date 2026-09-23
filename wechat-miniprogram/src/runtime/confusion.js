/*
 * 疑难辨析：分组、类别、已掌握标记全部是网页的 confusion-groups（src/shared/web.js）。
 * 小程序以前自己算一份，出厂库上 1,881 组里有一组和网页对不上（homophone:ロック / stem:開），
 * 而 confusion_mastered 是按 group_key 同步的 —— 组键不一样，标过的「已掌握」就丢了。
 */
const core = require('../core/study-core');
const { getDatabase, saveDatabase } = require('./database-store');
const content = require('../shared/content');

const web = core.web;

const withDatabase = (db, run) => {
  const database = db || getDatabase();
  // 辨析要读 confusion_mastered / progress，表由网页的 local-schema 建。
  core.ensureStudySchema(database);
  return core.withDb(database, run);
};

function ensureConfusionSchema(db) { core.ensureStudySchema(db || getDatabase()); }

// TYPE_META 里的 Icon 是 lucide 组件，绝不能进 setData（WXML 序列化不了）——只取名字。
const TYPE_ORDER = web.confusionGroups.CONFUSION_TYPES;
const TYPE_META = Object.fromEntries(TYPE_ORDER.map((type) => [type, { name: web.confusionGroups.TYPE_META[type].name }]));

function allGroups(db) {
  return withDatabase(db, () => web.confusionGroups.confusionGroups());
}

function queryConfusionGroupsWithDb(db, query = '', type = '', offset = 0, limit = 40) {
  return withDatabase(db, () => {
    const text = String(query || '').trim().toLowerCase();
    const groups = web.confusionGroups.confusionGroups().filter((group) => {
      if (type && group.type !== type) return false;
      if (!text) return true;
      return group.label.toLowerCase().includes(text)
        || group.members.some((member) => `${member.kanji}${member.kana}${member.meaning}`.toLowerCase().includes(text));
    });
    const mastered = masteredKeys();
    return groups.slice(Number(offset) || 0, (Number(offset) || 0) + (Number(limit) || 40)).map((group) => decorate(group, mastered));
  });
}

function decorate(group, mastered) {
  return {
    key: group.key,
    type: group.type,
    typeName: (TYPE_META[group.type] || {}).name || group.type,
    label: group.label,
    mastered: Boolean(mastered && mastered.has(group.key)),
    // 成员形态走网页的 displayForm（外来語行的 kanji 是词源，方括号注音要摘掉）
    members: group.members.map((member) => ({
      id: member.id,
      kanji: web.confusionGroups.displayForm(member),
      kana: member.kana,
      level: member.jlptLevel || '',
      meaning: member.meaning,
      exampleJp: member.exampleJp || ''
    }))
  };
}

function masteredKeys() {
  return new Set(web.dbUtils.rowsFor('SELECT group_key FROM confusion_mastered').map((row) => String(row.group_key)));
}

function confusionSummaryWithDb(db) {
  return withDatabase(db, () => ({
    total: web.confusionGroups.confusionGroups().length,
    mastered: web.dbUtils.firstValue('SELECT COUNT(*) FROM confusion_mastered', [], 0)
  }));
}

function confusionGroupsForWordWithDb(db, wordId) {
  return withDatabase(db, () => {
    const mastered = masteredKeys();
    return web.confusionGroups.confusionGroupsForWord(Number(wordId)).slice(0, 3).map((group) => decorate(group, mastered));
  });
}

function queryConfusionGroups(query, type, offset, limit) {
  return queryConfusionGroupsWithDb(getDatabase(), query, type, offset, limit);
}

function confusionSummary() { return confusionSummaryWithDb(getDatabase()); }

async function setConfusionMastered(groupKey, mastered = true) {
  // 网页的 setConfusionMastered 写同一张 confusion_mastered；删除由同步触发器留墓碑。
  withDatabase(getDatabase(), () => web.confusionGroups.setConfusionMastered(String(groupKey), Boolean(mastered)));
  await saveDatabase();
  return mastered;
}

/** 辨析题：题面、选项、跳过规则都是网页的 distinction-quiz（缺人工题面就整组跳过）。 */
async function quizQuestions(scope = { kind: 'all' }, db) {
  await content.ready();
  return withDatabase(db, () => {
    // 网页的 quizGroups 只认 group / type / today / learned；「全部」= 所有能出题的组
    // （playableGroupKeys 用的就是它自己那条 reviewable 判据）。
    const groups = scope.kind === 'all'
      ? (() => { const playable = web.distinctionQuiz.playableGroupKeys(); return web.confusionGroups.confusionGroups().filter((group) => playable.has(group.key)); })()
      : web.distinctionQuiz.quizGroups(scope);
    return web.distinctionQuiz.buildQuestions(groups);
  });
}

async function settleQuizGroup(groupKey, allCorrect) {
  withDatabase(getDatabase(), () => web.distinctionQuiz.settleGroup(String(groupKey), Boolean(allCorrect)));
  await saveDatabase();
}

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
  setConfusionMastered,
  quizQuestions,
  settleQuizGroup
};
