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
  weeklyReport: 'content-pages/weekly-report/index.wxss'
};

function targetPackage(selector) {
  const classes = [];
  selectorParser((tree) => tree.walkClasses((node) => classes.push(node.value))).processSync(selector);
  const owners = new Set();
  for (const name of classes) {
    if (name.startsWith('yz-')) owners.add(routes.yuzuShop);
    else if (name.startsWith('zoo-tm-')) owners.add(routes.team);
    else if (name.startsWith('weekly-report') || name.startsWith('wr-')) owners.add(routes.weeklyReport);
    else if (name.startsWith('vt-') && !name.startsWith('vt-timer')) owners.add(routes.vocabTest);
  }
  return owners.size === 1 ? [...owners][0] : null;
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
      const packageName = targetPackage(text);
      if (!packageName) keep.push(text);
      else {
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
