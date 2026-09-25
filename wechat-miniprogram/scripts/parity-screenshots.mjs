import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, values) => {
  if (!value.startsWith('--')) return pairs;
  pairs.push([value, values[index + 1]?.startsWith('--') || values[index + 1] === undefined ? '' : values[index + 1]]);
  return pairs;
}, []));
const webUrl = args['--web-url'];
const miniRoute = args['--mini-route'];
const cliHttpPort = Number(args['--cli-http-port'] || process.env.MINIPROGRAM_CLI_HTTP_PORT);
if (!webUrl || !miniRoute) {
  console.error('用法：node wechat-miniprogram/scripts/parity-screenshots.mjs --web-url <隔离端口网页 URL> --mini-route </小程序页面路径> --cli-http-port <开发者工具服务端口> [--output-dir <目录>]');
  process.exit(2);
}
if (!Number.isInteger(cliHttpPort) || cliHttpPort < 1 || cliHttpPort > 65535) {
  throw new Error('请通过 --cli-http-port 或 MINIPROGRAM_CLI_HTTP_PORT 指定开发者工具安全设置中显示的服务端口。');
}

const url = new URL(webUrl);
if (url.port === '5173') throw new Error('禁止把正在学习的 5173 用作截图目标；请启动 worktree 的独立端口。');
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)) throw new Error('网页截图只接受本机 worktree 服务，不能连外部站点。');
if (existsSync(path.join(root, 'frontend/.local/live.db'))) throw new Error('worktree 中发现 live.db；为保护真实学习记录，拒绝运行截图。');

const outputDir = path.resolve(root, args['--output-dir'] || 'work/parity-screenshots');
const sourceMiniProject = path.resolve(root, args['--mini-project'] || 'wechat-miniprogram');
const cliPath = args['--cli-path'] || process.env.MINIPROGRAM_CLI_PATH || '/Applications/wechatwebdevtools.app/Contents/MacOS/cli';
const projectTag = randomBytes(6).toString('hex');
const slug = miniRoute.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'page';
const webImageName = `${slug}-web.png`;
const miniImageName = `${slug}-miniprogram.png`;
const webImagePath = path.join(outputDir, webImageName);
const miniImagePath = path.join(outputDir, miniImageName);
const reportPath = path.join(outputDir, 'report.html');
mkdirSync(outputDir, { recursive: true });
const isolatedProject = path.join(root, 'work', `parity-miniprogram-${projectTag}`);
const isolatedAppId = 'touristappid';

mkdirSync(path.dirname(isolatedProject), { recursive: true });
cpSync(sourceMiniProject, isolatedProject, {
  recursive: true,
  filter: (sourcePath) => !path.relative(sourceMiniProject, sourcePath).split(path.sep).some((part) => ['.git', '.local', 'node_modules'].includes(part)),
});
const configPath = path.join(isolatedProject, 'src/config.js');
let configSource = readFileSync(configPath, 'utf8');
for (const [key, value] of Object.entries({
  cloudEnv: '', seedDatabaseUrl: `${url.origin}/nihongo.db`, seedDatabasePath: '',
  contentManifestUrl: '', audioBaseUrl: '', audioIndexUrl: '', syncUrl: '',
  entitlementUrl: '', paymentUrl: '', authUrl: '', reminderTemplateId: '',
})) {
  const expression = new RegExp(`(\\b${key}\\s*:\\s*)'[^']*'`);
  if (!expression.test(configSource)) throw new Error(`config.js 缺少隔离配置项：${key}`);
  configSource = configSource.replace(expression, `$1'${value}'`);
}
writeFileSync(configPath, configSource);
const projectConfigPath = path.join(isolatedProject, 'project.config.json');
const projectConfig = JSON.parse(readFileSync(projectConfigPath, 'utf8'));
projectConfig.appid = isolatedAppId;
projectConfig.projectname = `shushugo-parity-${projectTag}`;
projectConfig.setting = { ...projectConfig.setting, urlCheck: false };
writeFileSync(projectConfigPath, `${JSON.stringify(projectConfig, null, 2)}\n`);
const appJsonPath = path.join(isolatedProject, 'src/app.json');
const appConfig = JSON.parse(readFileSync(appJsonPath, 'utf8'));
const requestedPage = miniRoute.replace(/^\/+/, '');
const bootstrapPage = 'pages/parity-bootstrap/index';
mkdirSync(path.join(isolatedProject, 'src/pages/parity-bootstrap'), { recursive: true });
writeFileSync(path.join(isolatedProject, 'src/pages/parity-bootstrap/index.js'), 'Page({});\n');
writeFileSync(path.join(isolatedProject, 'src/pages/parity-bootstrap/index.json'), '{}\n');
writeFileSync(path.join(isolatedProject, 'src/pages/parity-bootstrap/index.wxml'), '<view />\n');
writeFileSync(path.join(isolatedProject, 'src/pages/parity-bootstrap/index.wxss'), '');
appConfig.pages = [bootstrapPage, ...appConfig.pages.filter((page) => page !== bootstrapPage)];
writeFileSync(appJsonPath, `${JSON.stringify(appConfig, null, 2)}\n`);
const databaseStorePath = path.join(isolatedProject, 'src/runtime/database-store.js');
const databaseStoreSource = readFileSync(databaseStorePath, 'utf8');
const isolatedDatabaseStoreSource = databaseStoreSource.replaceAll('}/shushugo', `}/shushugo-${projectTag}`);
if (isolatedDatabaseStoreSource === databaseStoreSource) throw new Error('无法为临时小程序建立独立用户数据目录');
writeFileSync(databaseStorePath, isolatedDatabaseStoreSource);

