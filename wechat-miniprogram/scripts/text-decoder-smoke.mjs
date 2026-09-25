// iOS 微信没有 TextDecoder（见 src/runtime/text-decoder.js）。这里在 Node 里模拟那个环境：
// 拿掉系统自带的 TextDecoder，只留替身，用**打进小程序包的那份** vendor/sql-wasm.js + wasm 打开出厂词库，
// 和 npm 版 sql.js（系统 TextDecoder）读出来的全部文本逐字对比。
// ⚠️ 其它 smoke 用的都是 npm 版 sql.js，vendored 那份此前从没被任何测试执行过——所以 iOS 的缺口一直没被抓到。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const NativeDecoder = globalThis.TextDecoder;
const { decodeUtf8 } = require(path.join(root, 'src/runtime/text-decoder.js'));

// 1. 字符串级：合法输入逐字一致；非法字节不抛错、给 U+FFFD。
const samples = ['', 'abc', '日本語を勉強する', '食べる（たべる）', '𠮟る 😀 👨‍👩‍👧', 'é\u0000z', 'x'.repeat(20000) + 'あ'.repeat(9000)];
for (const text of samples) assert.equal(decodeUtf8(new TextEncoder().encode(text)), text);
const bytes = new TextEncoder().encode('前後の文字列');
assert.equal(decodeUtf8(bytes.subarray(3, 9)), new NativeDecoder().decode(bytes.subarray(3, 9)));
for (const bad of [[0xff], [0xe3, 0x81], [0xc0, 0x80], [0xed, 0xa0, 0x80], [0xe3, 0x41, 0x42]]) {
  assert.ok(decodeUtf8(new Uint8Array(bad)).includes('�'), `非法字节 ${bad} 应替换为 U+FFFD`);
}

// 2. 词库级：npm 版 sql.js + 系统 TextDecoder 作基准。
const dump = (db) => ['SELECT kanji, kana, meaning FROM words ORDER BY id', 'SELECT pattern, meaning, notes FROM grammar_points ORDER BY id']
  .map((sql) => JSON.stringify(db.exec(sql)[0]?.values ?? [])).join('\n');
const seed = readFileSync(path.resolve(root, '../frontend/public/nihongo.db'));
const npmSql = await require(path.resolve(root, '../frontend/node_modules/sql.js/dist/sql-wasm.js'))({
  locateFile: (name) => path.resolve(root, '../frontend/node_modules/sql.js/dist', name)
});
const expected = dump(new npmSql.Database(seed));

// 模拟 iOS：没有 TextDecoder，只有替身。
delete globalThis.TextDecoder;
assert.equal(typeof globalThis.TextDecoder, 'undefined');
delete require.cache[path.join(root, 'src/runtime/text-decoder.js')];
require(path.join(root, 'src/runtime/text-decoder.js'));
assert.notEqual(globalThis.TextDecoder, NativeDecoder);
const wasm = readFileSync(path.join(root, 'src/assets/sql-wasm.wasm'));
const vendored = await require(path.join(root, 'src/vendor/sql-wasm.js'))({
  instantiateWasm(imports, done) { WebAssembly.instantiate(wasm, imports).then((r) => done(r.instance, r.module)); return {}; }
});
const actual = dump(new vendored.Database(seed));
globalThis.TextDecoder = NativeDecoder;

assert.ok(expected.length > 200_000, '基准转储太小，查询可能没拿到数据');
assert.equal(actual, expected, 'vendored sql.js + TextDecoder 替身读出的出厂词库与基准不一致');
console.log(`text-decoder-smoke ok: ${samples.length} 条样例、出厂词库 ${expected.length.toLocaleString()} 字符逐字一致`);
