// 实验功能：仅转写，不判断用户说得对不对。密钥只从函数环境变量读，音频不落日志。
const cloud = require('wx-server-sdk');
const { asr } = require('tencentcloud-sdk-nodejs-asr');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

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
