const { hooks, Shortcuts } = require('@tarojs/shared');

// plugin-html creates a synthetic `#text` child for <br> after Taro has walked
// the real children. No `tmpl_0_#text` template exists; Taro's text template is 9.
hooks.tap('modifyHydrateData', (data) => {
  if (data[Shortcuts.NodeName] === '#text') data[Shortcuts.NodeName] = '9';
  for (const child of data[Shortcuts.Childnodes] ?? []) {
    if (child[Shortcuts.NodeName] === '#text') child[Shortcuts.NodeName] = '9';
  }
});
