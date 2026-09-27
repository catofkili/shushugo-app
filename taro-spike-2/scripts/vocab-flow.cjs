const { createRequire } = require('node:module');
const path = require('node:path');
const util = require('node:util');
const root = path.resolve(__dirname, '..');
const repoRoot = path.resolve(root, '..');
const miniRequire = createRequire(path.join(repoRoot, 'wechat-miniprogram/package.json'));
const automator = miniRequire('miniprogram-automator');
const MiniProgram = miniRequire('miniprogram-automator/out/MiniProgram').default;

MiniProgram.prototype.checkVersion = async function checkVersionCompat() {
  await this.send('Tool.getInfo');
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function texts(page) {
  const elements = [...await page.$$('text'), ...await page.$$('button')];
  return Promise.all(elements.map((element) => element.text()));
}

async function waitForText(page, pattern, timeout = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const visible = await texts(page);
    if (visible.some((value) => pattern.test(value))) return visible;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${pattern}: ${JSON.stringify(await texts(page))}`);
}

async function tapText(page, label) {
  const elements = [...await page.$$('text'), ...await page.$$('button')];
  for (const element of elements) {
    if ((await element.text()).includes(label)) {
      await element.tap();
      await sleep(500);
      return;
    }
  }
  throw new Error(`Text not found: ${label}; visible=${JSON.stringify(await texts(page))}`);
}

async function tapButton(page, label) {
  for (const element of await page.$$('button')) {
    if ((await element.text()).includes(label)) {
      await element.tap();
      await sleep(500);
      return;
    }
  }
  throw new Error(`Button not found: ${label}; visible=${JSON.stringify(await texts(page))}`);
}

async function waitForQuestion(page, timeout = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const buttons = await page.$$('button');
    const choices = [];
    for (const button of buttons) {
      const label = (await button.text()).trim();
      if (label && !/提前交卷|不认识|下一题|查看结果/.test(label)) choices.push(button);
    }
    if (choices.length >= 4) return await texts(page);
    await sleep(100);
  }
  throw new Error(`Timed out waiting for four answer choices: ${JSON.stringify(await texts(page))}`);
}

(async () => {
  const mini = await automator.connect({ wsEndpoint: process.env.TARO_AUTOMATOR_WS || 'ws://127.0.0.1:9420' });
  console.log('CONNECTED');
  const errors = [];
  mini.on('exception', (event) => { errors.push(event); console.log('EXCEPTION', util.inspect(event, { depth: 5 })); });
  mini.on('console', (event) => console.log('CONSOLE', JSON.stringify(event)));
  await mini.callWxMethod('clearStorageSync');
  await mini.reLaunch('/pages/index/index');
  await sleep(1000);
  let page = await mini.currentPage();
  console.log('CURRENT', page?.path);
  if (!page) throw new Error('Developer Tools has no current page');
  void mini.navigateTo('/quiz/vocab-test/index').catch((error) => console.log('NAVIGATION_EVENT', String(error)));
  await sleep(1500);
  page = await mini.currentPage();
  console.log('ROUTE', page?.path);
  let visible = await waitForText(page, /开始测验|重新开始|出厂词库.*失败|下载.*失败|不存在|Error|错误/);
  const hasResumableSession = visible.some((value) => value.includes('重新开始'));
  console.log('LANDING_TEXTS', JSON.stringify(visible));
  await mini.screenshot({ path: path.join(root, 'reports', 'devtools-vocab-intro.png') });
  if (hasResumableSession) {
    await tapText(page, '重新开始');
    visible = await waitForQuestion(page);
  } else {
    await tapText(page, '开始测验');
    visible = await waitForQuestion(page);
  }
  if (visible.some((value) => /出厂词库.*失败|失败|错误|未就绪|下载/.test(value))) {
    throw new Error(`Vocab page did not reach intro: ${JSON.stringify(visible)}`);
  }
  console.log('QUESTION_1', JSON.stringify(visible));
  await mini.screenshot({ path: path.join(root, 'reports', 'devtools-vocab-question.png') });
  const answerCount = 15;
  for (let answer = 1; answer <= answerCount; answer += 1) {
    const buttons = await page.$$('button');
    const choices = [];
    for (const button of buttons) {
      const label = (await button.text()).trim();
      if (label && !/提前交卷|不认识|下一题|查看结果/.test(label)) choices.push(button);
    }
    if (choices.length < 4) throw new Error(`Expected four answers, found ${choices.length}: ${JSON.stringify(await texts(page))}`);
    await choices[0].tap();
    visible = await waitForText(page, /答对了|这题选错了|记为不认识/);
    console.log(`ANSWER_${answer}`, JSON.stringify(visible.filter((value) => /答对了|这题选错了|记为不认识/.test(value))));
    if (answer < answerCount) {
      await tapText(page, '下一题');
      visible = await waitForQuestion(page);
    }
  }
  await tapText(page, '下一题');
  await waitForQuestion(page);
  await tapText(page, '提前交卷');
  visible = await waitForText(page, /这次还没出数|这次测出|答得还太少|再测一次/);
  console.log('RESULT_TEXTS', JSON.stringify(visible));
  await mini.screenshot({ path: path.join(root, 'reports', 'devtools-vocab-result.png') });
  console.log('EXCEPTIONS', JSON.stringify(errors));
  if (errors.length) process.exitCode = 2;
  mini.disconnect();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
