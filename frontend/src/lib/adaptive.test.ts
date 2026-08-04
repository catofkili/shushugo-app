import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import initSqlJs, { type Database } from "sql.js";

// 用真实的 sql.js 内存库替换全局单例,复现 adaptive 的 SQL 行为。
let db: Database;
vi.mock("./database", () => ({
  getDatabase: () => db
}));

const { getMemoryStrengthLabel, getUserMemoryProfile, updateMemoryProfileIfNeeded } =
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
  // 保持率现在读 FSRS 的 fsrs_due,合成表要跟真实 schema 一致
  db.run(`CREATE TABLE progress (
    word_id INTEGER PRIMARY KEY,
    score REAL NOT NULL DEFAULT 0,
    seen_count INTEGER NOT NULL DEFAULT 0,
    known_forever INTEGER NOT NULL DEFAULT 0,
    last_seen_on TEXT,
    fsrs_stability REAL,
    fsrs_difficulty REAL,
    fsrs_due TEXT,
    fsrs_last_review TEXT,
    fsrs_state INTEGER,
    fsrs_steps INTEGER,
    fsrs_reps INTEGER,
    fsrs_lapses INTEGER
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

describe("updateMemoryProfileIfNeeded", () => {
  it("does nothing below the 100-review threshold", () => {
    insertReviews(50);
    updateMemoryProfileIfNeeded();
    expect(getUserMemoryProfile().totalReviews).toBe(0);
  });

  it("computes and stores a profile once enough reviews accumulate", () => {
    insertReviews(150);
    // 「已掌握」= FSRS 排的间隔 >= 7 天(不再看 score)。两个词分别复习了 4 次和 6 次 → 均值 5
    db.run(`INSERT INTO progress (word_id, seen_count, fsrs_last_review, fsrs_due)
            VALUES (1, 4, '2026-07-01T00:00:00Z', '2026-07-20T00:00:00Z'),
                   (2, 6, '2026-07-01T00:00:00Z', '2026-08-01T00:00:00Z')`);
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
