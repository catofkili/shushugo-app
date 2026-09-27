const selectorParser = require('postcss-selector-parser');

module.exports = () => ({
  postcssPlugin: 'taro-weapp-press-feedback',
  Rule(rule) {
    const aliases = [];
    selectorParser((selectors) => {
      selectors.each((selector) => {
        let hasActive = false;
        selector.walkPseudos((pseudo) => {
          if (pseudo.value.toLowerCase() === ':active') hasActive = true;
        });
        if (!hasActive) return;
        const alias = selector.clone();
        alias.walkPseudos((pseudo) => {
          if (pseudo.value.toLowerCase() === ':active') {
            pseudo.replaceWith(selectorParser.className({ value: 'is-pressed' }));
          }
        });
        aliases.push(alias.toString());
      });
    }).processSync(rule.selector);
    if (aliases.length) rule.after(rule.clone({ selector: aliases.join(',') }));
  }
});
module.exports.postcss = true;
