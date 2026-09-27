const fs = require('node:fs');
const path = require('node:path');
const postcss = require('postcss');
const selectorParser = require('postcss-selector-parser');

function encode(value) {
  return Array.from(String(value), (char) => /^[a-z\d-]$/i.test(char)
    ? char
    : `_x${char.codePointAt(0).toString(16)}_`).join('') || 'empty';
}

function selectorClass(attribute) {
  if (attribute.attribute === 'data-theme' && attribute.operator === '=' && ['light', 'dark'].includes(attribute.value)) {
    return `theme-${attribute.value}`;
  }
  if (attribute.attribute === 'data-skin' && attribute.operator === '=' && attribute.value) {
    return `skin-${attribute.value}`;
  }
  const name = encode(attribute.attribute);
  if (!attribute.operator) return `attr-${name}`;
  const value = encode(attribute.value ?? '');
  const operator = ({ '=': '', '~=': 'word', '|=': 'dash', '^=': 'starts', '$=': 'ends', '*=': 'contains' })[attribute.operator] ?? encode(attribute.operator);
  return `attr-${name}${operator ? `-${operator}` : ''}-${value}${attribute.insensitive ? '-i' : ''}`;
}

function classFor(attribute) {
  return [selectorClass(attribute)];
}

function cssFiles(directories) {
  const files = [];
  for (const directory of directories) {
    if (!fs.existsSync(directory)) continue;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) files.push(...cssFiles([file]));
      else if (entry.isFile() && file.endsWith('.css')) files.push(file);
    }
  }
  return files;
}

function collectAttributeSelectors(directories) {
  const selectors = new Map();
  for (const file of cssFiles(directories)) {
    const root = postcss.parse(fs.readFileSync(file, 'utf8'), { from: file });
    root.walkRules((rule) => {
      try {
        selectorParser((all) => all.walkAttributes((attribute) => {
          const item = {
            attribute: attribute.attribute,
            operator: attribute.operator || '',
            value: attribute.value ?? '',
            insensitive: Boolean(attribute.insensitive),
            className: selectorClass(attribute)
          };
          selectors.set(item.className, item);
        })).processSync(rule.selector);
      } catch {
        // Other PostCSS plugins will report invalid selectors with their source location.
      }
    });
  }
  return [...selectors.values()];
}

module.exports = () => ({
  postcssPlugin: 'taro-spike-weapp-attribute-selectors',
  Rule(rule) {
    if (!rule.selector.includes('[')) return;
    rule.selector = selectorParser((selectors) => {
      selectors.walkAttributes((attribute) => {
        attribute.replaceWith(...classFor(attribute).map((value) => selectorParser.className({ value })));
      });
    }).processSync(rule.selector);
  }
});
module.exports.postcss = true;
module.exports.collectAttributeSelectors = collectAttributeSelectors;
module.exports.selectorClass = selectorClass;
