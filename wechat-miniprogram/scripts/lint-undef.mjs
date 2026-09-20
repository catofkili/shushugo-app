// 只查一条：用了没 require / 没定义的标识符（no-undef）。
// 2026-09-19 首页把 getDatabase 漏在 require 外，Node 的 smoke 全绿、模拟器一跑就炸 ——
// 这类错只有在页面代码真正执行到那一行才会露头，静态查一遍最便宜。借 frontend 的 eslint，不另装。
import { ESLint } from '../../frontend/node_modules/eslint/lib/api.js';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const eslint = new ESLint({
  cwd: root,
  overrideConfigFile: true,
  overrideConfig: [{
    files: ['src/**/*.js', 'cloudfunctions/**/*.js'],
    ignores: ['src/vendor/**', 'src/data/**', 'cloudfunctions/**/node_modules/**'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: Object.fromEntries(['wx', 'App', 'Page', 'Component', 'getApp', 'getCurrentPages', 'WXWebAssembly',
        'require', 'module', 'exports', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
        'Promise', 'Map', 'Set', 'WeakMap', 'Symbol', 'BigInt', 'Uint8Array', 'ArrayBuffer', 'TextDecoder', 'TextEncoder',
        'Buffer', 'process', 'globalThis', 'fetch', 'AbortController', 'btoa', 'atob', 'Date', 'JSON', 'Math', 'Number', 'String',
        'Object', 'Array', 'Error', 'encodeURIComponent', 'decodeURIComponent', 'parseInt', 'parseFloat', 'isNaN', 'isFinite'
      ].map((g) => [g, 'readonly']))
    },
    rules: { 'no-undef': 'error' }
  }]
});
const results = await eslint.lintFiles(['src/**/*.js', 'cloudfunctions/**/*.js']);
const problems = results.flatMap((r) => r.messages.map((m) => `${path.relative(root, r.filePath)}:${m.line} ${m.message}`));
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log(`OK no-undef: ${results.length} files`);
