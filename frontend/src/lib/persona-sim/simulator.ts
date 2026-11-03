import { expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import type initSqlJs from "sql.js";
import type { Database } from "sql.js";
import { ensureSeedData, ensureUserTables } from "../study-core";
import { firstValue, getState, rowsFor, setState, studyDayEnd, today } from "../database/db-utils";
import { familiarityDefaults, getLevelPlanSettings, hydrateLevelPlanPreferences, saveLevelPlanSettings } from "../level-plan";
import { answerLevelAdvance, levelAdvancePrompt } from "../level-advance";
import { JLPT_TARGETS } from "../jlpt/plan";
import { applyExamPreset, applyStudyIntensity, previewCurrentLevelPlan, SECONDS_PER_CARD } from "../daily-plan";
import { getGrammarQuizSession, GRAMMAR_DEFAULT_REVIEW_CAP, PLAN_GRAMMAR_LEVEL, submitGrammarQuizAnswer } from "../grammar-quiz";
import { loadMixedCardData, mixedCardCounts } from "../mixed-cards";
import { answerMixedOther, pickMixedNext, recordMixedWordAnswer, resetMixedSession, type MixedOtherItem } from "../mixed-session";
import { materializeKanjiChars, recordKanjiCharReview, KANJI_CHAR_FSRS } from "../kanji-char-cards";
import { materializeConfusionCards, recordConfusionReview, CONFUSION_FSRS } from "../confusion-cards";
import { ensureGrammarProgressInitialized } from "../grammar-api";
import { ensureProgressInitialized } from "../word-api/bootstrap";
import { pickStage1Next, stage1ProgressCounts } from "../word-api/stage1";
import { advanceDailyRelief, advanceDailyTail, continueTodayPlanStudy, ensureDailyRelief, ensureDailyTail,
  getDailyReliefNext, getDailyTailNext, refreshTodayWordPlan, submitWordAnswer } from "../word-api";
import { defaultStudyPreferences, getEffectiveStudyPreferences, getStudyPreferences, kanaGatePending, levelUnseenContent,
  PLAN_REVIEW_DISABLED, readLevelAdvance } from "../studyPreferences";
import { pendingPriorSql, PRIOR_ENTITIES, priorValidatedToday, readPriorPace } from "../prior-pacing";
import { dailyReviewCap } from "../review-budget";
import { ensureFsrsColumns, GRAMMAR_FSRS, readFsrsState, WORD_FSRS } from "../fsrs-store";
import { retrievability } from "../fsrs-scheduler";
import { nextKanaStep } from "../kana-quiz";
import { deferWordPlanUntilKanaComplete, getAnsweredKana, getKanaStates, kanaComplete, recordKanaAnswer } from "../kana-progress";
import { KANA_WORD_START_DAY, KANA_WORDS_PER_DAY, kanaStudyDay, newWordsToday, recordKanaWordAnswer,
  simpleWords, wordMeaningQuestion, type KanaWord } from "../kana-words";
import type { WordCard } from "../../types/vocabulary";
import type { PlanKind } from "../plan-level-order";
import type { Calibration } from "./calibration";
import { indexSimulation, reuseStatements } from "./harness";
import { baseMinutes, burdenProbability, byKind, dateAt, DAY_MS, KINDS, logNormal, mulberry32, reviewProbability,
  round, seedFor, type CardDay, type Coverage, type Daily, type Persona, type Quota, type Run } from "./model";

const freshKeys = { words: "dailyGoal", grammar: "grammarDailyGoal", kanji: "kanjiDailyGoal", confusion: "confusionDailyGoal" } as const;
const reviewKeys = { words: "reviewCap", grammar: "grammarReviewCap", kanji: "kanjiReviewCap", confusion: "confusionReviewCap" } as const;
const entities = { words: WORD_FSRS, grammar: GRAMMAR_FSRS, kanji: KANJI_CHAR_FSRS, confusion: CONFUSION_FSRS };
const tasks = { words: "stage1_tasks", kanji: "kanji_char_tasks", confusion: "confusion_tasks" };
const emptyCard = (): CardDay => ({ planned: 0, plannedFresh: 0, releasedPrior: 0, answers: 0, fresh: 0, prior: 0,
  review: 0, relearn: 0, backlog: 0, pendingPrior: 0, scheduledRemaining: 0 });

const quotas = (): Record<PlanKind, Quota> => {
  const saved = getStudyPreferences(), effective = getEffectiveStudyPreferences();
  return byKind(k => {
    const savedFresh = saved[freshKeys[k]], effectiveFresh = k === "words" && kanaGatePending() ? 0 : effective[freshKeys[k]];
    const savedReview = saved[reviewKeys[k]], cap = effective[reviewKeys[k]];
    const effectiveReview = k === "words" ? dailyReviewCap(cap) : k === "grammar" && cap === 0
      ? Math.min(GRAMMAR_DEFAULT_REVIEW_CAP, dailyReviewCap(effective.reviewCap)) : cap === 0 ? 1_000_000_000 : cap === PLAN_REVIEW_DISABLED ? 0 : cap;
    const reasons: string[] = [];
    if (effectiveFresh !== savedFresh || cap !== savedReview) {
      if (k === "words" && kanaGatePending() && savedFresh !== effectiveFresh) reasons.push("五十音门槛");
      if (readLevelAdvance()[k === "grammar" ? "grammar" : "words"].pausedAt > 0 && ["words", "grammar"].includes(k) && effectiveFresh !== savedFresh) reasons.push(`${k}：95%暂停封顶`);
      if (!reasons.length) reasons.push("考后恢复覆盖层");
    }
    if (k === "grammar" && cap === 0) reasons.push("语法默认上限min(60,单词上限)");
    if (k === "words" && savedReview > 0 && effectiveReview !== savedReview && cap === savedReview) reasons.push("单词复习硬上限");
    // 0=自动、-1=不限等哨兵的翻译不是擅自改数，另存 effectiveReview 供对账。
    return { savedFresh, effectiveFresh, savedReview, effectiveReview, reasons };
  });
};

const levelOf = (kind: PlanKind, key: string): string => {
  if (kind === "words") return firstValue<string>("SELECT jlpt_level FROM words WHERE id=?", [key], "");
  if (kind === "grammar") return firstValue<string>("SELECT level FROM grammar_points WHERE id=?", [key], "");
  const e = PRIOR_ENTITIES[kind];
  return JLPT_TARGETS[firstValue<number>(`SELECT level_rank FROM ${e.table} WHERE ${e.idColumn}=?`, [key], 99)] ?? "";
};
const coverage = (target: string): Record<PlanKind, Coverage> => byKind(k => {
  const e = PRIOR_ENTITIES[k], rank = JLPT_TARGETS.indexOf(target as typeof JLPT_TARGETS[number]);
  const levels = JLPT_TARGETS.slice(0, rank + 1).map(l => `'${l}'`).join(",");
  const join = k === "words" ? "JOIN words c ON c.id=m.word_id" : k === "grammar" ? "JOIN grammar_points c ON c.id=m.grammar_id" : "";
  const scope = k === "words" ? `(c.jlpt_level IN (${levels}) OR COALESCE(c.jlpt_level,'')='')` : k === "grammar" ? `c.level IN (${levels})` : `m.level_rank<=${rank}`;
  const row = rowsFor(`SELECT COUNT(*) AS total,
    SUM(m.known_forever=1 OR EXISTS(SELECT 1 FROM ${e.reviews} r WHERE r.${e.idColumn}=m.${e.idColumn})) AS seen,
    SUM(m.known_forever=1 OR m.seen_count>0) AS stateSeen FROM ${e.table} m ${join} WHERE ${scope}`)[0];
  const total = Number(row.total), seen = Number(row.seen ?? 0), stateSeen = Number(row.stateSeen ?? 0);
  return { total, seen, percent: total ? round(100 * seen / total) : 100, stateSeen, statePercent: total ? round(100 * stateSeen / total) : 100 };
});

/** 只建真实评分流水，不手填due。前史为固定夹具，避免把随机种子同时变成历史差异。 */
async function lightHistory(start: number) {
  await saveLevelPlanSettings({ startingLevel: "kana", familiarity: byKind(() => 0), target: "N3", examDate: "", planEnabled: false });
  const lists = byKind(k => {
    if (k === "words") return rowsFor("SELECT id AS k FROM words WHERE jlpt_level IN ('N5','N4','N3') OR COALESCE(jlpt_level,'')='' ORDER BY id");
    if (k === "grammar") return rowsFor("SELECT id AS k FROM grammar_points WHERE level IN ('N5','N4','N3') ORDER BY id");
    const e = PRIOR_ENTITIES[k];
    return rowsFor(`SELECT ${e.idColumn} AS k FROM ${e.table} WHERE level_rank<=2 ORDER BY ${e.idColumn}`);
  });
  // 每张卡在前120天分散学习，并于3/14/45天后再答对；四次都走正式评分。
  // 这是偏强的合成记忆，不能用light的积压数冒充真实考后人群。
  const events = KINDS.flatMap(k => lists[k].flatMap((row, i) => [0, 3, 14, 45].map(offset =>
    ({ kind: k, key: String(row.k), day: -120 + i % 70 + offset })))).sort((a, b) => a.day - b.day);
  for (const event of events) {
    vi.setSystemTime(start + event.day * DAY_MS);
    const date = today();
    if (event.kind === "words") {
      setState("phase", "stage1"); setState("phase_date", date); setState("current_card", event.key);
      submitWordAnswer(Number(event.key), "know");
    } else if (event.kind === "grammar") submitGrammarQuizAnswer(PLAN_GRAMMAR_LEVEL, Number(event.key), "know");
    else if (event.kind === "kanji") recordKanjiCharReview(event.key, "know");
    else recordConfusionReview(event.key, "know");
  }
  vi.setSystemTime(start);
  await saveLevelPlanSettings({ startingLevel: "N3", familiarity: familiarityDefaults("N3"), target: "N3", examDate: "", planEnabled: false });
  // 前史建造时的cap=1只为避免每次评分顺带抽整份队列；正式人设恢复默认复习政策。
  saveStudyPrefs({ ...getStudyPreferences(), dailyGoal: defaultStudyPreferences.dailyGoal,
    grammarDailyGoal: defaultStudyPreferences.grammarDailyGoal, kanjiDailyGoal: defaultStudyPreferences.kanjiDailyGoal,
    confusionDailyGoal: defaultStudyPreferences.confusionDailyGoal, reviewCap: defaultStudyPreferences.reviewCap });
}

export interface Environment {
  SQL: Awaited<ReturnType<typeof initSqlJs>>; calibration: Calibration; factory: Uint8Array; livePath: string;
  preferences: Map<string, string>; setDatabase: (db: Database) => void;
  lightFixture?: { bytes: Uint8Array; preferences: [string, string][] };
}
let lightTemplate: Uint8Array | undefined;
let lightPreferences: [string, string][] = [];
export const preparedLightFixture = () => {
  if (!lightTemplate) throw new Error("light前史尚未准备");
  return { bytes: lightTemplate, preferences: lightPreferences };
};

export async function simulate(p: Persona, seed: number, days: number, env: Environment): Promise<Run> {
  const { calibration: cal, SQL } = env;
  const start = cal.start;
  if (p.id === "light" && !lightTemplate && env.lightFixture) {
    lightTemplate = env.lightFixture.bytes; lightPreferences = env.lightFixture.preferences;
  }
  env.preferences.clear();
  vi.setSystemTime(start);
  const appSeed = seedFor(p.id, seed, "app");
  let generator = mulberry32(appSeed), draws = 0;
  const random = () => { draws++; return generator(); };
  const rewind = (count: number) => {
    generator = mulberry32(appSeed); draws = 0;
    for (let i = 0; i < count; i++) random();
  };
  vi.spyOn(Math, "random").mockImplementation(random);
  let db: Database;
  if (p.id === "self") {
    const database = await vi.importActual<typeof import("../database")>("../database");
    await database.importDatabase(new Uint8Array(readFileSync(env.livePath)), { validateBackup: true });
    db = database.getDatabase();
  } else db = new SQL.Database(p.id === "light" && lightTemplate ? lightTemplate : env.factory);
  env.setDatabase(db);
  const driver = db as Database & { create_function(name: string, fn: () => string | number): void };
  driver.create_function("current_timestamp", () => new Date().toISOString());
  driver.create_function("random", () => Math.floor(random() * 2147483648));
  if (p.id === "self") { await ensureSeedData(); hydrateLevelPlanPreferences(); }
  else {
    ensureUserTables();
    if (p.id === "light" && lightTemplate) for (const [key, value] of lightPreferences) env.preferences.set(key, value);
    else saveStudyPrefs(defaultStudyPreferences);
  }
  ensureProgressInitialized(); ensureGrammarProgressInitialized();
  materializeKanjiChars(); materializeConfusionCards();
  for (const kind of KINDS) ensureFsrsColumns(entities[kind]);
  indexSimulation(db);
  let grammarObserved = new Set<string>();
  const statements = reuseStatements(db, params => {
    if (Array.isArray(params)) for (const id of params) grammarObserved.add(String(id));
  });
  try {
    if (p.id !== "self" && !(p.id === "light" && lightTemplate)) {
      if (p.id === "light") {
        saveStudyPrefs({ ...getStudyPreferences(), dailyGoal: 0, grammarDailyGoal: 0, kanjiDailyGoal: 0, confusionDailyGoal: 0, reviewCap: 1 });
        await lightHistory(start);
      } else {
        await saveLevelPlanSettings({ startingLevel: p.start, familiarity: familiarityDefaults(p.start), target: p.target,
          examDate: dateAt(start + p.examDays * DAY_MS), startedOn: today() });
        applyExamPreset(p.target);
        if (p.id === "zero") deferWordPlanUntilKanaComplete(getStudyPreferences().dailyGoal);
      }
    }
    if (p.id === "light" && !lightTemplate) {
      // export会重新打开sql.js连接，先释放语句；模板只存在内存，不写任何学习库。
      statements.release(); lightPreferences = [...env.preferences]; lightTemplate = db.export();
      db.close();
      return simulate(p, seed, days, env);
    }
    if (p.id === "light") expect(getStudyPreferences().reviewCap, "前史临时cap不得带进light人设").toBe(defaultStudyPreferences.reviewCap);
    // 与旧harness相同：裁掉仅供题面展示的大JSON，避免每次评分跨WASM搬运。
    // 取卡资格/优先级不读这些列；以相同随机流及同一事务状态实测对拍。
    const admission = () => {
      const session = getGrammarQuizSession(PLAN_GRAMMAR_LEVEL);
      return { id: session.card?.id, level: session.card?.level, isNew: session.card?.isNew,
        remaining: session.remaining, total: session.total, newQuota: session.newQuota };
    };
    const beforeDraws = draws;
    db.run("SAVEPOINT sim_payload_check");
    const beforeTrim = admission();
    db.run("ROLLBACK TO sim_payload_check"); db.run("RELEASE sim_payload_check");
    db.run("UPDATE grammar_points SET formation='', meaning='', example_jp='', example_meaning='', example_furigana='[]', example_tokens='[]', example_lemmas='[]'");
    rewind(beforeDraws);
    expect(admission(), "展示载荷裁剪不改变真实取卡/配额/剩余数").toEqual(beforeTrim);
    rewind(beforeDraws);
    const initial = {
      settings: getLevelPlanSettings(), quotas: quotas(), targetCoverage: coverage(getStudyPreferences().jlptTarget),
      levels: JLPT_TARGETS.map(level => ({ level,
        words: rowsFor(`SELECT COUNT(*) AS total, SUM(p.seen_count>0 OR p.known_forever=1) AS stateSeen,
          SUM(p.known_forever=1 OR EXISTS(SELECT 1 FROM reviews r WHERE r.word_id=w.id)) AS seen
          FROM words w JOIN progress p ON p.word_id=w.id WHERE w.jlpt_level=?`, [level])[0],
        grammar: rowsFor(`SELECT COUNT(*) AS total, SUM(p.seen_count>0 OR p.known_forever=1) AS stateSeen,
          SUM(p.known_forever=1 OR EXISTS(SELECT 1 FROM grammar_reviews r WHERE r.grammar_id=g.id)) AS seen
          FROM grammar_points g JOIN grammar_progress p ON p.grammar_id=g.id WHERE g.level=?`, [level])[0]
      })), levelAdvance: readLevelAdvance(), priorPace: byKind(k => readPriorPace(k).quota)
    };
    const history = byKind(k => {
      const e = PRIOR_ENTITIES[k];
      return new Set(rowsFor(`SELECT DISTINCT ${e.idColumn} AS k FROM ${e.reviews}`).map(row => String(row.k)));
    });
    const baselines = byKind(k => new Set(rowsFor("SELECT entity_key AS k FROM level_prior_baselines WHERE entity=?", [k]).map(row => String(row.k))));
    const learnedN4 = new Set(p.id === "self" ? rowsFor(`SELECT g.id FROM grammar_points g JOIN grammar_progress p ON p.grammar_id=g.id
      WHERE g.level='N4' AND (p.known_forever=1 OR EXISTS(SELECT 1 FROM grammar_reviews r WHERE r.grammar_id=g.id))`).map(row => String(row.id)) : []);
    const n4Scheduled = new Set<string>(), n4Shown = new Set<string>();
    const result: Run & { initial: typeof initial } = {
      seed, days: [], transitions: [], events: [], initial,
      coverage: { day: 0, date: "", reason: "", cards: coverage(p.target) },
      selfGap: p.id === "self" ? { initiallyLearnedN4: learnedN4.size, neverScheduled: 0, neverShown: 0,
        backfill: readLevelAdvance().grammar.backfill === "N4" ? "库里已选回补N4，保留现状" : levelUnseenContent("grammar", "N4") > 0 ? "等待N3提示" : "不适用：N4无未学内容" } : null
    };
    const attendance = mulberry32(seedFor(p.id, seed, "attendance")), time = mulberry32(seedFor(p.id, seed, "time")), answerRandom = mulberry32(seedFor(p.id, seed, "answers"));
    let probability = p.absence;
    const lastFreshLevel = byKind(() => "");
    const pausedOnce = new Set<"words" | "grammar">();
    const handlePrompts = (day: number) => {
      for (let tries = 0; tries < 10; tries++) {
        const prompt = levelAdvancePrompt();
        if (!prompt) return;
        const choice = p.id === "self" && prompt.kind === "grammar" ? prompt.backfill === "N4" ? "back" : "pause"
          : p.id === "struggle" && !pausedOnce.has(prompt.kind) ? "pause" : "up";
        if (choice === "pause") pausedOnce.add(prompt.kind);
        answerLevelAdvance(prompt.kind, prompt.level, choice);
        result.transitions.push({ seed, day, kind: prompt.kind, type: "prompt", from: prompt.level,
          to: choice === "up" ? prompt.next : choice === "back" ? prompt.backfill! : prompt.level, choice });
        if (result.selfGap && prompt.kind === "grammar") result.selfGap.backfill = choice === "back" ? "通过真实提示回补N4" : "不适用：提示无可回补N4";
      }
      throw new Error("升级提示未消退");
    };
    for (let day = 1; day <= days; day++) {
      vi.setSystemTime(start + (day - 1) * DAY_MS);
      const at = Date.now(), date = today(), base = baseMinutes(p, day, at);
      if (day === 1 && p.id === "light") {
        await saveLevelPlanSettings({ ...getLevelPlanSettings()!, planEnabled: false });
        applyStudyIntensity("light");
        result.events.push({ day, type: "plan", value: "暂不备考 + STUDY_INTENSITY.light" });
      }
      handlePrompts(day);
      const u = attendance(), fixedHoliday = p.id === "break" && day >= 21 && day <= 34;
      const absence: Daily["absence"] = base === 0 ? "weekend" : fixedHoliday ? "holiday" : u < p.absence ? "base" : u < probability ? "burden" : "none";
      const sampled = p.id === "self" ? cal.activeMinutes[Math.floor(time() * cal.activeMinutes.length)] : base;
      const available = Math.floor(sampled * logNormal(time) * 60);
      const d: Daily = { seed, day, date, baseMinutes: round(base), availableMinutes: available / 60,
        absenceProbability: round(probability), active: absence === "none", absence, shouldMinutes: 0, actualMinutes: 0,
        cards: byKind(emptyCard), quotas: quotas(), feasible: null,
        kana: { planned: 0, taught: 0, wordTaught: 0, answers: 0, mastered: 0 }, relief: 0, tail: 0 };
      result.days.push(d);
      db.run("ANALYZE");
      grammarObserved = new Set();
      setState("phase", "stage1"); setState("phase_date", date);
      stage1ProgressCounts(); mixedCardCounts(db, date);
      ensureDailyRelief(); ensureDailyTail();
      const grammar = getGrammarQuizSession(PLAN_GRAMMAR_LEVEL);
      const plannedIds = byKind(k => k === "grammar" ? new Set(grammarObserved)
        : new Set(rowsFor(`SELECT ${PRIOR_ENTITIES[k].idColumn} AS k FROM ${tasks[k]} WHERE reviewed_on=?`, [date]).map(row => String(row.k))));
      for (const k of KINDS) {
        d.cards[k].planned = k === "grammar" ? grammar.remaining : plannedIds[k].size;
        d.cards[k].plannedFresh = [...plannedIds[k]].filter(key => !history[k].has(key) && !baselines[k].has(key)).length;
        d.cards[k].releasedPrior = [...plannedIds[k]].filter(key => !history[k].has(key) && baselines[k].has(key)).length;
      }
      const relief = JSON.parse(getState("daily_relief_v2", "{}")) as { wordIds?: number[] };
      const tail = JSON.parse(getState("daily_tail_v2", "{}")) as { wordIds?: number[] };
      d.shouldMinutes = KINDS.reduce((sum, k) => sum + d.cards[k].planned * SECONDS_PER_CARD[k], 0) / 60
        + ((relief.wordIds?.length ?? 0) + (tail.wordIds?.length ?? 0)) * SECONDS_PER_CARD.words / 60;
      const settings = getLevelPlanSettings();
      if (getStudyPreferences().jlptPlanEnabled && settings?.examDate) {
        d.feasible = previewCurrentLevelPlan({ startingLevel: settings.startingLevel, familiarity: settings.familiarity,
          target: settings.target, examDate: new Date(`${settings.examDate}T12:00:00`), startedOn: new Date(`${settings.startedOn}T12:00:00`), kanaCompleted: kanaComplete() }).feasible;
      }
      let spent = 0;
      const spend = (seconds: number) => {
        if (spent + seconds > available) return false;
        spent += seconds; vi.setSystemTime(at + spent * 1000); return true;
      };
      const seenToday = byKind(() => new Set<string>());
      const score = (kind: PlanKind, key: string) => {
        const c = d.cards[kind], repeat = seenToday[kind].has(key);
        const lane = history[kind].has(key) ? "review" : baselines[kind].has(key) ? "prior" : "fresh";
        let prob = 0.85;
        if (!repeat) {
          if (lane === "fresh") prob = p.first[kind];
          else if (lane === "prior") prob = p.prior;
          else {
            const state = readFsrsState(key, entities[kind]);
            if (state) prob = reviewProbability(retrievability(state, new Date()), p.coefficient[kind], (spent - SECONDS_PER_CARD[kind]) / 60);
            else {
              if (cal.method !== "interval-buckets") throw new Error(`${kind}复习卡缺FSRS状态`);
              prob = 0.4;
            }
          }
          c[lane]++;
          seenToday[kind].add(key);
          if (lane === "fresh") {
            const level = levelOf(kind, key), previous = lastFreshLevel[kind];
            if (previous && JLPT_TARGETS.indexOf(level as typeof JLPT_TARGETS[number]) > JLPT_TARGETS.indexOf(previous as typeof JLPT_TARGETS[number])) result.transitions.push({ seed, day, kind, type: "content", from: previous, to: level });
            if (level) lastFreshLevel[kind] = level;
          }
        } else c.relearn++;
        c.answers++;
        if (kind === "grammar") n4Shown.add(key);
        return answerRandom() < prob ? "know" : "forgot";
      };
      if (p.id === "zero" && !kanaComplete()) {
        const states = getKanaStates();
        d.kana.planned = Object.values(states).filter(s => !["mastered", "passed"].includes(s.stage)).length;
        d.kana.mastered = Object.values(states).filter(s => s.stage === "mastered").length;
        d.shouldMinutes += d.kana.planned * SECONDS_PER_CARD.words / 60;
        if (kanaStudyDay() >= KANA_WORD_START_DAY) {
          const planned = Math.min(KANA_WORDS_PER_DAY - newWordsToday(), simpleWords(getAnsweredKana()).length);
          d.cards.words.planned += planned; d.cards.words.plannedFresh += planned;
          d.shouldMinutes += planned * SECONDS_PER_CARD.words / 60;
        }
      }
      if (d.active && p.id === "zero" && !kanaComplete()) {
        let states = getKanaStates();
        const introduced = getAnsweredKana(), recent: string[] = [];
        const wordsOn = kanaStudyDay() >= KANA_WORD_START_DAY, taught = new Set<number>();
        const morningNew = newWordsToday();
        let queue: { word: KanaWord; after: number; retry: boolean }[] = [], turn = 0;
        while (!kanaComplete()) {
          const step = nextKanaStep(states, introduced, recent);
          if (!step) break;
          // KanaPrimer.pickStep是UI私有函数：照其轮换/隔3题/最多重试1次，选词与记账仍调真实入口。
          if (wordsOn) {
            turn++;
            let due = queue.find(item => item.after <= turn);
            if (!due && morningNew + taught.size < KANA_WORDS_PER_DAY
              && (step.kind === "rest" || random() < 0.3 + 0.5 * Object.values(states).filter(s => s.stage === "mastered").length / 92)) {
              const word = simpleWords(introduced).find(word => !taught.has(word.id));
              if (word) {
                if (!spend(SECONDS_PER_CARD.words)) break;
                taught.add(word.id); d.kana.wordTaught++;
                queue.push({ word, after: turn + 3, retry: false });
                continue;
              }
            }
            if (!due && step.kind === "rest") due = queue[0];
            if (due) {
              wordMeaningQuestion(due.word);
              if (!spend(SECONDS_PER_CARD.words)) break;
              queue = queue.filter(item => item !== due);
              const correct = score("words", String(due.word.id)) === "know";
              recordKanaWordAnswer(due.word.id, correct);
              if (!correct && !due.retry) queue.push({ word: due.word, after: turn + 3, retry: true });
              continue;
            }
          }
          if (step.kind === "rest" || !spend(SECONDS_PER_CARD.words)) break;
          if (step.kind === "teach") {
            introduced.add(step.teach.symbol); recent.push(step.teach.symbol);
            if (recent.length > 2) recent.shift(); d.kana.taught++;
          }
          else {
            // 五十音没有四类的P表：首见用单词首答率，其后练习0.85；明确记录这项近似。
            const symbol = step.question.symbol;
            const correct = answerRandom() < (states[symbol].stage === "new" ? p.first.words : 0.85);
            const result = recordKanaAnswer(symbol, correct);
            states = result.states;
            if (result.completed) refreshTodayWordPlan();
            recent.push(symbol); if (recent.length > 2) recent.shift(); d.kana.answers++;
          }
        }
        d.kana.mastered = Object.values(states).filter(s => s.stage === "mastered").length;
        if (kanaComplete()) result.events.push({ day, type: "kana-complete", value: 92 });
      }
      if (d.active) {
        for (let card = getDailyReliefNext(); card && spend(SECONDS_PER_CARD.words); card = getDailyReliefNext()) {
          advanceDailyRelief(); d.relief++;
        }
        resetMixedSession();
        let word: WordCard | null = spent < available ? continueTodayPlanStudy().card : null;
        const finishTail = () => {
          // 压轴是独立收尾，不参加每5词轮换；答错由真实入口最多重排两次。
          for (let card = getDailyTailNext(); card && spend(SECONDS_PER_CARD.words); card = getDailyTailNext()) {
            const answer = score("words", String(card.id));
            submitWordAnswer(card.id, answer); advanceDailyTail({ requeue: answer !== "know" }); d.tail++;
          }
        };
        if (!word && spent < available) finishTail();
        let next: "word" | MixedOtherItem | null = spent < available ? pickMixedNext({ word: Boolean(word) }) : null;
        while (next) {
          const kind = next === "word" ? "words" : next.kind;
          if (!spend(SECONDS_PER_CARD[kind])) break;
          if (next === "word") {
            const key = String(word!.id);
            const answer = score("words", key);
            setState("current_card", key);
            word = submitWordAnswer(Number(key), answer).card;
            recordMixedWordAnswer();
            // 与WordStudy.afterWordAnswered相同：即使最后一张单词答完也先轮一次别的卡。
            next = pickMixedNext({ word: true, afterWord: true });
            if (next === "word" && !word) {
              finishTail();
              next = pickMixedNext({ word: false });
            }
          } else {
            const key = next.kind === "grammar" ? String(next.card.id) : next.kind === "kanji" ? next.card.char : next.card.groupKey;
            answerMixedOther(next, score(next.kind, key));
            if (!word) word = pickStage1Next();
            if (!word) finishTail();
            next = pickMixedNext({ word: Boolean(word) });
          }
        }
      }
      d.actualMinutes = spent / 60;
      const end = studyDayEnd().toISOString();
      for (const k of KINDS) {
        const e = PRIOR_ENTITIES[k], c = d.cards[k];
        const row = rowsFor(`SELECT SUM(NOT ${pendingPriorSql(k, `${e.table}.${e.idColumn}`)}) AS backlog,
          SUM(${pendingPriorSql(k, `${e.table}.${e.idColumn}`)}) AS pending FROM ${e.table}
          WHERE known_forever=0 AND seen_count>0 AND (fsrs_due IS NULL OR fsrs_due<=?)`, [end])[0];
        c.backlog = Number(row.backlog ?? 0); c.pendingPrior = Number(row.pending ?? 0);
        const actual = rowsFor(`SELECT COUNT(*) AS answers, COUNT(DISTINCT ${e.idColumn}) AS total FROM ${e.reviews} WHERE reviewed_on=?`, [date])[0];
        expect(actual, `${p.id}/${seed}/D${day}/${k}流水对账`).toEqual({ answers: c.answers, total: seenToday[k].size });
        expect(priorValidatedToday(k)).toBe(c.prior);
        for (const key of seenToday[k]) history[k].add(key);
        if (k === "grammar") c.scheduledRemaining = getGrammarQuizSession(PLAN_GRAMMAR_LEVEL).remaining;
        else c.scheduledRemaining = firstValue<number>(`SELECT COUNT(*) FROM ${tasks[k]} t JOIN ${e.table} m ON m.${e.idColumn}=t.${e.idColumn}
          WHERE t.reviewed_on=? AND m.known_forever=0 AND (m.fsrs_due IS NULL OR m.fsrs_due<=? OR m.fsrs_state IN (0,1,3))`, [date, end], 0);
      }
      for (const key of grammarObserved) if (learnedN4.has(key)) n4Scheduled.add(key);
      if (spent > available) throw new Error("超出时间预算");
      statements.verifyCounts(date);
      if (day % 10 === 0) process.stdout.write(`${p.id} seed=${seed} D${day}/${days}\n`);
      handlePrompts(day);
      probability = burdenProbability(p.absence, d.shouldMinutes, base || p.minutes);
      const exam = getStudyPreferences().jlptExamDate;
      if (date === exam || day === days && !result.coverage.day) result.coverage = {
        day, date, reason: date === exam ? "examDay" : "lastDay", cards: coverage(getStudyPreferences().jlptTarget)
      };
    }
    if (result.selfGap) {
      result.selfGap.neverScheduled = learnedN4.size - n4Scheduled.size;
      result.selfGap.neverShown = [...learnedN4].filter(key => !n4Shown.has(key)).length;
    }
    return result;
  } finally {
    await vi.dynamicImportSettled();
    statements.release();
    try { db.close(); } catch { /* 模板创建路径已关闭原实例 */ }
  }
}

// 用单独名字避免夹具的偏好与生产默认对象共享引用。
import { saveStudyPreferences as saveStudyPrefs } from "../studyPreferences";
export { loadMixedCardData };
