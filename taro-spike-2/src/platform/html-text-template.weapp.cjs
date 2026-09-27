const { hooks, Shortcuts } = require('@tarojs/shared');
const tableNodes = new Set(['thead', 'tbody', 'tfoot', 'tr', 'th', 'td']);
const inlineTextNodes = new Set(['span', 'small', 'em', 'b', 'strong', 'i', 'label']);

// This hook is SINGLE in Taro. Keep plugin-html's tag/attribute mapping before
// fixing its synthetic <br> child, or HTML nodes stay unmapped in base.wxml.
const list = hooks.callbacks?.modifyHydrateData;
const previous = list && list.next !== list.tail ? list.next : null;

hooks.tap('modifyHydrateData', function (data, node) {
  previous?.callback?.call(previous.context || hooks, data, node);

  // These HTML table nodes have no WXML template; the surrounding table uses View nodes.
  if (tableNodes.has(node?.nodeName)) data[Shortcuts.NodeName] = 'view';

  // Mini Program text nodes cannot contain images, views, inputs, or other
  // components. Preserve the h5-* class and switch only the wrapper component.
  if (inlineTextNodes.has(node?.nodeName)
    && data[Shortcuts.NodeName] === 'text'
    && (data[Shortcuts.Childnodes] ?? []).some((child) => child[Shortcuts.NodeName] !== '9' && child[Shortcuts.NodeName] !== 'text')) {
    data[Shortcuts.NodeName] = 'view';
  }

  // plugin-html creates this child after walking the real children. No
  // `tmpl_0_#text` template exists; Taro's text template is 9.
  if (data[Shortcuts.NodeName] === '#text') data[Shortcuts.NodeName] = '9';
  for (const child of data[Shortcuts.Childnodes] ?? []) {
    if (child[Shortcuts.NodeName] === '#text') child[Shortcuts.NodeName] = '9';
  }
});
