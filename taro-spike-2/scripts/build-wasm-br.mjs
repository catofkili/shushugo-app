import fs from 'node:fs';
import path from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(root, '../wechat-miniprogram/src/assets/sql-wasm.wasm');
const output = path.join(root, 'assets/sql-wasm.wasm.br');
const bytes = fs.readFileSync(source);
const compressed = brotliCompressSync(bytes, {
  params: {
    [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_GENERIC,
    [constants.BROTLI_PARAM_QUALITY]: 11
  }
});
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, compressed);
console.log(`sql.js WASM Brotli q11: ${bytes.byteLength} -> ${compressed.byteLength} B`);
