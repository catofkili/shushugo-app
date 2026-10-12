import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync, spawnSync } from 'node:child_process';
import { gunzipSync, brotliDecompressSync } from 'node:zlib';
import { audioPackGroups, buildAudioPacks } from './build-audio-packs.mjs';
import { pronunciationAudioName, exampleAudioName } from '../src/lib/speech-audio.ts';
import { validateAudioPackIndex, decodeAudioPack } from '../src/lib/audio-pack-format.ts';

const temporary = [];
beforeEach(() => { vi.spyOn(console, "log").mockImplementation(() => {}); });
afterEach(() => { for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });
const fixture = () => {
  const dir = mkdtempSync(join(tmpdir(), 'shushugo-audio-packs-')); temporary.push(dir);
  const source = join(dir, 'source'), output = join(dir, 'out');
  const db = new DatabaseSync(resolve('public/nihongo.db'), { readOnly: true });
  const word = db.prepare("SELECT kanji,kana,example_jp FROM words WHERE example_jp!='' ORDER BY id LIMIT 1").get(); db.close();
  // A bounded ADTS frame for parser tests, not a listening-quality fixture.
  const aac = Buffer.from([0xff, 0xf1, 0x50, 0x80, 0, 0xff, 0xfc]);
  for (const voice of ['voicevox-8', 'voicevox-10', 'voicevox-11']) {
    for (const [kind, hash] of [['words', pronunciationAudioName(word.kanji, word.kana)], ['examples', exampleAudioName(word.example_jp)]]) {
      mkdirSync(join(source, kind, voice), { recursive: true }); writeFileSync(join(source, kind, voice, `${hash}.aac`), aac);
    }
  }
  return { dir, source, output, word, aac };
};

it('groups the actual level/importance tiers, keeps word + example together, and separates grammar', () => {
  const words = Array.from({ length: 65 }, (_, i) => ({ kanji: `word${i}`, kana: `kana${i}`, example_jp: `sentence${i}`, jlpt_level: 'N3', importance: 5 }));
  words.push({ kanji: 'late', kana: 'later', example_jp: 'late sentence', jlpt_level: 'N1', importance: 5 });
  const groups = audioPackGroups(words, [{ id: 1, level: 'N5', sort_order: 1, example_jp: 'grammar' }]);
  expect(groups.map(g => g.items.length)).toEqual([64, 1, 1, 1]);
  expect(groups[0].items[0].keys).toEqual([`w:${pronunciationAudioName('word0', 'kana0')}`, `e:${exampleAudioName('sentence0')}`]);
  expect(groups.at(-1).id).toMatch(/^g-n5/);
});

it('produces stable hashed packs and indexes; re-synthesizing one sentence replaces only its voice/pack', () => {
  const f = fixture();
  const first = buildAudioPacks(f);
  const before = readFileSync(join(f.output, 'current.json'));
  const original = JSON.parse(readFileSync(join(f.output, 'upload.json'))).files;
  expect(buildAudioPacks(f).version).toBe(first.version);
  expect(readFileSync(join(f.output, 'current.json'))).toEqual(before);
  const compressed = gunzipSync(readFileSync(join(f.output, `index-${first.version}.json.gz`)));
  expect(brotliDecompressSync(readFileSync(join(f.output, `index-${first.version}.json.br`)))).toEqual(compressed);
  const index = validateAudioPackIndex(JSON.parse(compressed));
  const voice = index.voices[0], w = `w:${pronunciationAudioName(f.word.kanji, f.word.kana)}`, e = `e:${exampleAudioName(f.word.example_jp)}`;
  expect(voice.clips[w][0]).toBe(voice.clips[e][0]);
  const [pack] = voice.packs[voice.clips[w][0]], bytes = readFileSync(join(f.output, pack));
  const [offset, length] = decodeAudioPack(bytes)[w]; expect(bytes.subarray(offset, offset + length)).toEqual(f.aac);
  writeFileSync(join(f.source, 'examples/voicevox-8', `${exampleAudioName(f.word.example_jp)}.aac`), Buffer.concat([f.aac, f.aac]));
  const updated = buildAudioPacks(f);
  expect(updated.version).not.toBe(first.version);
  const files = JSON.parse(readFileSync(join(f.output, 'upload.json'))).files.filter(n => n.endsWith('.sap'));
  expect(files.filter(n => !original.includes(n))).toHaveLength(1);
  expect(readdirSync(join(f.source, 'words/voicevox-8'))).toHaveLength(1); // No source cleanup or synthesis.
  const manifest = resolve('../wechat-miniprogram/scripts/audio-pack-upload-manifest.mjs');
  expect(execFileSync(process.execPath, ['--no-warnings', manifest, f.output], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })).toContain('voicevox-11/');
  writeFileSync(join(f.output, files[0]), Buffer.alloc(1));
  expect(() => execFileSync(process.execPath, ['--no-warnings', manifest, f.output], { stdio: 'pipe' })).toThrow();
}, 20_000);

