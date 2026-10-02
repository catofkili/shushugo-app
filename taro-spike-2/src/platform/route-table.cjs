const { mobileTitles } = require('../../../frontend/src/app/navigation-titles.cjs');

const definitions = [
  ['home', 'pages/home/index', true],
  ['word', 'pages/word/index', true],
  ['grammar', 'pages/grammar/index', true],
  ['profile', 'pages/profile/index', true],
  ['team', 'study/team/index', false, 'study'],
  ['quick-study', 'study/quick-study/index', false, 'study'],
  ['vocab-test', 'study/vocab-test/index', false, 'study'],
  ['study-modes', 'study/study-modes/index', false, 'study'],
  ['confusion', 'study/confusion/index', false, 'study'],
  ['distinction-quiz', 'study/distinction-quiz/index', false, 'study'],
  ['kanji-readings', 'study/kanji-readings/index', false, 'study'],
  ['word-list', 'study/word-list/index', false, 'study'],
  ['jlpt-plan', 'study/jlpt-plan/index', false, 'study'],
  ['pro', 'account/pro/index', false, 'account'],
  ['account', 'account/account/index', false, 'account'],
  ['personal-info', 'account/personal-info/index', false, 'account'],
  ['notifications', 'account/notifications/index', false, 'account'],
  ['settings', 'account/settings/index', false, 'account'],
  ['privacy', 'account/privacy/index', false, 'account'],
  ['privacy-policy', 'account/privacy-policy/index', false, 'account'],
  ['user-agreement', 'account/user-agreement/index', false, 'account'],
  ['help', 'account/help/index', false, 'account'],
  ['detail', 'content-pages/detail/index', false, 'content-pages'],
  ['grammar-foundation', 'content-pages/grammar-foundation/index', false, 'content-pages'],
  ['favorites', 'content-pages/favorites/index', false, 'content-pages'],
  ['weekly-report', 'content-pages/weekly-report/index', false, 'content-pages'],
  ['yuzu-shop', 'content-pages/yuzu-shop/index', false, 'content-pages'],
  ['achievements', 'content-pages/achievements/index', false, 'content-pages'],
  ['about', 'content-pages/about/index', false, 'content-pages'],
  // 实验功能「开口练习」：只有 SHUSHUGO_EXP_TALK=1 的构建才登记这一页，发布包里没有（docs/DAILY_TALK_SPEC.md §0）。
  // app.config.js 在 node 里读这份时看环境变量；打进包里的这份由 DefinePlugin 把 __EXP_TALK__ 换成字面量。
  ...((typeof __EXP_TALK__ !== 'undefined' ? __EXP_TALK__ : process.env.SHUSHUGO_EXP_TALK === '1')
    ? [['talk', 'study/talk/index', false, 'study']]
    : []),
  // 拼写只读自己的编译常量或环境变量，开口练习的上线状态不会改变这页登记。
  ...((typeof __EXP_SPELLING__ !== 'undefined' ? __EXP_SPELLING__ : process.env.SHUSHUGO_EXP_SPELLING === '1')
    ? [['spelling', 'study/spelling/index', false, 'study']]
    : [])
];

module.exports = definitions.map(([page, path, tab, subpackage]) => ({
  page,
  path,
  tab,
  subpackage: subpackage || null,
  title: Object.hasOwn(mobileTitles, page) ? (mobileTitles[page] ?? '') : (tab ? '收集日' : '')
}));
module.exports = { ROUTE_TABLE: module.exports };
