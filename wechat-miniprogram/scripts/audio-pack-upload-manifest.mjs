// Local-only validation. Cloud permissions/configuration are never changed by the upload script.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync, brotliDecompressSync } from 'node:zlib';
import { validateAudioPackIndex, decodeAudioPack } from '../../frontend/src/lib/audio-pack-format.ts';
const dir = resolve(process.argv[2]);
const read = name => readFileSync(resolve(dir, name));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(read('upload.json'));
const current = JSON.parse(read('current.json'));
if (manifest.version !== current.version || !/^[0-9a-f]{64}$/.test(current.version)) throw new Error('Audio pointer/manifest mismatch');
const gzip = gunzipSync(read(`index-${current.version}.json.gz`));
const br = brotliDecompressSync(read(`index-${current.version}.json.br`));
if (!gzip.equals(br) || sha(gzip) !== current.version) throw new Error('Audio catalog hash mismatch');
const index = validateAudioPackIndex(JSON.parse(gzip));
if (!['voicevox-8', 'voicevox-10', 'voicevox-11'].every(id => index.voices.some(v => v.id === id))) throw new Error('Build all three voices before uploading (--voice voicevox-8 is for measurement only)');
const expected = index.voices.flatMap(v => v.packs.map(([name]) => name)).concat([`index-${current.version}.json.gz`, `index-${current.version}.json.br`]);
if (manifest.files.length !== expected.length || new Set(manifest.files).size !== expected.length || expected.some(name => !manifest.files.includes(name))) throw new Error('Audio upload list mismatch');
for (const voice of index.voices) {
  for (const [name, size] of voice.packs) {
    const bytes = read(name);
    if (size !== bytes.length || !name.endsWith(`-${sha(bytes)}.sap`)) throw new Error(`Audio pack hash mismatch: ${name}`);
    const clips = decodeAudioPack(bytes);
    for (const [key, [slot, offset, length]] of Object.entries(voice.clips)) {
      if (voice.packs[slot][0] === name && (clips[key]?.[0] !== offset || clips[key]?.[1] !== length)) throw new Error(`Audio mapping mismatch: ${key}`);
    }
  }
  if (!voice.complete) console.error(`${voice.label} 的源音频尚未齐全：见 missing.json；付费声音在三端继续显示即将上架。`);
}
console.log(expected.join('\n'));
