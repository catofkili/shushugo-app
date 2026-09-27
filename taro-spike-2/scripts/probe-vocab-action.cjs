const { createRequire } = require('node:module');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const miniRequire = createRequire(path.join(path.resolve(root, '..'), 'wechat-miniprogram/package.json'));
const automator = miniRequire('miniprogram-automator');
const MiniProgram = miniRequire('miniprogram-automator/out/MiniProgram').default;
MiniProgram.prototype.checkVersion = async function checkVersionCompat() { await this.send('Tool.getInfo'); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const snapshot = async (page) => ({
  path: page?.path,
  texts: await Promise.all((await page.$$('text')).map((node) => node.text())),
  buttons: await Promise.all((await page.$$('button')).map((node) => node.text()))
});
(async () => {
  const mini = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  let page = await mini.currentPage();
  if (page.path !== 'quiz/vocab-test/index') {
    void mini.navigateTo('/quiz/vocab-test/index').catch(() => undefined);
    await sleep(2500);
    page = await mini.currentPage();
  }
  const button = (await page.$$('button'))[0];
  console.log('BEFORE', JSON.stringify(await snapshot(page)));
  console.log('BUTTON_WXML', await button.outerWxml());
  console.log('BUTTON_OFFSET', JSON.stringify(await button.offset()), 'SIZE', JSON.stringify(await button.size()));
  await button.tap();
  await sleep(1500);
  console.log('AFTER_TAP', JSON.stringify(await snapshot(await mini.currentPage())));
  const current = await mini.currentPage();
  const nextButton = (await current.$$('button'))[0];
  if ((await nextButton.text()).includes('开始测验')) {
    await nextButton.trigger('tap');
    await sleep(1500);
    console.log('AFTER_TRIGGER', JSON.stringify(await snapshot(await mini.currentPage())));
    await nextButton.dispatchEvent({ eventName: 'click' });
    await sleep(1500);
    console.log('AFTER_CLICK_EVENT', JSON.stringify(await snapshot(await mini.currentPage())));
  }
  await mini.disconnect();
})().catch((error) => { console.error(error); process.exitCode = 1; });
