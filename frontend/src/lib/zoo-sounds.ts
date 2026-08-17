/**
 * 动物园音效引擎 —— 纯 WebAudio 合成,零采样、零依赖、体积为 0。
 * 设计原则:同一"木质温暖(卡林巴/马林巴)"调性,永不互相打架;
 * 答错不是惩罚,用柔和小三度下行 + 更低音量,表达"哦～"而非"错!"。
 * 采样版替换时接口不变。开关跟随 studyPreferences.zooSounds。
 */

import { getStudyPreferences } from "./studyPreferences";

let ctx: AudioContext | null = null;

/** 静音判定:用户偏好关闭,或系统开启了「减少动态效果」以外的无障碍诉求时保持安静 */
function muted() {
  try {
    return !getStudyPreferences().zooSounds;
  } catch {
    return false;
  }
}

function ac(): AudioContext {
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

/** 一个"木质"音:三角波 + 快速指数衰减,像敲一下卡林巴。 */
function pluck(freq: number, start: number, dur: number, gain = 0.18) {
  const c = ac();
  const osc = c.createOscillator();
  const g = c.createGain();
  const t = c.currentTime + start;
  osc.type = "triangle";
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** 音名 → 频率(十二平均律,A4=440) */
const N: Record<string, number> = {
  F4: 349.23, G4: 392.0, A4: 440.0, C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880.0, C6: 1046.5
};

function guard(fn: () => void) {
  if (muted()) return;
  try {
    fn();
  } catch {
    /* 音频不可用时静默 */
  }
}

/** 认识:上行两音(do→mi),轻快有弹性 */
export const playKnow = () =>
  guard(() => {
    pluck(N.C5, 0, 0.16, 0.23);
    pluck(N.E5, 0.09, 0.22, 0.23);
  });

/** 不认识:柔和下行小三度(la→fa),音量更低,是"哦～"不是"错!" */
export const playDontKnow = () =>
  guard(() => {
    pluck(N.A4, 0, 0.18, 0.12);
    pluck(N.F4, 0.1, 0.26, 0.11);
  });

/** 翻卡:一声很轻的叶子/纸声(高频短促) */
export const playFlip = () =>
  guard(() => {
    pluck(N.A5, 0, 0.06, 0.06);
  });

/** 收藏:水滴"咚"(高音带下滑) */
export const playSave = () =>
  guard(() => {
    const c = ac();
    const osc = c.createOscillator();
    const g = c.createGain();
    const t = c.currentTime;
    osc.type = "sine";
    osc.frequency.setValueAtTime(N.C6, t);
    osc.frequency.exponentialRampToValueAtTime(N.G5, t + 0.14);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    osc.connect(g).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.24);
  });

/** 一场完成:三音上行小结尾 */
export const playComplete = () =>
  guard(() => {
    pluck(N.C5, 0, 0.2, 0.23);
    pluck(N.E5, 0.12, 0.2, 0.23);
    pluck(N.G5, 0.24, 0.32, 0.25);
  });

/** 最后三十张：像轻轻敲一下倒数刻度，制造紧迫感但不刺耳。 */
export const playCountdownTick = () =>
  guard(() => {
    pluck(N.A5, 0, 0.1, 0.105);
    pluck(N.C6, 0.045, 0.13, 0.09);
  });

/** 昨日减负：一张张像纸牌落桌，短促、连续、偏爽快。 */
export const playReliefDeal = () =>
  guard(() => {
    pluck(N.G5, 0, 0.09, 0.13);
    pluck(N.C6, 0.055, 0.14, 0.11);
  });

/** 连击里程碑:远处一声鸟叫(快速音高抖动) */
export const playStreakChirp = () =>
  guard(() => {
    const c = ac();
    const osc = c.createOscillator();
    const g = c.createGain();
    const t = c.currentTime;
    osc.type = "sine";
    osc.frequency.setValueAtTime(N.A5, t);
    osc.frequency.setValueAtTime(N.C6, t + 0.05);
    osc.frequency.setValueAtTime(N.A5, t + 0.1);
    osc.frequency.setValueAtTime(N.C6, t + 0.15);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.1, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(g).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.24);
  });

/** 柚子落头(温泉打卡完成):闷闷一声"噗"+水花 */
export const playYuzuPlop = () =>
  guard(() => {
    pluck(N.F4, 0, 0.12, 0.16);
    pluck(N.C5, 0.06, 0.1, 0.08);
  });
