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
  ['about', 'content-pages/about/index', false, 'content-pages']
];

module.exports = definitions.map(([page, path, tab, subpackage]) => ({
  page,
  path,
  tab,
  subpackage: subpackage || null,
  title: Object.hasOwn(mobileTitles, page) ? (mobileTitles[page] ?? '') : (tab ? '收集日' : '')
}));
module.exports = { ROUTE_TABLE: module.exports };
