import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';

const traverse = traverseModule.default ?? traverseModule;

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
  { api: 'URL', file: 'taro.js', before: /Invalid $/, after: /^"\);[a-z]+=[a-z]+\?[a-z]+\.startsWith\("\/\/"\)/, count: 1, reason: 'Taro emits URL in its parser error text immediately before relative-URL parsing; this is not a global URL access.' },
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
  { api: 'indexedDB', file: 'common.js', before: /var r=$/, after: /^\.open\(\w+,1\)/, count: 1, reason: 'storage.ts reaches openBrowserDatabase only when isNativeFileStorage is false; Capacitor platform wechat makes it true.' },
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
  { api: 'btoa', file: 'common.js', before: /return $/, after: /^\(e\)},\w+=function/, count: 1, reason: 'The base64 encoder is supplied by scripts/shared/polyfill.js using wx.arrayBufferToBase64.' }
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

// These are the members declared by Taro 4.2.1's runtime classes, not the
// incidental globals copied by TaroWindow's constructor. Additions made by our
// WeChat adapter are listed beside their source below.
const providedMembers = {
  window: new Set([
    'navigator', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'Date',
    'location', 'history', 'document', 'addEventListener', 'removeEventListener', 'setTimeout',
    'clearTimeout', 'innerWidth', 'innerHeight', 'devicePixelRatio', 'initEvent', 'on', 'off', 'trigger',
    // app-polyfills.weapp.ts forwards window.dispatchEvent into TaroWindow's Events.
    'dispatchEvent',
    // Added by app-polyfills.weapp.ts using the WeChat JS timer globals.
    'setInterval', 'clearInterval'
  ]),
  // TaroDocument inherits TaroElement -> TaroNode -> TaroEventTarget.
  // Sources: @tarojs/runtime/dist/{dom/document,element,node,event-target}.d.ts.
  document: new Set([
    'documentElement', 'head', 'body', 'visibilityState', 'hidden', 'createEvent', 'cookie', 'createElement', 'createElementNS',
    'createTextNode', 'getElementById', 'querySelector', 'querySelectorAll', 'createComment', 'defaultView',
    'ctx', 'tagName', 'props', 'style', 'dataset', 'innerHTML', 'id', 'className', 'cssText', 'classList',
    'children', 'attributes', 'textContent', 'hasAttribute', 'hasAttributes', 'focus', 'blur', 'setAttribute',
    'removeAttribute', 'getAttribute', 'getElementsByTagName', 'getElementsByClassName', 'dispatchEvent',
    'addEventListener', 'removeEventListener', 'uid', 'sid', 'nodeType', 'nodeName', 'parentNode', 'childNodes',
    '_root', '_path', 'nextSibling', 'previousSibling', 'parentElement', 'firstChild', 'lastChild',
    'insertBefore', 'appendChild', 'replaceChild', 'removeChild', 'remove', 'hasChildNodes', 'enqueueUpdate',
    'ownerDocument', 'extend'
  ]),
  // TaroURL's static create/revoke methods are replaced in app-polyfills.weapp.ts;
  // instance properties come from @tarojs/runtime/dist/bom/URL.d.ts.
  URL: new Set([
    'createObjectURL', 'revokeObjectURL', 'protocol', 'host', 'hostname', 'port', 'pathname', 'search',
    'hash', 'href', 'origin', 'searchParams', 'toString', 'toJSON', '_toRaw'
  ]),
  // Exact object returned by @tarojs/runtime/dist/bom/navigator.js.
  navigator: new Set([
    'appCodeName', 'appName', 'appVersion', 'cookieEnabled', 'mimeTypes', 'onLine', 'platform', 'plugins',
    'product', 'productSub', 'userAgent', 'vendor', 'vendorSub'
  ]),
  // TaroLocation/TaroHistory declarations plus inherited @tarojs/shared Events methods.
  location: new Set([
    'protocol', 'host', 'hostname', 'port', 'pathname', 'search', 'hash', 'href', 'origin', 'assign', 'reload',
    'replace', 'toString', 'cache', 'on', 'off', 'trigger'
  ]),
  history: new Set([
    'length', 'state', 'go', 'back', 'forward', 'pushState', 'replaceState', 'cache', 'on', 'off', 'trigger'
  ])
};

