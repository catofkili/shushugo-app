const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../../frontend/node_modules/typescript');

// Exercise the actual adapter with the two native lifecycle orders seen on page hide:
// app background pauses, while navigation invalidates exactly once despite retained pages.
const listeners = new Map();
const document = {
  visibilityState: 'visible',
  addEventListener: (type, callback) => listeners.set(type, callback),
  removeEventListener: (type) => listeners.delete(type)
};
const timers = new Map();
let timerId = 0;
let onShow, onHide, cleanup;
let leaveCount = 0;
let touches = 0;
const visible = [];
const slots = [];
let slot = 0;
const react = {
  useRef: (initial) => slots[slot++] ??= { current: initial },
  useState: (initial) => [typeof initial === 'function' ? initial() : initial],
  useEffect: (effect) => { cleanup = effect(); }
};
const tabCalls = [];
let route = 'pages/word/index';
const taro = {
  getCurrentInstance: () => ({ router: { $taroPath: 'word-page' } }),
  getCurrentPages: () => [{ route }],
  hideTabBar: () => { tabCalls.push('hide'); },
  showTabBar: () => { tabCalls.push('show'); },
  useDidShow: (callback) => { onShow = callback; },
  useDidHide: (callback) => { onHide = callback; }
};
const moduleObject = { exports: {} };
const source = fs.readFileSync(path.join(__dirname, '../src/platform/use-study-activity.weapp.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } });
vm.runInNewContext(compiled.outputText, {
  module: moduleObject, exports: moduleObject.exports, document,
  require: (name) => name === 'react' ? react : name === '@tarojs/taro' ? taro : assert.fail(name),
  setTimeout: (callback) => { timers.set(++timerId, callback); return timerId; },
  clearTimeout: (id) => timers.delete(id)
});
const { useStudyActivity, notifyStudyInteraction, useStudyBreakTabBar } = moduleObject.exports;
const runTimers = () => { const pending = [...timers.values()]; timers.clear(); pending.forEach((callback) => callback()); };
const appVisibility = (value) => { document.visibilityState = value; listeners.get('visibilitychange')?.(); };
useStudyActivity({ onInteraction: () => touches++, onVisibilityChange: (value) => visible.push(value), onLeave: () => leaveCount++ });
assert.equal(visible.at(-1), true);
notifyStudyInteraction('other-page');
notifyStudyInteraction('word-page');
assert.equal(touches, 1);

onHide();
appVisibility('hidden');
runTimers();
notifyStudyInteraction('word-page');
assert.equal(leaveCount, 0, 'backgrounding must retain reward eligibility');
assert.equal(touches, 1, 'hidden page must not accrue interaction');
appVisibility('visible');
assert.equal(visible.at(-1), false, 'app foreground alone does not activate a hidden page');
onShow();
assert.equal(visible.at(-1), true);

appVisibility('hidden');
onHide();
runTimers();
assert.equal(leaveCount, 0, 'app-hide-first order must also pause');
appVisibility('visible');
onShow();
onHide();
runTimers();
assert.equal(leaveCount, 1, 'native page navigation invalidates the session');
cleanup();
assert.equal(leaveCount, 1, 'navigation then unmount must not double-invalidate');
assert.equal(listeners.size, 0);
notifyStudyInteraction('word-page');
assert.equal(touches, 1, 'unmount removes interaction listeners');

useStudyBreakTabBar(true);
assert.deepEqual(tabCalls, ['hide']);
cleanup();
assert.deepEqual(tabCalls, ['hide', 'show']);
route = 'study/quick-study/index';
useStudyBreakTabBar(true);
assert.equal(cleanup, undefined, 'non-tab pages must not alter native tab bar');
assert.deepEqual(tabCalls, ['hide', 'show']);
console.log('Study activity: background pause, native navigation exit, page-scoped interaction and break tab bar passed.');
