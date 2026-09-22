const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const { readFileSync } = require('node:fs');

const root = path.resolve(__dirname, '..');
const pagePath = path.join(root, 'src/pages/team/index.js');
const wxml = readFileSync(path.join(root, 'src/pages/team/index.wxml'), 'utf8');
const boundHandlers = ['signIn', 'createTeam', 'joinTeam', 'cheer', 'reportTeam', 'copyInvite', 'editTeam', 'cancelEdit', 'saveTeam', 'regenerateInvite', 'leaveTeam', 'inputNickname', 'inputName', 'inputInvite', 'changeTarget', 'changeEmoji', 'changeVisibility'];
for (const handler of boundHandlers) assert.ok(wxml.includes(`="${handler}"`), `${handler} is bound in WXML`);
assert.ok(wxml.includes('open-type="share"'), 'WeChat share button is bound');
const calls = [];
const ui = { actions: [], clipboard: '', modals: [], navigations: [], shareMenus: 0, stoppedRefreshes: 0 };

const fixture = () => ({
  id: 'team-1', name: 'N3 每日打卡', targetLevel: 'N3', emoji: '🌱', visibility: 'public',
  maxMembers: 6, inviteCode: 'STUDY222', isOwner: true, memberCount: 4, activeCount: 3,
  totalStudyCount: 86, streak: 12,
  members: [
    { memberId: 'm1', name: '每天背十个', avatar: '🐿️', isMe: true, isOwner: true, studyCount: 17, completed: true, cheersReceived: 2, cheeredByMe: false },
    { memberId: 'm2', name: '小林', avatar: '🐼', isMe: false, isOwner: false, studyCount: 31, completed: false, cheersReceived: 1, cheeredByMe: false },
    { memberId: 'm3', name: '葵', avatar: '🐧', isMe: false, isOwner: false, studyCount: 24, completed: true, cheersReceived: 3, cheeredByMe: true },
    { memberId: 'm4', name: '夏目', avatar: '🦉', isMe: false, isOwner: false, studyCount: 14, completed: false, cheersReceived: 0, cheeredByMe: false }
  ]
});

const plazaFixture = () => [
  { id: 'team-1', name: 'N3 每日打卡', targetLevel: 'N3', emoji: '🌱', maxMembers: 6, memberCount: 4, activeCount: 3, streak: 12 },
  { id: 'team-2', name: '早起背单词', targetLevel: 'N2', emoji: '🚃', maxMembers: 6, memberCount: 2, activeCount: 1, streak: 4 }
];

let currentTeam = fixture();
let currentPlaza = plazaFixture();
let capturedPage;
let consentVersion = '2026-09-22';
let databaseReady = true;
let restoreShouldFail = false;
let createShouldFail = false;

const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const teamApi = {
  async myTeam(day) { calls.push(['myTeam', day]); return clone(currentTeam); },
  async plaza(day) { calls.push(['plaza', day]); return clone(currentPlaza); },
  async reportActivity(input) {
    calls.push(['reportActivity', input]);
    if (!currentTeam) return null;
    const me = currentTeam.members.find((member) => member.isMe);
    if (me) Object.assign(me, { studyCount: input.studyCount, completed: input.completed });
    return clone(currentTeam);
  },
  async create(input) {
    calls.push(['create', input]);
    if (createShouldFail) throw new Error('模拟接口失败');
    currentTeam = fixture();
    Object.assign(currentTeam, { name: input.name, targetLevel: input.targetLevel, emoji: input.emoji, visibility: input.visibility });
    return clone(currentTeam);
  },
  async join(input) { calls.push(['join', input]); currentTeam = fixture(); return clone(currentTeam); },
  async update(input) { calls.push(['update', input]); Object.assign(currentTeam, input); return clone(currentTeam); },
  async cheer(memberId, day) {
    calls.push(['cheer', memberId, day]);
    const member = currentTeam.members.find((item) => item.memberId === memberId);
    member.cheeredByMe = true;
    member.cheersReceived += 1;
    return clone(currentTeam);
  },
  async report(teamId, reason) { calls.push(['report', teamId, reason]); },
  async regenerateInvite() { calls.push(['regenerateInvite']); currentTeam.inviteCode = 'NEWCODE2'; return currentTeam.inviteCode; },
  async leave() { calls.push(['leave']); currentTeam = null; }
};

