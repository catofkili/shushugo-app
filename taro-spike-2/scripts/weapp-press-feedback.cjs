const selectorParser = require('postcss-selector-parser');

module.exports = () => ({
  postcssPlugin: 'taro-weapp-press-feedback',
  Rule(rule) {
    const aliases = [];
    selectorParser((selectors) => {
      selectors.each((selector) => {
        // :active → .is-pressed；:disabled → .is-disabled（见 press-feedback-jsx-runtime.weapp.cjs：小程序里禁用的按钮不带原生 disabled）。
        const classes = { ':active': 'is-pressed', ':disabled': 'is-disabled' };
        let hasAlias = false;
        selector.walkPseudos((pseudo) => {
          if (classes[pseudo.value.toLowerCase()]) hasAlias = true;
        });
        if (!hasAlias) return;
        const alias = selector.clone();
        alias.walkPseudos((pseudo) => {
          const name = classes[pseudo.value.toLowerCase()];
          if (name) pseudo.replaceWith(selectorParser.className({ value: name }));
        });
        aliases.push(alias.toString());
      });
    }).processSync(rule.selector);
    if (aliases.length) rule.after(rule.clone({ selector: aliases.join(',') }));
  }
});
module.exports.postcss = true;
