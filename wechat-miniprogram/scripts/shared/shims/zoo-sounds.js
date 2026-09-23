/*
 * 网页用 WebAudio 振荡器；微信没有那组接口。把同样的短木质音合成成 WAV 写到本机，
 * 再交给 InnerAudioContext 播放。这里只替换音频平台，不参与评分、连击或偏好判断。
 */
let timbre = 'kalimba';
let player = null;
const files = new Map();
const RATE = 16000;
const TWO_PI = Math.PI * 2;

function setSoundTimbre(next) {
  timbre = ['kalimba', 'marimba', 'epiano'].includes(next) ? next : 'kalimba';
}

function wave(phase) {
  if (timbre === 'marimba') return Math.sin(phase);
  if (timbre === 'epiano') return Math.sin(phase) * 0.78 + Math.sin(phase * 2) * 0.22;
  return 2 / Math.PI * Math.asin(Math.sin(phase));
}

function note(freq, start, duration, gain) { return { freq, start, duration, gain }; }

function shepard(step, start, duration, gain) {
  const offset = ((step % 12) + 12) % 12 / 12;
  const parts = Array.from({ length: 9 }, (_, octave) => {
    const freq = 32.703 * 2 ** (octave + offset);
    const distance = Math.log2(freq / 523.25);
    return { freq, weight: Math.exp(-distance * distance / (2 * 0.85 ** 2)) };
  });
  const total = parts.reduce((sum, part) => sum + part.weight, 0);
  return parts.map((part) => note(part.freq, start, duration * Math.min(2.2, Math.max(0.3, (523.25 / part.freq) ** 0.8)), gain * part.weight / total));
}

function score(name) {
  if (name.startsWith('know-')) {
    const step = Number(name.slice(5));
    return [...shepard(step, 0, 0.16, 0.23), ...shepard(step + 4, 0.09, 0.22, 0.23)];
  }
  if (name === 'wrong') return [note(440, 0, 0.18, 0.12), note(349.23, 0.1, 0.26, 0.11)];
  if (name === 'flip') return [note(880, 0, 0.06, 0.06)];
  if (name === 'complete') return [note(523.25, 0, 0.2, 0.23), note(659.25, 0.12, 0.2, 0.23), note(783.99, 0.24, 0.32, 0.25)];
  if (name === 'countdown') return [note(880, 0, 0.1, 0.105), note(1046.5, 0.045, 0.13, 0.09)];
  if (name === 'relief') return [note(783.99, 0, 0.09, 0.13), note(1046.5, 0.055, 0.14, 0.11)];
  return [];
}

function wav(notes) {
  const seconds = Math.max(...notes.map((item) => item.start + item.duration), 0) + 0.04;
  const samples = Math.ceil(seconds * RATE);
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const label = (at, value) => { for (let i = 0; i < 4; i++) view.setUint8(at + i, value.charCodeAt(i)); };
  label(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); label(8, 'WAVE');
  label(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, RATE, true); view.setUint32(28, RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  label(36, 'data'); view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) {
    const t = i / RATE;
    let value = 0;
    for (const item of notes) {
      const age = t - item.start;
      if (age < 0 || age >= item.duration) continue;
      const attack = Math.min(1, age / 0.012);
      const decay = Math.exp(-5.5 * age / item.duration);
      value += wave(TWO_PI * item.freq * age) * attack * decay * item.gain;
    }
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, value)) * 32767, true);
  }
  return buffer;
}

function play(name) {
  if (typeof wx === 'undefined' || !wx.createInnerAudioContext || !wx.getFileSystemManager || !wx.env?.USER_DATA_PATH) return;
  try {
    const key = `${timbre}-${name}`;
    let file = files.get(key);
    if (!file) {
      file = `${wx.env.USER_DATA_PATH}/shushugo-sfx-v1-${key}.wav`;
      wx.getFileSystemManager().writeFileSync(file, wav(score(name)));
      files.set(key, file);
    }
    player ||= wx.createInnerAudioContext();
    player.stop();
    player.src = file;
    player.play();
  } catch (error) { console.warn('[sounds] 音效不可用', error); }
}

module.exports = {
  setSoundTimbre,
  playKnow: (step = 0) => play(`know-${((step % 12) + 12) % 12}`),
  playDontKnow: () => play('wrong'),
  playFlip: () => play('flip'),
  playComplete: () => play('complete'),
  playCountdownTick: () => play('countdown'),
  playReliefDeal: () => play('relief'),
  previewTimbre(next) { const previous = timbre; setSoundTimbre(next); play('know-0'); timbre = previous; }
};
