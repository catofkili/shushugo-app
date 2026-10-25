import { beforeEach, describe, expect, it, vi } from "vitest";
import initSqlJs, { type Database } from "sql.js";

let db: Database;
let plan = { total: 0, completed: 0 };
let encoreWords = 0;
const TODAY = "2026-09-19";
const nativeIcon = vi.hoisted(() => ({ getCurrent: vi.fn(), set: vi.fn() }));

vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: vi.fn(() => "web"), isPluginAvailable: vi.fn(() => false), isNativePlatform: () => false },
  registerPlugin: vi.fn(() => nativeIcon)
}));

vi.mock("./database", () => ({ getDatabase: () => db }));
vi.mock("./database/db-utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./database/db-utils")>()),
  today: () => TODAY,
  persistSoon: () => undefined
}));
vi.mock("./word-api/stage1", () => ({ stage1ProgressCounts: () => plan }));
vi.mock("./review-budget", () => ({ readEncoreLog: () => ({ dayWords: encoreWords }) }));

import { buyItem, claimDailyPlanYuzu, equipItem, unequip, equippedItem, grantRepairCard, ownsItem, repairableDays, repairCards, repairDay, repairDayWithCard, repairPrice, settleYuzu, yuzuBalance, YUZU } from "./yuzu";
import { Capacitor } from "@capacitor/core";
import { setAppIcon, syncAppIcon } from "./app-icon";
import { streakSnapshot } from "./streak";
import { YUZU_TITLE_IDS } from "./yuzu-titles";
import { YUZU_ITEMS, itemById } from "./yuzu-catalog";
import { setWalkStyle } from "../components/CapybaraMascot";

const checkin = (...days: string[]) => days.forEach((d) => db.run("INSERT OR IGNORE INTO checkins (checked_on) VALUES (?)", [d]));
const answers = (n: number, day = TODAY) => {
  for (let i = 0; i < n; i++) db.run("INSERT INTO reviews (word_id, reviewed_on, direction) VALUES (?, ?, 'forward')", [i + 1, day]);
};

beforeEach(async () => {
  vi.mocked(Capacitor.getPlatform).mockReturnValue("web");
  vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(false);
  nativeIcon.getCurrent.mockReset().mockResolvedValue({ name: null });
  nativeIcon.set.mockReset().mockImplementation(async ({ name }: { name: string | null }) => {
    nativeIcon.getCurrent.mockResolvedValue({ name });
  });
  const SQL = await initSqlJs();
  db = new SQL.Database();
  db.run("CREATE TABLE reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, word_id INTEGER, reviewed_on TEXT, direction TEXT)");
  db.run("CREATE TABLE checkins (checked_on TEXT PRIMARY KEY)");
  db.run("CREATE TABLE grammar_reviews (reviewed_on TEXT)");
  db.run("CREATE TABLE kanji_unit_reviews (reviewed_on TEXT)");
  db.run("CREATE TABLE word_study_time (studied_on TEXT PRIMARY KEY, seconds INTEGER)");
  db.run("CREATE TABLE achievements (id TEXT PRIMARY KEY, unlocked_on TEXT NOT NULL)");
  db.run("CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT)");
  // 新装的库:账本已经是 ×10 之后的面额。不写这个标记的话,第一次读余额会把 fund() 直接写进去的行当旧账本再乘 10
  db.run("INSERT INTO app_state VALUES ('yuzu_scale_10', '1')");
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

  it("每日计划奖励等到完成页领取；其他收入仍由结算自动入账", () => {
    answers(120);
    plan = { total: 300, completed: 300 };
    checkin("2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", TODAY);
    db.run("INSERT INTO achievements VALUES ('first-know', '2026-06-06'), ('streak-7', '2026-06-12')");
    encoreWords = 20;
    expect(settleYuzu()).toBe(YUZU.study + YUZU.streak7 + YUZU.encore + 2 * YUZU.achievement);
    expect(settleYuzu()).toBe(0);
    expect(claimDailyPlanYuzu()).toBe(YUZU.plan);
    expect(claimDailyPlanYuzu()).toBe(0);
  });

  it("每日计划未完成时不能领取计划奖励", () => {
    plan = { total: 10, completed: 9 };
    expect(claimDailyPlanYuzu()).toBe(0);
  });

  it("连击 8 天不发;今天还没亮也不发(streak 数的是昨天的)", () => {
    checkin("2026-09-12", "2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18");
    expect(settleYuzu()).toBe(0);
    checkin(TODAY);
    expect(settleYuzu()).toBe(0);
  });

  it("小火苗保连胜不发奖：第七天只是亮（20 次作答），不发连击", () => {
    checkin("2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18");
    answers(20);
    expect(settleYuzu()).toBe(0);
  });

  it("大火苗得奖：中间夹着小火苗不断，攒满 7 个大火苗那天发一次", () => {
    // 9/12 只亮（20 题），其余 7 天清完计划：连胜 8 天、大火苗 7 个
    checkin("2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18");
    db.run("INSERT INTO word_study_time VALUES ('2026-09-12', 300)");
    expect(settleYuzu()).toBe(0);
    checkin(TODAY);
    expect(settleYuzu()).toBe(YUZU.streak7);
    expect(settleYuzu()).toBe(0);
  });

  it("补签天保连胜但不算大火苗", () => {
    checkin("2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", TODAY);
    db.run("INSERT INTO yuzu_ledger VALUES ('repair_card', '2026-09-16', 0, ?)", [TODAY]);
    expect(settleYuzu()).toBe(0);
  });
});

