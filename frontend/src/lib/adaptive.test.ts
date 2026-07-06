import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import initSqlJs, { type Database } from "sql.js";

// 用真实的 sql.js 内存库替换全局单例,复现 adaptive 的 SQL 行为。
let db: Database;
vi.mock("./database", () => ({
  getDatabase: () => db
}));

const { calculateAdaptiveDecay, getMemoryStrengthLabel, getUserMemoryProfile, updateMemoryProfileIfNeeded } =
  await import("./adaptive");

const insertReviews = (count: number) => {
  for (let index = 0; index < count; index += 1) {
    db.run("INSERT INTO reviews (word_id, answer, reviewed_on) VALUES (?, 'know', date('now'))", [index + 1]);
  }
};

beforeAll(async () => {
  const SQL = await initSqlJs();
  db = new SQL.Database();
});

beforeEach(() => {
  db.run("DROP TABLE IF EXISTS app_state");
  db.run("DROP TABLE IF EXISTS reviews");
  db.run("DROP TABLE IF EXISTS progress");
  db.run("CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  db.run(`CREATE TABLE reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word_id INTEGER NOT NULL,
    answer TEXT NOT NULL,
    reviewed_on TEXT NOT NULL
  )`);
  db.run(`CREATE TABLE progress (
    word_id INTEGER PRIMARY KEY,
    score REAL NOT NULL DEFAULT 0,
    seen_count INTEGER NOT NULL DEFAULT 0,
    known_forever INTEGER NOT NULL DEFAULT 0,
    last_seen_on TEXT
  )`);
});

describe("getUserMemoryProfile", () => {
  it("returns the default profile for a fresh database", () => {
    const profile = getUserMemoryProfile();
    expect(profile.memoryStrength).toBe(1.0);
    expect(profile.totalReviews).toBe(0);
  });

  it("survives corrupted stored profiles", () => {
    db.run("INSERT INTO app_state (key, value) VALUES ('user_memory_profile', 'oops')");
    expect(getUserMemoryProfile().memoryStrength).toBe(1.0);
  });
});

describe("calculateAdaptiveDecay", () => {
  it("uses the conservative default curve before 100 reviews", () => {
    // 默认曲线:基础 1.0 + 重要度 ±0.1/档 + 错误率 0.2,夹在 0.8-1.2
    expect(calculateAdaptiveDecay(3, 0)).toBe(1.0);
    expect(calculateAdaptiveDecay(5, 1)).toBeCloseTo(1.2);
    expect(calculateAdaptiveDecay(1, 0)).toBeCloseTo(0.8);
  });

  it("scales decay by memory strength once adaptive kicks in", () => {
    insertReviews(120);
    db.run("INSERT INTO app_state (key, value) VALUES ('user_memory_profile', ?)", [
      JSON.stringify({
        memoryStrength: 2.0,
        firstTimeCorrectRate: 0.9,
        retentionRate7Days: 0.9,
        avgReviewsToMaster: 4,
        totalReviews: 120,
        lastUpdated: new Date().toISOString()
      })
    ]);
    // 2.0 * 1.0 + 0 + 0 = 2.0(上限)
    expect(calculateAdaptiveDecay(3, 0)).toBe(2.0);
  });

  it("never leaves the 0.5-2.0 band", () => {
    insertReviews(120);
    db.run("INSERT INTO app_state (key, value) VALUES ('user_memory_profile', ?)", [
      JSON.stringify({
        memoryStrength: 0.5,
        firstTimeCorrectRate: 0.1,
        retentionRate7Days: 0.1,
        avgReviewsToMaster: 20,
        totalReviews: 120,
        lastUpdated: new Date().toISOString()
      })
    ]);
    expect(calculateAdaptiveDecay(1, 0)).toBeGreaterThanOrEqual(0.5);
    expect(calculateAdaptiveDecay(5, 1)).toBeLessThanOrEqual(2.0);
  });
});

describe("updateMemoryProfileIfNeeded", () => {
  it("does nothing below the 100-review threshold", () => {
    insertReviews(50);
    updateMemoryProfileIfNeeded();
    expect(getUserMemoryProfile().totalReviews).toBe(0);
  });

  it("computes and stores a profile once enough reviews accumulate", () => {
    insertReviews(150);
    db.run("INSERT INTO progress (word_id, score, seen_count) VALUES (1, 12, 4), (2, 15, 6)");
    updateMemoryProfileIfNeeded();
    const profile = getUserMemoryProfile();
    expect(profile.totalReviews).toBe(150);
    expect(profile.avgReviewsToMaster).toBe(5);
    expect(profile.memoryStrength).toBeGreaterThanOrEqual(0.5);
    expect(profile.memoryStrength).toBeLessThanOrEqual(2.0);
  });

  it("waits 50 reviews between profile refreshes", () => {
    insertReviews(150);
    updateMemoryProfileIfNeeded();
    const first = getUserMemoryProfile();
    insertReviews(10);
    updateMemoryProfileIfNeeded();
    expect(getUserMemoryProfile().totalReviews).toBe(first.totalReviews);
  });
});

describe("getMemoryStrengthLabel", () => {
  it("maps strength bands to labels", () => {
    expect(getMemoryStrengthLabel(1.6)).toBe("优秀");
    expect(getMemoryStrengthLabel(1.3)).toBe("良好");
    expect(getMemoryStrengthLabel(1.0)).toBe("正常");
    expect(getMemoryStrengthLabel(0.6)).toBe("需加强");
  });
});
