import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const appPath = path.join(dist, 'app.wxss');
const appCss = postcss.parse(fs.readFileSync(appPath, 'utf8'), { from: appPath });
const appWxssBytesBefore = Buffer.byteLength(appCss.toString());
const moved = new Map();
const byteTotals = new Map();
const routes = {
  vocabTest: 'study/vocab-test/index.wxss',
  team: 'study/team/index.wxss',
  invite: 'study/invite/index.wxss',
  yuzuShop: 'content-pages/yuzu-shop/index.wxss',
  weeklyReport: 'content-pages/weekly-report/index.wxss',
  wordList: 'study/word-list/index.wxss',
  quickStudy: 'study/quick-study/index.wxss',
  confusion: 'study/confusion/index.wxss',
  kanjiReadings: 'study/kanji-readings/index.wxss',
  word: 'pages/word/index.wxss',
  achievements: 'content-pages/achievements/index.wxss',
  personalInfo: 'account/personal-info/index.wxss',
  // 开口练习样式只放在自己的 study 页面，保持主包体积。
  talk: 'study/talk/index.wxss',
  jlptPractice: 'study/jlpt-practice/index.wxss'
};

const prefixRoutes = [
  [['yz-'], [routes.yuzuShop]],
  [['zoo-tm-'], [routes.team, routes.invite]],
  [['invite-'], [routes.invite]],
  [['weekly-report', 'wr-'], [routes.weeklyReport]],
  [['vt-'], [routes.vocabTest]],
  [['talk-'], [routes.talk]],
  [['sp-'], [routes.word]],
  [['jq-'], [routes.jlptPractice]],
  [['wl-'], [routes.wordList]],
  [['quick-'], [routes.quickStudy]],
  [['cf-'], [routes.confusion, routes.kanjiReadings]],
  [['kr-'], [routes.kanjiReadings]],
  [['ach-'], [routes.achievements, routes.personalInfo]]
];

function targetPackages(selector) {
  const classes = [];
  selectorParser((tree) => tree.walkClasses((node) => classes.push(node.value))).processSync(selector);
  const owners = new Set();
  for (const name of classes) {
    // The curtain is portaled from the home tab as well as the weekly-report route.
    if (name === 'wr-entrance-veil' || name.startsWith('vt-timer')) continue;
    const match = prefixRoutes.find(([prefixes]) => prefixes.some((prefix) => name.startsWith(prefix)));
    if (match) owners.add(match[1]);
  }
  // Keep selectors spanning different prefix families global, as before.
  // A single family can be shared by several pages (cf-); each gets a clone.
  return owners.size === 1 ? [...owners][0] : [];
}

function appendWrappedRule(sourceRule, rule, route) {
  let child = rule;
  for (let parent = sourceRule.parent; parent && parent.type !== 'root'; parent = parent.parent) {
    if (parent.type !== 'atrule') continue;
    child = parent.clone({ nodes: [] }).append(child);
  }
  const out = moved.get(route) ?? postcss.root();
  out.append(child);
  moved.set(route, out);
  byteTotals.set(route, (byteTotals.get(route) ?? 0) + Buffer.byteLength(child.toString()));
}

// lazy 样式先按原有加载顺序合入，再拆分；只用于分包页的前缀也应经过同一道路由判据。
// 主包 Tab 的样式仍留 app / 主包页面，不能 @import lazy 分包的私有 wxss。
const lazyDir = path.join(dist, 'lazy');
for (const name of fs.existsSync(lazyDir) ? fs.readdirSync(lazyDir) : []) {
  if (!name.endsWith('.wxss')) continue;
  const lazyPath = path.join(lazyDir, name);
  const lazyCss = postcss.parse(fs.readFileSync(lazyPath, 'utf8'), { from: lazyPath });
  appCss.append(lazyCss.nodes);
  fs.writeFileSync(lazyPath, '');
}

appCss.walkRules((rule) => {
  if (!rule.parent) return;
  const groups = new Map();
  const keep = [];
  selectorParser((tree) => {
    tree.each((selector) => {
      const text = selector.toString();
      const packageNames = targetPackages(text);
      if (!packageNames.length) keep.push(text);
      for (const packageName of packageNames) {
        const selectors = groups.get(packageName) ?? [];
        selectors.push(text);
        groups.set(packageName, selectors);
      }
    });
  }).processSync(rule.selector);

  for (const [packageName, selectors] of groups) {
    const clone = rule.clone({ selector: selectors.join(',') });
    appendWrappedRule(rule, clone, packageName);
  }
  if (groups.size && keep.length) rule.selector = keep.join(',');
  else if (groups.size) rule.remove();
});
appCss.walkAtRules((rule) => {
  if (!rule.nodes?.length) rule.remove();
});

// 原 lazy wxss 留空：运行时 <link> 是空操作，但 webpack runtime 仍识别这些路径。

for (const [relative, css] of moved) {
  const filename = path.join(dist, relative);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const current = fs.existsSync(filename) ? fs.readFileSync(filename, 'utf8') : '';
  fs.writeFileSync(filename, `${current}${current ? '\n' : ''}${css.toString()}\n`);
}

fs.writeFileSync(appPath, `${appCss.toString()}\n`);
const report = {
  appWxssBytesBefore,
  appWxssBytesAfter: Buffer.byteLength(appCss.toString()) + 1,
  movedRuleBytesByRoute: Object.fromEntries([...byteTotals].sort(([a], [b]) => a.localeCompare(b))),
  movedRuleCountByRoute: Object.fromEntries([...moved].map(([name, css]) => [name, css.nodes.length])),
  routes
};
fs.writeFileSync(path.join(root, 'reports/route-css-split.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
