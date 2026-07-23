import { describe, expect, it } from "vitest";
import {
  recordReview,
  retrievability,
  isDue,
  isGraduated,
  ratingFor,
  FSRS_MAX_INTERVAL_DAYS,
  type FsrsState
} from "./fsrs-scheduler";
import { Rating } from "ts-fsrs";

const at = (d: string) => new Date(d + "T04:00:00Z");
const dayGap = (a: FsrsState, when: string) =>
  Math.round((new Date(a.due).getTime() - new Date(when).getTime()) / 86400000);

describe("三答法映射", () => {
  it("认识/模糊/忘记/熟知 → Good/Hard/Again/Easy", () => {
    expect(ratingFor("know")).toBe(Rating.Good);
    expect(ratingFor("fuzzy")).toBe(Rating.Hard);
    expect(ratingFor("forgot")).toBe(Rating.Again);
    expect(ratingFor("known_forever")).toBe(Rating.Easy);
  });
});

describe("间隔随连续答对指数增长(治『满分词两周回锅』)", () => {
  it("连对多次,间隔越拉越长且上不封顶(在护栏内)", () => {
    let s: FsrsState | null = null;
    let day = new Date("2026-01-01T04:00:00Z");
    const gaps: number[] = [];
    for (let i = 0; i < 8; i++) {
      s = recordReview(s, "know", day);
      const gap = Math.round((new Date(s.due).getTime() - day.getTime()) / 86400000);
      gaps.push(gap);
      day = new Date(s.due); // 每次都按时复习
    }
    // 单调不减,且明显突破两周天花板
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeGreaterThanOrEqual(gaps[i - 1]);
    expect(Math.max(...gaps)).toBeGreaterThan(30);
  });
});

describe("忘记是打折不是清零(治『一忘作废 30 次历史』)", () => {
  it("高稳定度的词忘一次,新间隔远比新卡长", () => {
    // 先养出一张高稳定度卡
    let mature: FsrsState | null = null;
    let day = new Date("2026-01-01T04:00:00Z");
    for (let i = 0; i < 6; i++) { mature = recordReview(mature, "know", day); day = new Date(mature!.due); }
    const matureS = mature!.stability;

    // 同一天:一张成熟卡忘记 vs 一张新卡忘记
    const now = new Date(mature!.due);
    const lapsed = recordReview(mature, "forgot", now);
    const freshLapse = recordReview(null, "forgot", now);

    expect(lapsed.stability).toBeGreaterThan(freshLapse.stability); // 历史没被清零
    expect(lapsed.stability).toBeLessThan(matureS);                 // 确实打了折
    expect(dayGap(lapsed, now.toISOString())).toBeGreaterThanOrEqual(dayGap(freshLapse, now.toISOString()));
  });
});

describe("间隔护栏(采自墨墨,防低数据期外推)", () => {
  it("再稳的卡,间隔也不超过 maximum_interval", () => {
    const superStable: FsrsState = {
      stability: 99999, difficulty: 1.5,
      due: "2026-01-01T04:00:00Z", lastReview: "2026-01-01T04:00:00Z"
    };
    const now = at("2026-06-01");
    const next = recordReview(superStable, "know", now);
    const gap = (new Date(next.due).getTime() - now.getTime()) / 86400000;
    expect(gap).toBeLessThanOrEqual(FSRS_MAX_INTERVAL_DAYS + 0.5);
  });
});

describe("可提取性 / 到期 / 毕业", () => {
  it("R 随时间单调下降;到期日 R≈目标记住率", () => {
    const s = recordReview(null, "know", at("2026-01-01"));
    const r0 = retrievability(s, at("2026-01-01"));
    const rLater = retrievability(s, at("2026-01-20"));
    expect(r0).toBeGreaterThan(rLater);
  });

  it("无 FSRS 记录的词视同到期(等待首评)", () => {
    expect(isDue(null, at("2026-01-01"))).toBe(true);
  });

  it("未到期的词 isDue=false", () => {
    const s = recordReview(null, "know", at("2026-01-01"));
    expect(isDue(s, at("2026-01-01"))).toBe(false);
    expect(isDue(s, at("2026-02-01"))).toBe(true);
  });

  it("稳定度 ≥180 天 = 毕业", () => {
    expect(isGraduated({ stability: 200, difficulty: 3, due: "x", lastReview: "x" })).toBe(true);
    expect(isGraduated({ stability: 20, difficulty: 3, due: "x", lastReview: "x" })).toBe(false);
    expect(isGraduated(null)).toBe(false);
  });
});
