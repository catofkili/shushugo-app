const assert = require('node:assert/strict');
const stores = require('../src/shared/content-store');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const shimPath = path.join(__dirname, 'shared/shims/lazy-json.js');
const shimModule = { exports: {} };
const shimRequire = (request) => request === '../shared/content-store' ? stores : require(request);
vm.runInThisContext(`(function(require,module,exports){${fs.readFileSync(shimPath, 'utf8')}\n})`, { filename: shimPath })(
  shimRequire,
  shimModule,
  shimModule.exports
);
const lazyJson = shimModule.exports;

stores.grammar = null;
const points = lazyJson('grammar', 'array');
assert.equal(Array.isArray(points), true);
assert.equal(points.length, 0);

stores.grammar = [{ id: 'n5-first' }, { id: 'n1-last' }];
assert.equal(points.length, 2);
assert.equal(points[0].id, 'n5-first');
assert.equal(points.find((point) => point.id === 'n1-last').id, 'n1-last');
assert.deepEqual(points.map((point) => point.id), ['n5-first', 'n1-last']);
assert.deepEqual([...points].map((point) => point.id), ['n5-first', 'n1-last']);
assert.equal(points.missing, undefined);

console.log('lazy-json array proxy: null sentinel, live reads, Array methods passed');
