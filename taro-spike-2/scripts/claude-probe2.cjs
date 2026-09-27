const { createRequire } = require('node:module'); const path = require('node:path');
const miniRequire = createRequire(path.join(path.resolve(__dirname, '../..'), 'wechat-miniprogram/package.json'));
const automator = miniRequire('miniprogram-automator');
const MP = miniRequire('miniprogram-automator/out/MiniProgram').default; MP.prototype.checkVersion = async function () { await this.send('Tool.getInfo'); };
(async () => {
  const mini = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  const page = await mini.currentPage();
  const b = (await page.$$('button'))[0];
  const w = await b.outerWxml(); console.log(w.replace(/>.*$/s, '>'));
  const r = await mini.evaluate(() => {
    const out = {};
    try { const rt = require('@tarojs/runtime'); out.rt = Object.keys(rt).length; } catch (e) { out.rtErr = String(e); }
    out.hasDocument = typeof document; out.pages = getCurrentPages().map((p) => p.route);
    return out;
  }).catch((e) => String(e)); console.log('EVAL', JSON.stringify(r));
  await mini.disconnect();
})().catch((e) => { console.error('ERR', e); process.exitCode = 1; });
