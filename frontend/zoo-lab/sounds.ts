/**
 * 动物园音效引擎 —— 纯 WebAudio 合成,零采样、零依赖、体积为 0。
 * 设计原则:同一"木质温暖(卡林巴/马林巴)"调性,永不互相打架;
 * 答错不是惩罚,用柔和小三度下行 + 更低音量,表达"哦～"而非"错!"。
 * 正式接入时把这套换成小采样也可,接口不变。
 */

let ctx: AudioContext | null = null;
let muted = false;

export function setMuted(v: boolean) {
  muted = v;
}
export function isMuted() {
  return muted;
}

function ac(): AudioContext {
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/**
 * 空闲即挂起。
 * running 状态的 AudioContext 会一直占着音频渲染线程和硬件通路,哪怕一声没在响——
 * 这是「用户什么都没干也在耗电」的那一类,比页面上所有 CSS 动画加起来都贵。
 * 最长的一组音(传说琶音 + 尾音鸟叫)约 1 秒,2 秒的空闲窗口不会掐断正在响的声音。
 */
const IDLE_SUSPEND_MS = 2000;
let idleTimer = 0;

function scheduleIdleSuspend() {
  window.clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => {
    if (ctx && ctx.state === "running") void ctx.suspend();
  }, IDLE_SUSPEND_MS);
}

/** 切后台 / 页面不可见时立刻挂起,不等那 2 秒 */
export function suspendAudio() {
  window.clearTimeout(idleTimer);
  if (ctx && ctx.state === "running") void ctx.suspend();
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

/** 一个"机械"音:方波极短促,像旋钮咔哒一下。 */
function click(freq: number, start: number, gain = 0.07) {
  const c = ac();
  const osc = c.createOscillator();
  const g = c.createGain();
  const t = c.currentTime + start;
  osc.type = "square";
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  osc.connect(g).connect(c.destination);
  osc.start(t);
  osc.stop(t + 0.06);
}

/** 一记闷响:低频正弦快速下滑,像塑料蛋落进出口。 */
function thud(freq: number, start: number, gain = 0.2) {
  const c = ac();
  const osc = c.createOscillator();
  const g = c.createGain();
  const t = c.currentTime + start;
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.55, t + 0.12);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  osc.connect(g).connect(c.destination);
  osc.start(t);
  osc.stop(t + 0.18);
}

/** 音名 → 频率(十二平均律,A4=440) */
const N: Record<string, number> = {
  C4: 261.63, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, C5: 523.25, D5: 587.33, E5: 659.25,
  G5: 783.99, A5: 880.0, C6: 1046.5, E6: 1318.51
};

function guard(fn: () => void) {
  if (muted) return;
  try {
    fn();
    scheduleIdleSuspend();
  } catch {
    /* 音频不可用时静默 */
  }
}

