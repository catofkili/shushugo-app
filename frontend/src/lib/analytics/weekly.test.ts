import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import initSqlJs, { type Database } from "sql.js";

let db: Database;

vi.mock("../database", () => ({
  getDatabase: () => db
}));

const {
  getWeekWindow,
  weekStartOf,
  windowDays,
  isWeekend,
  getWeeklyMetrics,
  getWeeklyHighlight,
  getWeeklyRevisitWords,
  getSlotDistribution,
  getKeywordCandidates,
  pickKeyword,
  getGoalEta,
  getRollingSpeed,
  buildReferences,
  passesThreshold,
  hashSeed,
  reportPeriodStart,
  TIME_REF_MIN_MINUTES
} = await import("./weekly");

const at = (y: number, m: number, d: number, hour: number, minute = 0): number =>
  new Date(y, m - 1, d, hour, minute, 0, 0).getTime();

const reportWindow = () => getWeekWindow("2026-09-13T15:00:00");

beforeAll(async () => {
  const SQL = await initSqlJs();
  db = new SQL.Database();
});

beforeEach(() => {
  for (const table of ["reviews", "grammar_reviews", "grammar_activity_events", "kanji_unit_reviews", "words", "word_study_time", "study_time_by_period"]) {
    db.run(`DROP TABLE IF EXISTS ${table}`);
  }
  db.run(`CREATE TABLE reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word_id INTEGER NOT NULL,
    answer TEXT NOT NULL,
    reviewed_on TEXT NOT NULL,
    direction TEXT NOT NULL DEFAULT 'forward',
    reviewed_at INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE grammar_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    grammar_id INTEGER NOT NULL,
    answer TEXT NOT NULL,
    score_after REAL NOT NULL DEFAULT 0,
    reviewed_on TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE kanji_unit_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    unit_key TEXT NOT NULL,
    answer TEXT NOT NULL,
    reviewed_on TEXT NOT NULL,
    reviewed_at INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run("CREATE TABLE word_study_time (studied_on TEXT PRIMARY KEY, seconds INTEGER, updated_at TEXT)");
  db.run("CREATE TABLE study_time_by_period (period_start TEXT, device_id TEXT, seconds INTEGER, PRIMARY KEY (period_start, device_id))");
  db.run("CREATE TABLE words (id INTEGER PRIMARY KEY, kanji TEXT, kana TEXT)");
  db.run("CREATE TABLE grammar_activity_events (id INTEGER PRIMARY KEY AUTOINCREMENT, grammar_id TEXT, answer TEXT, activity_on TEXT, activity_at INTEGER, created_at TEXT)");
});

const addWord = (
  wordId: number,
  day: string,
  reviewedAt: number,
  direction = "forward",
  answer = "know"
) => {
  db.run(
    "INSERT INTO reviews (word_id, answer, reviewed_on, direction, reviewed_at) VALUES (?, ?, ?, ?, ?)",
    [wordId, answer, day, direction, reviewedAt]
  );
};

const addGrammar = (grammarId: number, day: string, reviewedAt: number) => {
  db.run(
    "INSERT INTO grammar_reviews (grammar_id, answer, reviewed_on, created_at) VALUES (?, 'know', ?, ?)",
    [grammarId, day, new Date(reviewedAt).toISOString()]
  );
};

const addKanji = (unitKey: string, day: string, reviewedAt: number) => {
  db.run(
    "INSERT INTO kanji_unit_reviews (unit_key, answer, reviewed_on, reviewed_at, created_at) VALUES (?, 'know', ?, ?, ?)",
    [unitKey, day, reviewedAt, new Date(reviewedAt).toISOString()]
  );
};

describe("14:00 周期", () => {
  it("以周日 14:00 为边界，窗口左闭右开", () => {
    const window = reportWindow();
    expect(window.start).toBe("2026-09-06");
    expect(window.end).toBe("2026-09-12");
    addWord(1, "2026-09-05", at(2026, 9, 6, 13, 59));
    addWord(2, "2026-09-06", at(2026, 9, 6, 14));
    addWord(3, "2026-09-13", at(2026, 9, 13, 13, 59));
    addWord(4, "2026-09-13", at(2026, 9, 13, 14));
    const metrics = getWeeklyMetrics(window);
    expect(metrics.totalReviews).toBe(2);
    expect(metrics.newWords).toBe(2);
    expect(metrics.daily).toHaveLength(7);
    expect(metrics.daily[0].reviews).toBe(2);
    expect(metrics.days).toBe(1);
  });

  it("周日 14:00 之前仍读取上一段已结束周期", () => {
    const before = getWeekWindow("2026-09-13T13:59:59");
    expect(before.start).toBe("2026-08-30");
    expect(before.end).toBe("2026-09-05");
    expect(getWeekWindow("2026-09-13T14:00:00").start).toBe("2026-09-06");
  });

  it("日期工具仍按周日归类", () => {
    expect(weekStartOf("2026-09-16")).toBe("2026-09-13");
    expect(windowDays(reportWindow())).toEqual([
      "2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09",
      "2026-09-10", "2026-09-11", "2026-09-12"
    ]);
    expect(isWeekend("2026-09-13")).toBe(true);
    expect(isWeekend("2026-09-16")).toBe(false);
  });

  it("跨月跨年保持本地日历", () => {
    expect(getWeekWindow("2027-01-03T15:00:00")).toMatchObject({ start: "2026-12-27", end: "2027-01-02" });
    expect(getWeekWindow("2026-10-04T15:00:00")).toMatchObject({ start: "2026-09-27", end: "2026-10-03" });
  });
});

describe("所有模式的周指标", () => {
  it("生成高光和可自愿复习的疑难词", () => {
    const window = reportWindow();
    db.run("INSERT INTO words VALUES (1, '学ぶ', 'まなぶ'), (2, '見る', 'みる')");
    addWord(1, "2026-09-07", at(2026, 9, 7, 15), "forward", "forgot");
    addWord(2, "2026-09-07", at(2026, 9, 7, 15), "forward", "fuzzy");
    addWord(3, "2026-09-08", at(2026, 9, 8, 15), "forward", "forgot");
    const metrics = getWeeklyMetrics(window);
    expect(getWeeklyHighlight(metrics)?.date).toBe("2026-09-07");
    expect(getWeeklyRevisitWords(window).map((item) => item.text)).toEqual(["学ぶ", "見る"]);
  });

  it("统计单词、反向、语法、汉字和快速学习的同一份学习记录", () => {
    const window = reportWindow();
    addWord(1, "2026-09-07", at(2026, 9, 7, 10));
    addWord(2, "2026-09-07", at(2026, 9, 7, 10), "reverse");
    addGrammar(8, "2026-09-08", at(2026, 9, 8, 20));
    addKanji("u1", "2026-09-09", at(2026, 9, 9, 8));
    addWord(3, "2026-09-10", at(2026, 9, 10, 8), "forward", "fuzzy");
    const metrics = getWeeklyMetrics(window);
    expect(metrics.totalReviews).toBe(5);
    expect(metrics.wordReviews).toBe(3);
    expect(metrics.grammarReviews).toBe(1);
    expect(metrics.kanjiReviews).toBe(1);
    expect(metrics.days).toBe(4);
    expect(metrics.newWords).toBe(2);
  });

  it("只有正向单词第一次事件才计入新词", () => {
    const window = reportWindow();
    addWord(1, "2026-08-30", at(2026, 8, 30, 15));
    addWord(1, "2026-09-07", at(2026, 9, 7, 15));
    addWord(2, "2026-09-07", at(2026, 9, 7, 15), "reverse");
    addWord(2, "2026-09-08", at(2026, 9, 8, 15), "forward");
    addWord(3, "2026-09-09", at(2026, 9, 9, 15), "forward");
    const metrics = getWeeklyMetrics(window);
    expect(metrics.totalReviews).toBe(4);
    // reverse 本身不定义“新词”，但它之后的第一次 forward 仍是这个词的首次正向练习。
    expect(metrics.newWords).toBe(2);
    expect(metrics.reviewCount).toBe(2);
  });

  it("一键完成计划产生的批量流水不冒充逐题学习", () => {
    db.run("ALTER TABLE reviews ADD COLUMN event_source TEXT NOT NULL DEFAULT 'legacy'");
    db.run(
      "INSERT INTO reviews (word_id, answer, reviewed_on, direction, reviewed_at, event_source) VALUES (1, 'know', '2026-09-07', 'forward', ?, 'bulk_complete')",
      [at(2026, 9, 7, 15)]
    );
    const metrics = getWeeklyMetrics(reportWindow());
    expect(metrics.totalReviews).toBe(0);
    expect(metrics.newWords).toBe(0);
  });

  it("旧周回看不混入窗口结束后的数据", () => {
    const window = reportWindow();
    addWord(1, "2026-09-07", at(2026, 9, 7, 15));
    addWord(2, "2026-09-20", at(2026, 9, 20, 15));
    expect(getWeeklyMetrics(window).cumulativeWords).toBe(1);
    expect(getWeeklyMetrics(window).cumulativeDays).toBe(1);
  });

  it("连续天数以窗口末日为锚点，不读取今天", () => {
    const window = reportWindow();
    for (const day of [7, 8, 9, 10, 11, 12]) {
      addWord(day, `2026-09-${String(day).padStart(2, "0")}`, at(2026, 9, day, 16));
    }
    addWord(13, "2026-09-13", at(2026, 9, 13, 13, 59));
    addWord(99, "2026-09-20", at(2026, 9, 20, 16));
    expect(getWeeklyMetrics(window).streak).toBe(7);
  });

  it("按周期时长表跨设备求和", () => {
    const window = reportWindow();
    db.run("INSERT INTO study_time_by_period VALUES ('2026-09-06 14:00', 'a', 600), ('2026-09-06 14:00', 'b', 300), ('2026-09-13 14:00', 'a', 9999)");
    expect(getWeeklyMetrics(window).totalSeconds).toBe(900);
    expect(getWeeklyMetrics(window).minutes).toBe(15);
  });

  it("只有计时的多个学习日不会被压成一天", () => {
    db.run("INSERT INTO study_time_by_period VALUES ('2026-09-06 14:00', 'a', 900)");
    db.run("INSERT INTO word_study_time VALUES ('2026-09-07', 300, 'x'), ('2026-09-09', 300, 'x'), ('2026-09-12', 300, 'x')");
    const metrics = getWeeklyMetrics(reportWindow());
    expect(metrics.days).toBe(3);
    expect(metrics.cumulativeDays).toBe(3);
    expect(metrics.daily.filter((day) => day.seconds > 0)).toHaveLength(3);
  });

  it("旧库没有周期表时退回日汇总", () => {
    db.run("DROP TABLE study_time_by_period");
    db.run("INSERT INTO word_study_time VALUES ('2026-09-07', 600, 'x'), ('2026-09-08', 300, 'x'), ('2026-09-20', 9999, 'x')");
    expect(getWeeklyMetrics(reportWindow()).totalSeconds).toBe(900);
  });
});

describe("时段与关键词", () => {
  it("所有有时间的模式都进入时段统计", () => {
    const window = reportWindow();
    addWord(1, "2026-09-07", at(2026, 9, 7, 23));
    addGrammar(1, "2026-09-08", at(2026, 9, 8, 1));
    addKanji("u1", "2026-09-09", at(2026, 9, 9, 8));
    const slots = getSlotDistribution(window);
    expect(slots.total).toBe(3);
    expect(slots.counts.deepNight).toBe(2);
    expect(slots.counts.earlyMorning).toBe(0);
  });

  it("22:00 到 04:00 都是深夜", () => {
    const window = reportWindow();
    addWord(1, "2026-09-07", at(2026, 9, 7, 22));
    addWord(2, "2026-09-08", at(2026, 9, 8, 3, 59));
    expect(getSlotDistribution(window).counts.deepNight).toBe(2);
  });

  it("关键词命中来自真实材料", () => {
    const window = reportWindow();
    addWord(1, "2026-09-07", at(2026, 9, 7, 23));
    addWord(2, "2026-09-07", at(2026, 9, 7, 23, 30));
    const metrics = getWeeklyMetrics(window);
    expect(getKeywordCandidates(metrics, getSlotDistribution(window)).map((item) => item.keyword)).toContain("夜行者");
  });

  it("关键词同 seed 可复现且不会永远取稀有词", () => {
    const candidates = [{ keyword: "复习派", rarity: 2 }, { keyword: "单日爆发", rarity: 5 }];
    expect(pickKeyword(candidates, "a")).toEqual(pickKeyword(candidates, "a"));
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) seen.add(pickKeyword(candidates, `u${i}`)!.keyword);
    expect(seen.size).toBe(2);
    expect(hashSeed("abc")).not.toBe(hashSeed("ABC"));
  });
});

describe("页面降级与滚动速度", () => {
  it("只有一天有记录时不出高光页", () => {
    const window = reportWindow();
    addWord(1, "2026-09-07", at(2026, 9, 7, 15));
    addWord(2, "2026-09-07", at(2026, 9, 7, 16));
    addWord(3, "2026-09-07", at(2026, 9, 7, 17));
    const metrics = getWeeklyMetrics(window);
    expect(metrics.days).toBe(1);
    expect(getWeeklyHighlight(metrics)).toBeNull();
  });

  it("峰值只有一次作答时也不凑一页高光", () => {
    const window = reportWindow();
    addWord(1, "2026-09-07", at(2026, 9, 7, 15));
    addWord(2, "2026-09-08", at(2026, 9, 8, 15));
    const metrics = getWeeklyMetrics(window);
    expect(metrics.days).toBe(2);
    expect(getWeeklyHighlight(metrics)).toBeNull();
  });

  it("没有卡住的词时不出「再见一面」", () => {
    const window = reportWindow();
    db.run("INSERT INTO words VALUES (1, '学ぶ', 'まなぶ')");
    addWord(1, "2026-09-07", at(2026, 9, 7, 15), "forward", "know");
    expect(getWeeklyRevisitWords(window)).toEqual([]);
  });

  it("疑难词按卡住次数降序，且不超出上限", () => {
    const window = reportWindow();
    db.run("INSERT INTO words VALUES (1, '学ぶ', 'まなぶ'), (2, '見る', 'みる')");
    addWord(1, "2026-09-07", at(2026, 9, 7, 15), "forward", "forgot");
    addWord(2, "2026-09-07", at(2026, 9, 7, 16), "forward", "fuzzy");
    addWord(2, "2026-09-08", at(2026, 9, 8, 15), "forward", "forgot");
    const words = getWeeklyRevisitWords(window);
    expect(words.map((item) => item.text)).toEqual(["見る", "学ぶ"]);
    expect(words[0].count).toBe(2);
  });

  it("疑难词只取正向的 forgot/fuzzy 记录", () => {
    const window = reportWindow();
    db.run("INSERT INTO words VALUES (1, '学ぶ', 'まなぶ'), (2, '見る', 'みる')");
    addWord(1, "2026-09-07", at(2026, 9, 7, 15), "reverse", "forgot");
    addWord(2, "2026-09-07", at(2026, 9, 7, 16), "forward", "unknown");
    expect(getWeeklyRevisitWords(window)).toEqual([]);
  });

  it("新用户第一周不被四周摊薄", () => {
    const window = reportWindow();
    for (let i = 0; i < 4; i += 1) addWord(i + 1, "2026-09-07", at(2026, 9, 7, 15));
    // 只有一周是「开始使用之后」的，平均值就是那一周，不是四分之一。
    expect(getRollingSpeed(window, 4)).toBe(4);
  });

  it("开始使用之后的真实零新增周要保留在分母里", () => {
    const window = reportWindow();
    for (let i = 0; i < 4; i += 1) addWord(i + 1, "2026-08-31", at(2026, 8, 31, 15));
    // 上一周 4 个新词、这一周 0 个：两周平均 2，而不是被四周摊成 1。
    expect(getRollingSpeed(window, 4)).toBe(2);
  });

  it("完全没有记录时速度为 0", () => {
    expect(getRollingSpeed(reportWindow(), 4)).toBe(0);
  });

  it("零新增日会阻止匀速标签", () => {
    const window = reportWindow();
    for (let i = 0; i < 5; i += 1) {
      addWord(i + 1, "2026-09-07", at(2026, 9, 7, 15 + i));
      addWord(i + 6, "2026-09-08", at(2026, 9, 8, 15 + i));
    }
    const metrics = getWeeklyMetrics(window);
    expect(getKeywordCandidates(metrics, getSlotDistribution(window)).map((item) => item.keyword)).not.toContain("匀速前进");
  });
});

describe("页面展示口径", () => {
  it("首发不展示模糊 ETA", () => {
    expect(getGoalEta()).toBeNull();
  });

  it("参照物只使用真实投入与作答次数", () => {
    const metrics = getWeeklyMetrics(reportWindow());
    metrics.totalSeconds = 120;
    metrics.minutes = 2;
    metrics.totalReviews = 3;
    const references = buildReferences({ metrics, speedBand: null, eta: null });
    expect(references.map((item) => item.kind)).toEqual(expect.arrayContaining(["time", "review"]));
    expect(references.map((item) => item.text).join(" ")).not.toContain("日剧");
  });

  it("低于一分钟不伪造成 0 分钟内容", () => {
    const metrics = getWeeklyMetrics(reportWindow());
    metrics.minutes = TIME_REF_MIN_MINUTES - 1;
    metrics.totalSeconds = 30;
    expect(buildReferences({ metrics, speedBand: null, eta: null }).map((item) => item.kind)).not.toContain("time");
  });

  it("一天有一条记录也能生成周报", () => {
    addWord(1, "2026-09-07", at(2026, 9, 7, 15));
    expect(passesThreshold(getWeeklyMetrics(reportWindow()))).toBe(true);
  });

  it("完全没有记录不生成周报", () => {
    expect(passesThreshold(getWeeklyMetrics(reportWindow()))).toBe(false);
  });

  it("时长周期起点计算准确", () => {
    expect(reportPeriodStart(at(2026, 9, 6, 13, 59))).toBe("2026-08-30 14:00");
    expect(reportPeriodStart(at(2026, 9, 6, 14))).toBe("2026-09-06 14:00");
  });
});