describe("消费", () => {
  let seed = 0;
  const fund = (n: number) => db.run("INSERT INTO yuzu_ledger VALUES ('test', ?, ?, ?)", [String(seed++), n, TODAY]);

  it("钱不够不卖;买到即拥有,槽位空着就自动装上;不重复卖", () => {
    // 价格从目录读：2026-09-24 按人民币面额整体 ×10 时这里写死的 199 就过期了
    fund(itemById("theme-matcha")!.price - 1);
    expect(buyItem("theme-matcha")).toBe(false);
    fund(1);
    expect(buyItem("theme-matcha")).toBe(true);
    expect(ownsItem("theme-matcha")).toBe(true);
    expect(equippedItem("theme")).toBe("theme-matcha");
    expect(yuzuBalance()).toBe(0);
    expect(buyItem("theme-matcha")).toBe(false);
  });

  it("称号单买：首件自动装备，换另一件只占一个槽，卸下保留所有权", () => {
    const titles = YUZU_ITEMS.filter((item) => item.category === "title");
    expect(titles.map((item) => item.id).sort()).toEqual(Object.values(YUZU_TITLE_IDS).sort());
    expect(titles.every((item) => !item.soon && item.price === (item.invite ? 0 : 3000))).toBe(true);
    fund(6000);
    expect(buyItem("title-early")).toBe(true);
    expect(equippedItem("title")).toBe("title-early");
    expect(buyItem("title-night")).toBe(true);
    expect(equippedItem("title")).toBe("title-early");
    equipItem("title-night");
    expect(equippedItem("title")).toBe("title-night");
    expect(db.exec("SELECT value FROM app_state WHERE key = 'yuzu_equipped:title'")[0].values).toEqual([["title-night"]]);
    unequip("title");
    expect(equippedItem("title")).toBe("");
    expect(ownsItem("title-early") && ownsItem("title-night")).toBe(true);
    expect(yuzuBalance()).toBe(0);
  });

  it("滚着走：余额不足不卖，买后自动装备，卸下回到默认走路", () => {
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("document", { documentElement: { setAttribute() {}, removeAttribute() {} } });
    setWalkStyle("");
    const changed = vi.fn();
    window.addEventListener("shushugo:walk-style", changed);
    try {
      fund(itemById("walk-alt")!.price - 1);
      expect(buyItem("walk-alt")).toBe(false);
      expect(changed).not.toHaveBeenCalled();
      expect(ownsItem("walk-alt")).toBe(false);
      expect(equippedItem("walk")).toBe("");
      fund(1);
      expect(buyItem("walk-alt")).toBe(true);
      expect(ownsItem("walk-alt")).toBe(true);
      expect(equippedItem("walk")).toBe("walk-alt");
      expect(changed).toHaveBeenCalledTimes(1);
      expect(yuzuBalance()).toBe(0);
      expect(buyItem("walk-alt")).toBe(false);
      unequip("walk");
      expect(changed).toHaveBeenCalledTimes(2);
      expect(equippedItem("walk")).toBe("");
      expect(ownsItem("walk-alt")).toBe(true);
    } finally {
      setWalkStyle("");
      vi.unstubAllGlobals();
    }
  });

  it("补签:只补 7 天内、首次亮之后的洞;30 天内 500/1000/2000 递增;补完连击接上", () => {
    checkin("2026-09-10", "2026-09-11", "2026-09-14", "2026-09-17", TODAY);
    // 窗口是今天 −1..−7 = 09-12..09-18,09-09 在外面
    expect(repairableDays()).toEqual(["2026-09-18", "2026-09-16", "2026-09-15", "2026-09-13", "2026-09-12"]);
    expect(repairDay("2026-09-09")).toBe(false);
    fund(1500);
    expect(repairPrice()).toBe(500);
    expect(repairDay("2026-09-18")).toBe(true);
    expect(repairPrice()).toBe(1000);
    expect(repairDay("2026-09-16")).toBe(true);
    expect(repairPrice()).toBe(2000);
    expect(repairDay("2026-09-15")).toBe(false); // 没钱了
    expect(yuzuBalance()).toBe(0);
    expect(streakSnapshot().streak).toBe(4); // 16,17,18,19
  });

  it("第一次亮可以来自学习时长；已亮未打卡的日子不卖补签", () => {
    db.run("INSERT INTO word_study_time VALUES ('2026-09-15', 300)");
    answers(20, "2026-09-17");
    expect(repairableDays()).toEqual(["2026-09-18", "2026-09-16"]);
    fund(2000);
    expect(repairDay("2026-09-17")).toBe(false);
    expect(repairDay("2026-09-14")).toBe(false);
    expect(repairDay("2026-09-18")).toBe(true);
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

describe("iOS App 图标", () => {
  const own = (id = "icon-happy") => db.run("INSERT INTO yuzu_ledger VALUES ('buy', ?, -5000, ?)", [id, TODAY]);
  beforeEach(() => {
    vi.mocked(Capacitor.getPlatform).mockReturnValue("ios");
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
  });

  it("装备映射到原生名，重复装备不重复改图标，换回传 null", async () => {
    own();
    equipItem("icon-happy");
    equipItem("icon-happy");
    await vi.waitFor(() => expect(nativeIcon.getCurrent).toHaveBeenCalledTimes(2));
    expect(nativeIcon.set).toHaveBeenCalledExactlyOnceWith({ name: "AppIconHappy" });
    unequip("icon");
    await vi.waitFor(() => expect(nativeIcon.set).toHaveBeenLastCalledWith({ name: null }));
    expect(equippedItem("icon")).toBe("");
  });

  it("原生已经是目标名时不弹提示", async () => {
    own();
    nativeIcon.getCurrent.mockResolvedValue({ name: "AppIconHappy" });
    equipItem("icon-happy");
    await vi.waitFor(() => expect(nativeIcon.getCurrent).toHaveBeenCalledOnce());
    expect(nativeIcon.set).not.toHaveBeenCalled();
  });

  it("买下且槽位为空时自动装备泡汤图标", async () => {
    db.run("INSERT INTO yuzu_ledger VALUES ('test', 'fund', 5000, ?)", [TODAY]);
    expect(buyItem("icon-onsen")).toBe(true);
    await vi.waitFor(() => expect(nativeIcon.set).toHaveBeenCalledOnce());
    expect(equippedItem("icon")).toBe("icon-onsen");
    expect(nativeIcon.set).toHaveBeenCalledExactlyOnceWith({ name: "AppIconOnsen" });
  });

  it("启动按装备槽对账一次，相同不重设，空槽恢复默认", async () => {
    db.run("INSERT INTO app_state VALUES ('yuzu_equipped:icon', 'icon-happy')");
    await syncAppIcon();
    await syncAppIcon();
    expect(nativeIcon.set).toHaveBeenCalledExactlyOnceWith({ name: "AppIconHappy" });
    db.run("UPDATE app_state SET value = '' WHERE key = 'yuzu_equipped:icon'");
    await syncAppIcon();
    expect(nativeIcon.set).toHaveBeenLastCalledWith({ name: null });
  });

  it("原生拒绝或读取失败时静默，队列之后仍能重试", async () => {
    own();
    nativeIcon.set.mockRejectedValueOnce(new Error("系统拒绝"));
    equipItem("icon-happy");
    await expect(setAppIcon("icon-happy")).resolves.toBeUndefined();
    expect(nativeIcon.set).toHaveBeenLastCalledWith({ name: "AppIconHappy" });
    nativeIcon.getCurrent.mockRejectedValueOnce(new Error("读取失败"));
    await expect(syncAppIcon()).resolves.toBeUndefined();
  });

  it.each(["web", "android", "wechat", "ios-without-plugin"])("%s 不可购买或修改图标槽", async (platform) => {
    vi.mocked(Capacitor.getPlatform).mockReturnValue(platform === "ios-without-plugin" ? "ios" : platform);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(platform !== "ios-without-plugin");
    db.run("INSERT INTO yuzu_ledger VALUES ('test', 'fund', 10000, ?)", [TODAY]);
    expect(buyItem("icon-onsen")).toBe(false);
    own();
    equipItem("icon-happy");
    expect(equippedItem("icon")).toBe("");
    db.run("INSERT INTO app_state VALUES ('yuzu_equipped:icon', 'icon-happy')");
    unequip("icon");
    expect(equippedItem("icon")).toBe("icon-happy");
    await syncAppIcon();
    await setAppIcon("");
    expect(nativeIcon.getCurrent).not.toHaveBeenCalled();
    expect(nativeIcon.set).not.toHaveBeenCalled();
  });
});
