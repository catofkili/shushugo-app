const assert = require('node:assert/strict');
const { hooks } = require('@tarojs/shared');

// 模拟 plugin-html：它只给 <input> 把 change 映射成 input（app.tsx 之前已注册）。
hooks.tap('onAddEvent', (type, _handler, _options, node) => {
  if (node.nodeName === 'input' && type === 'change') {
    Object.defineProperty(node.__handlers, type, { configurable: true, enumerable: true, get() { return node.__handlers.input; }, set(value) { node.__handlers.input = value; } });
  }
});
require('../src/platform/html-textarea-events.weapp.cjs');

const handler = () => {};
const textarea = { nodeName: 'textarea', __handlers: {} };
hooks.call('onAddEvent', 'change', handler, {}, textarea);
textarea.__handlers.change = [handler];
assert.deepEqual(textarea.__handlers.input, [handler], 'textarea 的 onChange 必须落到 input 事件上');

const input = { nodeName: 'input', __handlers: {} };
hooks.call('onAddEvent', 'change', handler, {}, input);
input.__handlers.change = [handler];
assert.deepEqual(input.__handlers.input, [handler], 'plugin-html 原来的 <input> 映射不能被顶掉');

const view = { nodeName: 'view', __handlers: {} };
hooks.call('onAddEvent', 'change', handler, {}, view);
view.__handlers.change = [handler];
assert.equal(view.__handlers.input, undefined, '别的元素的 change 不动');

console.log('textarea onChange → input mapping passed; plugin-html input mapping preserved.');