// Unsupported but deliberately retained accesses must have an exact count and
// a reason tied to an unreachable or capability-guarded path. Keep this list
// empty unless that condition is demonstrable from the source.
const memberAllowlist = [
  { object: 'window', member: 'prompt', file: 'common.js', count: 1, reason: 'This is SQL.js’s optional stdin fallback; generated code checks whether window.prompt exists before calling it, and ShuShuGo never reads SQLite from interactive stdin.' },
  { object: 'document', member: 'createTreeWalker', file: /^(content-pages|grammar-pages)\/sub-common\/.*\.js$|^lazy\/tabs\.js$/, count: 6, reason: 'GrammarHighlightProvider returns before selection/highlight work when touchEventsEnabled() is true; Mini Program text selection is not implemented.' },
  { object: 'document', member: 'createRange', file: /^(content-pages|grammar-pages)\/sub-common\/.*\.js$|^lazy\/tabs\.js$/, count: 4, reason: 'GrammarHighlightProvider returns before selection/highlight work when touchEventsEnabled() is true; Mini Program text selection is not implemented.' },
  { object: 'window', member: 'getSelection', file: /^(content-pages|grammar-pages)\/sub-common\/.*\.js$|^lazy\/tabs\.js$/, count: 4, reason: 'GrammarHighlightProvider returns before selection/highlight work when touchEventsEnabled() is true; Mini Program text selection is not implemented.' },
  { object: 'document', member: 'fonts', file: 'content-pages/weekly-report/index.js', count: 1, reason: 'The optional chain in weekly-report-share.ts checks whether fonts.ready exists; awaiting the missing Mini Program font set resolves immediately.' },
  { object: 'navigator', member: 'scheduling', file: 'vendors.js', count: 1, reason: 'React Scheduler reads this optional capability and falls back to its timer yield when absent; it does not call through the missing value.' }
];
const membersFound = [];
const memberCounts = new Map(memberAllowlist.map((rule) => [rule, 0]));
const unsupportedMembers = [];

function propertyName(node) {
  if (!node.computed && node.property.type === 'Identifier') return node.property.name;
  if (node.computed && node.property.type === 'StringLiteral') return node.property.value;
  return null;
}

function isModuleFactory(functionPath) {
  const { params } = functionPath.node;
  const property = functionPath.parentPath;
  return params.length >= 3 && params[2].type === 'Identifier'
    && property.isObjectProperty() && property.node.key.type === 'NumericLiteral';
}

function isGuarded(memberPath, source) {
  if (memberPath.node.optional) return true;
  const parent = memberPath.parentPath;
  if (parent.isOptionalMemberExpression() && parent.node.object === memberPath.node && parent.node.optional) return true;
  if (parent.isOptionalCallExpression() && parent.node.callee === memberPath.node && parent.node.optional) return true;
  if (parent.isUnaryExpression({ operator: 'typeof' })) return true;
  const { start, end } = memberPath.node;
  const nearby = source.slice(Math.max(0, start - 100), Math.min(source.length, end + 120));
  const name = memberPath.node.property.name;
  return typeof name === 'string' && new RegExp(`typeof\\s+[^;{}]{0,100}\\b${name}\\b`).test(nearby)
    && /&&|\?\./.test(nearby);
}

