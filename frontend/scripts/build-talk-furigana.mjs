#!/usr/bin/env node
// 只读内容 JSON，不碰出厂库或学习库；分词词典只在构建期使用。
import assert from 'node:assert/strict';
import { talkAudioSentences } from '../src/lib/talk/sentences.ts';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const content = JSON.parse(readFileSync(path.join(root, 'src/data/talk_content.json'), 'utf8'));
const overrides = JSON.parse(readFileSync(path.join(root, 'scripts/talk-furigana-overrides.json'), 'utf8'));
const kanji = /[\u3400-\u9fff々〇]/u;
const hira = text => text.replace(/[ァ-ヶ]/gu, char => String.fromCharCode(char.charCodeAt(0) - 0x60));
const tokenizer = await new Promise((resolve, reject) => require('kuromoji').builder({
  dicPath: path.join(path.dirname(require.resolve('kuromoji/package.json')), 'dict')
}).build((error, result) => error ? reject(error) : resolve(result)));

// 假名是读音的锚点，送假名留在 ruby 外；偏移累加 surface.length（UTF-16），不用 word_position。
function align(base, reading, start) {
  if (!kanji.test(base)) return [];
  assert.ok(reading, `缺少读音：${base}`);
  const runs = base.match(/[\u3400-\u9fff々〇]+|[^\u3400-\u9fff々〇]+/gu);
  const walk = (index, offset, position) => {
    if (index === runs.length) return position === reading.length ? [] : null;
    const run = runs[index];
    if (!kanji.test(run)) return reading.startsWith(hira(run), position)
      ? walk(index + 1, offset + run.length, position + run.length) : null;
    for (let end = reading.length; end > position; end--) {
      const tail = walk(index + 1, offset + run.length, end);
      if (tail) return [{ start: start + offset, length: run.length, reading: reading.slice(position, end) }, ...tail];
    }
    return null;
  };
  const annotations = walk(0, 0, 0);
  assert.ok(annotations, `读音无法对齐：${base} / ${reading}`);
  return annotations;
}

function annotate(sentence) {
  const spans = [];
  // 覆盖先占住完整片段（可跨分词边界），剩余片段再交给 kuromoji。
  for (const { base, reading } of overrides[sentence] ?? []) {
    let at = sentence.indexOf(base);
    assert.ok(at >= 0, `过期覆盖：${sentence} / ${base}`);
    while (at >= 0) {
      assert.ok(!spans.some(span => at < span.end && at + base.length > span.start), `覆盖重叠：${sentence} / ${base}`);
      spans.push({ start: at, end: at + base.length, base, reading });
      at = sentence.indexOf(base, at + base.length);
    }
  }
  spans.sort((a, b) => a.start - b.start);
  const result = [];
  const tokenize = (text, start) => {
    let offset = start;
    for (const token of tokenizer.tokenize(text)) {
      try { result.push(...align(token.surface_form, hira(token.reading ?? ''), offset)); }
      catch (error) { throw new Error(`${sentence}: ${error.message}`); }
      offset += token.surface_form.length;
    }
  };
  let cursor = 0;
  for (const span of spans) {
    tokenize(sentence.slice(cursor, span.start), cursor);
    result.push(...align(span.base, span.reading, span.start));
    cursor = span.end;
  }
  tokenize(sentence.slice(cursor), cursor);
  return result;
}

const sentences = new Set(talkAudioSentences(content));
const answers = new Set(sentences);
for (const formula of content.formulas) for (const group of formula.fillers) {
  const fill = text => text.replace(/\[([^\]]+)\]/gu, (_, slot) => group[slot].ja);
  sentences.add(fill(formula.skeleton));
}
// 使用提醒里的日文引语也会上屏；中文说明本身不能交给日语分词器。
for (const note of [...content.formulas.map(f => f.note), ...content.scenes.map(s => s.note ?? '')]) {
  for (const match of note.matchAll(/「([^」]+)」/gu)) if (/[ぁ-んァ-ヶ]/u.test(match[1])) sentences.add(match[1]);
}
const table = Object.fromEntries([...sentences].map(sentence => [sentence, annotate(sentence)]));
for (const sentence of answers) {
  const chars = [...sentence];
  let end = chars.slice(0, Math.max(2, Math.ceil(chars.length * 0.4))).join('').length;
  // 提示不能把一块汉字截半截（領収書 → 領収），否则无法保留正确的读音。
  const crossing = table[sentence].find(a => a.start < end && a.start + a.length > end);
  if (crossing) end = crossing.start + crossing.length;
  table[sentence.slice(0, end) + '…'] = table[sentence].filter(a => a.start + a.length <= end);
}
for (const sentence of Object.keys(overrides)) assert.ok(sentence in table, `过期覆盖句：${sentence}`);
if (process.argv.includes('--check')) {
  assert.deepEqual(JSON.parse(readFileSync(path.join(root, 'src/data/talk_furigana.json'), 'utf8')), table, '注音表已过期，请重跑 build-talk-furigana.mjs');
  console.log(`Talk furigana verification passed: ${Object.keys(table).length} sentences.`);
  process.exit(0);
}
writeFileSync(path.join(root, 'src/data/talk_furigana.json'), JSON.stringify(table, null, 2) + '\n');
const readings = new Set(Object.entries(table).flatMap(([sentence, annotations]) => annotations.map(a => `${sentence.slice(a.start, a.start + a.length)} | ${a.reading}`)));
const report = '# 开口练习注音复核清单\n\n| 片段 | 读音 |\n|---|---|\n' + [...readings].sort().map(row => `| ${row} |`).join('\n') + '\n';
mkdirSync(path.join(root, '../tmp'), { recursive: true });
writeFileSync(path.join(root, '../tmp/talk-furigana-review.md'), report);
console.log(`Talk furigana built: ${Object.keys(table).length} sentences, ${readings.size} unique readings.\n${report}`);
