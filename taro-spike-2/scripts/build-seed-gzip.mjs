import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(root, '../frontend/public/nihongo.db');
const output = process.argv[2];
if (!output) throw new Error('usage: node scripts/build-seed-gzip.mjs <output-file>');

const destination = path.resolve(output);
const sourceBytes = fs.readFileSync(source);
const compressed = gzipSync(sourceBytes, { level: 9, mtime: 0 });
const brotli = brotliCompressSync(sourceBytes, {
  params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 6 }
});
const require = createRequire(import.meta.url);
const { gunzipSync } = require('../../wechat-miniprogram/src/vendor/fflate.umd.js');
const started = process.hrtime.bigint();
const inflated = gunzipSync(compressed);
const fflateDecodeMs = Number(process.hrtime.bigint() - started) / 1e6;
if (!Buffer.from(inflated).equals(sourceBytes)) throw new Error('fflate gzip roundtrip did not match the factory database');
const brotliStarted = process.hrtime.bigint();
const brotliInflated = brotliDecompressSync(brotli);
const brotliDecodeMs = Number(process.hrtime.bigint() - brotliStarted) / 1e6;
if (!brotliInflated.equals(sourceBytes)) throw new Error('Brotli roundtrip did not match the factory database');
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, compressed);
console.log(JSON.stringify({
  source,
  output: destination,
  originalBytes: sourceBytes.byteLength,
  gzipBytes: compressed.byteLength,
  savedBytes: sourceBytes.byteLength - compressed.byteLength,
  ratio: Number((compressed.byteLength / sourceBytes.byteLength).toFixed(4)),
  fflateDecodeMs: Number(fflateDecodeMs.toFixed(3)),
  brotliBytes: brotli.byteLength,
  brotliQuality: 6,
  brotliDecodeMs: Number(brotliDecodeMs.toFixed(3)),
  gzipRoundtripMatches: true,
  brotliRoundtripMatches: true
}, null, 2));
