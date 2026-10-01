import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = fs.mkdtempSync(path.join(root, '.route-css-test-'));
try {
  for (const dir of ['scripts', 'dist', 'reports']) fs.mkdirSync(path.join(scratch, dir));
  fs.copyFileSync(path.join(root, 'scripts/split-route-css.mjs'), path.join(scratch, 'scripts/split-route-css.mjs'));
  fs.writeFileSync(path.join(scratch, 'dist/app.wxss'), `
.ach-card,.wl-row { color:red }
@media (max-width:600px) { @supports (display:grid) { .cf-sheet,.shared { display:grid } } }
.theme-dark .cf-sheet { color:white }
.kr-card { padding:2px }
.quick-study-row { margin:1px }
.weekly-report-page .wr-title { color:blue }
.wr-entrance-veil,.vt-timer { display:block }
.wl-row .yz-card { color:green }
`);
  execFileSync(process.execPath, [path.join(scratch, 'scripts/split-route-css.mjs')]);
  const read = (name) => postcss.parse(fs.readFileSync(path.join(scratch, 'dist', name), 'utf8'));
  const app = read('app.wxss');
  const selectors = (css) => { const values = []; css.walkRules((r) => values.push(r.selector.trim())); return values; };
  assert.deepEqual(selectors(app), ['.ach-card', '.shared', '.wr-entrance-veil,.vt-timer', '.wl-row .yz-card']);
  assert.deepEqual(selectors(read('study/word-list/index.wxss')), ['.wl-row']);
  assert.deepEqual(selectors(read('study/quick-study/index.wxss')), ['.quick-study-row']);
  const confusion = read('study/confusion/index.wxss');
  const kanji = read('study/kanji-readings/index.wxss');
  assert.deepEqual(selectors(confusion), ['.cf-sheet', '.theme-dark .cf-sheet']);
  assert.deepEqual(selectors(kanji), ['.cf-sheet', '.theme-dark .cf-sheet', '.kr-card']);
  for (const css of [confusion, kanji]) {
    assert.equal(css.first.name, 'media');
    assert.equal(css.first.params, '(max-width:600px)');
    assert.equal(css.first.first.name, 'supports');
    assert.equal(css.first.first.params, '(display:grid)');
    assert.equal(css.first.first.first.selector.trim(), '.cf-sheet');
  }
  assert.deepEqual(selectors(read('content-pages/weekly-report/index.wxss')), ['.weekly-report-page .wr-title']);
  console.log('Route CSS split passed: shared cf- pages, mixed selectors, nested wrappers, source order, global exceptions, missing page WXSS.');
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
