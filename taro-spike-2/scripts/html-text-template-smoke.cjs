const assert = require('node:assert/strict');
const { hooks, Shortcuts } = require('@tarojs/shared');

require('../src/platform/html-text-template.weapp.cjs');

const lineBreak = {
  [Shortcuts.NodeName]: 'text',
  [Shortcuts.Childnodes]: [{ [Shortcuts.NodeName]: '#text', [Shortcuts.Text]: '\n' }]
};
hooks.call('modifyHydrateData', lineBreak, {});
assert.equal(lineBreak[Shortcuts.Childnodes][0][Shortcuts.NodeName], '9');

console.log('HTML <br> synthetic text nodes resolve to Taro template 9.');
