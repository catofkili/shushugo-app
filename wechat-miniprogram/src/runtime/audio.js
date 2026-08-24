const config = require('../config');
const { requestJson } = require('./wx-promise');

let audioIndex = null;
let audioContext = null;

function clean(text) {
  return String(text || '').replace(/\[[^\]]*\]/g, '').replace(/[〜～~\s]/g, '');
}

function audioName(kanji, kana) {
  if (typeof BigInt !== 'function') return null;
  let hash = BigInt('0xcbf29ce484222325');
  for (const char of `${kanji}|${kana}`) {
    hash ^= BigInt(char.codePointAt(0) || 0);
    hash = (hash * BigInt('0x100000001b3')) & BigInt('0xffffffffffffffff');
  }
  return hash.toString(16).padStart(16, '0');
}

async function loadAudioIndex() {
  if (audioIndex) return audioIndex;
  if (!config.audioIndexUrl) return null;
  try {
    const data = await requestJson(config.audioIndexUrl);
    audioIndex = Array.isArray(data?.voices) ? data : null;
  } catch {
    audioIndex = null;
  }
  return audioIndex;
}

async function playWordAudio(kanji, kana) {
  const index = await loadAudioIndex();
  const voice = index?.voices?.find((item) => item.id === index.default) || index?.voices?.[0];
  const name = audioName(kanji, kana);
  if (!config.audioBaseUrl || !voice || !name) return { played: false, reason: '没有配置可用的音频 CDN' };
  audioContext ||= wx.createInnerAudioContext();
  audioContext.stop();
  audioContext.src = `${config.audioBaseUrl.replace(/\/$/, '')}/${encodeURIComponent(voice.id)}/${name}${voice.ext || '.aac'}`;
  await new Promise((resolve, reject) => {
    audioContext.offCanplay?.();
    audioContext.offError?.();
    audioContext.onCanplay(resolve);
    audioContext.onError(reject);
    audioContext.play();
  });
  return { played: true };
}

module.exports = { playWordAudio, audioName, loadAudioIndex };
