const { createRequire } = require('node:module'); const path = require('node:path');
const miniRequire = createRequire(path.join(path.resolve(__dirname, '../..'), 'wechat-miniprogram/package.json'));
const automator = miniRequire('miniprogram-automator');
const MP = miniRequire('miniprogram-automator/out/MiniProgram').default; MP.prototype.checkVersion = async function () { await this.send('Tool.getInfo'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function btn(page, label) { for (const b of await page.$$('button')) if ((await b.text()).includes(label)) return b; return null; }
(async () => {
  const mini = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  mini.on('exception', (e) => console.log('EXCEPTION', JSON.stringify(e).slice(0, 500)));
  let page = await mini.currentPage();
  const times = [];
  for (let i = 0; i < 5; i++) {
    const opts = (await page.$$('button')); const labels = await Promise.all(opts.map((b) => b.text()));
    const choice = opts.find((b, k) => /^\s*1/.test(labels[k])) || opts[1];
    const before = JSON.stringify(await page.data()).length; const t0 = Date.now();
    await choice.tap();
    let changed = false; while (Date.now() - t0 < 3000) { if (JSON.stringify(await page.data()).length !== before) { changed = true; break; } await sleep(20); }
    times.push(Date.now() - t0);
    const next = await btn(page, '下一题'); if (next) { await next.tap(); await sleep(400); }
    console.log('Q', i + 1, 'labels', JSON.stringify(labels).slice(0, 160), 'feedbackChanged', changed, 'nextBtn', Boolean(next));
  }
  console.log('TAP->RENDER ms (incl. automator roundtrip)', times.join(','));
  const stop = await btn(page, '提前交卷'); if (stop) { await stop.tap(); await sleep(1500); }
  const d = JSON.stringify(await page.data());
  console.log('RESULT has 可信度', d.includes('可信度'), 'has 分享', d.includes('分享'));
  await mini.screenshot({ path: path.join(__dirname, '../reports/claude-result.png') });
  await mini.disconnect();
})().catch((e) => { console.error('ERR', e); process.exitCode = 1; });