global.wx = {
  showShareMenu() { ui.shareMenus += 1; },
  stopPullDownRefresh() { ui.stoppedRefreshes += 1; },
  navigateTo(input) { ui.navigations.push(input); },
  setClipboardData({ data }) { ui.clipboard = data; },
  showActionSheet(input) { ui.actions.push(input.itemList); input.success({ tapIndex: 0 }); },
  showModal(input) { ui.modals.push({ title: input.title, content: input.content }); input.success({ confirm: true }); }
};
global.Page = (definition) => { capturedPage = definition; };

const originalLoad = Module._load;
Module._load = function mockPageDependencies(request, parent, isMain) {
  if (parent?.filename === pagePath) {
    if (request === '../../config') return { privacyVersion: '2026-09-22' };
    if (request === '../../core/study-core') return {
      firstValue(_db, sql) {
        if (sql.includes('sqlite_master')) return 1;
        if (sql.includes('grammar_reviews')) return 3;
        if (sql.includes('kanji_unit_reviews')) return 2;
        if (sql.includes('checkins')) return 1;
        return 0;
      },
      getState() { return consentVersion; }
    };
    if (request === '../../core/analytics') return { studySummary: () => ({ day: '2026-09-22', today: 12 }) };
    if (request === '../../runtime/auth') return {
      authStatus: () => ({ signedIn: true, user: { id: 'test-user' } }),
      signInWithWechat: async () => ({ signedIn: true, user: { id: 'test-user' } })
    };
    if (request === '../../runtime/database-store') return {
      getDatabase: () => ({}),
      getStatus: () => ({ ready: databaseReady }),
      restoreDatabase: async () => {
        if (restoreShouldFail) throw new Error('模拟旧库损坏');
        databaseReady = true;
      }
    };
    if (request === '../../runtime/team') return teamApi;
  }
  return originalLoad.call(this, request, parent, isMain);
};

delete require.cache[pagePath];
require(pagePath);
Module._load = originalLoad;
assert.ok(capturedPage, 'team page registered');

function setPath(target, dotted, value) {
  const parts = dotted.split('.');
  let cursor = target;
  for (const part of parts.slice(0, -1)) cursor = cursor[part] ??= {};
  cursor[parts.at(-1)] = value;
}

function page(overrides = {}) {
  const instance = {
    ...capturedPage,
    data: { ...clone(capturedPage.data), ...clone(overrides) },
    setData(update) {
      for (const [key, value] of Object.entries(update)) setPath(this.data, key, clone(value));
    }
  };
  return instance;
}

const event = (id) => ({ currentTarget: { dataset: id ? { id } : {} }, detail: {} });
const settle = async () => {
  for (let index = 0; index < 4; index += 1) await new Promise((resolve) => setImmediate(resolve));
};
const reset = ({ team = fixture(), plaza = plazaFixture() } = {}) => {
  currentTeam = clone(team);
  currentPlaza = clone(plaza);
  calls.length = 0;
  consentVersion = '2026-09-22';
  databaseReady = true;
  restoreShouldFail = false;
  createShouldFail = false;
};

