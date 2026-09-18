// 语调迁移:借一个语调自然的引擎的「句调」,重音型仍是词典的。
//
// VOICEVOX 是积木式的:按重音短语逐拍预测音高,只知道每个短语的重音型,不理解整句在说什么,
// 于是句尾该落多少、逗号前后松紧、哪个短语抬起来,一律给平均值 —— 单词听着没问题,
// 句子就死板。而 audio_query 里每拍的 mora.pitch(log Hz)是可写的(编辑器里手画音高线
// 走的就是它)。所以:让参考引擎念一遍 → 测出音高曲线 → 按 VOICEVOX 自己给的每拍时长把
// 时间轴对上 → **每个短语算一个整体偏移**写回去 → 仍由 VOICEVOX 的声音合成。
//
// 为什么是短语级而不是逐拍抄:逐拍抄会把参考引擎的重音位置一起抄过来,而重音是学习者要学的
// 内容,句调只是氛围;而且没有强制对齐,逐拍按比例映射会错一两拍,短语级几乎不受影响。
// 2026-09-17 三段 A/B 实听:短语级(C)明显比原样(A)像人,逐拍(B)起伏更大但有错位感。
//
// 参考引擎现在是 macOS 自带的 Kyoko(免安装)。以后换 AivisSpeech 只改 referenceWav。

import { readFileSync, unlinkSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = promisify(execFile);
export const SR = 24000;
const HOP = 240; // 10ms
const WIN = 960; // 40ms

/** 参考引擎念一遍,返回 24k 单声道 PCM(Float32,-1..1)。 */
export async function referenceWav(text) {
  const path = join(tmpdir(), `prosody-${process.pid}-${Math.random().toString(36).slice(2)}.wav`);
  await run("say", ["-v", "Kyoko", "-r", "180", "-o", path, `--data-format=LEI16@${SR}`, text]);
  const wav = readFileSync(path);
  unlinkSync(path);
  const dataOff = wav.indexOf("data") + 8;
  const pcm = new Float32Array((wav.length - dataOff) / 2);
  for (let i = 0; i < pcm.length; i++) pcm[i] = wav.readInt16LE(dataOff + i * 2) / 32768;
  return pcm;
}

/** 自相关 F0 跟踪,每 10ms 一帧,80–500Hz;无声/静音帧为 0。合成语音很干净,够用。 */
export function trackF0(pcm) {
  const f0 = [];
  for (let start = 0; start + WIN <= pcm.length; start += HOP) {
    const frame = pcm.subarray(start, start + WIN);
    let energy = 0;
    for (const x of frame) energy += x * x;
    if (energy / WIN < 1e-4) {
      f0.push(0);
      continue;
    }
    let best = 0;
    let bestLag = 0;
    for (let lag = Math.floor(SR / 500); lag <= SR / 80; lag += 1) {
      let sum = 0;
      let n0 = 0;
      let n1 = 0;
      for (let i = 0; i + lag < WIN; i += 1) {
        sum += frame[i] * frame[i + lag];
        n0 += frame[i] ** 2;
        n1 += frame[i + lag] ** 2;
      }
      const r = sum / Math.sqrt(n0 * n1 + 1e-9);
      if (r > best) {
        best = r;
        bestLag = lag;
      }
    }
    f0.push(best > 0.6 ? SR / bestLag : 0);
  }
  return f0;
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[s.length >> 1] : null;
};

/**
 * 把参考 F0 曲线的短语级起伏写进 query 的 mora.pitch(原地改)。
 * strength 放大短语内部的起伏幅度(1 = 不放大)。无声拍(pitch 0)不动。
 * 返回改了几拍;参考没测出有声帧时返回 0、query 不动。
 */
export function transferPhraseContour(query, f0, strength = 1) {
  const voicedFrames = f0.map((v, i) => [v, i]).filter(([v]) => v > 0);
  if (voicedFrames.length < 3) return 0;
  const dStart = voicedFrames[0][1];
  const dLen = voicedFrames[voicedFrames.length - 1][1] - dStart + 1;

  // VOICEVOX 时间轴(含短语间停顿),按比例映射到参考的有声区间
  const spans = [];
  let t = 0;
  for (const phrase of query.accent_phrases) {
    for (const m of phrase.moras) {
      const len = (m.consonant_length ?? 0) + m.vowel_length;
      spans.push([t, t + len]);
      t += len;
    }
    if (phrase.pause_mora) t += phrase.pause_mora.vowel_length;
  }
  const total = t || 1;
  const donorLog = spans.map(([s, e]) => {
    const a = dStart + Math.floor((s / total) * dLen);
    const b = dStart + Math.ceil((e / total) * dLen);
    return median(f0.slice(a, Math.max(b, a + 1)).filter((v) => v > 0).map(Math.log));
  });
  const donorMean = mean(donorLog.filter((v) => v !== null));
  const own = query.accent_phrases.flatMap((p) => p.moras).filter((m) => m.pitch > 0).map((m) => m.pitch);
  if (!own.length) return 0;
  const origMean = mean(own); // 保留原声音的音区,只借相对高低

  let applied = 0;
  let idx = 0;
  for (const phrase of query.accent_phrases) {
    const n = phrase.moras.length;
    const ownPitch = phrase.moras.filter((m) => m.pitch > 0).map((m) => m.pitch);
    const ref = donorLog.slice(idx, idx + n).filter((v) => v !== null);
    idx += n;
    if (!ownPitch.length || !ref.length) continue;
    // 让这个短语相对全句的高低跟参考一致;短语内部的形状(重音型)只按 strength 缩放
    const shift = mean(ref) - donorMean - (mean(ownPitch) - origMean);
    for (const m of phrase.moras) {
      if (m.pitch <= 0) continue;
      m.pitch = origMean + (m.pitch - origMean) * strength + shift;
      applied += 1;
    }
  }
  return applied;
}
