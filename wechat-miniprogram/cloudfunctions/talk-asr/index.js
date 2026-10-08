// 实验功能：仅转写，不判断用户说得对不对。密钥只从函数环境变量读，音频不落日志。
const cloud = require('wx-server-sdk');
const { asr } = require('tencentcloud-sdk-nodejs-asr');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const USAGE_COLLECTION = 'talk_asr_usage';
const beijingDate = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(Date.now()));
  const value = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${value.year}-${value.month}-${value.day}`;
};

const dailyLimit = () => {
  const value = String(process.env.TALK_ASR_DAILY_LIMIT ?? '').trim();
  if (!value) return 100;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('Invalid TALK_ASR_DAILY_LIMIT');
  return Number(value);
};

const errorText = (error) => `${error?.code ?? ''} ${error?.errCode ?? ''} ${error?.message ?? ''} ${error?.errMsg ?? ''}`;
const isCollectionMissing = (error) => Number(error?.errCode) === -502005 || /COLLECTION_NOT_EXIST|collection.{0,80}(?:not exist|does not exist|not found)|集合.{0,20}不存在/i.test(errorText(error));
const isDocumentMissing = (error) => Number(error?.errCode) === -502006 || /DOCUMENT_NOT_EXIST|document.{0,80}(?:not exist|does not exist|not found)|doc.{0,80}(?:not exist|does not exist|not found)/i.test(errorText(error));
const isDuplicate = (error) => /DUPLICATE|duplicate|already exists|E11000|已存在/i.test(errorText(error));
const isCollectionAlreadyExists = (error) => /COLLECTION_ALREADY_EXISTS|collection.{0,80}already exists|集合.{0,20}已存在/i.test(errorText(error));

const withCollectionRetry = async (operation) => {
  try { return await operation(); }
  catch (error) {
    if (!isCollectionMissing(error)) throw error;
    try { await cloud.database().createCollection(USAGE_COLLECTION); }
    catch (createError) { if (!isCollectionAlreadyExists(createError)) throw createError; }
    return operation();
  }
};

const reserveDailyUsage = async (openid, limit) => {
  if (limit === 0) return false;
  const db = cloud.database();
  const documentId = `${openid}_${beijingDate()}`;
  return withCollectionRetry(async () => {
    const collection = db.collection(USAGE_COLLECTION);
    const incrementIfBelowLimit = async () => {
      // 先在数据库里条件自增；先读 count 再判断会让并发请求一起越限。
      const result = await collection.where({ _id: documentId, count: db.command.lt(limit) })
        .update({ data: { count: db.command.inc(1) } });
      if (result?.stats?.updated === 1) return true;
      if (result?.stats?.updated !== 0) throw new Error('Unexpected quota update result');
      return false;
    };
    const currentCount = async () => {
      let result;
      try { result = await collection.doc(documentId).get(); }
      catch (error) { if (isDocumentMissing(error)) return undefined; throw error; }
      return result?.data;
    };

    if (await incrementIfBelowLimit()) return true;
    const existing = await currentCount();
    if (existing) {
      if (Number.isSafeInteger(existing.count) && existing.count >= limit) return false;
      throw new Error('Quota counter was not incremented');
    }
    try {
      await collection.add({ data: { _id: documentId, count: 1 } });
      return true;
    } catch (error) {
      if (!isDuplicate(error)) throw error;
      // Another first request created this fixed-id document. Retry the atomic conditional increment.
      if (await incrementIfBelowLimit()) return true;
      const raced = await currentCount();
      if (raced && Number.isSafeInteger(raced.count) && raced.count >= limit) return false;
      throw new Error('Quota counter was not incremented');
    }
  });
};

exports.main = async (event) => {
  if (!cloud.getWXContext().OPENID) return { error: 'asr_failed', code: 'Unauthorized' };
  const secretId = process.env.TALK_ASR_SECRET_ID;
  const secretKey = process.env.TALK_ASR_SECRET_KEY;
  if (!secretId || !secretKey) return { error: 'not_configured' };
  if (event?.format !== 'mp3' || typeof event.audio !== 'string') return { error: 'asr_failed', code: 'InvalidParameter' };
  // 先限编码长度，再解码；不让客户端用超大的字符串耗掉实例内存。
  if (event.audio.length > Math.ceil(600 * 1024 / 3) * 4) return { error: 'too_long' };
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(event.audio)) return { error: 'asr_failed', code: 'InvalidParameter' };
  const audio = Buffer.from(event.audio, 'base64');
  if (audio.length > 600 * 1024) return { error: 'too_long' };
  if (!audio.length) return { text: '' };
  let allowed;
  try { allowed = await reserveDailyUsage(cloud.getWXContext().OPENID, dailyLimit()); }
  catch { return { error: 'asr_failed', code: 'QuotaCheckFailed' }; }
  if (!allowed) return { error: 'too_many' };
  try {
    // 官方 SDK 用 HTTPS，兼容云函数默认 Node 16，不依赖全局 fetch。
    const client = new asr.v20190614.Client({
      credential: { secretId, secretKey },
      region: 'ap-shanghai',
      profile: { signMethod: 'TC3-HMAC-SHA256', httpProfile: { endpoint: 'asr.tencentcloudapi.com', reqTimeout: 30 } }
    });
    const response = await client.SentenceRecognition({
      EngSerViceType: '16k_ja', SourceType: 1, VoiceFormat: 'mp3', Data: event.audio, DataLen: audio.length
    });
    return { text: response.Result || '' };
  } catch (error) {
    // 不返回 message / request，SDK 错误里可能含请求细节；仅保留腾讯云错误码。
    return { error: 'asr_failed', code: typeof error?.code === 'string' && /^[A-Za-z][A-Za-z0-9_.]*$/.test(error.code) ? error.code : 'InternalError' };
  }
};
