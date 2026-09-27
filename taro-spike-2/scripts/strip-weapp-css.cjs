const selectorParser = require('postcss-selector-parser');
const fs = require('node:fs');
const path = require('node:path');

const removed = new Set();
const sourceBytes = new Map();
const unsupportedPseudo = (value) => value === ':has'
  || value === ':where'
  || value === ':host'
  || value === ':focus-visible'
  || value === ':focus-within'
  || value === '::backdrop'
  || value.startsWith('::highlight')
  || /^::?(?:-moz|-webkit|-ms|-o)-/.test(value)
  || value === '::file-selector-button';

module.exports = () => ({
  postcssPlugin: 'strip-unsupported-weapp-css',
  Once(root) {
    root.walkAtRules('font-face', (rule) => {
      const src = rule.nodes?.find((node) => node.type === 'decl' && node.prop.toLowerCase() === 'src')?.value ?? '';
      if (/url\([^)]*\.(?:woff2?|ttf|otf|eot)(?:[?#][^)]*)?\)/i.test(src)
        || /url\(\s*["']?data:(?:font\/|application\/font-)/i.test(src)) {
        removed.add('@font-face local font');
        rule.remove();
      }
    });
    root.walkAtRules('layer', (rule) => {
      removed.add(`@layer ${rule.params}`);
      rule.remove();
    });
    root.walkRules((rule) => {
      let unsupported = [];
      const filtered = selectorParser((selectors) => {
        selectors.each((selector) => {
          let invalid = false;
          selector.walkPseudos((pseudo) => {
            if (unsupportedPseudo(pseudo.value) || pseudo.prev()?.type === 'combinator') invalid = true;
          });
          selector.walkCombinators((combinator) => {
            if (combinator.value === '~') invalid = true;
          });
          if (invalid) {
            unsupported.push(selector.toString());
            selector.remove();
          }
        });
      }).processSync(rule.selector);
      unsupported.forEach((selector) => removed.add(selector));
      if (!filtered.trim()) rule.remove();
      else rule.selector = filtered;
    });
  },
  OnceExit(root, { result }) {
    const source = result.opts.from;
    if (source && path.isAbsolute(source)) {
      const repoRoot = path.resolve(process.cwd(), '..');
      sourceBytes.set(path.relative(repoRoot, source).split(path.sep).join('/'), Buffer.byteLength(root.toString()));
      fs.writeFileSync(
        path.resolve(process.cwd(), 'reports/css-source-bytes.json'),
        `${JSON.stringify(Object.fromEntries([...sourceBytes].sort(([a], [b]) => a.localeCompare(b))), null, 2)}\n`
      );
    }
    const report = path.resolve(process.cwd(), 'reports/css-removed.json');
    fs.mkdirSync(path.dirname(report), { recursive: true });
    fs.writeFileSync(report, `${JSON.stringify([...removed].sort(), null, 2)}\n`);
  }
});
module.exports.postcss = true;
