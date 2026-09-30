// check-release.mjs 自测：干净的产物要过，埋了问题的每一条都要拦住（正则写错时这里先红）。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const script = path.join(import.meta.dirname, 'check-release.mjs');
const run = (files, setting = { uploadWithSourceMap: false, urlCheck: true }, libVersion = '2.32.3') => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-release-'));
  const dist = path.join(dir, 'dist');
  fs.mkdirSync(dist);
  fs.writeFileSync(path.join(dist, 'app.json'), '{"pages":["pages/index/index"]}');
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dist, name), text);
  fs.writeFileSync(path.join(dir, 'project.config.json'), JSON.stringify({ appid: 'wxfbdb3cd03f09fa7d', libVersion, setting }));
  try {
    execFileSync(process.execPath, [script, dist, path.join(dir, 'project.config.json')], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

const clean = 'var a={"DEV":false};var apis=["setEnableDebug"];var msg="请用 HTTPS 或 localhost 打开"';
assert.equal(run({ 'common.js': clean }), true, '干净的产物要过');
for (const [label, text] of Object.entries({
  localhost: 'fetch("http://localhost:8787/api")',
  private10: 'fetch("https://10.0.0.3/api")',
  private172: 'fetch("http://172.16.4.2/api")',
  linkLocal: 'fetch("http://169.254.1.2/api")',
  ipv6Loopback: 'fetch("http://[::1]:8787/api")',
  localDomain: 'fetch("http://shushugo.local/api")',
  workersDev: 'var u="https://x.workers.dev"',
  vconsole: 'wx.setEnableDebug({enableDebug:!0})',
  timing: 'console.log("[preview-timing] Taro study")',
  devOnly: 'var o="/__live-snapshot"',
  mockFixture: 'var o="__SHUSHUGO_DEV_ONLY_FIXTURE__"',
  expTalk: 'var m="__SHUSHUGO_EXP_TALK__"',
  devEnv: 'var e={"DEV":true}',
  privateKey: '"-----BEGIN PRIVATE KEY-----"',
  appSecret: 'var c={appSecret:"0123456789abcdef0123456789abcdef"}',
  wechatPayAppKey: 'var c={WECHAT_PAY_APP_KEY:"0123456789abcdef"}',
  accessToken: 'var c={accessToken:"0123456789abcdef"}'
})) assert.equal(run({ 'common.js': `${clean};${text}` }), false, `${label} 要被拦住`);
assert.equal(run({ 'common.js': clean, 'common.js.map': '{}' }), false, 'sourcemap 文件要被拦住');
assert.equal(run({ 'common.js': clean, 'app.json': '{"pages":["pages/index/index"],"subPackages":[{"root":"study","pages":["talk/index"]}]}' }), false, '实验页面（开口练习）要被拦住');
assert.equal(run({ 'common.js': clean }, { uploadWithSourceMap: true, urlCheck: true }), false, 'uploadWithSourceMap 要关');
assert.equal(run({ 'common.js': clean }, { uploadWithSourceMap: false, urlCheck: false }), false, 'urlCheck 要开');
assert.equal(run({ 'common.js': clean }, { uploadWithSourceMap: false, urlCheck: true }, '2.31.0'), false, '基础库版本要对齐');
console.log('check-release 自测通过');
