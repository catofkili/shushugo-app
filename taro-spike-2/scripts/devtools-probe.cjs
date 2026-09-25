const { createRequire } = require('node:module');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const repoRoot = path.resolve(root, '..');
const miniRequire = createRequire(path.join(repoRoot, 'wechat-miniprogram/package.json'));
const automator = miniRequire('miniprogram-automator');
const MiniProgram = miniRequire('miniprogram-automator/out/MiniProgram').default;

MiniProgram.prototype.checkVersion = async function checkVersionCompat() {
  await this.send('Tool.getInfo');
};

(async () => {
  const mini = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  const errors = [];
  mini.on('exception', (event) => errors.push(event));
  mini.on('console', (event) => console.log('CONSOLE', JSON.stringify(event)));
  await new Promise((resolve) => setTimeout(resolve, 3000));
  let stack = await mini.pageStack();
  if (!stack.length) {
    console.log('EMPTY_STACK_INFO', JSON.stringify(await mini.send('Tool.getInfo')));
    await mini.reLaunch('/pages/index/index');
    await new Promise((resolve) => setTimeout(resolve, 3000));
    stack = await mini.pageStack();
  }
  console.log('STACK', JSON.stringify(stack.map(({ path: route }) => route)));
  for (const page of stack) {
    console.log('WXML', page.path, JSON.stringify(await (await page.$('view'))?.outerWxml()));
    const texts = await page.$$('text');
    console.log('TEXTS', page.path, JSON.stringify(await Promise.all(texts.map((item) => item.text()))));
    await mini.screenshot({ path: path.join(root, 'reports', `devtools-${page.path.replace(/[^a-z0-9]+/gi, '-')}.png`) });
  }
  console.log('EXCEPTIONS', JSON.stringify(errors));
  mini.disconnect();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
