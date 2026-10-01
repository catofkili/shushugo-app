// 无网络、无真实密钥；同时验证请求参数和错误不会泄露请求正文。
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const originalLoad = Module._load;
const originalEnv = { id: process.env.TALK_ASR_SECRET_ID, key: process.env.TALK_ASR_SECRET_KEY };
let openid = 'mock-openid';
let result = { Result: 'はい。' };
let failure;
const requests = [];
const configs = [];
Module._load = function (name, ...rest) {
  if (name === 'wx-server-sdk') return { init() {}, DYNAMIC_CURRENT_ENV: 'mock-env', getWXContext: () => ({ OPENID: openid }) };
  if (name === 'tencentcloud-sdk-nodejs-asr') return { asr: { v20190614: { Client: class {
    constructor(config) { configs.push(config); }
    async SentenceRecognition(params) { requests.push(params); if (failure) throw failure; return result; }
  } } } };
  return originalLoad.call(this, name, ...rest);
};
try {
  const { main } = require('../cloudfunctions/talk-asr/index.js');
  const event = { audio: Buffer.from('mock audio').toString('base64'), format: 'mp3' };
  delete process.env.TALK_ASR_SECRET_ID;
  delete process.env.TALK_ASR_SECRET_KEY;
  assert.deepEqual(await main(event), { error: 'not_configured' });
  process.env.TALK_ASR_SECRET_ID = 'mock-id';
  assert.deepEqual(await main(event), { error: 'not_configured' });
  assert.equal(requests.length, 0);
  process.env.TALK_ASR_SECRET_KEY = 'mock-key';
  assert.deepEqual(await main({ audio: Buffer.alloc(600 * 1024 + 1).toString('base64'), format: 'mp3' }), { error: 'too_long' });
  assert.equal(requests.length, 0);
  openid = undefined;
  assert.deepEqual(await main(event), { error: 'asr_failed', code: 'Unauthorized' });
  assert.equal(requests.length, 0);
  openid = 'mock-openid';
  for (const bad of [{ ...event, format: 'wav' }, { ...event, audio: '***' }, {}]) {
    assert.deepEqual(await main(bad), { error: 'asr_failed', code: 'InvalidParameter' });
  }
  assert.deepEqual(await main(event), { text: 'はい。' });
  assert.deepEqual(requests.at(-1), { EngSerViceType: '16k_ja', SourceType: 1, VoiceFormat: 'mp3', Data: event.audio, DataLen: 10 });
  assert.equal(configs.at(-1).region, 'ap-shanghai');
  assert.equal(configs.at(-1).profile.signMethod, 'TC3-HMAC-SHA256');
  assert.deepEqual(await main({ audio: Buffer.alloc(600 * 1024).toString('base64'), format: 'mp3' }), { text: 'はい。' });
  failure = { code: 'FailedOperation.ServiceNotActivated', message: 'never return request body or credentials' };
  assert.deepEqual(await main(event), { error: 'asr_failed', code: failure.code });
  failure = { code: 'unsafe code with request', message: 'never return this' };
  assert.deepEqual(await main(event), { error: 'asr_failed', code: 'InternalError' });
  failure = undefined; result = { Result: '' };
  assert.deepEqual(await main(event), { text: '' });
  console.log('✅ talk-asr: 未配置 / 超长 / 成功 / 腾讯云失败、OPENID、格式、600 KB 边界、空结果均通过（mock，无网络）');
} finally {
  Module._load = originalLoad;
  for (const [name, value] of [['TALK_ASR_SECRET_ID', originalEnv.id], ['TALK_ASR_SECRET_KEY', originalEnv.key]]) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
}
