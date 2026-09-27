const assert = require('node:assert/strict');
const { hooks, Shortcuts } = require('@tarojs/shared');
const inlineTextNodes = new Set(['span', 'small', 'em', 'b', 'strong', 'i', 'label']);

// Mimic plugin-html's handler, which is registered before app.tsx runs.
hooks.tap('modifyHydrateData', (data, node) => {
  if (data[Shortcuts.NodeName] === 'div') data[Shortcuts.NodeName] = 'view';
  if (inlineTextNodes.has(node?.nodeName)) data[Shortcuts.NodeName] = 'text';
  if (data[Shortcuts.NodeName] === 'br') {
    data[Shortcuts.NodeName] = 'text';
    data[Shortcuts.Childnodes] = [{ [Shortcuts.NodeName]: '#text', [Shortcuts.Text]: '\n' }];
  }
});
require('../src/platform/html-text-template.weapp.cjs');

const block = { [Shortcuts.NodeName]: 'div', [Shortcuts.Childnodes]: [] };
hooks.call('modifyHydrateData', block, {});
assert.equal(block[Shortcuts.NodeName], 'view');

const inlineText = { [Shortcuts.NodeName]: 'text', [Shortcuts.Childnodes]: [{ [Shortcuts.NodeName]: '9' }] };
hooks.call('modifyHydrateData', inlineText, { nodeName: 'span' });
assert.equal(inlineText[Shortcuts.NodeName], 'text');

const inlineSticker = {
  [Shortcuts.NodeName]: 'text',
  [Shortcuts.Childnodes]: [{ [Shortcuts.NodeName]: 'image' }],
  className: 'h5-small'
};
hooks.call('modifyHydrateData', inlineSticker, { nodeName: 'small' });
assert.equal(inlineSticker[Shortcuts.NodeName], 'view');
assert.equal(inlineSticker.className, 'h5-small');

const inlineRuby = { [Shortcuts.NodeName]: 'text', [Shortcuts.Childnodes]: [{ [Shortcuts.NodeName]: 'view' }] };
hooks.call('modifyHydrateData', inlineRuby, { nodeName: 'span' });
assert.equal(inlineRuby[Shortcuts.NodeName], 'view');

const tableCell = { [Shortcuts.NodeName]: 'th', [Shortcuts.Childnodes]: [] };
hooks.call('modifyHydrateData', tableCell, { nodeName: 'th' });
assert.equal(tableCell[Shortcuts.NodeName], 'view');

const lineBreak = {
  [Shortcuts.NodeName]: 'br',
  [Shortcuts.Childnodes]: []
};
hooks.call('modifyHydrateData', lineBreak, {});
assert.equal(lineBreak[Shortcuts.NodeName], 'text');
assert.equal(lineBreak[Shortcuts.Childnodes][0][Shortcuts.NodeName], '9');

console.log('plugin-html inline fallback, table-node fallback, and synthetic <br> text mapping passed.');
