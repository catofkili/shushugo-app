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

/**
 * ============ 认识音:Shepard 音阶(无限上升的听觉错觉) ============
 *
 * 上一版是五声音阶往上爬,爬四级就**封顶** —— 因为真的一直升下去会啸到刺耳。
 * 于是连对第 5 个和连对第 50 个听起来一模一样,「累积」这件事在声音上到第四个
 * 就说完了。
 *
 * Shepard 音把这个约束整个拿掉:**听感一直在升,实际频率原地转圈**。
 *
 * 做法是同一个音级在**多个八度上同时响**,每个分音的音量由一条**固定在绝对频率上**
 * 的钟形包络决定(峰值 C5,宽 1.3 个八度)。每答对一个,所有分音一起上移一个半音:
 * 最高那个爬出包络、悄悄淡出,同时一个新的分音在最低处悄悄淡入。走满 12 步刚好
 * 每个分音都顶替了上一个的位置 —— **频谱和第 0 步逐位相同**,所以能无缝地转下去。
 *
 * 耳朵跟着分音「都变高了」这件事走,但整体亮度(谱重心)几乎没动:实测走完整整
 * 一个八度,重心只从 523 Hz 漂到 527 Hz(0.14 个半音)。所以它听起来一直在爬,
 * 却永远不会刺耳、永远不用封顶,也永远不用「掉下来重新开始」。
 *
 * **音色不用换,还是原来那个三角波卡林巴。** 一般讲 Shepard 都说分音必须是正弦,
 * 怕三角波的 3f、5f 谐波给耳朵一个绝对音高的锚点。实际算下来不成立:3 次谐波落在
 * 3·2^k·f₀ = 1.5·2^(k+1)·f₀,也就是**所有 3 次谐波自己也构成一组八度堆叠**(比主堆叠
 * 高一个纯五度),5 次、7 次同理。每一组都各自满足「顶上淡出、底下淡入」,谐波是
 * 跟着一起转的。把三角波前 16 个谐波全代进去算:重心漂移 0.118 个半音、能量波动
 * 0.24%,和纯正弦(0.117 / 0.20%)没有区别。
 */
const SHEPARD_BASE = 32.703;            // C1:最低那个八度的锚点
const SHEPARD_OCTAVES = 9;              // 一路铺到 C9,包络在两端都已衰减到听不见
const SHEPARD_CENTER = Math.log2(N.C5); // 包络峰值,沿用原来的音区中心
/**
 * 钟形宽度(以八度计)。
 *
 * 第一版用 1.3,相邻八度还有 74% 的音量 —— 三个八度几乎等响地一起响,那是
 * **管风琴**的定义,不是卡林巴。收到 0.85 之后相邻只剩 48%、再外面 4%,
 * 听起来就是「一个音」而不是一摞音。
 *
 * 收窄不但没伤错觉,反而更稳:重心漂移 1.3→0.118 半音、0.85→0.041 半音
 * (高斯在整数间隔上的可加性在这一带更好)。再窄就掉头变差:0.6 时是 0.147。
 */
const SHEPARD_WIDTH = 0.85;
const SHEPARD_CYCLE = 12;               // 12 个半音走完一圈
/**
 * 高分音衰减得更快 —— 这是「敲了一下木头」和「按住一个电子音」最主要的区别。
 * 真实的卡林巴/马林巴上,基音余韵最长,高上去两个八度的分音几乎瞬间就没了。
 *
 * ⚠️ 时长必须是**绝对频率**的函数,不能按分音序号算。按序号算的话,走满 12 步
 * 之后第 k 个分音跑到了第 k+1 个的频率上却还带着自己那份时长,frequency-set
 * 虽然相同、包络却错位,循环就不再无缝。
 */
const SHEPARD_DECAY_TILT = 0.8;

/** 起始时刻的微小错开:让九个分音不要相位锁死在一起。 */
const SHEPARD_SPREAD_MS = 0.006;

/**
 * 某一步上所有分音的频率和相对音量。纯函数,便于测试「第 0 步和第 12 步完全相同」
 * 以及「谱重心不随步数上移」这两条 —— 错觉成立与否全押在这两条上。
 */
export const shepardPartials = (
  step: number
): Array<{ freq: number; gain: number; decay: number; delay: number }> => {
  const offset = ((step % SHEPARD_CYCLE) + SHEPARD_CYCLE) % SHEPARD_CYCLE / SHEPARD_CYCLE;
  const raw = Array.from({ length: SHEPARD_OCTAVES }, (_, octave) => {
    const freq = SHEPARD_BASE * 2 ** (octave + offset);
    const distance = Math.log2(freq) - SHEPARD_CENTER;
    return {
      freq,
      gain: Math.exp(-(distance * distance) / (2 * SHEPARD_WIDTH * SHEPARD_WIDTH)),
      // 低音余韵长、高音立刻消失。全都是绝对频率的函数,所以第 12 步的每个分音
      // 拿到的正是第 0 步同频率那个分音的时长和错开量 —— 循环仍然逐位相同。
      decay: (N.C5 / freq) ** SHEPARD_DECAY_TILT,
      delay: SHEPARD_SPREAD_MS * ((Math.sin(freq) + 1) / 2)
    };
  });
  // 归一化:所有分音相位都从 0 起,t=0 时是同相叠加,所以峰值 ≈ 增益之和。
  // 除以总和之后,整个音的峰值就和过去单个音的一样,不会因为叠了七个分音而变吵。
  const total = raw.reduce((sum, partial) => sum + partial.gain, 0);
  // **两端那几个几乎听不见的分音也要留着**。按「低于某个权重就不开振荡器」去省
  // 两个振荡器的话,分音会在门限上进进出出:每次进出都让谱重心跳一下、总音量抖一下,
  // 而「重心不动」正是错觉唯一的支点。实测门限 0.02 时重心漂移 0.435 个半音,
  // 全留则是 0.117 个半音、音量波动精确为 0。两个静音振荡器换这个,便宜。
  return raw.map((partial) => ({ ...partial, gain: partial.gain / total }));
};

/** 一个 Shepard 音:把该步的所有分音敲下去,音色仍是原来的三角波卡林巴。 */
function shepardPluck(step: number, start: number, dur: number, gain: number) {
  shepardPartials(step).forEach((partial) => {
    // 时长上下各夹一道,免得最低那个分音拖出长尾巴、最高那个短到听不见起音。
    const decay = Math.min(Math.max(partial.decay, 0.3), 2.2);
    pluck(partial.freq, start + partial.delay, dur * decay, gain * partial.gain);
  });
}

/**
 * 认识:上行两音,轻快有弹性。step = 当前连对了几个(0 起),**不再封顶**。
 *
 * 两个音仍是大三度(+4 个半音),和改版前的 do→mi 是同一个音程。
 * 音量全程不变 —— 升音高读作「累积」,升音量读作「喊」。
 */
export const playKnow = (step = 0) =>
  guard(() => {
    const base = Math.max(step, 0);
    // 增益、时值、音程全部沿用改版前 —— 这次只换「音高怎么走」,其他一律不动。
    shepardPluck(base, 0, 0.16, 0.23);
    shepardPluck(base + 4, 0.09, 0.22, 0.23);
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
