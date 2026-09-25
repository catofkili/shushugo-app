const selectorParser = require('postcss-selector-parser');
const fs = require('node:fs');
const path = require('node:path');

const removed = new Set();
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
  OnceExit() {
    const report = path.resolve(process.cwd(), 'reports/css-removed.json');
    fs.mkdirSync(path.dirname(report), { recursive: true });
    fs.writeFileSync(report, `${JSON.stringify([...removed].sort(), null, 2)}\n`);
  }
});
module.exports.postcss = true;
