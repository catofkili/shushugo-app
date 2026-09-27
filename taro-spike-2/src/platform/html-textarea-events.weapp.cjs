const { hooks } = require('@tarojs/shared');

// 网页的多行输入框写的是 React 的 onChange；小程序的 textarea 只发 input 事件，从不发 change。
// @tarojs/plugin-html 只给 <input> 做了 change → input 的映射，<textarea> 漏了：onChange 永远不触发，
// 而 Taro 的受控输入恢复逻辑会在每次 input 事件后把值改回 React 状态里的旧值——
// 真机上就是「字出来零点一秒就被吞」（2026-09-27：提意见、便签、语法笔记，八处 textarea 全中）。
//
// onAddEvent 在 Taro 里是 SINGLE 钩子，再 tap 会顶掉 plugin-html 的那一个，所以先调原来的再补 textarea。
// 写法和 html-text-template.weapp.cjs 一样。
const list = hooks.callbacks?.onAddEvent;
const previous = list && list.next !== list.tail ? list.next : null;

hooks.tap('onAddEvent', function (type, handler, options, node) {
  previous?.callback?.call(previous.context || hooks, type, handler, options, node);
  if (node?.nodeName !== 'textarea' || type !== 'change') return;
  Object.defineProperty(node.__handlers, type, {
    enumerable: true,
    configurable: true,
    get() { return node.__handlers.input; },
    set(value) { node.__handlers.input = value; }
  });
});
