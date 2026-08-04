import { describe, expect, it } from "vitest";
import {
  recordReview,
  retrievability,
  isDue,
  isGraduated,
  isGraduatedForDay,
  isLearning,
  isLeech,
  ratingFor,
  FSRS_MAX_INTERVAL_DAYS,
  type FsrsState
} from "./fsrs-scheduler";
import { Rating } from "ts-fsrs";

const at = (d: string) => new Date(d + "T04:00:00Z");
const HR = 3600_000, DAY = 86400_000;
const dayGap = (a: FsrsState, when: string) =>
  Math.round((new Date(a.due).getTime() - new Date(when).getTime()) / DAY);
/** 补全 FsrsState 额外字段(测纯函数用) */
const full = (p: Partial<FsrsState>): FsrsState =>
  ({ stability: 200, difficulty: 3, due: "2026-01-01T04:00:00Z", lastReview: "2026-01-01T04:00:00Z",
     state: 2, steps: 0, reps: 1, lapses: 0, ...p });

describe("三答法映射", () => {
  it("认识/模糊/忘记/熟知 → Good/Hard/Again/Easy", () => {
    expect(ratingFor("know")).toBe(Rating.Good);
    expect(ratingFor("fuzzy")).toBe(Rating.Hard);
    expect(ratingFor("forgot")).toBe(Rating.Again);
    expect(ratingFor("known_forever")).toBe(Rating.Easy);
  });

  it("当天首答认识(mode=known)按 Easy 记,不是 Good", () => {
    expect(ratingFor("know", "known")).toBe(Rating.Easy);
    expect(ratingFor("know", "normal")).toBe(Rating.Good);
    // 模糊/忘记不受 mode 影响
    expect(ratingFor("fuzzy", "known")).toBe(Rating.Hard);
    expect(ratingFor("forgot", "known")).toBe(Rating.Again);
  });

  it("当天首答认识的记忆强度要远高于普通认识", () => {
    const now = new Date("2026-08-01T10:00:00Z");
    const known = recordReview(null, "know", now, { mode: "known" });
    const normal = recordReview(null, "know", now, { mode: "normal" });
    // 当天首答认识:跳过学习步骤,直接排到一周开外(实测 8 天)
    const days = (new Date(known.due).getTime() - now.getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(5);
    // 起点强度按 Easy 取,是 Good 的三倍以上(实测 8.30 vs 2.31)
    expect(known.stability).toBeGreaterThan(normal.stability * 3);
  });
});

describe("学习步骤:新词/答错要当天反复刷到毕业(治『点不认识就算过』)", () => {
  const now = at("2026-03-01");
  const boundary = new Date(now.getTime() + 4 * HR); // 本学习日边界(4 小时后)

  it("新词点一次『认识』只进学习步骤,当天还没毕业(还要再出)", () => {
    const s = recordReview(null, "know", now);
    expect(isLearning(s)).toBe(true);
    expect(isGraduatedForDay(s, boundary)).toBe(false);   // due 只排到几分钟后
    expect(dayGap(s, now.toISOString())).toBe(0);
  });

  it("新词连点两次『认识』才毕业(排到明天及以后,当天不再出)", () => {
    const s1 = recordReview(null, "know", now);
    const s2 = recordReview(s1, "know", new Date(s1.due));
    expect(isGraduatedForDay(s2, boundary)).toBe(true);
    expect(dayGap(s2, now.toISOString())).toBeGreaterThanOrEqual(1);
  });

  it("点『不认识』退回学习、当天继续出;要再连着走完步骤才过", () => {
    const again = recordReview(null, "forgot", now);
    expect(isLearning(again)).toBe(true);
    expect(isGraduatedForDay(again, boundary)).toBe(false);
    // 之后一次 Good 仍在学习步骤里(没毕业),得再一次才毕业
    const g1 = recordReview(again, "know", new Date(again.due));
    expect(isGraduatedForDay(g1, boundary)).toBe(false);
  });

  it("成熟复习卡答错=lapse:转重学、当天重刷,lapses+1", () => {
    // 先养一张成熟卡(连对毕业几次)
    let m: FsrsState | null = null;
    let day = at("2026-01-01");
    for (let i = 0; i < 5; i++) { m = recordReview(m, "know", day); day = new Date(m.due); }
    const lapsed = recordReview(m, "forgot", new Date(m!.due));
    const lb = new Date(new Date(m!.due).getTime() + 4 * HR);
    expect(lapsed.lapses).toBe(1);
    expect(isGraduatedForDay(lapsed, lb)).toBe(false); // 当天要重学
    expect(isLearning(lapsed)).toBe(true);
  });

  it("答错后当天要连续两次『认识』才毕业(一次答对多半只是工作记忆)", () => {
    let m: FsrsState | null = null;
    let day = at("2026-01-01");
    for (let i = 0; i < 5; i++) { m = recordReview(m, "know", day); day = new Date(m.due); }
    const lapsed = recordReview(m, "forgot", new Date(m!.due));
    const boundary = new Date(new Date(lapsed.due).getTime() + 4 * HR);

    // 隔十几张卡后答对:仍在重学步骤里,当天还要再考一次
    const first = recordReview(lapsed, "know", new Date(lapsed.due));
    expect(isGraduatedForDay(first, boundary)).toBe(false);
    // 第二次答对(隔得更远)才算真记住,当天不再出
    const second = recordReview(first, "know", new Date(first.due));
    expect(isGraduatedForDay(second, boundary)).toBe(true);
  });

  it("顽固词(当天错够 3 次)要连对三次才毕业", () => {
    let m: FsrsState | null = null;
    let day = at("2026-01-01");
    for (let i = 0; i < 5; i++) { m = recordReview(m, "know", day); day = new Date(m.due); }
    // 当天错三次:第三次起按顽固词的三步走
    let s = recordReview(m, "forgot", new Date(m!.due));
    s = recordReview(s, "forgot", new Date(s.due), { mode: "stubborn" });
    s = recordReview(s, "forgot", new Date(s.due), { mode: "stubborn" });
    const boundary = new Date(new Date(s.due).getTime() + 6 * HR);

    const first = recordReview(s, "know", new Date(s.due), { mode: "stubborn" });
    expect(isGraduatedForDay(first, boundary)).toBe(false);
    const second = recordReview(first, "know", new Date(first.due), { mode: "stubborn" });
    expect(isGraduatedForDay(second, boundary)).toBe(false);  // 普通词到这里就过了,顽固词还不行
    const third = recordReview(second, "know", new Date(second.due), { mode: "stubborn" });
    expect(isGraduatedForDay(third, boundary)).toBe(true);
  });

  it("顽固词中途再错一次,退回第一步重来", () => {
    let m: FsrsState | null = null;
    let day = at("2026-01-01");
    for (let i = 0; i < 5; i++) { m = recordReview(m, "know", day); day = new Date(m.due); }
    let s = recordReview(m, "forgot", new Date(m!.due), { mode: "stubborn" });
    const boundary = new Date(new Date(s.due).getTime() + 6 * HR);
    s = recordReview(s, "know", new Date(s.due), { mode: "stubborn" });   // 第一关
    s = recordReview(s, "forgot", new Date(s.due), { mode: "stubborn" }); // 再错 → 退回
    // 退回后再连对两次仍不够(顽固词要三次)
    s = recordReview(s, "know", new Date(s.due), { mode: "stubborn" });
    s = recordReview(s, "know", new Date(s.due), { mode: "stubborn" });
    expect(isGraduatedForDay(s, boundary)).toBe(false);
  });

  it("成熟卡到期答『认识』:一次就过(不折腾已掌握的词)", () => {
    let m: FsrsState | null = null;
    let day = at("2026-01-01");
    for (let i = 0; i < 5; i++) { m = recordReview(m, "know", day); day = new Date(m.due); }
    const due = new Date(m!.due);
    const again = recordReview(m, "know", due);
    expect(isGraduatedForDay(again, new Date(due.getTime() + 4 * HR))).toBe(true);
  });
});

describe("间隔随连续答对指数增长(治『满分词两周回锅』)", () => {
  it("毕业后间隔越拉越长且突破两周天花板", () => {
    let s: FsrsState | null = null;
    let day = new Date("2026-01-01T04:00:00Z");
    const gaps: number[] = [];
    for (let i = 0; i < 8; i++) {
      s = recordReview(s, "know", day);
      gaps.push(Math.round((new Date(s.due).getTime() - day.getTime()) / DAY));
      day = new Date(s.due);
    }
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeGreaterThanOrEqual(gaps[i - 1]);
    expect(Math.max(...gaps)).toBeGreaterThan(30);
  });
});

describe("忘记是打折不是清零(治『一忘作废历史』)", () => {
  it("高稳定度的词忘一次,新稳定度远比新卡高", () => {
    let mature: FsrsState | null = null;
    let day = new Date("2026-01-01T04:00:00Z");
    for (let i = 0; i < 6; i++) { mature = recordReview(mature, "know", day); day = new Date(mature!.due); }
    const matureS = mature!.stability;
    const now = new Date(mature!.due);
    const lapsed = recordReview(mature, "forgot", now);
    const freshLapse = recordReview(null, "forgot", now);
    expect(lapsed.stability).toBeGreaterThan(freshLapse.stability); // 没被清零
    expect(lapsed.stability).toBeLessThan(matureS);                 // 确实打折
  });
});

describe("leech 顽固词判定", () => {
  it("累计答错达阈值即 leech", () => {
    expect(isLeech(full({ lapses: 8 }))).toBe(true);
    expect(isLeech(full({ lapses: 3 }))).toBe(false);
    expect(isLeech(null)).toBe(false);
  });
});

describe("间隔护栏(采自墨墨,防低数据期外推)", () => {
  it("再稳的卡,间隔也不超过 maximum_interval", () => {
    const superStable = full({ stability: 99999, difficulty: 1.5 });
    const now = at("2026-06-01");
    const next = recordReview(superStable, "know", now);
    const gap = (new Date(next.due).getTime() - now.getTime()) / DAY;
    expect(gap).toBeLessThanOrEqual(FSRS_MAX_INTERVAL_DAYS + 0.5);
  });
});

describe("可提取性 / 到期 / 毕业留存", () => {
  it("R 随时间单调下降", () => {
    const s = full({ stability: 10 });
    expect(retrievability(s, at("2026-01-01"))).toBeGreaterThan(retrievability(s, at("2026-01-20")));
  });
  it("无 FSRS 记录的词视同到期(等待首评)", () => {
    expect(isDue(null, at("2026-01-01"))).toBe(true);
  });
  it("稳定度 ≥180 天 = 毕业留存", () => {
    expect(isGraduated(full({ stability: 200 }))).toBe(true);
    expect(isGraduated(full({ stability: 20 }))).toBe(false);
    expect(isGraduated(null)).toBe(false);
  });
});
