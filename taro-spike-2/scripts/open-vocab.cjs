const { createRequire } = require('node:module');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const repoRoot = path.resolve(root, '..');
const miniRequire = createRequire(path.join(repoRoot, 'wechat-miniprogram/package.json'));
const automator = miniRequire('miniprogram-automator');
const MiniProgram = miniRequire('miniprogram-automator/out/MiniProgram').default;
MiniProgram.prototype.checkVersion = async function checkVersionCompat() { await this.send('Tool.getInfo'); };

(async () => {
  const mini = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  mini.on('console', (event) => console.log('CONSOLE', JSON.stringify(event)));
  const navigation = mini.navigateTo('/quiz/vocab-test/index').catch((error) => console.log('NAVIGATION_EVENT', String(error)));
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const page = await mini.currentPage();
  console.log('PAGE', page?.path);
  console.log('TEXTS', JSON.stringify(await Promise.all((await page.$$('text')).map((node) => node.text()))));
  console.log('BUTTONS', JSON.stringify(await Promise.all((await page.$$('button')).map((node) => node.text()))));
  await mini.screenshot({ path: path.join(root, 'reports', 'devtools-vocab-intro.png') });
  await mini.disconnect();
  await Promise.race([navigation, new Promise((resolve) => setTimeout(resolve, 100))]);
})().catch((error) => { console.error(error); process.exitCode = 1; });
