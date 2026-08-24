import { describe, expect, it, vi } from "vitest";

// 声音开关读 studyPreferences（localStorage）。这里只测纯函数，不碰 WebAudio。
vi.mock("./studyPreferences", () => ({ getStudyPreferences: () => ({ zooSounds: false }) }));

import { shepardPartials } from "./zoo-sounds";

const centroid = (step: number) => {
  const partials = shepardPartials(step);
  const total = partials.reduce((sum, p) => sum + p.gain, 0);
  return partials.reduce((sum, p) => sum + Math.log2(p.freq) * p.gain, 0) / total;
};

describe("Shepard 认识音", () => {
  it("走满 12 步回到起点，频谱逐位相同 —— 所以能无限转下去", () => {
    const first = shepardPartials(0);
    const wrapped = shepardPartials(12);
    expect(wrapped).toHaveLength(first.length);
    first.forEach((partial, index) => {
      expect(wrapped[index].freq).toBeCloseTo(partial.freq, 9);
      expect(wrapped[index].gain).toBeCloseTo(partial.gain, 12);
      // 时长和错开量也必须逐位相同 —— 它们是绝对频率的函数,不是分音序号的函数。
      // 一旦有人改成按序号算,循环就会在这里露馅。
      expect(wrapped[index].decay).toBeCloseTo(partial.decay, 12);
      expect(wrapped[index].delay).toBeCloseTo(partial.delay, 12);
    });
    // 连对上百个也只是继续转圈
    expect(shepardPartials(120)[0].freq).toBeCloseTo(first[0].freq, 9);
  });

  it("听感一路上升，但谱重心几乎不动（错觉成立与否全在这条）", () => {
    const values = Array.from({ length: 12 }, (_, step) => centroid(step));
    const drift = Math.max(...values) - Math.min(...values);
    // 单位是「八度」。0.02 个八度 = 0.24 个半音，远低于可觉察阈值。
    expect(drift).toBeLessThan(0.02);
  });

  it("每一步的总音量一致，不会越答越吵", () => {
    const sums = Array.from({ length: 12 }, (_, step) =>
      shepardPartials(step).reduce((sum, p) => sum + p.gain, 0)
    );
    // 全部分音都留着 → 归一化后每一步的和恒等于 1，一点波动都没有
    sums.forEach((sum) => expect(sum).toBeCloseTo(1, 12));
  });

  it("分音都是八度关系，且落在能听见的范围里", () => {
    const partials = shepardPartials(5);
    expect(partials).toHaveLength(9);
    partials.forEach((p) => {
      expect(p.freq).toBeGreaterThan(20);
      expect(p.freq).toBeLessThan(20000);
    });
    partials.slice(1).forEach((p, index) => {
      expect(p.freq / partials[index].freq).toBeCloseTo(2, 6);
    });
  });

  it("三角波的谐波不破坏错觉 —— 所以音色维持原样", () => {
    // 三角波 = 奇次谐波、幅度 1/n²。3 次谐波落在 3·2^k·f₀ = 1.5·2^(k+1)·f₀，
    // 也就是所有 3 次谐波自己也是一组八度堆叠，跟着主堆叠一起转。
    const triangleSpectrum = (step: number) =>
      shepardPartials(step).flatMap((partial) =>
        [1, 3, 5, 7, 9, 11, 13, 15]
          .map((n) => ({ freq: partial.freq * n, gain: partial.gain / (n * n) }))
          .filter((h) => h.freq < 20000)
      );
    const centroidOf = (spectrum: Array<{ freq: number; gain: number }>) => {
      const total = spectrum.reduce((sum, h) => sum + h.gain, 0);
      return spectrum.reduce((sum, h) => sum + Math.log2(h.freq) * h.gain, 0) / total;
    };
    const values = Array.from({ length: 12 }, (_, step) => centroidOf(triangleSpectrum(step)));
    // 和纯正弦那条同一个量级(0.117 vs 0.118 个半音)
    expect(Math.max(...values) - Math.min(...values)).toBeLessThan(0.02);
  });

  it("基音压得住,不是一摞等响的八度（那听起来是管风琴不是卡林巴）", () => {
    const partials = shepardPartials(0);
    const loudest = partials.reduce((best, p) => (p.gain > best.gain ? p : best));
    const others = partials.filter((p) => p !== loudest).map((p) => p.gain / loudest.gain);
    const neighbours = others.filter((ratio) => ratio > 0.3);
    // 只允许上下各一个八度还有存在感,再外面必须已经退到背景里
    expect(neighbours.length).toBeLessThanOrEqual(2);
  });

  it("高分音衰减得比低分音快 —— 敲一下木头,不是按住一个电子音", () => {
    const partials = shepardPartials(0);
    const sorted = [...partials].sort((a, b) => a.freq - b.freq);
    sorted.slice(1).forEach((partial, index) => {
      expect(partial.decay).toBeLessThan(sorted[index].decay);
    });
  });

  it("负数步数不炸（TeamPage 那类无参调用走 0）", () => {
    expect(() => shepardPartials(-3)).not.toThrow();
    expect(shepardPartials(-12)[0].freq).toBeCloseTo(shepardPartials(0)[0].freq, 9);
  });
});
