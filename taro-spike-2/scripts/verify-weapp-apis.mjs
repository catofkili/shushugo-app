import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const APIs = [
  'TextEncoder', 'TextDecoder', 'URLSearchParams', 'URL', 'fetch', 'XMLHttpRequest', 'Blob', 'FileReader',
  'structuredClone', 'AbortController', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
  'CompressionStream', 'DecompressionStream', 'matchMedia', 'getComputedStyle', 'ResizeObserver',
  'IntersectionObserver', 'MutationObserver', 'indexedDB', 'crypto', 'performance', 'BroadcastChannel',
  'Worker', 'WebSocket', 'Image', 'Audio', 'speechSynthesis', 'SpeechSynthesisUtterance', 'Notification',
  'localStorage', 'sessionStorage', 'atob', 'btoa', 'Intl', 'WeakRef', 'FinalizationRegistry',
  'ReadableStream', 'Response', 'Request', 'Headers'
];

// File + source context, not generated line numbers. Counts make a new call fail even if it
// happens to sit beside an existing one. Reasons identify the runtime shim or unreachable path.
const allowlist = [
  { api: 'TextDecoder', file: 'common.js', before: /var \w+=new $/, after: /^,\w+=function/, count: 1, reason: 'vendor/sql-wasm.js constructs this decoder; sql-js.weapp.cjs requires runtime/text-decoder.js before the vendor module.' },
  { api: 'TextDecoder', file: 'common.js', before: /\(new $/, after: /^\)\.decode\(/, count: 1, reason: 'vendor/sql-wasm.js decodes database text; sql-js.weapp.cjs and filesystem.weapp.cjs load runtime/text-decoder.js first.' },
  { api: 'URL', file: 'taro.js', before: /not support $/, after: /^\.createObjectURL/, count: 1, reason: 'Taro emits the name inside its deliberate createObjectURL error message; it does not read global URL.' },
  { api: 'URL', file: 'taro.js', before: /not support $/, after: /^\.revokeObjectURL/, count: 1, reason: 'Taro emits the name inside its deliberate revokeObjectURL error message; it does not read global URL.' },
  { api: 'URL', file: 'taro.js', before: /Invalid base $/, after: /^"\);i=g/, count: 1, reason: 'Taro emits the name in its own URL parser error text; this is not a global URL access.' },
  { api: 'URL', file: 'taro.js', before: /Invalid $/, after: /^"\);r=e/, count: 1, reason: 'Taro emits the name in its own URL parser error text; this is not a global URL access.' },
  { api: 'URL', file: 'account/fflate.umd.js', before: /new Worker\(n\[e\].*=$/, after: /^\.createObjectURL\(new Blob\(/, count: 1, reason: 'fflate references URL only inside its optional async Worker factory; shipped sync gzipSync/gunzipSync paths never call it.' },
  { api: 'fetch', file: 'common.js', before: /n\.n=2,$/, after: /^\(e,\{credentials:"same-origin"/, count: 1, reason: 'vendor/sql-wasm.js default browser loader; sql-js.weapp.cjs supplies instantiateWasm so this loader is bypassed.' },
  { api: 'fetch', file: 'common.js', before: /n\.p=1,t=$/, after: /^\(r,\{credentials:"same-origin"/, count: 1, reason: 'vendor/sql-wasm.js default browser loader; sql-js.weapp.cjs supplies instantiateWasm so this loader is bypassed.' },
  { api: 'XMLHttpRequest', file: 'common.js', before: /C=function\(n\)\{var e=new $/, after: /^;return e\.open\("GET",n,!1\)/, count: 1, reason: 'vendor/sql-wasm.js synchronous browser loader; the WeChat adapter supplies instantiateWasm and never enters it.' },
  { api: 'XMLHttpRequest', file: 'common.js', before: /Promise\(function\(n,r\)\{var t=new $/, after: /^;t\.open\("GET",e,!0\)/, count: 1, reason: 'vendor/sql-wasm.js async browser loader; the WeChat adapter supplies instantiateWasm and never enters it.' },
  { api: 'Blob', file: 'account/fflate.umd.js', before: /URL\.createObjectURL\(new $/, after: /^\(\[t\+/, count: 1, reason: 'fflate uses Blob only in its optional async Worker factory; ShuShuGo loads synchronous gzipSync/gunzipSync.' },
  { api: 'AbortController', file: 'common.js', before: /,o=new $/, after: /^,u=setTimeout\(function\(\)\{return o\.abort\(\)\}/, count: 1, reason: 'The cloud-fetch adapter installs AbortController before application modules evaluate.' },
  { api: 'AbortController', file: 'common.js', before: /,r=new $/, after: /^,t=setTimeout\(function\(\)\{return r\.abort\(\)\}/, count: 1, reason: 'The cloud-fetch adapter installs AbortController before application modules evaluate.' },
  { api: 'Blob', file: 'common.js', before: /case 4:return i=new $/, after: /^\(\[z\(e\)\]\)\.stream\(\)\.pipeThrough\(new CompressionStream/, count: 0, reason: 'Webpack binds this browser reference to globalThis.Blob; the app polyfill supplies Blob and a WeChat file-export path.' },
  { api: 'Blob', file: 'common.js', before: /case 6:u=new $/, after: /^\(\[z\(e\)\]\)\.stream\(\)\.pipeThrough\(new DecompressionStream/, count: 0, reason: 'Webpack binds this browser reference to globalThis.Blob; the app polyfill supplies Blob and a WeChat file-export path.' },
  { api: 'CompressionStream', file: 'common.js', before: /pipeThrough\(new $/, after: /^\("gzip"\)\),o=Uint8Array,n\.n=5,new Response/, count: 1, reason: 'sync/snapshot.ts exits through its Capacitor wechat branch before using browser compression APIs.' },
  { api: 'DecompressionStream', file: 'common.js', before: /pipeThrough\(new $/, after: /^\("gzip"\)\),s=u\.getReader\(/, count: 1, reason: 'sync/snapshot.ts exits through its Capacitor wechat branch before using browser decompression APIs.' },
  { api: 'Response', file: 'common.js', before: /n\.n=5,new $/, after: /^\(i\)\.arrayBuffer\(/, count: 1, reason: 'sync/snapshot.ts exits through its Capacitor wechat branch before constructing a browser Response.' },
  { api: 'indexedDB', file: 'common.js', before: /var r=$/, after: /^\.open\(nn,1\)/, count: 1, reason: 'storage.ts reaches openBrowserDatabase only when isNativeFileStorage is false; Capacitor platform wechat makes it true.' },
  { api: 'performance', file: 'common.js', before: /Ze\(n,$/, after: /^\.now\(\)/, count: 0, reason: 'Webpack binds SQL.js timer references to the Date.now-backed globalThis.performance shim.' },
  { api: 'performance', file: 'common.js', before: /return $/, after: /^\.now\(\)/, count: 0, reason: 'Webpack binds SQL.js timer references to the Date.now-backed globalThis.performance shim.' },
  { api: 'crypto', file: 'common.js', before: /=$/, after: /^\.randomUUID\(/, count: 3, reason: 'These sync/schema.ts device identifiers use the randomUUID shim installed by scripts/shared/polyfill.js.' },
  { api: 'crypto', file: 'common.js', before: /return $/, after: /^\.getRandomValues\(n\)/, count: 1, reason: 'sql.js Emscripten random_get is used by SQLite RANDOM() queries; the startup polyfill provides a non-cryptographic byte filler for ordering and seed values only.' },
  { api: 'Worker', file: 'common.js', before: /\\u8bf7\\u6c42 $/, after: /^ /, count: 1, reason: 'Worker is part of a user-facing error string saying direct Worker-domain requests are refused; it is not a Worker reference.' },
  { api: 'Worker', file: 'account/fflate.umd.js', before: /var a=new $/, after: /^\(n\[e\]\|\|\(n\[e\]=URL\.createObjectURL\(new Blob/, count: 1, reason: 'fflate emits this optional async Worker factory; the Mini Program calls only synchronous gzipSync/gunzipSync.' },
  { api: 'fetch', file: 'account/settings/index.js', before: /export-moji-review-data\.py --$/, after: /^"/, count: 1, reason: 'This is the documented `--fetch` command shown as code in SettingsPage, not a network call.' },
  { api: 'Worker', file: 'account/settings/index.js', before: /VITE_SYNC_API_URL\\uff0c\\u90e8\\u7f72 Cloudflare $/, after: /^ /, count: 1, reason: 'Worker is part of a user-facing Cloudflare deployment instruction string, not a Worker reference.' },
  { api: 'Image', file: 'taro.js', before: /\(View\|$/, after: /^\|Text\)\$/, count: 1, reason: 'Image is a component name inside Taro’s element-order regex, not the browser Image constructor.' },
  { api: 'atob', file: 'common.js', before: /var e=$/, after: /^\(n\),r=new Uint8Array\(e\.length\)/, count: 2, reason: 'The base64 decoder is supplied by scripts/shared/polyfill.js using wx.base64ToArrayBuffer.' },
  { api: 'btoa', file: 'common.js', before: /return $/, after: /^\(e\)},Sn=function/, count: 1, reason: 'The base64 encoder is supplied by scripts/shared/polyfill.js using wx.arrayBufferToBase64.' }
];

function* javascriptFiles(directory, relative = '') {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const name = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) yield* javascriptFiles(absolute, name);
    else if (entry.isFile() && entry.name.endsWith('.js')) yield [absolute, name];
  }
}

function escaped(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function guarded(source, start, end, api) {
  const context = source.slice(Math.max(0, start - 90), end + 60);
  return new RegExp(`typeof\\s+(globalThis\\.|window\\.|self\\.)?${escaped(api)}`).test(context)
    || new RegExp(`["']${escaped(api)}["']\\s+in\\s`).test(context)
    || new RegExp(`(globalThis|window|self)\\s*\\??\\.\\s*${escaped(api)}`).test(context);
}

if (!fs.existsSync(root)) {
  console.error(`Mini Program build output not found: ${root}`);
  process.exit(1);
}

const files = [...javascriptFiles(root)];
const found = [];
for (const [absolute, file] of files) {
  const source = fs.readFileSync(absolute, 'utf8');
  for (const api of APIs) {
    const pattern = new RegExp(`(?<![\\w$.])${escaped(api)}(?![\\w$])`, 'g');
    for (const match of source.matchAll(pattern)) {
      const start = match.index;
      const end = start + api.length;
      const before = source.slice(Math.max(0, start - 120), start);
      const after = source.slice(end, end + 120);
      if ((after.startsWith(':') && !after.startsWith('::')) || /["'`]$/.test(before) || guarded(source, start, end, api)) continue;
      found.push({ api, file, before, after });
    }
  }
}

const counts = new Map(allowlist.map((rule) => [rule, 0]));
const unexpected = [];
for (const hit of found) {
  const matches = allowlist.filter((rule) => rule.api === hit.api && rule.file === hit.file
    && rule.before.test(hit.before) && rule.after.test(hit.after));
  if (matches.length !== 1) {
    unexpected.push({ ...hit, matches: matches.length });
    continue;
  }
  counts.set(matches[0], counts.get(matches[0]) + 1);
}

const countErrors = allowlist.filter((rule) => counts.get(rule) !== rule.count);
if (unexpected.length || countErrors.length) {
  for (const hit of unexpected) {
    console.error(`Unexpected unguarded ${hit.api} in ${hit.file}: …${hit.before.slice(-72)}<${hit.api}>${hit.after.slice(0, 72)}… (allowlist matches: ${hit.matches})`);
  }
  for (const rule of countErrors) {
    console.error(`Allowlist count changed for ${rule.api} in ${rule.file}: expected ${rule.count}, found ${counts.get(rule)}; ${rule.reason}`);
  }
  process.exit(1);
}

console.log(`WeChat API gate passed: ${found.length} unguarded matches across ${files.length} JavaScript files.`);
for (const rule of allowlist) console.log(`  ${rule.api} × ${rule.count} in ${rule.file}: ${rule.reason}`);
