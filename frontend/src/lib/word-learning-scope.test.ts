import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import initSqlJs, { type Database } from "sql.js";
import content from "../data/jlpt_collocation_content.json";

let db: Database;
let SQL: Awaited<ReturnType<typeof initSqlJs>>;
let seed: Uint8Array;
const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key)
});
vi.stubGlobal("window", { dispatchEvent: () => true });
vi.mock("./database", () => ({ getDatabase: () => db }));
vi.mock("./storage", () => ({ scheduleSave: vi.fn(), requestFullSnapshot: vi.fn() }));
vi.mock("./progress-events", () => ({ notifyProgressUpdated: vi.fn() }));

import { firstValue, rowsFor, today } from "./study-core";
import { ensureProgressInitialized } from "./word-api/bootstrap";
import { createStage1Tasks, pickStage1Next } from "./word-api/stage1";
import { getWordStats } from "./word-api/stats";
import { fsrsDueWordIds } from "./fsrs-store";
import { defaultStudyPreferences, getStudyPreferences, levelUnseenContent, saveStudyPreferences } from "./studyPreferences";
import { levelAdvancePrompt } from "./level-advance";
import { newWordEligibleSql, wordLearningScopeSql } from "./word-learning-scope";
import { collocationTier, wordCollocationTier } from "./collocation-tier";
import { remainingPlanWords } from "./daily-plan";
import { shouldSpellWord } from "./spelling/study";
import { getJlptPlanStatus } from "./jlpt/status";
import { applyLevelStartingPoint } from "./level-plan";
import { ensureDirectionCardIds, KANJI, REVERSE } from "./word-api/directions";
import { setPickedWords, pickedWordIds } from "./word-api/picked";
import { startVocabTest } from "./vocab-test";
import { getMasteryAnalytics } from "./analytics/stats";

const CORE = 50001, NORMAL = 50002, COMMON = 50003, OPTIONAL = 50004;
const toggle = (includeOptionalExpressions: boolean) => storage.set("mn-study-preferences", JSON.stringify({
  ...defaultStudyPreferences, jlptTarget: "N3", dailyGoal: 4, includeOptionalExpressions
}));
const tasks = () => rowsFor("SELECT word_id FROM stage1_tasks WHERE reviewed_on = ? AND task_type = 'new' ORDER BY order_index", [today()])
  .map((row) => Number(row.word_id));
const count = (predicate: string) => firstValue<number>(`SELECT COUNT(*) FROM words w LEFT JOIN progress p ON p.word_id=w.id WHERE w.id>=50001 AND ${predicate}`, [], 0);

