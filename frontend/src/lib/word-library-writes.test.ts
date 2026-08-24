/**
 * 词库页会写数据的那两件事：加入队列、熟知。
 *
 * 队列只有一份 —— progress 里的 FSRS 状态；「今天」是它在学习日边界上的投影。
 * 所以这条只对**没学过**的词有意义：学过的到期自己会出现，加了没有含义。
 * 新词按每日配额排，勾 300 个不该把今天砸穿。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;
let SQL: Awaited<ReturnType<typeof initSqlJs>>;

const prefStore = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => prefStore.get(key) ?? null,
  setItem: (key: string, value: string) => { prefStore.set(key, String(value)); },
  removeItem: (key: string) => { prefStore.delete(key); },
  clear: () => prefStore.clear()
};
(globalThis as any).window = {
  dispatchEvent: () => true, addEventListener: () => undefined, removeEventListener: () => undefined
};

vi.mock("./database", () => ({
  getDatabase: () => testDb, initDatabase: async () => testDb,
  exportDatabase: () => null, importDatabase: async () => undefined
}));
vi.mock("./storage", () => ({ scheduleSave: () => undefined, persistSoon: () => undefined }));
vi.mock("./progress-events", () => ({ PROGRESS_UPDATED_EVENT: "test", notifyProgressUpdated: () => undefined }));

import {
  addWordsToQueue,
  ensureProgressInitialized,
  markWordKnownForever,
  setWordsKnownForever,
  setWordsKnownForeverIds,
  unmarkWordKnownForever
} from "./word-api";
import { defaultStudyPreferences, saveStudyPreferences } from "./studyPreferences";

const seedPath = fileURLToPath(new URL("../../public/nihongo.db", import.meta.url));
const count = (sql: string, params: unknown[] = []) =>
  Number(testDb.exec(sql, params as never)[0]?.values?.[0]?.[0] ?? 0);

// 每日新词额度最低就是 5（INTENSITY_MIN），所以拿 7 个词才试得出「排不下」
const UNSEEN = [7001, 7002, 7003, 7004, 7005, 7006, 7007];

beforeEach(async () => {
  SQL = SQL ?? await initSqlJs();
  testDb = new SQL.Database(new Uint8Array(readFileSync(seedPath)));
  prefStore.clear();
  saveStudyPreferences({ ...defaultStudyPreferences, dailyGoal: 5, reviewCap: 20 });
  ensureProgressInitialized();
  testDb.run("DELETE FROM stage1_tasks");
  testDb.run("DELETE FROM reviews");
  testDb.run("DELETE FROM dictionary_discovered_words");
  testDb.run(`UPDATE progress SET seen_count = 0, known_forever = 0, last_seen_on = NULL,
    fsrs_due = NULL, fsrs_last_review = NULL, fsrs_state = NULL, fsrs_stability = NULL
    WHERE word_id IN (${UNSEEN.join(",")})`);
});

describe("加入学习队列", () => {
  it("学过的词不用加 —— 到期自己会出现", () => {
    testDb.run("UPDATE progress SET seen_count = 4 WHERE word_id = ?", [UNSEEN[0]]);
    const result = addWordsToQueue([UNSEEN[0]]);
    expect(result).toMatchObject({ added: 0, alreadyLearning: 1 });
    // 它没有作为「新词」被排进去（当天到期的复习词本来就会自己进计划，那是另一回事）
    expect(count(
      "SELECT COUNT(*) FROM stage1_tasks WHERE word_id = ? AND task_type = 'new'",
      [UNSEEN[0]]
    )).toBe(0);
  });

  it("标了熟知的词单独回报，不当成「学过的」混过去", () => {
    setWordsKnownForever([UNSEEN[0]], true);
    expect(addWordsToQueue([UNSEEN[0]])).toMatchObject({ added: 0, known: 1, alreadyLearning: 0 });
  });

  it("新词全部进队列；今天的新词名额（5 个）优先给挑中的，多出来的排到后面几天", () => {
    const result = addWordsToQueue(UNSEEN);
    expect(result.added).toBe(7);
    expect(result.today).toBe(5);
    // 今天的新词一共还是 5 个 —— 名额没被撑破，只是换成了用户挑的那五个
    expect(count("SELECT COUNT(*) FROM stage1_tasks WHERE task_type = 'new'")).toBe(5);
    expect(count(
      `SELECT COUNT(*) FROM stage1_tasks WHERE task_type = 'new' AND word_id IN (${UNSEEN.join(",")})`
    )).toBe(5);
    // 今天排不下的那两个也没丢：进了「优先新词」名单，之后排计划时最优先
    expect(count(
      `SELECT COUNT(*) FROM dictionary_discovered_words WHERE word_id IN (${UNSEEN.join(",")})`
    )).toBe(7);
  });

  it("走的是占名额的普通新词，不是越过配额的加餐通道", () => {
    addWordsToQueue(UNSEEN);
    expect(count("SELECT COUNT(*) FROM stage1_tasks WHERE task_type = 'encore_new'")).toBe(0);
  });

  it("已经答过的新词不会被挤掉 —— 只让出还没答的那些名额", () => {
    addWordsToQueue([UNSEEN[0]]);
    testDb.run("UPDATE progress SET seen_count = 1, last_seen_on = date('now') WHERE word_id = ?", [UNSEEN[0]]);
    addWordsToQueue(UNSEEN.slice(1));
    expect(count("SELECT COUNT(*) FROM stage1_tasks WHERE word_id = ?", [UNSEEN[0]])).toBe(1);
  });

  it("重复加同一个词不会在今天排两遍", () => {
    addWordsToQueue([UNSEEN[0]]);
    addWordsToQueue([UNSEEN[0]]);
    expect(count("SELECT COUNT(*) FROM stage1_tasks WHERE word_id = ?", [UNSEEN[0]])).toBe(1);
  });

  it("行末那颗「熟知」= 进队列 + 第一次就答熟知：算一次学过，然后退出队列", () => {
    const id = UNSEEN[0];
    expect(markWordKnownForever(id)).toBe(true);
    // 算一次学过：seen_count 涨了、有一条正向流水
    expect(count("SELECT seen_count FROM progress WHERE word_id = ?", [id])).toBe(1);
    expect(count(
      "SELECT COUNT(*) FROM reviews WHERE word_id = ? AND answer = 'known_forever' AND direction = 'forward'",
      [id]
    )).toBe(1);
    // 退出队列：known_forever = 1，FSRS 状态一个字都没写（熟知的词不需要调度）
    expect(count("SELECT known_forever FROM progress WHERE word_id = ?", [id])).toBe(1);
    expect(count("SELECT COUNT(*) FROM progress WHERE word_id = ? AND fsrs_due IS NOT NULL", [id])).toBe(0);
    // 重复点不会再记一条
    expect(markWordKnownForever(id)).toBe(false);
    expect(count("SELECT COUNT(*) FROM reviews WHERE word_id = ?", [id])).toBe(1);
  });

  it("当天点错了能整个撤回去 —— 流水一起删，别留下一条假的学习记录", () => {
    const id = UNSEEN[0];
    markWordKnownForever(id);
    expect(unmarkWordKnownForever(id)).toBe(true);
    expect(count("SELECT known_forever FROM progress WHERE word_id = ?", [id])).toBe(0);
    expect(count("SELECT seen_count FROM progress WHERE word_id = ?", [id])).toBe(0);
    expect(count("SELECT COUNT(*) FROM reviews WHERE word_id = ?", [id])).toBe(0);
  });

  it("更早那次熟知只翻标记，不重写昨天的账", () => {
    const id = UNSEEN[1];
    markWordKnownForever(id);
    testDb.run("UPDATE reviews SET reviewed_on = '2020-01-01' WHERE word_id = ?", [id]);
    expect(unmarkWordKnownForever(id)).toBe(true);
    expect(count("SELECT known_forever FROM progress WHERE word_id = ?", [id])).toBe(0);
    expect(count("SELECT COUNT(*) FROM reviews WHERE word_id = ?", [id])).toBe(1);
    expect(count("SELECT seen_count FROM progress WHERE word_id = ?", [id])).toBe(1);
  });

  it("熟知不往当日任务表里塞行 —— 那会凭空多出一条「已完成」的今日任务", () => {
    const before = count("SELECT COUNT(*) FROM stage1_tasks");
    UNSEEN.forEach((id) => markWordKnownForever(id));
    expect(count("SELECT COUNT(*) FROM stage1_tasks")).toBe(before);
  });

  it("多选工具条的「标熟知」和行末那颗是同一条实现 —— 一样记流水、一样能撤", () => {
    const ids = UNSEEN.slice(0, 3);
    expect(setWordsKnownForever(ids, true)).toBe(3);
    expect(count(
      `SELECT COUNT(*) FROM reviews WHERE answer = 'known_forever' AND word_id IN (${ids.join(",")})`
    )).toBe(3);
    expect(count(`SELECT SUM(seen_count) FROM progress WHERE word_id IN (${ids.join(",")})`)).toBe(3);
    expect(setWordsKnownForever(ids, false)).toBe(3);
    expect(count(`SELECT COUNT(*) FROM reviews WHERE word_id IN (${ids.join(",")})`)).toBe(0);
    expect(count(`SELECT SUM(seen_count) FROM progress WHERE word_id IN (${ids.join(",")})`)).toBe(0);
  });

  it("已经熟知的词重复标不会再记一条", () => {
    setWordsKnownForever([UNSEEN[0]], true);
    expect(setWordsKnownForever([UNSEEN[0]], true)).toBe(0);
    expect(count("SELECT COUNT(*) FROM reviews WHERE word_id = ?", [UNSEEN[0]])).toBe(1);
  });

  /**
   * 多选工具条上的「标熟知」是**撤销条**,不是确认框:直接做掉,把后悔药挂在提示里。
   * 撤销必须按「真的改动了哪些」回滚 —— 词库页不隐藏已经熟知的词,勾中的那批里
   * 混着几个本来就熟知的是常态,拿原始勾选反着跑一遍会把它们一并放回复习,
   * 等于撤出了原来没有的改动。
   */
  describe("撤销条按「真的改动了哪些」回滚", () => {
    it("已经熟知的词不进改动列表", () => {
      const [already, ...rest] = UNSEEN.slice(0, 3);
      setWordsKnownForeverIds([already], true);

      const changed = setWordsKnownForeverIds([already, ...rest], true);
      expect(changed.sort()).toEqual(rest.sort());
    });

    it("撤销只动这次改过的那些,勾中的既有熟知词原样留着", () => {
      const [already, ...rest] = UNSEEN.slice(0, 3);
      setWordsKnownForeverIds([already], true);
      const changed = setWordsKnownForeverIds([already, ...rest], true);

      // 撤销条上点一下 = 把 changed 反着跑一遍
      setWordsKnownForeverIds(changed, false);

      expect(count("SELECT known_forever FROM progress WHERE word_id = ?", [already])).toBe(1);
      expect(count(
        `SELECT SUM(known_forever) FROM progress WHERE word_id IN (${rest.join(",")})`
      )).toBe(0);
      // 那个本来就熟知的词,它自己那条流水也没被撤销顺手删掉
      expect(count("SELECT COUNT(*) FROM reviews WHERE word_id = ?", [already])).toBe(1);
    });

    it("「放回复习」方向同理:没在队列里的词不进改动列表", () => {
      const ids = UNSEEN.slice(0, 3);
      setWordsKnownForeverIds(ids.slice(0, 2), true);

      const changed = setWordsKnownForeverIds(ids, false);
      expect(changed.sort()).toEqual(ids.slice(0, 2).sort());

      setWordsKnownForeverIds(changed, true);
      expect(count(`SELECT SUM(known_forever) FROM progress WHERE word_id IN (${ids.join(",")})`)).toBe(2);
    });

    it("setWordsKnownForever 还是返回个数 —— 老签名没变", () => {
      expect(setWordsKnownForever(UNSEEN.slice(0, 3), true)).toBe(3);
    });
  });
});
