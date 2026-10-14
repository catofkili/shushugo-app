const assert = require('node:assert/strict');
const vm = require('node:vm');
const terser = require('terser');
const { mini } = require('../config/index.js');

(async () => {
  assert.equal(mini.terser.config.output.ascii_only, false);
  const source = `JSON.stringify({word:"日本語 中文",emoji:"😀",separator:"a\\u2028b",match:/日本語+/.test("日本語語"),key:{中文:"文字"}})`;
  const options = { compress:false, mangle:false, output:{ ecma:5, ascii_only:true } };
  const ascii = await terser.minify(source, options);
  const utf8 = await terser.minify(source, { ...options, output:{ ...options.output, ...mini.terser.config.output } });
  assert.equal(vm.runInNewContext(utf8.code), vm.runInNewContext(ascii.code));
  assert.ok(Buffer.byteLength(utf8.code) < Buffer.byteLength(ascii.code));
  console.log('Minifier encoding passed: CJK, Japanese, emoji, line separator, regex and property names preserve values.');
})().catch(error => { console.error(error); process.exitCode = 1; });
