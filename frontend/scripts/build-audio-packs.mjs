#!/usr/bin/env node
// Read-only source: never call the synthesis scripts here (their orphan cleanup mutates audio-src).
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { encodeAudioPack, decodeAudioPack, validateAudioPackIndex, clipKey } from '../src/lib/audio-pack-format.ts';
import { pronunciationAudioName, exampleAudioName } from '../src/lib/speech-audio.ts';

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const rank = level => level === 'N2' ? 2 : level === 'N1' ? 3 : 1;
export const WORDS_PER_PACK = 64;
export function audioPackGroups(words, grammar) {
  const unique = new Map(words.map(w => [pronunciationAudioName(w.kanji, w.kana), w]));
  const sorted = [...unique.values()].sort((a, b) => rank(a.jlpt_level) - rank(b.jlpt_level) || b.importance - a.importance || order(a.kanji, b.kanji) || order(a.kana, b.kana));
  const groups = [];
  let group;
  for (const w of sorted) {
    const tier = `w-r${rank(w.jlpt_level)}-i${w.importance}`;
    if (!group || group.tier !== tier || group.items.length === WORDS_PER_PACK) {
      group = { tier, id: `${tier}-${groups.filter(g => g.tier === tier).length}`, items: [] }; groups.push(group);
    }
    group.items.push({ word: w, keys: [clipKey('words', pronunciationAudioName(w.kanji, w.kana)), ...(w.example_jp?.trim() ? [clipKey('examples', exampleAudioName(w.example_jp))] : [])] });
  }
  for (const g of [...grammar].sort((a, b) => order(b.level, a.level) || a.sort_order - b.sort_order || a.id - b.id)) {
    const tier = `g-${g.level.toLowerCase()}`;
    if (!group || group.tier !== tier || group.items.length === WORDS_PER_PACK) {
      group = { tier, id: `${tier}-${groups.filter(x => x.tier === tier).length}`, items: [] }; groups.push(group);
    }
    if (g.example_jp?.trim()) group.items.push({ keys: [clipKey('examples', exampleAudioName(g.example_jp))] });
  }
  return groups;
}

