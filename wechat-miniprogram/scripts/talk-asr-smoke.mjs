// 无网络、无真实密钥；模拟云开发数据库和腾讯云 SDK。
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const originalLoad = Module._load;
const originalEnv = Object.fromEntries(['TALK_ASR_SECRET_ID', 'TALK_ASR_SECRET_KEY', 'TALK_ASR_DAILY_LIMIT'].map((name) => [name, process.env[name]]));
let openid = 'mock-openid';
let result = { Result: 'はい。' };
let failure;
let databaseFailure;
let collectionExists = true;
let documents = new Map();
let requests = [];
let configs = [];
let updateAttempts = 0;
let createAttempts = 0;
const collectionName = 'talk_asr_usage';

const dbError = (code, message) => Object.assign(new Error(message), { code });
const assertCollection = (name) => {
  assert.equal(name, collectionName);
  if (databaseFailure) throw databaseFailure;
  if (!collectionExists) throw dbError('COLLECTION_NOT_EXIST', 'collection not exists');
};
const database = {
  command: {
    inc: (value) => ({ operator: 'inc', value }),
    lt: (value) => ({ operator: 'lt', value })
  },
  async createCollection(name) {
    assert.equal(name, collectionName);
    createAttempts += 1;
    if (databaseFailure) throw databaseFailure;
    if (collectionExists) throw dbError('COLLECTION_ALREADY_EXISTS', 'collection already exists');
    collectionExists = true;
  },
  collection(name) {
    assert.equal(name, collectionName);
    return {
      where(filter) {
        return {
          async update({ data }) {
            assertCollection(name);
            updateAttempts += 1;
            const row = documents.get(filter._id);
            if (!row || !(row.count < filter.count.value)) return { stats: { updated: 0 } };
            row.count += data.count.value;
            return { stats: { updated: 1 } };
          }
        };
      },
      doc(id) {
        return {
          async get() {
            assertCollection(name);
            const row = documents.get(id);
            return { data: row ? { ...row } : null };
          }
        };
      },
      async add({ data }) {
        assertCollection(name);
        if (documents.has(data._id)) throw dbError('DUPLICATE_KEY', 'document already exists');
        documents.set(data._id, { ...data });
      }
    };
  }
};

const cloud = {
  DYNAMIC_CURRENT_ENV: 'mock-env',
  init() {},
  database: () => database,
  getWXContext: () => ({ OPENID: openid })
};
Module._load = function (name, ...rest) {
  if (name === 'wx-server-sdk') return cloud;
  if (name === 'tencentcloud-sdk-nodejs-asr') return { asr: { v20190614: { Client: class {
    constructor(config) { configs.push(config); }
    async SentenceRecognition(params) { requests.push(params); if (failure) throw failure; return result; }
  } } } };
  return originalLoad.call(this, name, ...rest);
};