describe("固定搭配分档的共享学习口径", () => {
  beforeAll(async () => {
    // 用 Taro sql-js.weapp.cjs 实际引用的胶水和 wasm，不能拿 npm 版通过冒充小程序 JSON1 可用。
    const initWeappSqlJs = createRequire(import.meta.url)("../../../wechat-miniprogram/src/vendor/sql-wasm.js") as
      (options: { wasmBinary: Uint8Array }) => ReturnType<typeof initSqlJs>;
    SQL = await initWeappSqlJs({ wasmBinary: readFileSync(new URL("../../../wechat-miniprogram/src/assets/sql-wasm.wasm", import.meta.url)) });
    db = new SQL.Database(new Uint8Array(readFileSync(new URL("../../public/nihongo.db", import.meta.url))));
    ensureProgressInitialized();
    // 只留下四张可学习卡，沿用出厂表结构，避免测试自己发明一份调度 schema。
    db.run("UPDATE words SET jlpt_level='N1'");
    db.run("UPDATE progress SET known_forever=1");
    for (const [id, tier] of [[CORE, "core"], [COMMON, "common"], [OPTIONAL, "optional"]] as const) {
      const entry = content.entries.find((entry) => entry.level === "N3" && collocationTier(entry) === tier)!;
      db.run("INSERT INTO words (id,kanji,kana,meaning,pos,jlpt_level,importance,shuffle_rank,example_jp,example_meaning,collocation_tier) VALUES (?,?,?,?,'固定搭配','N3',3,0,'','',?)", [id, entry.surface, entry.kana, entry.meaning, entry.t ?? 1]);
    }
    db.run("INSERT INTO words (id,kanji,kana,meaning,pos,jlpt_level,importance,shuffle_rank,example_jp,example_meaning) VALUES (?, '通常テスト','つうじょうてすと','普通词','名词','N3',10,0,'','')", [NORMAL]);
    db.run("INSERT INTO progress (word_id) VALUES (?), (?), (?), (?)", [CORE, NORMAL, COMMON, OPTIONAL]);
    seed = db.export();
    db.close();
  });
  beforeEach(() => {
    db = new SQL.Database(seed);
    storage.clear();
    toggle(false);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 2, 10, 0, 0)); // 本地时间 10:00：不依赖运行机的时区（写成 +08:00 时 UTC 的 CI 上是 02:00，落在凌晨 4 点前一天）
  });
  afterEach(async () => { await vi.dynamicImportSettled(); vi.useRealTimers(); db.close(); });

  it("老偏好默认关闭，规范化并通过现有读写保存布尔值", () => {
    storage.clear();
    expect(getStudyPreferences().includeOptionalExpressions).toBe(false);
    saveStudyPreferences({ ...getStudyPreferences(), includeOptionalExpressions: true });
    expect(getStudyPreferences().includeOptionalExpressions).toBe(true);
    storage.set("mn-study-preferences", JSON.stringify({ includeOptionalExpressions: "false" }));
    expect(getStudyPreferences().includeOptionalExpressions).toBe(false);
  });
  it("小程序实际 wasm 支持档位集合使用的 json_each", () => {
    expect(firstValue<string>("SELECT json_group_array(value) FROM json_each('[1,2,3]')", [], "")).toBe("[1,2,3]");
  });
  it("NULL 固定搭配按 common 排序且不当作 optional 隐藏", () => {
    db.run("UPDATE words SET collocation_tier=NULL WHERE id=?", [COMMON]);
    expect(wordCollocationTier(rowsFor("SELECT pos,collocation_tier FROM words WHERE id=?", [COMMON])[0])).toBe("common");
    createStage1Tasks(today());
    expect(tasks()).toEqual([NORMAL, CORE, COMMON]);
    expect(count(newWordEligibleSql())).toBe(3);
    toggle(true);
    createStage1Tasks(today());
    expect(tasks()).toEqual([NORMAL, CORE, COMMON, OPTIONAL]);
  });
  it("同形非固定搭配即使列值为 optional 也不隐藏或改变普通词排序", () => {
    db.run("UPDATE words SET kanji=(SELECT kanji FROM words WHERE id=?), kana=(SELECT kana FROM words WHERE id=?), collocation_tier=2 WHERE id=?", [OPTIONAL, OPTIONAL, NORMAL]);
    createStage1Tasks(today());
    expect(tasks()).toEqual([NORMAL, CORE, COMMON]);
    expect(count(newWordEligibleSql())).toBe(3);
  });
  it("关闭时普通词与独立搭配名额分开入队，不含 optional，首次出题仍按档位", () => {
    createStage1Tasks(today());
    expect(tasks()).toEqual([NORMAL, CORE, COMMON]);
    expect(count(newWordEligibleSql())).toBe(3);
    expect(pickStage1Next(new Set(), { deterministic: true })?.id).toBe(CORE);
  });
  it("打开时 optional 进入第三个搭配名额，实际首次出题顺序在 common 之后", () => {
    toggle(true);
    createStage1Tasks(today());
    expect(tasks()).toEqual([NORMAL, CORE, COMMON, OPTIONAL]);
    const picked: number[] = [];
    for (let i = 0; i < 4; i++) {
      const card = pickStage1Next(new Set(), { deterministic: true })!;
      picked.push(card.id);
      db.run("UPDATE progress SET known_forever=1 WHERE word_id=?", [card.id]);
    }
    expect(picked).toEqual([CORE, NORMAL, COMMON, OPTIONAL]);
  });
  it("关闭后清理当天旧队列，保留答过的 optional，并回填空出的新词名额", () => {
    toggle(true);
    storage.set("mn-study-preferences", JSON.stringify({ ...getStudyPreferences(), dailyGoal: 2 }));
    db.run("INSERT INTO stage1_tasks (reviewed_on,word_id,task_type,order_index) VALUES (?,?,'new',1)", [today(), OPTIONAL]);
    toggle(false);
    createStage1Tasks(today());
    expect(tasks()).toEqual([NORMAL, CORE, COMMON]);
    db.run("UPDATE progress SET seen_count=1 WHERE word_id=?", [OPTIONAL]);
    db.run("INSERT INTO stage1_tasks (reviewed_on,word_id,task_type,order_index) VALUES (?,?,'new',4)", [today(), OPTIONAL]);
    createStage1Tasks(today());
    expect(tasks()).toContain(OPTIONAL);
  });
  it.each(["seen", "fsrs", "review"])("已经有 %s 的 optional 关掉开关仍到期复习，不吃新词名额", (signal) => {
    if (signal === "seen") db.run("UPDATE progress SET seen_count=1 WHERE word_id=?", [OPTIONAL]);
    if (signal === "fsrs") db.run("UPDATE progress SET fsrs_state=2, fsrs_due='2026-11-01T00:00:00.000Z' WHERE word_id=?", [OPTIONAL]);
    if (signal === "review") db.run("INSERT INTO reviews (word_id, answer, score_after, reviewed_on) VALUES (?,'know',0,'2026-11-01')", [OPTIONAL]);
    expect(count(wordLearningScopeSql())).toBe(4);
    expect(fsrsDueWordIds(10)).toContain(OPTIONAL);
    createStage1Tasks(today());
    expect(tasks()).not.toContain(OPTIONAL);
    expect(rowsFor("SELECT word_id FROM stage1_tasks WHERE task_type='review'").map((row) => Number(row.word_id))).toContain(OPTIONAL);
  });
  it("本级学完只看普通词，搭配开关及已学搭配不影响完成", () => {
    db.run("UPDATE progress SET seen_count=1 WHERE word_id IN (?,?,?)", [CORE, NORMAL, COMMON]);
    expect(levelAdvancePrompt()).toMatchObject({ kind: "words", level: "N3", percent: 100 });
    expect(levelUnseenContent("words", "N3")).toBe(0);
    toggle(true);
    expect(levelAdvancePrompt()).toMatchObject({ percent: 100 });
    expect(levelUnseenContent("words", "N3")).toBe(0);
    db.run("UPDATE progress SET seen_count=1 WHERE word_id=?", [OPTIONAL]);
    toggle(false);
    expect(levelAdvancePrompt()).toMatchObject({ percent: 100 });
  });
  it("首页与备考覆盖总量保留搭配，普通词计划缺口不受搭配开关影响", () => {
    expect(getWordStats().unseenCount).toBe(3);
    expect(remainingPlanWords("kana", "N3")).toBe(1);
    const off = getJlptPlanStatus().coverage.words.total;
    expect(remainingPlanWords("kana", "N3", undefined, true)).toBe(1);
    toggle(true);
    expect(getWordStats().unseenCount).toBe(4);
    expect(remainingPlanWords("kana", "N3")).toBe(1);
    expect(getJlptPlanStatus().coverage.words.total).toBe(off + 1);
  });
  it("optional 不出内联拼写，保留普通词拼写与已有 always_spell 标记", () => {
    db.run("INSERT INTO spelling_memory (word_id, always_spell) VALUES (?,1), (?,1)", [OPTIONAL, NORMAL]);
    expect(shouldSpellWord(OPTIONAL, true, true, "stage1")).toBe(false);
    expect(shouldSpellWord(NORMAL, true, true, "stage1")).toBe(true);
    expect(firstValue<number>("SELECT always_spell FROM spelling_memory WHERE word_id=?", [OPTIONAL], 0)).toBe(1);
  });
  it("开关打开后补足当天尚空的名额，不用 C 再改调度器", () => {
    createStage1Tasks(today());
    expect(tasks()).toHaveLength(3);
    toggle(true);
    createStage1Tasks(today());
    expect(tasks()).toEqual([NORMAL, CORE, COMMON, OPTIONAL]);
  });
  it("打开偏好的冷启动也回填今日已答任务，不能把完成过的名额补成额外新词", () => {
    toggle(true);
    db.run("INSERT INTO reviews (word_id,answer,score_after,reviewed_on) VALUES (?,'know',0,?)", [OPTIONAL, today()]);
    db.run("UPDATE progress SET seen_count=1,fsrs_due='2099-01-01' WHERE word_id=?", [OPTIONAL]);
    createStage1Tasks(today());
    expect(tasks()).toEqual([OPTIONAL, NORMAL, CORE, COMMON]);
    expect(tasks()).toHaveLength(4);
  });
  it("起点先验不激活关闭的未学 optional，也不覆盖已有 FSRS", async () => {
    const settings = { startingLevel: "N3" as const, target: "N3" as const, familiarity: { words: 75, grammar: 0, kanji: 0, confusion: 0 }, examKind: "jlpt" as const, examDate: "2026-12-06", startedOn: today() };
    db.run("UPDATE progress SET fsrs_state=2,fsrs_stability=123,fsrs_due='2099-01-01' WHERE word_id=?", [COMMON]);
    await applyLevelStartingPoint(settings);
    expect(firstValue<number>("SELECT seen_count FROM progress WHERE word_id=?", [OPTIONAL], 0)).toBe(0);
    expect(firstValue<number>("SELECT fsrs_stability FROM progress WHERE word_id=?", [COMMON], 0)).toBe(123);
    toggle(true);
    await applyLevelStartingPoint({ ...settings, familiarity: { ...settings.familiarity, words: 76 } });
    expect(firstValue<number>("SELECT seen_count FROM progress WHERE word_id=?", [OPTIONAL], 0)).toBe(1);
  });
  it("optional 不新建读音产出卡，反向认读仍可建；已有方向记录不删除", () => {
    db.run("UPDATE progress SET seen_count=1 WHERE word_id=?", [OPTIONAL]);
    expect(ensureDirectionCardIds(KANJI, 10)).not.toContain(OPTIONAL);
    expect(ensureDirectionCardIds(REVERSE, 10)).toContain(OPTIONAL);
    expect(firstValue<number>("SELECT COUNT(*) FROM reverse_memory WHERE word_id=?", [OPTIONAL], 0)).toBe(1);
  });
  it("自选清单和新词汇量测验也共用口径；切开关不销毁自选原始清单", () => {
    setPickedWords([CORE, OPTIONAL]);
    expect(pickedWordIds()).toEqual([CORE]);
    expect(startVocabTest(() => 0.3).populationByLevel.N3).toBe(3);
    toggle(true);
    expect(pickedWordIds()).toEqual([CORE, OPTIONAL]);
    expect(startVocabTest(() => 0.3).populationByLevel.N3).toBe(4);
  });
  it("掌握度分析的级别总量也排除未学 optional，真实历史分子照常保留", () => {
    const n3 = () => getMasteryAnalytics().byLevel.find((row) => row.level === "N3")!;
    expect(n3()).toMatchObject({ total: 3, studied: 0 });
    toggle(true);
    expect(n3().total).toBe(4);
    toggle(false);
    db.run("UPDATE progress SET seen_count=1 WHERE word_id=?", [OPTIONAL]);
    expect(n3()).toMatchObject({ total: 4, studied: 1 });
  });
});