/** 认识:上行两音(do→mi),轻快有弹性 */
export const playKnow = () =>
  guard(() => {
    pluck(N.C5, 0, 0.16, 0.2);
    pluck(N.E5, 0.09, 0.22, 0.2);
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
    pluck(N.C5, 0, 0.2, 0.2);
    pluck(N.E5, 0.12, 0.2, 0.2);
    pluck(N.G5, 0.24, 0.32, 0.22);
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

/* ===== 扭蛋机 ===== */

/** 拧旋钮:四下机械咔哒,越拧越紧(音高微升) */
export const playCrank = () =>
  guard(() => {
    click(620, 0);
    click(660, 0.09);
    click(700, 0.18);
    click(760, 0.27, 0.09);
  });

/** 蛋掉出来:滚过滑道 + 落进出口的一记闷响 */
export const playCapsuleDrop = () =>
  guard(() => {
    click(420, 0, 0.04);
    click(380, 0.07, 0.035);
    click(340, 0.14, 0.03);
    thud(150, 0.34);
    thud(190, 0.46, 0.09); // 弹一下
  });

/** 掰开蛋壳:一声脆响 */
export const playCapsuleCrack = () =>
  guard(() => {
    click(1500, 0, 0.06);
    pluck(N.A5, 0.02, 0.09, 0.09);
  });

/** 开出结果:稀有度越高,琶音越长越亮 */
export const playReveal = (rarity: "n" | "r" | "sr") =>
  guard(() => {
    if (rarity === "n") {
      pluck(N.C5, 0, 0.18, 0.16);
      pluck(N.E5, 0.09, 0.24, 0.16);
      return;
    }
    if (rarity === "r") {
      pluck(N.C5, 0, 0.16, 0.18);
      pluck(N.E5, 0.08, 0.16, 0.18);
      pluck(N.G5, 0.16, 0.3, 0.2);
      return;
    }
    // SR:五音上行 + 尾巴一声鸟叫,值得停一秒
    pluck(N.C5, 0, 0.14, 0.2);
    pluck(N.E5, 0.07, 0.14, 0.2);
    pluck(N.G5, 0.14, 0.14, 0.2);
    pluck(N.C6, 0.21, 0.2, 0.22);
    pluck(N.E6, 0.29, 0.42, 0.2);
    window.setTimeout(() => playStreakChirp(), 520);
  });

/** 抽到重复:柔和上行两音——是"又见面啦",不是"可惜" */
export const playDupe = () =>
  guard(() => {
    pluck(N.F4, 0, 0.16, 0.1);
    pluck(N.A4, 0.09, 0.24, 0.1);
  });

/* ===== 钓鱼 ===== */

/** 一段音高滑行:甩竿的"咻"就靠它 */
function sweep(from: number, to: number, start: number, dur: number, gain = 0.1) {
  const c = ac();
  const osc = c.createOscillator();
  const g = c.createGain();
  const t = c.currentTime + start;
  osc.type = "sine";
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.25);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** 甩竿:一声由高到低的"咻" */
export const playCast = () =>
  guard(() => {
    sweep(1600, 420, 0, 0.26, 0.09);
  });

/** 落水:闷响 + 两点水花 */
export const playSplash = () =>
  guard(() => {
    thud(220, 0, 0.16);
    pluck(N.C6, 0.04, 0.07, 0.05);
    pluck(N.G5, 0.11, 0.09, 0.04);
  });

/** 咬钩:两下急促的低音顶 + 一记上扬——这是全场唯一"紧张"的音 */
export const playBite = () =>
  guard(() => {
    thud(180, 0, 0.22);
    thud(200, 0.11, 0.2);
    sweep(400, 900, 0.2, 0.16, 0.12);
  });

/** 卷线:一串越来越快的咔哒 */
export const playReelIn = () =>
  guard(() => {
    let t = 0;
    let gap = 0.075;
    for (let i = 0; i < 8; i++) {
      click(520 + i * 26, t, 0.05);
      t += gap;
      gap *= 0.88;
    }
  });

/** 出水:按大小给不同长度的上行音;杂物只有闷闷两声(是笑点,不是失败) */
export const playFishUp = (tier: "s" | "m" | "l" | "junk") =>
  guard(() => {
    if (tier === "junk") {
      thud(190, 0, 0.16);
      pluck(N.F4, 0.12, 0.2, 0.09);
      return;
    }
    thud(260, 0, 0.14); // 出水那一下
    pluck(N.C5, 0.06, 0.16, 0.18);
    pluck(N.E5, 0.14, 0.16, 0.18);
    if (tier === "s") return;
    pluck(N.G5, 0.22, 0.28, 0.2);
    if (tier === "m") return;
    pluck(N.C6, 0.3, 0.2, 0.22);
    pluck(N.E6, 0.38, 0.42, 0.2);
    window.setTimeout(() => playStreakChirp(), 620);
  });

/** 空振り / 逃走:柔和下行,音量很低——是"哦～"不是"错!" */
export const playMiss = () =>
  guard(() => {
    pluck(N.A4, 0, 0.18, 0.09);
    pluck(N.F4, 0.1, 0.28, 0.08);
  });