export function buildAudioPacks({ source = join(frontend, 'public/audio-src'), output = join(frontend, 'audio-pack-dist'), voices = ['voicevox-8', 'voicevox-10', 'voicevox-11'] } = {}) {
  source = realpathSync(source); output = resolve(output);
  let parent = output;
  while (!existsSync(parent)) parent = dirname(parent);
  output = resolve(realpathSync(parent), relative(parent, output));
  if (output === source || output.startsWith(`${source}/`) || (existsSync(output) && realpathSync(output).startsWith(source))) throw new Error('Output must not be inside audio-src');
  if (voices.some(v => !['voicevox-8', 'voicevox-10', 'voicevox-11'].includes(v)) || !voices.includes('voicevox-8')) throw new Error('Include voicevox-8 and only supported voices');
  const db = new DatabaseSync(join(frontend, 'public/nihongo.db'), { readOnly: true });
  const words = db.prepare('SELECT kanji,kana,example_jp,jlpt_level,importance FROM words').all();
  const grammar = db.prepare('SELECT id,level,sort_order,example_jp FROM grammar_points').all(); db.close();
  // The runtime collocations have pronunciation audio but no example sentence in their source schema.
  const existing = new Set(words.map(w => pronunciationAudioName(w.kanji, w.kana)));
  for (const w of JSON.parse(readFileSync(join(frontend, 'src/data/jlpt_collocation_content.json'), 'utf8')).entries) {
    if (!existing.has(pronunciationAudioName(w.surface, w.kana))) words.push({ kanji: w.surface, kana: w.kana, example_jp: '', jlpt_level: w.level, importance: 5 });
  }
  const groups = audioPackGroups(words, grammar);
  const labels = { 'voicevox-8': '春日部つむぎ(女声)', 'voicevox-10': '雨晴はう(女声)', 'voicevox-11': '玄野武宏(男声)' };
  const index = { format: 1, default: 'voicevox-8', voices: [] };
  const files = [];
  const stats = [];
  const missingClips = {};
  const stableWrite = (path, bytes) => { mkdirSync(dirname(path), { recursive: true }); if (!existsSync(path) || !readFileSync(path).equals(Buffer.from(bytes))) writeFileSync(path, bytes); };
  for (const id of voices) {
    const voice = { id, label: labels[id], ext: '.aac', engine: 'voicevox', count: 0, complete: false, packs: [], clips: {} };
    const missing = new Set();
    for (const group of groups) {
      const clips = new Map();
      for (const item of group.items) for (const key of item.keys) {
        if (clips.has(key)) continue;
        const path = join(source, key[0] === 'w' ? 'words' : 'examples', id, `${key.slice(2)}.aac`);
        if (!existsSync(path)) { missing.add(key); continue; }
        const bytes = readFileSync(path);
        // The generator publishes the .aac file before writing it; don't package an in-progress/truncated file.
        let pos = 0;
        while (pos + 7 <= bytes.length && bytes[pos] === 0xff && (bytes[pos + 1] & 0xf6) === 0xf0) {
          const length = ((bytes[pos + 3] & 3) << 11) | (bytes[pos + 4] << 3) | (bytes[pos + 5] >> 5);
          if (length < 7) break;
          pos += length;
        }
        if (!bytes.length || pos !== bytes.length) { missing.add(key); continue; }
        clips.set(key, bytes);
      }
      if (!clips.size) continue;
      const bytes = encodeAudioPack(clips);
      if (bytes.length > 2 * 1024 * 1024) throw new Error(`Pack too large: ${id}/${group.id}`);
      const name = `${id}/${group.id}-${sha(bytes)}.sap`;
      stableWrite(join(output, name), bytes); files.push(name);
      const slot = voice.packs.length;
      voice.packs.push([name, bytes.length]);
      for (const [key, [offset, length]] of Object.entries(decodeAudioPack(bytes))) voice.clips[key] ??= [slot, offset, length];
    }
    voice.count = Object.keys(voice.clips).filter(k => k[0] === 'w').length;
    voice.complete = missing.size === 0;
    missingClips[id] = [...missing].sort();
    index.voices.push(voice);
    const sizes = voice.packs.map(p => p[1]);
    stats.push({ voice: id, packs: sizes.length, averageBytes: Math.round(sizes.reduce((s, n) => s + n, 0) / sizes.length), maxBytes: Math.max(...sizes), totalBytes: sizes.reduce((s, n) => s + n, 0), wordClips: voice.count, exampleClips: Object.keys(voice.clips).filter(k => k[0] === 'e').length, missingWords: [...missing].filter(k => k[0] === 'w').length, missingExamples: [...missing].filter(k => k[0] === 'e').length, complete: voice.complete });
  }
  validateAudioPackIndex(index);
  const keys = [...new Set(index.voices.flatMap(v => Object.keys(v.clips)))];
  const wire = { ...index, keys, voices: index.voices.map(v => ({ ...v, clips: keys.map(key => v.clips[key] ?? null) })) };
  validateAudioPackIndex(wire);
  const json = Buffer.from(JSON.stringify(wire));
  const version = sha(json);
  const gzip = gzipSync(json, { level: 9, mtime: 0 });
  const br = brotliCompressSync(json, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } });
  for (const [ext, bytes] of [['gz', gzip], ['br', br]]) { const name = `index-${version}.json.${ext}`; stableWrite(join(output, name), bytes); files.push(name); }
  // Local uncompressed copy is for inspection/estimation only; upload.json lists the two wire encodings.
  stableWrite(join(output, 'index.json'), JSON.stringify(index));
  stableWrite(join(output, 'current.json'), JSON.stringify({ version }));
  const report = { version, wordsPerPack: WORDS_PER_PACK, indexBytes: json.length, indexGzipBytes: gzip.length, indexBrotliBytes: br.length, voices: stats };
  stableWrite(join(output, 'stats.json'), JSON.stringify(report, null, 2) + '\n');
  stableWrite(join(output, 'missing.json'), JSON.stringify(missingClips, null, 2) + '\n');
  stableWrite(join(output, 'upload.json'), JSON.stringify({ version, files, complete: stats.every(s => s.complete), voices }, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  return report;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = name => { const n = args.indexOf(name); return n >= 0 ? args[n + 1] : undefined; };
  if (args.includes('--help')) console.log('node --no-warnings scripts/build-audio-packs.mjs [--voice voicevox-8 | --voices voicevox-8,voicevox-10,voicevox-11] [--source DIR] [--out DIR]\nDefault: all three voices. Missing/in-progress clips are reported; incomplete paid voices cannot be sold.');
  else buildAudioPacks({ source: value('--source'), output: value('--out'), voices: (value('--voices') ?? value('--voice'))?.split(',') });
}