const frontendRequire = createRequire(path.join(root, 'frontend/package.json'));
const miniRequire = createRequire(path.join(root, 'wechat-miniprogram/package.json'));
const { chromium } = frontendRequire('playwright');
const automator = miniRequire('miniprogram-automator');
const MiniProgram = miniRequire('miniprogram-automator/out/MiniProgram').default;
const compareVersions = miniRequire('licia/cmpVersion');
// Current Electron DevTools returns `version` where automator 0.12.1 expects `SDKVersion`.
MiniProgram.prototype.checkVersion = async function checkVersionCompat() {
  const { SDKVersion } = await this.send('Tool.getInfo');
  if (SDKVersion && SDKVersion !== 'dev' && compareVersions(SDKVersion, '2.7.3') < 0) {
    throw new Error(`WeChat base library ${SDKVersion} is below automator's 2.7.3 minimum`);
  }
};
let browser;
let miniProgram;
let miniUserDataDirectory = '';
let webSetupVisible = false;
let miniSetupVisible = false;
let completed = false;

function pngSize(filePath) {
  const bytes = readFileSync(filePath);
  if (bytes.toString('ascii', 1, 4) !== 'PNG') throw new Error(`不是 PNG 截图：${filePath}`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

try {
  const chromePath = args['--browser-executable'] || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  browser = await chromium.launch({ headless: true, ...(chromePath ? { executablePath: chromePath } : existsSync(systemChrome) ? { executablePath: systemChrome } : {}) });
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 1 });
  await page.goto(webUrl, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.evaluate(() => document.fonts?.ready.then(() => true));
  webSetupVisible = await page.locator('.ls-backdrop').count() > 0;
  await page.screenshot({ path: webImagePath });
  await browser.close();
  browser = undefined;

  miniProgram = await automator.launch({
    cliPath,
    projectPath: isolatedProject,
    timeout: 120_000,
    trustProject: true,
    args: ['--port', String(cliHttpPort)],
  });
  miniProgram.on('console', (event) => console.error(`[小程序 console] ${JSON.stringify(event)}`));
  miniProgram.on('exception', (event) => console.error(`[小程序 exception] ${JSON.stringify(event)}`));
  let lastPageStack = '(未读取)';
  const waitForPage = async (route) => {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const stack = await miniProgram.pageStack();
      lastPageStack = stack.map((page) => page.path).join(' → ') || '(空)';
      const targetPage = stack.slice().reverse().find((page) => page.path === route);
      if (targetPage && (route !== 'pages/home/index' || await targetPage.$('.page'))) return targetPage;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`等待小程序页面超时：${route}；当前页面栈：${lastPageStack}`);
  };
  console.log('开发者工具已连接，等待临时项目启动页');
  await waitForPage(appConfig.pages[0]);
  console.log('临时项目启动页已打开，写入隔离的出厂种子库');
  const seedResult = await miniProgram.evaluate((seedUrl, directoryName) => new Promise((resolve) => {
    const failed = (step, error) => resolve({ ok: false, step, error: error?.errMsg || error?.message || String(error) });
    const fs = wx.getFileSystemManager();
    const directory = `${wx.env.USER_DATA_PATH}/${directoryName}`;
    const destination = `${directory}/nihongo.db`;
    const copySeed = (tempFilePath, statusCode) => fs.copyFile({
      srcPath: tempFilePath,
      destPath: destination,
      success: () => resolve({ ok: true, statusCode, directory }),
      fail: (error) => failed('copy', error)
    });
    wx.downloadFile({
      url: seedUrl,
      success: ({ statusCode, tempFilePath }) => {
        if (statusCode < 200 || statusCode >= 300) return failed('download', `HTTP ${statusCode}`);
        fs.mkdir({
          dirPath: directory,
          recursive: true,
          success: () => copySeed(tempFilePath, statusCode),
          fail: (error) => error?.errMsg?.includes('file already exists') ? copySeed(tempFilePath, statusCode) : failed('mkdir', error)
        });
      },
      fail: (error) => failed('download', error)
    });
  }), `${url.origin}/nihongo.db`, `shushugo-${projectTag}`);
  if (!seedResult?.ok) throw new Error(`临时小程序安装出厂种子库失败（${seedResult?.step}）：${seedResult?.error}`);
  miniUserDataDirectory = seedResult.directory;
  console.log(`已在临时小程序用户目录安装同一出厂种子库（HTTP ${seedResult.statusCode}）`);
  const tabPages = new Set((appConfig.tabBar?.list || []).map(({ pagePath }) => pagePath));
  if (tabPages.has(requestedPage)) await miniProgram.switchTab(`/${requestedPage}`);
  else await miniProgram.navigateTo(miniRoute);
  await waitForPage(requestedPage);
  miniSetupVisible = (await miniProgram.pageStack()).some(({ path }) => path === 'features/jlpt-plan/index');
  await new Promise((resolve) => setTimeout(resolve, 500));
  await miniProgram.screenshot({ path: miniImagePath });
  const miniSystemInfo = await miniProgram.evaluate(() => wx.getWindowInfo());
  const webSize = pngSize(webImagePath);
  const miniSize = pngSize(miniImagePath);
  const escapeHtml = (value) => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const report = `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>网页 / 微信小程序对照：${escapeHtml(miniRoute)}</title>
<style>
  body{margin:0;padding:24px;background:#f4f1e9;color:#2b241c;font:15px/1.5 system-ui,sans-serif}
  h1{font-size:20px;margin:0 0 8px}p{margin:0 0 18px;color:#655d53}
  main{display:grid;grid-template-columns:repeat(2,minmax(0,375px));gap:16px;align-items:start}
  figure{margin:0;padding:12px;background:#fff;border-radius:12px;box-shadow:0 2px 12px #0001}
  figcaption{margin-bottom:8px;font-weight:700}img{display:block;width:100%;height:auto;background:#eee}
  @media(max-width:790px){main{grid-template-columns:minmax(0,375px)}}
</style>
<h1>网页 / 微信小程序视觉对照</h1><p>网页：${escapeHtml(page.url())}（375 × 812） · 小程序：${escapeHtml(miniRoute)}（${miniSystemInfo.windowWidth} × ${miniSystemInfo.windowHeight}） · 两端使用同一出厂种子库。${webSetupVisible && miniSetupVisible ? '两端均显示首次启动的学习计划设置层。' : webSetupVisible || miniSetupVisible ? `首次启动的学习计划设置层状态不同：网页${webSetupVisible ? '显示' : '未显示'}，小程序${miniSetupVisible ? '显示' : '未显示'}。` : ''}</p>
<main><figure><figcaption>网页（${webSize.width} × ${webSize.height}）</figcaption><img src="${webImageName}" alt="网页截图"></figure>
<figure><figcaption>微信开发者工具（${miniSize.width} × ${miniSize.height}）</figcaption><img src="${miniImageName}" alt="小程序截图"></figure></main></html>`;
  writeFileSync(reportPath, report);
  completed = true;
  console.log(`网页截图：${webImagePath} (${webSize.width}×${webSize.height})`);
  console.log(`小程序截图：${miniImagePath} (${miniSize.width}×${miniSize.height})`);
  console.log(`对照报告：${reportPath}`);
} finally {
  await browser?.close().catch(() => {});
  if (miniProgram && miniUserDataDirectory) {
    await miniProgram.evaluate((directory) => new Promise((resolve) => {
      wx.getFileSystemManager().rmdir({ dirPath: directory, recursive: true, success: () => resolve(true), fail: () => resolve(false) });
    }), miniUserDataDirectory).catch(() => {});
  }
  miniProgram?.disconnect();
  try { execFileSync(cliPath, ['--port', String(cliHttpPort), 'close', '--project', isolatedProject], { stdio: 'ignore', timeout: 15_000 }); } catch {}
  rmSync(isolatedProject, { recursive: true, force: true });
  if (!completed) for (const filePath of [webImagePath, miniImagePath, reportPath]) rmSync(filePath, { force: true });
}
