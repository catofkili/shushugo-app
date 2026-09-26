const assert = require('node:assert/strict');

globalThis.Blob = undefined;
globalThis.FileReader = undefined;
let written;
let shared;
globalThis.wx = {
  env: { USER_DATA_PATH: '/shushugo' },
  getFileSystemManager: () => ({
    writeFile: ({ data, success }) => { written = Buffer.from(data).toString(); success(); },
    readFile: ({ filePath, encoding, success }) => {
      assert.equal(filePath, '/tmp/avatar.png');
      assert.equal(encoding, 'base64');
      success({ data: Buffer.from('png').toString('base64') });
    }
  }),
  base64ToArrayBuffer: (data) => Uint8Array.from(Buffer.from(data, 'base64')).buffer,
  shareFileMessage: ({ filePath, fileName }) => { shared = { filePath, fileName }; }
};

require('../src/platform/browser-runtime.weapp.cjs');

async function main() {
  const blob = new Blob(['ShuShuGo'], { type: 'text/plain' });
  assert.equal(blob.size, 8);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'export.txt';
  link.click();
  URL.revokeObjectURL(link.href);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(written, 'ShuShuGo');
  assert.deepEqual(shared, { filePath: '/shushugo/export.txt', fileName: 'export.txt' });

  const reader = new FileReader();
  const loaded = new Promise((resolve) => { reader.onload = resolve; });
  reader.readAsDataURL({ path: '/tmp/avatar.png', type: 'image/png' });
  await loaded;
  assert.equal(reader.result, 'data:image/png;base64,cG5n');
  console.log('WeChat Blob export and FileReader shims passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
