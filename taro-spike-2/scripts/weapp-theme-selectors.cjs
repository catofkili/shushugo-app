const selectorParser = require('postcss-selector-parser');

function classFor(attribute) {
  if (attribute.attribute === 'data-theme') {
    if (attribute.value === undefined) return ['theme-light', 'theme-dark'];
    if (attribute.value === 'light' || attribute.value === 'dark') return [`theme-${attribute.value}`];
    return null;
  }
  if (attribute.attribute === 'data-skin' && attribute.value) {
    return [`skin-${attribute.value}`];
  }
  return null;
}

module.exports = () => ({
  postcssPlugin: 'taro-spike-weapp-theme-selectors',
  Rule(rule) {
    if (!rule.selector.includes('[data-theme') && !rule.selector.includes('[data-skin')) return;

    rule.selector = selectorParser((selectors) => {
      selectors.each((selector) => {
        let variants = [selector.clone()];
        const attributes = [];
        selector.walkAttributes((attribute) => {
          if (attribute.attribute === 'data-theme' || attribute.attribute === 'data-skin') {
            attributes.push(classFor(attribute));
          }
        });

        for (let index = attributes.length - 1; index >= 0; index -= 1) {
          const classNames = attributes[index];
          if (!classNames) continue;
          variants = variants.flatMap((variant) => classNames.map((className) => {
            const clone = variant.clone();
            let current = 0;
            clone.walkAttributes((attribute) => {
              if (current === index) {
                attribute.replaceWith(selectorParser.className({ value: className }));
              }
              current += 1;
            });
            return clone;
          }));
        }

        selector.replaceWith(...variants);
      });
    }).processSync(rule.selector);
  }
});
module.exports.postcss = true;
