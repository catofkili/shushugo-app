const assert = require('node:assert/strict');
const { hooks, Shortcuts } = require('@tarojs/shared');

// Mimic plugin-html's handler, which is registered before app.tsx runs.
hooks.tap('modifyHydrateData', (data) => {
  if (data[Shortcuts.NodeName] === 'div') data[Shortcuts.NodeName] = 'view';
  if (data[Shortcuts.NodeName] === 'br') {
    data[Shortcuts.NodeName] = 'text';
    data[Shortcuts.Childnodes] = [{ [Shortcuts.NodeName]: '#text', [Shortcuts.Text]: '\n' }];
  }
});
require('../src/platform/html-text-template.weapp.cjs');

const block = { [Shortcuts.NodeName]: 'div', [Shortcuts.Childnodes]: [] };
hooks.call('modifyHydrateData', block, {});
assert.equal(block[Shortcuts.NodeName], 'view');

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

console.log('plugin-html mapping, table-node fallback, and synthetic <br> text mapping passed.');