for (const [absolute, file] of files) {
  const source = fs.readFileSync(absolute, 'utf8');
  let ast;
  try {
    ast = parse(source, { sourceType: 'unambiguous', plugins: ['optionalChaining'] });
  } catch (error) {
    console.error(`Cannot parse built JavaScript ${file}: ${error.message}`);
    process.exitCode = 1;
    continue;
  }

  traverse(ast, {
    FunctionExpression(factory) {
      if (!isModuleFactory(factory)) return;
      const requireName = factory.node.params[2].name;
      const aliases = new Map();
      const derivedTypes = new WeakMap();
      factory.traverse({
        VariableDeclarator(declaration) {
          const init = declaration.node.init;
          if (!init || init.type !== 'MemberExpression' || declaration.node.id.type !== 'Identifier') return;
          const object = init.object;
          const exportedName = propertyName(init);
          if (!providedMembers[exportedName] || object.type !== 'CallExpression'
            || object.callee.type !== 'Identifier' || object.callee.name !== requireName
            || object.arguments.length !== 1 || object.arguments[0].type !== 'NumericLiteral') return;
          aliases.set(declaration.node.id.name, { type: exportedName, declaration: declaration.node });
        }
      });
      if (!aliases.size) return;

      factory.traverse({
        MemberExpression(memberPath) { record(memberPath); },
        OptionalMemberExpression(memberPath) { record(memberPath); }
      });

      function record(memberPath) {
        const object = memberPath.node.object;
        let objectType;
        if (object.type === 'Identifier') {
          const alias = aliases.get(object.name);
          if (!alias || memberPath.scope.getBinding(object.name)?.path.node !== alias.declaration) return;
          objectType = alias.type;
        } else if ((object.type === 'MemberExpression' || object.type === 'OptionalMemberExpression') && derivedTypes.has(object)) {
          objectType = derivedTypes.get(object);
        } else return;

        const member = propertyName(memberPath.node);
        const hit = { file, object: objectType, member: member ?? '<dynamic>', guarded: isGuarded(memberPath, source) };
        membersFound.push(hit);
        const childType = objectType === 'window' && ['document', 'navigator', 'location', 'history'].includes(member)
          ? member : null;
        if (childType) derivedTypes.set(memberPath.node, childType);
        if (member !== null && providedMembers[objectType].has(member)) return;
        if (hit.guarded) return;

        const matches = memberAllowlist.filter((rule) => rule.object === objectType && rule.member === hit.member
          && (rule.file instanceof RegExp ? rule.file.test(file) : rule.file === file));
        if (matches.length !== 1) {
          unsupportedMembers.push({ ...hit, matches: matches.length });
          return;
        }
        memberCounts.set(matches[0], memberCounts.get(matches[0]) + 1);
      }
    }
  });
}

const staleMemberAllowlist = memberAllowlist.filter((rule) => memberCounts.get(rule) !== rule.count);
const platformSourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/platform');
const forbiddenGlobalShimWrites = [];
const shimNames = new Set(['window', 'document', 'URL']);

function* sourceFiles(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(absolute);
    else if (entry.isFile() && /\.(?:c?js|tsx?)$/.test(entry.name)) yield absolute;
  }
}

function globalShimNames(value) {
  if (!value) return [];
  if (value.type === 'StringLiteral') return shimNames.has(value.value) ? [value.value] : [];
  if (value.type !== 'ObjectExpression') return [];
  return value.properties.flatMap((property) => {
    if (property.type !== 'ObjectProperty') return [];
    const name = propertyName({ computed: property.computed, property: property.key });
    return name && shimNames.has(name) ? [name] : [];
  });
}

