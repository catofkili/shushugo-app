/*
 * 上传前检查：只看**要上传的东西**（dist/ + project.config.json），不看源码。
 * 原生版对应 wechat-miniprogram/scripts/check-source.mjs（那边 09-21 上传的 0.1.0 开发版把诊断界面带进过用户界面）。
 * 上传 / 提审之前：`npm run build:weapp && npm run check:release`。⚠️ `build:preview:weapp` 的计时版永远不许上传。
 *
 * 用法：node scripts/check-release.mjs [dist 目录] [project.config.json]
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.resolve(process.argv[2] ?? path.join(root, 'dist'));
const configPath = path.resolve(process.argv[3] ?? path.join(root, 'project.config.json'));

const files = fs.readdirSync(dist, { recursive: true }).map(String).filter((f) => fs.statSync(path.join(dist, f)).isFile());
const texts = files.filter((f) => /\.(js|json|wxml|wxss|wxs)$/.test(f)).map((f) => [f, fs.readFileSync(path.join(dist, f), 'utf8')]);
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const app = JSON.parse(fs.readFileSync(path.join(dist, 'app.json'), 'utf8'));
const hits = (pattern) => texts.filter(([, text]) => pattern.test(text)).map(([file]) => file);
const fails = (ok, detail = []) => (ok ? [] : detail.length ? detail : ['(配置)']);
const localNetworkUrl = /https?:\/\/(?:localhost(?:\.local)?|(?:127|10)\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3}|0\.0\.0\.0|\[::1\]|::1|[A-Z0-9-]+\.local)(?=[:/]|$)/i;

const checks = [
  ['不带 sourcemap', [
    ...fails(config.setting?.uploadWithSourceMap === false),
    ...files.filter((f) => f.endsWith('.map')),
    ...hits(/sourceMappingURL=/)
  ]],
  ['urlCheck 开着', fails(config.setting?.urlCheck === true)],
  ['开发工具基础库设为 2.32.3', fails(config.libVersion === '2.32.3')],
  ['appid 不是游客号', fails(Boolean(config.appid) && config.appid !== 'touristappid')],
  ['app.json 没开 debug', fails(app.debug !== true)],
  ['正式环境变量（DEV=false）', hits(/"DEV":true/)],
  ['没有指向本机 / 内网的地址', hits(localNetworkUrl)],
  // 大陆打不开 workers.dev；小程序里所有 Worker 请求都走云函数 api（见 docs/MINIPROGRAM_SYNC_PLAN.md）。
  ['没有 workers.dev', hits(/workers\.dev/)],
  // 只拦「真的打开了调试」：Taro 运行时自带的接口名单里本来就有 setEnableDebug 这个名字。
  ['没开 vConsole / 调试', hits(/vConsole|enableDebug\s*:\s*(!0|true)/)],
  ['不是计时预览版', hits(/preview-timing-host|\[preview-timing\]/)],
  // TARO_PERF_OVERLAY=1 出的分段计时版（React 是正式版，上面那条认不出来）
  ['不是分段计时版', hits(/perf-overlay-marker/)],
  ['没有开发专用代码', hits(/__live-snapshot|开发环境常开 Pro/)],
  ['没有周报模拟夹具', hits(/__SHUSHUGO_DEV_ONLY_FIXTURE__/)],
  ['没有密钥', hits(new RegExp([
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/.source,
    /(app_?secret|private_?key|api_?key|secret_?key|wechat_?(?:pay_?)?app_?key|(?:access|refresh|auth)_?token)["']?\s*[:=]\s*["'][A-Za-z0-9+/=_-]{16,}["']/.source,
    /\bsk-[A-Za-z0-9]{32,}/.source,
    /\bAKID[A-Za-z0-9]{13,}/.source,
    /\bghp_[A-Za-z0-9]{36}\b/.source
  ].join('|'), 'i'))]
];

const failed = checks.filter(([, bad]) => bad.length);
for (const [name, bad] of checks) console.log(`${bad.length ? '❌' : '✅'} ${name}${bad.length ? `：${bad.slice(0, 5).join('、')}` : ''}`);
if (failed.length) {
  console.error(`\n上传前检查没过（${failed.length} 项），别上传。`);
  process.exit(1);
}
console.log('\n上传前检查通过');
