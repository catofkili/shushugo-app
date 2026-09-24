import { beforeEach, describe, expect, it, vi } from "vitest";
import initSqlJs, { type Database } from "sql.js";

let db: Database;
let plan = { total: 0, completed: 0 };
let encoreWords = 0;
const TODAY = "2026-09-19";

vi.mock("./database", () => ({ getDatabase: () => db }));
vi.mock("./database/db-utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./database/db-utils")>()),
  today: () => TODAY,
  persistSoon: () => undefined
}));
vi.mock("./word-api/stage1", () => ({ stage1ProgressCounts: () => plan }));
vi.mock("./review-budget", () => ({ readEncoreLog: () => ({ dayWords: encoreWords }) }));

import { buyItem, equippedItem, grantRepairCard, ownsItem, repairableDays, repairCards, repairDay, repairDayWithCard, repairPrice, settleYuzu, yuzuBalance, YUZU } from "./yuzu";
import { computeStreak } from "./zoo-streak";

const checkin = (...days: string[]) => days.forEach((d) => db.run("INSERT OR IGNORE INTO checkins (checked_on) VALUES (?)", [d]));
const answers = (n: number, day = TODAY) => {
  for (let i = 0; i < n; i++) db.run("INSERT INTO reviews (word_id, reviewed_on, direction) VALUES (?, ?, 'forward')", [i + 1, day]);
};

beforeEach(async () => {
  const SQL = await initSqlJs();
  db = new SQL.Database();
  db.run("CREATE TABLE reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, word_id INTEGER, reviewed_on TEXT, direction TEXT)");
  db.run("CREATE TABLE checkins (checked_on TEXT PRIMARY KEY)");
  db.run("CREATE TABLE achievements (id TEXT PRIMARY KEY, unlocked_on TEXT NOT NULL)");
  db.run("CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT)");
  db.run("CREATE TABLE yuzu_ledger (kind TEXT NOT NULL, key TEXT NOT NULL, amount INTEGER NOT NULL, day TEXT NOT NULL, PRIMARY KEY (kind, key))");
  plan = { total: 0, completed: 0 };
  encoreWords = 0;
});

describe("收入", () => {
  it("不到 100 词、计划没清:一分不给;再叫一次也不重复记账", () => {
    answers(99);
    plan = { total: 300, completed: 200 };
    expect(settleYuzu()).toBe(0);
    db.run("INSERT INTO reviews (word_id, reviewed_on, direction) VALUES (100, ?, 'forward')", [TODAY]);
    expect(settleYuzu()).toBe(YUZU.study);
    expect(settleYuzu()).toBe(0);
    expect(yuzuBalance()).toBe(YUZU.study);
  });

  it("清完计划、连击、成就都按新版倍率入账", () => {
    answers(120);
    plan = { total: 300, completed: 300 };
    checkin("2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", TODAY);
    db.run("INSERT INTO achievements VALUES ('first-know', '2026-06-06'), ('streak-7', '2026-06-12')");
    encoreWords = 20;
    expect(settleYuzu()).toBe(YUZU.study + YUZU.plan + YUZU.streak7 + YUZU.encore + 2 * YUZU.achievement);
    expect(settleYuzu()).toBe(0);
  });

  it("连击 8 天不发;今天还没打卡也不发(streak 数的是昨天的)", () => {
    checkin("2026-09-12", "2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18");
    expect(settleYuzu()).toBe(0);
    checkin(TODAY);
    expect(settleYuzu()).toBe(0);
  });
});

describe("消费", () => {
  let seed = 0;
  const fund = (n: number) => db.run("INSERT INTO yuzu_ledger VALUES ('test', ?, ?, ?)", [String(seed++), n, TODAY]);

  it("钱不够不卖;买到即拥有,槽位空着就自动装上;不重复卖", () => {
    fund(199);
    expect(buyItem("theme-matcha")).toBe(false);
    fund(1);
    expect(buyItem("theme-matcha")).toBe(true);
    expect(ownsItem("theme-matcha")).toBe(true);
    expect(equippedItem("theme")).toBe("theme-matcha");
    expect(yuzuBalance()).toBe(0);
    expect(buyItem("theme-matcha")).toBe(false);
  });

  it("补签:只补 7 天内、首次打卡之后的洞;30 天内 500/1000/2000 递增;补完连击接上", () => {
    checkin("2026-09-10", "2026-09-11", "2026-09-14", "2026-09-17", TODAY);
    // 窗口是今天 −1..−7 = 09-12..09-18,09-09 在外面
    expect(repairableDays()).toEqual(["2026-09-18", "2026-09-16", "2026-09-15", "2026-09-13", "2026-09-12"]);
    expect(repairDay("2026-09-09")).toBe(false);
    fund(150);
    expect(repairPrice()).toBe(500);
    expect(repairDay("2026-09-18")).toBe(true);
    expect(repairPrice()).toBe(1000);
    expect(repairDay("2026-09-16")).toBe(true);
    expect(repairPrice()).toBe(2000);
    expect(repairDay("2026-09-15")).toBe(false); // 没钱了
    expect(yuzuBalance()).toBe(0);
    const days = db.exec("SELECT checked_on FROM checkins")[0].values.map((r) => String(r[0]));
    expect(computeStreak(days, TODAY)).toBe(4); // 16,17,18,19
  });

  it("补签卡:最多存一张,多发不折算柚子;同一来源只发一次;用卡不抬补签价", () => {
    checkin("2026-09-10", "2026-09-17", TODAY);
    expect(grantRepairCard("pro")).toBe(true);
    expect(grantRepairCard("pro")).toBe(false);
    expect(repairCards()).toBe(1);
    expect(grantRepairCard("event-a")).toBe(false);
    expect(repairCards()).toBe(1);
    expect(yuzuBalance()).toBe(0);
    expect(repairDayWithCard("2026-09-18")).toBe(true);
    expect(repairCards()).toBe(0);
    expect(repairDayWithCard("2026-09-16")).toBe(false);
    expect(repairPrice()).toBe(500);
    expect(grantRepairCard("event-b")).toBe(true);
    expect(repairCards()).toBe(1);
    expect(yuzuBalance()).toBe(0);
  });
});