for (const absolute of sourceFiles(platformSourceRoot)) {
  const source = fs.readFileSync(absolute, 'utf8');
  let ast;
  try {
    ast = parse(source, { sourceType: 'unambiguous', plugins: ['optionalChaining', 'typescript', 'jsx'] });
  } catch (error) {
    console.error(`Cannot parse platform source ${path.relative(platformSourceRoot, absolute)}: ${error.message}`);
    process.exit(1);
  }
  traverse(ast, {
    AssignmentExpression(nodePath) {
      const left = nodePath.node.left;
      if (left.type !== 'MemberExpression' || left.object.type !== 'Identifier' || left.object.name !== 'globalThis') return;
      const name = propertyName(left);
      if (name && shimNames.has(name)) forbiddenGlobalShimWrites.push({ file: path.relative(platformSourceRoot, absolute), name });
    },
    UpdateExpression(nodePath) {
      const argument = nodePath.node.argument;
      if (argument.type !== 'MemberExpression' || argument.object.type !== 'Identifier' || argument.object.name !== 'globalThis') return;
      const name = propertyName(argument);
      if (name && shimNames.has(name)) forbiddenGlobalShimWrites.push({ file: path.relative(platformSourceRoot, absolute), name });
    },
    CallExpression(nodePath) {
      const { callee, arguments: args } = nodePath.node;
      if (callee.type !== 'MemberExpression' || callee.object.type !== 'Identifier' || callee.object.name !== 'Object') return;
      const method = propertyName(callee);
      if (method === 'defineProperty' && args[0]?.type === 'Identifier' && args[0].name === 'globalThis') {
        const name = args[1]?.type === 'StringLiteral' ? args[1].value : null;
        if (name && shimNames.has(name)) forbiddenGlobalShimWrites.push({ file: path.relative(platformSourceRoot, absolute), name });
      }
      if (method === 'defineProperties' && args[0]?.type === 'Identifier' && args[0].name === 'globalThis') {
        for (const name of globalShimNames(args[1])) forbiddenGlobalShimWrites.push({ file: path.relative(platformSourceRoot, absolute), name });
      }
      if (method === 'assign' && args[0]?.type === 'Identifier' && args[0].name === 'globalThis') {
        for (const argument of args.slice(1)) {
          for (const name of globalShimNames(argument)) forbiddenGlobalShimWrites.push({ file: path.relative(platformSourceRoot, absolute), name });
        }
      }
    }
  });
}

if (unexpected.length || countErrors.length || unsupportedMembers.length || staleMemberAllowlist.length || forbiddenGlobalShimWrites.length) {
  for (const hit of unexpected) {
    console.error(`Unexpected unguarded ${hit.api} in ${hit.file}: …${hit.before.slice(-72)}<${hit.api}>${hit.after.slice(0, 72)}… (allowlist matches: ${hit.matches})`);
  }
  for (const rule of countErrors) {
    console.error(`Allowlist count changed for ${rule.api} in ${rule.file}: expected ${rule.count}, found ${counts.get(rule)}; ${rule.reason}`);
  }
  for (const hit of unsupportedMembers) {
    console.error(`Unsupported Taro ${hit.object}.${hit.member} in ${hit.file}${hit.guarded ? ' (guarded)' : ''} (allowlist matches: ${hit.matches})`);
  }
  for (const rule of staleMemberAllowlist) {
    console.error(`Taro member allowlist count changed for ${rule.object}.${rule.member}: expected ${rule.count}, found ${memberCounts.get(rule)}; ${rule.reason}`);
  }
  for (const hit of forbiddenGlobalShimWrites) {
    console.error(`Do not patch globalThis.${hit.name} in ${hit.file}; Taro supplies a separate runtime object.`);
  }
  process.exit(1);
}

console.log(`WeChat API gate passed: ${found.length} unguarded matches across ${files.length} JavaScript files.`);
for (const rule of allowlist) console.log(`  ${rule.api} × ${rule.count} in ${rule.file}: ${rule.reason}`);
console.log(`Taro object member gate passed: ${membersFound.length} accesses across ${files.length} JavaScript files.`);
for (const rule of memberAllowlist) console.log(`  ${rule.object}.${rule.member} × ${rule.count}: ${rule.reason}`);
console.log('Taro global shim audit passed: no globalThis.window/document/URL patches in platform sources.');