const reset = ({ hasCollection = true } = {}) => {
  documents = new Map(); requests = []; configs = [];
  updateAttempts = 0; createAttempts = 0;
  databaseFailure = undefined; failure = undefined; result = { Result: 'はい。' };
  collectionExists = hasCollection;
};
const validEvent = { audio: Buffer.from('mock audio').toString('base64'), format: 'mp3' };
const counterId = (day) => `mock-openid_${day}`;
const beijingDay = (timestamp = Date.now()) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(timestamp));
  const value = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${value.year}-${value.month}-${value.day}`;
};

try {
  const { main } = require('../cloudfunctions/talk-asr/index.js');
  delete process.env.TALK_ASR_SECRET_ID;
  delete process.env.TALK_ASR_SECRET_KEY;
  delete process.env.TALK_ASR_DAILY_LIMIT;
  assert.deepEqual(await main(validEvent), { error: 'not_configured' });
  process.env.TALK_ASR_SECRET_ID = 'mock-id';
  assert.deepEqual(await main(validEvent), { error: 'not_configured' });
  assert.equal(updateAttempts, 0);

  process.env.TALK_ASR_SECRET_KEY = 'mock-key';
  reset();
  assert.deepEqual(await main({ audio: Buffer.alloc(600 * 1024 + 1).toString('base64'), format: 'mp3' }), { error: 'too_long' });
  assert.equal(requests.length, 0);
  openid = undefined;
  assert.deepEqual(await main(validEvent), { error: 'asr_failed', code: 'Unauthorized' });
  assert.equal(requests.length, 0);
  openid = 'mock-openid';
  for (const bad of [{ ...validEvent, format: 'wav' }, { ...validEvent, audio: '***' }, {}]) {
    assert.deepEqual(await main(bad), { error: 'asr_failed', code: 'InvalidParameter' });
  }
  assert.deepEqual(await main({ audio: '', format: 'mp3' }), { text: '' });
  assert.equal(updateAttempts, 0);
  assert.equal(documents.size, 0);

  assert.deepEqual(await main(validEvent), { text: 'はい。' });
  assert.deepEqual(requests.at(-1), { EngSerViceType: '16k_ja', SourceType: 1, VoiceFormat: 'mp3', Data: validEvent.audio, DataLen: 10 });
  assert.equal(configs.at(-1).region, 'ap-shanghai');
  assert.equal(configs.at(-1).profile.signMethod, 'TC3-HMAC-SHA256');
  assert.deepEqual(await main({ audio: Buffer.alloc(600 * 1024).toString('base64'), format: 'mp3' }), { text: 'はい。' });
  failure = { code: 'FailedOperation.ServiceNotActivated', message: 'never return request body or credentials' };
  assert.deepEqual(await main(validEvent), { error: 'asr_failed', code: failure.code });
  assert.equal(documents.get(counterId(beijingDay()))?.count, 3);
  failure = { code: 'unsafe code with request', message: 'never return this' };
  assert.deepEqual(await main(validEvent), { error: 'asr_failed', code: 'InternalError' });
  failure = undefined; result = { Result: '' };
  assert.deepEqual(await main(validEvent), { text: '' });

  reset();
  for (let index = 0; index < 100; index += 1) assert.deepEqual(await main(validEvent), { text: 'はい。' });
  assert.deepEqual(await main(validEvent), { error: 'too_many' });
  assert.equal(requests.length, 100);
  assert.equal(documents.get(counterId(beijingDay()))?.count, 100);

  reset();
  process.env.TALK_ASR_DAILY_LIMIT = '2';
  assert.deepEqual(await main(validEvent), { text: 'はい。' });
  assert.deepEqual(await main(validEvent), { text: 'はい。' });
  assert.deepEqual(await main(validEvent), { error: 'too_many' });
  assert.equal(requests.length, 2);
  openid = 'another-openid';
  assert.deepEqual(await main(validEvent), { text: 'はい。' });
  assert.equal(documents.get(`another-openid_${beijingDay()}`)?.count, 1);
  openid = 'mock-openid';

  reset();
  const realNow = Date.now;
  Date.now = () => Date.parse('2026-10-08T16:30:00.000Z');
  try { assert.deepEqual(await main(validEvent), { text: 'はい。' }); }
  finally { Date.now = realNow; }
  assert.equal(documents.get('mock-openid_2026-10-09')?.count, 1);

  reset({ hasCollection: false });
  assert.deepEqual(await main(validEvent), { text: 'はい。' });
  assert.equal(createAttempts, 1);
  assert.equal(requests.length, 1);

  reset();
  databaseFailure = dbError('DATABASE_UNAVAILABLE', 'database is unavailable');
  assert.deepEqual(await main(validEvent), { error: 'asr_failed', code: 'QuotaCheckFailed' });
  assert.equal(requests.length, 0);
  console.log('✅ talk-asr: 成功 / 失败计数 / 默认与自定义上限 / 北京日期 / 自动建集合 / 计数故障关闭 / 非法及空音频不计数（mock，无网络）');
} finally {
  Module._load = originalLoad;
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
}
