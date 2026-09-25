const { createRequire } = require('node:module');
const path = require('node:path');
const util = require('node:util');
const root = path.resolve(__dirname, '..');
const repoRoot = path.resolve(root, '..');
const miniRequire = createRequire(path.join(repoRoot, 'wechat-miniprogram/package.json'));
const automator = miniRequire('miniprogram-automator');
const MiniProgram = miniRequire('miniprogram-automator/out/MiniProgram').default;
MiniProgram.prototype.checkVersion = async function checkVersionCompat() { await this.send('Tool.getInfo'); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pageTexts(page) {
  const elements = [...await page.$$('text'), ...await page.$$('button')];
  return Promise.all(elements.map((element) => element.text().catch(() => '')));
}

async function waitForText(readPage, pattern, timeout = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const page = await readPage();
    const visible = await pageTexts(page);
    if (visible.some((value) => pattern.test(value))) return { page, visible };
    await sleep(200);
  }
  const page = await readPage();
  throw new Error(`Timed out waiting for ${pattern}: ${JSON.stringify(await pageTexts(page))}`);
}

async function tapButton(readPage, pattern) {
  const page = await readPage();
  for (const button of await page.$$('button')) {
    const text = await button.text().catch(() => '');
    const label = await button.attribute('aria-label').catch(() => '');
    const title = await button.attribute('title').catch(() => '');
    if (pattern.test(`${text} ${label} ${title}`)) {
      await button.tap();
      await sleep(350);
      return `${text} ${label} ${title}`.trim();
    }
  }
  if (pattern.test('上一个')) {
    const studyToolbar = await page.$$('.ds-icon-btn');
    console.log('UNDO_TOOLBAR_BUTTONS', studyToolbar.length);
    if (studyToolbar.length >= 3) {
      await studyToolbar[2].tap();
      await sleep(350);
      return 'undo toolbar button';
    }
  }
  throw new Error(`Button ${pattern} not found: ${JSON.stringify(await pageTexts(page))}`);
}

async function tapText(readPage, pattern) {
  const page = await readPage();
  for (const element of await page.$$('text')) {
    const value = await element.text().catch(() => '');
    if (pattern.test(value)) {
      await element.tap();
      await sleep(350);
      return value;
    }
  }
  throw new Error(`Text ${pattern} not found: ${JSON.stringify(await pageTexts(page))}`);
}

let mini;
(async () => {
  mini = await automator.connect({ wsEndpoint: process.env.TARO_AUTOMATOR_WS || 'ws://127.0.0.1:9421' });
  mini.on('exception', (event) => console.log('EXCEPTION', util.inspect(event, { depth: 5 })));
  mini.on('console', (event) => console.log('CONSOLE', JSON.stringify(event)));
  const readPage = async () => mini.currentPage();
  await mini.reLaunch('/pages/index/index');
  await sleep(1000);
  await tapButton(readPage, /WordStudy/);
  let { page, visible } = await waitForText(readPage, /显示答案|Factory.*WordStudy|暂时读不到本地词库/);
  console.log('FRONT_TEXTS', JSON.stringify(visible));
  if (visible.some((value) => value.includes('暂时读不到本地词库'))) throw new Error(`WordStudy load failed: ${JSON.stringify(visible)}`);
  await mini.screenshot({ path: path.join(root, 'reports', 'devtools-word-study-front.png') });

  console.log('FLIP', await tapButton(readPage, /显示答案/));
  ({ page, visible } = await waitForText(readPage, /忘了|模糊|记得|熟知/));
  console.log('BACK_TEXTS', JSON.stringify(visible));
  await mini.screenshot({ path: path.join(root, 'reports', 'devtools-word-study-back.png') });

  console.log('DICTIONARY_TOKEN', await tapText(readPage, /安心（あんしん）/));
  ({ page, visible } = await waitForText(readPage, /词典中暂未收录这个词|暂无释义|加入学习/));
  console.log('DICTIONARY_TEXTS', JSON.stringify(visible));
  await mini.screenshot({ path: path.join(root, 'reports', 'devtools-word-study-dictionary.png') });
  console.log('DICTIONARY_CLOSE', await tapText(readPage, /×/));

  console.log('RATE', await tapButton(readPage, /认识/));
  ({ page, visible } = await waitForText(readPage, /显示答案|这批词过完了/));
  console.log('NEXT_TEXTS', JSON.stringify(visible));
  await mini.screenshot({ path: path.join(root, 'reports', 'devtools-word-study-next.png') });

  console.log('UNDO', await tapButton(readPage, /上一个/));
  ({ page, visible } = await waitForText(readPage, /显示答案/));
  console.log('UNDO_TEXTS', JSON.stringify(visible));
  await mini.screenshot({ path: path.join(root, 'reports', 'devtools-word-study-undo.png') });
  mini.disconnect();
})().catch((error) => {
  console.error(error);
  mini?.disconnect();
  process.exitCode = 1;
});
