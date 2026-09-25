const path = require('node:path');
const { chromium } = require(path.resolve(__dirname, '../../frontend/node_modules/playwright'));
const root = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const webOrigin = process.env.WEB_ORIGIN || 'http://127.0.0.1:5194';
const screenshotPrefix = process.env.SCREENSHOT_PREFIX || 'web';
const screenshot = (name) => path.join(root, 'reports', `${screenshotPrefix}-${name}-375x812.png`);

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  });
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await context.addInitScript(() => { Math.random = () => 0.42; });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(webOrigin, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /保存并查看今天怎么学/ }).click();
  await page.getByRole('button', { name: /开始今天的单词/ }).waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: /开始今天的单词/ }).click();
  await page.getByRole('button', { name: /显示答案/ }).waitFor({ timeout: 30000 });
  await sleep(300);
  await page.screenshot({ path: screenshot('word-study-front') });
  await page.getByRole('button', { name: /显示答案/ }).click();
  await page.getByRole('button', { name: /忘了|模糊|记得|熟知/ }).first().waitFor({ timeout: 10000 });
  await sleep(300);
  await page.screenshot({ path: screenshot('word-study-back') });

  await page.getByRole('button', { name: /首页|主页/ }).first().click();
  await page.getByRole('button', { name: /查词汇量/ }).click();
  await page.getByRole('button', { name: /开始测验/ }).waitFor({ timeout: 30000 });
  await page.screenshot({ path: screenshot('vocab-landing') });
  await page.getByRole('button', { name: /开始测验/ }).click();
  await page.locator('button.ds-choice').first().waitFor({ timeout: 15000 });
  await sleep(300);
  await page.screenshot({ path: screenshot('vocab-question') });
  for (let answer = 1; answer <= 15; answer += 1) {
    await page.locator('button.ds-choice').first().click();
    await page.getByText(/答对了|这题选错了|记为不认识/).first().waitFor({ timeout: 15000 });
    if (answer < 15) {
      await page.getByRole('button', { name: /下一题/ }).click();
      await page.locator('button.ds-choice').first().waitFor({ timeout: 15000 });
    }
  }
  await page.getByRole('button', { name: /下一题/ }).click();
  await page.getByRole('button', { name: /提前交卷/ }).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: /提前交卷/ }).click();
  await page.getByText(/这次测出|这次还没出数/).waitFor({ timeout: 15000 });
  await sleep(300);
  await page.screenshot({ path: screenshot('vocab-result') });
  console.log(JSON.stringify({ viewport: '375x812', answered: 15, screenshots: [
    screenshot('word-study-front'), screenshot('word-study-back'), screenshot('vocab-landing'), screenshot('vocab-question'), screenshot('vocab-result')
  ], pageErrors: errors }, null, 2));
  await browser.close();
})().catch((error) => { console.error(error); process.exitCode = 1; });