it('refuses an output path that reaches audio-src through a parent symlink', () => {
  const f = fixture(); symlinkSync(f.source, join(f.dir, 'alias'), 'dir');
  expect(() => buildAudioPacks({ source: f.source, output: join(f.dir, 'alias/new-output') })).toThrow('Output must not be inside audio-src');
});

it('uploads only cloud-missing artifacts, clears proxies, publishes the pointer last, and aborts before publishing on errors', () => {
  const f = fixture(); buildAudioPacks(f);
  const artifacts = JSON.parse(readFileSync(join(f.output, 'upload.json'))).files;
  const log = join(f.dir, 'uploads.jsonl'), bin = join(f.dir, 'bin'); mkdirSync(bin);
  writeFileSync(join(bin, 'curl'), `#!${process.execPath}\nconst fs=require('fs');const args=process.argv.slice(2), url=args.at(-1);if(url.endsWith('current.json')){fs.writeFileSync(args[args.indexOf('--output')+1], '{}');process.stdout.write('200');}else process.stdout.write(process.env.HEAD_STATUS|| (url.endsWith(${JSON.stringify(artifacts[0])}) ? '200':'404'));\n`, { mode: 0o755 });
  writeFileSync(join(bin, 'tcb'), `#!${process.execPath}\nconst fs=require('fs');if(['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'].some(k=>process.env[k]))process.exit(91);fs.appendFileSync(process.env.UPLOAD_LOG,JSON.stringify(process.argv.slice(2))+'\\n');if(process.env.FAIL_UPLOAD)process.exit(1);\n`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, TCB: join(bin, 'tcb'), PACK_DIST: f.output, UPLOAD_LOG: log,
    HTTP_PROXY: 'fake', HTTPS_PROXY: 'fake', ALL_PROXY: 'fake', http_proxy: 'fake', https_proxy: 'fake', all_proxy: 'fake' };
  const script = resolve('../wechat-miniprogram/scripts/upload-cloud-content.sh');
  const run = extra => spawnSync('bash', [script, '--packs'], { encoding: 'utf8', env: { ...env, ...extra } });
  expect(run({}).status).toBe(0);
  const calls = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
  expect(calls.at(-1)[3]).toBe('audio/packs/current.json');
  expect(calls.slice(0, -1).map(c => c[3])).not.toContain(`audio/packs/${artifacts[0]}`);
  expect(calls).toHaveLength(artifacts.length); // One skipped artifact, plus current.json.
  writeFileSync(log, ''); const denied = run({ HEAD_STATUS: '403' }); expect(denied.status, denied.stdout + denied.stderr).not.toBe(0); expect(readFileSync(log, 'utf8')).toBe('');
  writeFileSync(log, ''); expect(run({ FAIL_UPLOAD: '1' }).status).not.toBe(0); expect(readFileSync(log, 'utf8')).not.toContain('current.json');
}, 20_000);