(async () => {
  reset();
  const loaded = page();
  loaded.onLoad({ invite: 'st-udy!22z' });
  assert.equal(loaded.data.inviteCode, 'STUDY22Z');
  assert.equal(ui.shareMenus, 1);
  await loaded.onShow();
  assert.equal(loaded.data.team.members.find((member) => member.isMe).studyCount, 17);
  assert.deepEqual(loaded.data.plaza.map((team) => team.id), ['team-2']);
  assert.ok(calls.some(([name]) => name === 'reportActivity'));

  reset();
  databaseReady = false;
  restoreShouldFail = true;
  const needsInit = page();
  await needsInit.onShow();
  assert.equal(needsInit.data.needsInit, true);
  assert.equal(needsInit.data.ready, true);

  reset({ team: null });
  const created = page({ auth: { signedIn: true }, nickname: '小松鼠', draft: { name: 'N2 冲刺组', targetLevel: 'N2', emoji: '🐿️', visibility: 'invite' } });
  created.createTeam();
  await settle();
  assert.equal(calls.find(([name]) => name === 'create')[1].displayName, '小松鼠');
  assert.equal(created.data.team.name, 'N2 冲刺组');

  reset({ team: null });
  createShouldFail = true;
  const failedCreate = page({ auth: { signedIn: true }, nickname: '小松鼠', draft: { name: '失败测试队', targetLevel: 'N3', emoji: '🌱', visibility: 'public' } });
  const originalConsoleError = console.error;
  console.error = () => undefined;
  failedCreate.createTeam();
  await settle();
  console.error = originalConsoleError;
  assert.equal(failedCreate.data.result, '模拟接口失败');

  reset({ team: null });
  const joinedByCode = page({ auth: { signedIn: true }, nickname: '小松鼠', inviteCode: 'STUDY22' });
  joinedByCode.joinTeam(event());
  await settle();
  assert.deepEqual(calls.find(([name]) => name === 'join')[1], { inviteCode: 'STUDY22', displayName: '小松鼠' });
  assert.equal(joinedByCode.data.inviteCode, '');

  reset({ team: null });
  const joinedFromPlaza = page({ auth: { signedIn: true }, nickname: '小松鼠' });
  joinedFromPlaza.joinTeam(event('team-2'));
  await settle();
  assert.equal(calls.find(([name]) => name === 'join')[1].teamId, 'team-2');

  reset();
  const social = page({ auth: { signedIn: true }, team: fixture(), plaza: plazaFixture() });
  social.cheer(event('m2'));
  await settle();
  assert.equal(social.data.team.members.find((member) => member.memberId === 'm2').cheeredByMe, true);
  social.reportTeam(event('team-2'));
  await settle();
  assert.deepEqual(calls.find(([name]) => name === 'report').slice(1), ['team-2', '广告或联系方式']);
  assert.ok(!social.data.plaza.some((team) => team.id === 'team-2'));
  social.copyInvite();
  assert.equal(ui.clipboard, 'STUDY222');
  assert.equal(social.onShareAppMessage().path, '/pages/team/index?invite=STUDY222');
  assert.equal(page({ team: null }).onShareAppMessage().path, '/pages/team/index');

  social.editTeam();
  assert.equal(social.data.editing, true);
  social.cancelEdit();
  assert.equal(social.data.editing, false);
  social.editTeam();
  social.inputNickname({ detail: { value: '新昵称' } });
  social.inputInvite({ detail: { value: 'ab-12!09z' } });
  assert.equal(social.data.nickname, '新昵称');
  assert.equal(social.data.inviteCode, 'AB29Z');
  social.inputName({ detail: { value: '晚间学习组' } });
  social.changeTarget({ detail: { value: '4' } });
  social.changeEmoji({ detail: { value: '5' } });
  social.changeVisibility({ detail: { value: '1' } });
  social.saveTeam();
  await settle();
  assert.deepEqual(calls.find(([name]) => name === 'update')[1], { name: '晚间学习组', targetLevel: 'N1', emoji: '🍊', visibility: 'invite' });
  assert.equal(social.data.editing, false);

  social.regenerateInvite();
  await settle();
  assert.equal(social.data.team.inviteCode, 'NEWCODE2');
  assert.equal(ui.modals.at(-1).title, '更新邀请码');

  reset();
  const leaving = page({ auth: { signedIn: true }, team: fixture() });
  leaving.leaveTeam();
  await settle();
  assert.match(ui.modals.at(-1).content, /移交/);
  assert.ok(calls.some(([name]) => name === 'leave'));
  assert.equal(leaving.data.team, null);

  reset();
  consentVersion = 'older-version';
  const consentBlocked = page({ nickname: '小松鼠' });
  await consentBlocked.signIn();
  assert.equal(ui.navigations.at(-1).url, '/pages/legal/index?consent=1');

  reset();
  const signedIn = page({ nickname: '小松鼠' });
  await signedIn.signIn();
  assert.equal(signedIn.data.auth.signedIn, true);
  assert.ok(calls.some(([name]) => name === 'myTeam'));
  await signedIn.onPullDownRefresh();
  assert.equal(ui.stoppedRefreshes, 1);

  console.log(JSON.stringify({
    ok: true,
    covered: ['load invite', 'local database recovery gate', 'consent gate', 'wechat sign-in', 'refresh and activity', 'create', 'create error', 'join by code', 'join from plaza', 'cheer', 'report', 'copy invite', 'share with and without team', 'edit and cancel', 'input cleaning and pickers', 'regenerate invite', 'leave and owner-transfer warning', 'pull-to-refresh'],
    membersRendered: fixture().members.length,
    bindingsChecked: boundHandlers.length + 1
  }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
