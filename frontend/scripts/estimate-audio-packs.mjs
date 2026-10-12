#!/usr/bin/env node
// Explicit read-only snapshot; never fetch or refresh the learner's page.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pronunciationAudioName, exampleAudioName } from '../src/lib/speech-audio.ts';
import { AUDIO_CACHE_BYTES } from '../src/lib/audio-pack-format.ts';
const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const path = process.argv[2];
if (!path) throw new Error('Pass a real live.db snapshot path (read only)');
const db = new DatabaseSync(path, { readOnly: true });
const index = JSON.parse(readFileSync(resolve(frontend, 'audio-pack-dist/index.json')));
const voice = index.voices.find(v => v.id === 'voicevox-8');
const last = db.prepare('SELECT MAX(reviewed_on) day FROM stage1_tasks').get().day;
const since = new Date(`${last}T00:00:00Z`); since.setUTCDate(since.getUTCDate() - 29);
const rows = db.prepare('SELECT t.reviewed_on day, w.kanji,w.kana,w.example_jp FROM stage1_tasks t JOIN words w ON w.id=t.word_id WHERE t.reviewed_on>=? ORDER BY t.reviewed_on,t.order_index,t.word_id').all(since.toISOString().slice(0,10));
const days = new Map();
for (const w of rows) {
  if (!days.has(w.day)) days.set(w.day, { words: 0, unmappedWords: 0, packs: new Set() });
  const day = days.get(w.day); day.words++;
  for (const key of [`w:${pronunciationAudioName(w.kanji,w.kana)}`, ...(w.example_jp?.trim() ? [`e:${exampleAudioName(w.example_jp)}`] : [])]) {
    const loc = voice.clips[key]; if (loc) day.packs.add(loc[0]); else if (key[0] === 'w') day.unmappedWords++;
  }
}
const cache = new Map(); let used = 0;
const samples = [...days].map(([day, d]) => {
  let downloads = 0, bytes = 0;
  for (const slot of d.packs) {
    const size = voice.packs[slot][1];
    if (!cache.has(slot)) {
      downloads++; bytes += size;
      while ([...cache].reduce((s,[p])=>s+voice.packs[p][1],0)+size>AUDIO_CACHE_BYTES && cache.size) {
        const oldest = [...cache].sort((a,b)=>a[1]-b[1])[0][0]; cache.delete(oldest);
      }
    }
    cache.set(slot, ++used);
  }
  return { day, words: d.words, unmappedWords: d.unmappedWords, coldPacks: d.packs.size, coldBytes: [...d.packs].reduce((s,p)=>s+voice.packs[p][1],0), downloads, downloadBytes: bytes };
});
const median = field => { const a=samples.map(s=>s[field]).sort((a,b)=>a-b);return a[Math.floor(a.length/2)]; };
const report = { snapshotWritten: statSync(path).mtime.toISOString(), from: samples[0]?.day, to: last, activeDays: samples.length, cacheBytes: AUDIO_CACHE_BYTES, medianPlanWords: median('words'), medianColdPacks: median('coldPacks'), medianColdBytes: median('coldBytes'), medianDownloadsWithLru: median('downloads'), medianDownloadBytesWithLru: median('downloadBytes'), samples };
console.log(JSON.stringify(report,null,2));
writeFileSync(resolve(frontend, 'audio-pack-dist/estimate.json'), JSON.stringify(report,null,2)+'\n');
db.close();
