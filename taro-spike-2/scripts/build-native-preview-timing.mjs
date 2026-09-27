import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const taroRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(taroRoot, '..');
const nativeRoot = path.join(repoRoot, 'wechat-miniprogram');
const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shushugo-native-preview-timing-'));
const nativePreviewRoot = path.join(outputRoot, 'wechat-miniprogram');

fs.cpSync(path.join(nativeRoot, 'src'), path.join(nativePreviewRoot, 'src'), { recursive: true });
fs.copyFileSync(path.join(nativeRoot, 'project.config.json'), path.join(nativePreviewRoot, 'project.config.json'));

const patchOnce = (relativePath, from, to) => {
  const file = path.join(nativePreviewRoot, relativePath);
  const source = fs.readFileSync(file, 'utf8');
  const occurrences = source.split(from).length - 1;
  if (occurrences !== 1) throw new Error(`${relativePath}: expected one patch anchor, found ${occurrences}`);
  fs.writeFileSync(file, source.replace(from, to));
};

const helper = `const LIMIT = 20;
const key = (kind) => kind === 'study' ? 'previewTiming.study' : 'previewTiming.vocab';
const title = (kind) => kind === 'study' ? 'WordStudy' : '查词汇量';
function record(page, kind, startedAt) {
  if (!startedAt) return;
  const all = page.__previewTimingSamples || (page.__previewTimingSamples = { study: [], vocab: [] });
  const samples = all[kind];
  if (samples.length >= LIMIT) return;
  samples.push(Math.max(0, Math.round(Date.now() - startedAt)));
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
  const p90 = sorted[Math.ceil(sorted.length * 0.9) - 1];
  page.setData({ [key(kind)]: title(kind) + ' ' + samples.length + '/' + LIMIT + ' · 中位 ' + median + ' ms · p90 ' + p90 + ' ms' });
  console.log('[preview-timing] native ' + kind + ' ' + samples.length + '/' + LIMIT + ' median=' + median + 'ms p90=' + p90 + 'ms');
}
module.exports = { record };
`;
fs.writeFileSync(path.join(nativePreviewRoot, 'src/runtime/preview-timing.js'), helper);

const eventStart = `function eventStart(event) {
  const timestamp = Number(event?.timeStamp);
  if (!Number.isFinite(timestamp)) return Date.now();
  if (timestamp > 1000000000000) return timestamp;
  const performanceNow = typeof performance !== 'undefined' ? performance.now() : 0;
  return Date.now() - performanceNow + timestamp;
}
`;

patchOnce(
  'src/pages/index/index.js',
  "const { web } = core;\n",
  "const { web } = core;\nconst previewTiming = require('../../runtime/preview-timing');\n" + eventStart
);
patchOnce(
  'src/pages/index/index.js',
  "    sharedDaily: null\n",
  "    sharedDaily: null,\n    previewTiming: { study: 'WordStudy 0/20 · 中位 — ms · p90 — ms' }\n"
);
patchOnce(
  'src/pages/index/index.js',
  "        noteDraft: home.card?.note || ''\n      });",
  "        noteDraft: home.card?.note || ''\n      }, () => {\n        const pending = this.__previewStudyTiming;\n        if (pending && this.data.card?.id !== pending.cardId && this.data.card?.prompt) {\n          this.__previewStudyTiming = null;\n          previewTiming.record(this, 'study', pending.startedAt);\n        }\n      });"
);
patchOnce(
  'src/pages/index/index.js',
  "    if (!card || !answer || this.data.busy || this.flinging) return;\n    this.run('记录作答', async () => {",
  "    if (!card || !answer || this.data.busy || this.flinging) return;\n    if (answer === 'know' && event.currentTarget?.dataset?.noSwipe === '1') {\n      this.__previewStudyTiming = { startedAt: eventStart(event), cardId: card.id };\n    }\n    this.run('记录作答', async () => {"
);

patchOnce(
  'src/features/vocab-test/index.js',
  "const { vocabTest } = require('../../runtime/extended-features');\n",
  "const { vocabTest } = require('../../runtime/extended-features');\nconst previewTiming = require('../../runtime/preview-timing');\n" + eventStart
);
patchOnce(
  'src/features/vocab-test/index.js',
  "    levels: LEVELS\n",
  "    levels: LEVELS,\n    previewTiming: { vocab: '查词汇量 0/20 · 中位 — ms · p90 — ms' }\n"
);
patchOnce(
  'src/features/vocab-test/index.js',
  "    this.answer(index === question.answerIndex ? 'correct' : 'wrong', index);",
  "    this.answer(index === question.answerIndex ? 'correct' : 'wrong', index, eventStart(event));"
);
patchOnce(
  'src/features/vocab-test/index.js',
  "  answer(state, selected) {",
  "  answer(state, selected, previewStartedAt) {"
);
patchOnce(
  'src/features/vocab-test/index.js',
  "    this.setData({ session, feedback, shown: this.decorate(question, feedback) });",
  "    this.setData({ session, feedback, shown: this.decorate(question, feedback) }, () => {\n      if (selected !== null && previewStartedAt) previewTiming.record(this, 'vocab', previewStartedAt);\n    });"
);

for (const [relativePath, text] of [
  ['src/pages/index/index.wxml', '{{previewTiming.study}}'],
  ['src/features/vocab-test/index.wxml', '{{previewTiming.vocab}}']
]) {
  const file = path.join(nativePreviewRoot, relativePath);
  const source = fs.readFileSync(file, 'utf8');
  const ending = '</scroll-view>';
  if (!source.trimEnd().endsWith(ending)) throw new Error(`${relativePath}: expected one final scroll-view`);
  fs.writeFileSync(file, source.trimEnd().slice(0, -ending.length) + `<view class="preview-timing">${text}</view>\n${ending}\n`);
}

for (const relativePath of ['src/pages/index/index.wxss', 'src/features/vocab-test/index.wxss']) {
  const file = path.join(nativePreviewRoot, relativePath);
  fs.appendFileSync(file, '\n.preview-timing { position: fixed; top: 12rpx; right: 12rpx; z-index: 9999; padding: 8rpx 12rpx; border-radius: 12rpx; background: rgba(28, 35, 34, .88); color: #fff; font-size: 20rpx; line-height: 1.4; pointer-events: none; }\n');
}

console.log(nativePreviewRoot);
