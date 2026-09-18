import { describe, expect, it } from "vitest";
// @ts-expect-error 脚本是 .mjs,没有类型
import { trackF0, transferPhraseContour, SR } from "../../scripts/prosody-transfer.mjs";

const mora = (text: string, pitch: number, len = 0.1) => ({ text, pitch, vowel_length: len, consonant_length: null });

describe("trackF0", () => {
  it("220Hz 正弦测出 ≈220,静音段为 0", () => {
    const pcm = new Float32Array(SR);
    for (let i = 0; i < SR / 2; i++) pcm[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / SR);
    const f0 = trackF0(pcm);
    const voiced = f0.filter((v: number) => v > 0);
    expect(voiced.length).toBeGreaterThan(30);
    for (const v of voiced) expect(Math.abs(v - 220)).toBeLessThan(5);
    expect(f0.slice(-20).every((v: number) => v === 0)).toBe(true);
  });
});

describe("transferPhraseContour", () => {
  const build = () => ({
    accent_phrases: [
      { moras: [mora("ア", 6.0), mora("イ", 6.1), mora("ウ", 5.9)] },
      { moras: [mora("エ", 6.0), mora("シ", 0), mora("オ", 6.1)] }
    ]
  });
  // 参考:前半高(300Hz)、后半低(200Hz),各 30 帧
  const f0 = [...Array(30).fill(300), ...Array(30).fill(200)];

  it("第二个短语整体被压低,短语内部的形状(重音型)不变,无声拍不动", () => {
    const q = build();
    expect(transferPhraseContour(q, f0, 1)).toBe(5);
    const [p1, p2] = q.accent_phrases;
    expect(p1.moras[1].pitch - p1.moras[0].pitch).toBeCloseTo(0.1, 5);
    expect(p1.moras[2].pitch - p1.moras[0].pitch).toBeCloseTo(-0.1, 5);
    expect(p2.moras[1].pitch).toBe(0);
    // 参考里两段差 ln(300/200)=0.405;原来两个短语均值一样,所以迁移后差正好是这个数
    const m1 = (p1.moras[0].pitch + p1.moras[1].pitch + p1.moras[2].pitch) / 3;
    const m2 = (p2.moras[0].pitch + p2.moras[2].pitch) / 2;
    expect(m1 - m2).toBeCloseTo(Math.log(300 / 200), 2);
  });
  it("strength 只放大短语内部的差", () => {
    const q = build();
    transferPhraseContour(q, f0, 2);
    const p1 = q.accent_phrases[0];
    expect(p1.moras[1].pitch - p1.moras[0].pitch).toBeCloseTo(0.2, 5);
  });
  it("参考全是静音 → 不动", () => {
    const q = build();
    expect(transferPhraseContour(q, Array(60).fill(0), 1)).toBe(0);
    expect(q.accent_phrases[0].moras[0].pitch).toBe(6.0);
  });
});
