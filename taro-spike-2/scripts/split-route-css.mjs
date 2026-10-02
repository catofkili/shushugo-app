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
  yuzuShop: 'content-pages/yuzu-shop/index.wxss',
  weeklyReport: 'content-pages/weekly-report/index.wxss',
  wordList: 'study/word-list/index.wxss',
  quickStudy: 'study/quick-study/index.wxss',
  confusion: 'study/confusion/index.wxss',
  kanjiReadings: 'study/kanji-readings/index.wxss',
  // 实验功能「开口练习」：只有 SHUSHUGO_EXP_TALK=1 的预览构建里才有 talk- 类（docs/DAILY_TALK_SPEC.md §0）
  talk: 'study/talk/index.wxss',
  jlptPractice: 'study/jlpt-practice/index.wxss'
};

const prefixRoutes = [
  [['yz-'], [routes.yuzuShop]],
  [['zoo-tm-'], [routes.team]],
  [['weekly-report', 'wr-'], [routes.weeklyReport]],
  [['vt-'], [routes.vocabTest]],
  [['talk-'], [routes.talk]],
  [['jq-'], [routes.jlptPractice]],
  [['wl-'], [routes.wordList]],
  [['quick-'], [routes.quickStudy]],
  [['cf-'], [routes.confusion, routes.kanjiReadings]],
  [['kr-'], [routes.kanjiReadings]]
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
