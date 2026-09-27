const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(path.resolve(__dirname, '../../frontend/node_modules/playwright'));
const reports = path.resolve(__dirname, '../reports');
const pairs = [
  ['WordStudy · 翻面前', 'main-after-main-word-study-front-375x812.png', 'devtools-word-study-front.png'],
  ['WordStudy · 翻面后', 'main-after-main-word-study-back-375x812.png', 'devtools-word-study-back.png'],
  ['WordStudy · 查词弹层', 'main-after-main-word-study-dictionary-375x812.png', 'devtools-word-study-dictionary.png'],
  ['查词汇量 · 落地页', 'main-after-main-vocab-landing-375x812.png', 'devtools-vocab-intro.png'],
  ['查词汇量 · 答题', 'main-after-main-vocab-question-375x812.png', 'devtools-vocab-question.png'],
  ['查词汇量 · 结果', 'main-after-main-vocab-result-375x812.png', 'devtools-vocab-result.png']
];
const rows = pairs.map(([title, web, weapp]) => `
  <section><h2>${title}</h2><div class="pair">
    <figure><figcaption>网页（main）· 375×812</figcaption><img src="${web}"></figure>
    <figure><figcaption>微信开发者工具（Taro）· 375×812 等比</figcaption><img src="${weapp}"></figure>
  </div></section>`).join('\n');
const html = `<!doctype html><meta charset="utf-8"><title>Route A · Round 4 comparison</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f3f2ee;color:#333;font:14px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;width:780px}
header{padding:10px 12px;background:#fff;font-weight:700}section{padding:8px 4px 14px}h2{font-size:14px;margin:0 0 4px} .pair{display:grid;grid-template-columns:375px 375px;gap:12px}
figure{margin:0;background:#fff;border:1px solid #ddd;border-radius:4px;overflow:hidden}figcaption{height:22px;padding:2px 6px;background:#fff;font-size:12px;color:#555}img{display:block;width:375px;height:812px;object-fit:fill;background:#faf8f2}
</style><header>路线 A 第四轮 · 最新 main 网页 / Taro DevTools 对照（网页视口和右侧归一均为 375×812）</header>${rows}`;
const htmlPath = path.join(reports, 'round4-web-weapp-comparison.html');
fs.writeFileSync(htmlPath, html);
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const page = await browser.newPage({ viewport: { width: 780, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
  await page.locator('img').last().waitFor();
  await page.evaluate(() => Promise.all([...document.images].map((img) => img.decode())));
  await page.screenshot({ path: path.join(reports, 'round4-web-weapp-comparison.png'), fullPage: true });
  console.log(JSON.stringify({ pairs: pairs.length, imageCount: await page.locator('img').count(), screenshot: path.join(reports, 'round4-web-weapp-comparison.png') }));
  await browser.close();
})().catch((error) => { console.error(error); process.exitCode = 1; });
