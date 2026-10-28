import { getDatabase } from "./database";
import { getState, oncePerDatabase, rowsFor, setState, today } from "./database/db-utils";
import { ensureFsrsColumns, recordFsrsReview, type FsrsEntity } from "./fsrs-store";
import { getStudyPreferences, saveStudyPreferences } from "./studyPreferences";
import { notifyProgressUpdated } from "./progress-events";
import { requestFullSnapshot, scheduleSave } from "./storage";

export const KANA = [
  ["あ","a"],["い","i"],["う","u"],["え","e"],["お","o"],["か","ka"],["き","ki"],["く","ku"],["け","ke"],["こ","ko"],
  ["さ","sa"],["し","shi"],["す","su"],["せ","se"],["そ","so"],["た","ta"],["ち","chi"],["つ","tsu"],["て","te"],["と","to"],
  ["な","na"],["に","ni"],["ぬ","nu"],["ね","ne"],["の","no"],["は","ha"],["ひ","hi"],["ふ","fu"],["へ","he"],["ほ","ho"],
  ["ま","ma"],["み","mi"],["む","mu"],["め","me"],["も","mo"],["や","ya"],["ゆ","yu"],["よ","yo"],["ら","ra"],["り","ri"],
  ["る","ru"],["れ","re"],["ろ","ro"],["わ","wa"],["を","wo"],["ん","n"],
  ["ア","a"],["イ","i"],["ウ","u"],["エ","e"],["オ","o"],["カ","ka"],["キ","ki"],["ク","ku"],["ケ","ke"],["コ","ko"],
  ["サ","sa"],["シ","shi"],["ス","su"],["セ","se"],["ソ","so"],["タ","ta"],["チ","chi"],["ツ","tsu"],["テ","te"],["ト","to"],
  ["ナ","na"],["ニ","ni"],["ヌ","nu"],["ネ","ne"],["ノ","no"],["ハ","ha"],["ヒ","hi"],["フ","fu"],["ヘ","he"],["ホ","ho"],
  ["マ","ma"],["ミ","mi"],["ム","mu"],["メ","me"],["モ","mo"],["ヤ","ya"],["ユ","yu"],["ヨ","yo"],["ラ","ra"],["リ","ri"],
  ["ル","ru"],["レ","re"],["ロ","ro"],["ワ","wa"],["ヲ","wo"],["ン","n"]
] as const;

// Share this across Web and Mini Program; separate copies left the Mini Program answer first.
export const kanaQuizChoices = (index: number, attempt = 0): string[] => {
  const options = new Set<string>([KANA[index][1]]);
  for (let offset = 7; options.size < 4; offset += 11) options.add(KANA[(index + offset) % KANA.length][1]);
  const shuffled = [...options];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = (Math.floor(Math.random() * (i + 1)) + attempt) % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

// 原生小程序（已停止维护）用的简单出题。网页和 Taro 走 kana-quiz.ts 的 nextKanaStep（先教再考、四种题）。
// 出哪个字。原来是 findIndex 取表序第一个没学会的，同一个字连出两遍就算「连对两次」，等于没考。
// 现在：在表序最前的 8 个没学会的字里随机挑（新字逐步进来，又和刚学的混着考），
// 约四分之一的题抽已学会的字回炉（答错就清零、重新算没学会），且不连出同一个字。
export const pickKanaIndex = (progress: KanaProgress, previous?: string, random = Math.random): number | null => {
  const pending = KANA.flatMap(([kana], i) => (progress[kana] ?? 0) < 2 ? [i] : []);
  if (!pending.length) return null;
  const notPrevious = (list: number[]) => list.filter((i) => KANA[i][0] !== previous);
  const window = notPrevious(pending.slice(0, 8));
  const review = notPrevious(KANA.flatMap(([kana], i) => (progress[kana] ?? 0) >= 2 ? [i] : []));
  const pool = review.length && (!window.length || random() < 0.25) ? review : window.length ? window : pending;
  return pool[Math.floor(random() * pool.length)];
};

const WORD_GOAL_KEY = "kana_deferred_word_goal";
const KANA_FSRS: FsrsEntity = { table: "kana_memory", idColumn: "symbol", eligible: "1=1" };

export type KanaProgress = Record<string, number>;

const ensureKanaRows = () => oncePerDatabase("kana-rows", () => {
  const db = getDatabase();
  for (const [symbol] of KANA) db.run("INSERT OR IGNORE INTO kana_memory (symbol) VALUES (?)", [symbol]);
  ensureFsrsColumns(KANA_FSRS);
});

// 掌握口径（2026-10-28 用户定：「五十音再怎么也该有三天」「前一天的学会打回重来」）：
// 一个字要在三个不同的日子都过关才算掌握，所以最快三天学完。过关 = 第一次学的那天连对两次；之后每天答对一次。
// 当天过关只算「今天会了」，第二天打回成待重考，再答对才回来。任何一次答错都清零，从头算三天。
// 只看作答流水 kana_reviews：两台设备的流水合并后结论一样，不靠 correct_streak 这种会被覆盖的列。
// 和单词的 FSRS 完全分开：kana_memory 自己一张表，不进任何单词 / 语法的到期数和复习队列。
export type KanaStage = "new" | "learning" | "review" | "passed" | "mastered";
export type KanaState = { stage: KanaStage; days: number; todayCorrect: number; masteredOn?: string };
export const KANA_MASTERY_DAYS = 3;

export const kanaStateFrom = (reviews: ReadonlyArray<{ answer: string; reviewed_on: string }>, day: string): KanaState => {
  let days: string[] = [];
  let runDay = "";
  let run = 0;
  for (const review of reviews) {
    if (review.reviewed_on !== runDay) { runDay = review.reviewed_on; run = 0; }
    if (review.answer !== "know") { days = []; run = 0; continue; }
    run += 1;
    if (!days.includes(review.reviewed_on) && run >= (days.length === 0 ? 2 : 1)) days.push(review.reviewed_on);
  }
  const todayCorrect = runDay === day ? run : 0;
  const stage: KanaStage = days.length >= KANA_MASTERY_DAYS ? "mastered"
    : days.includes(day) ? "passed"
    : !reviews.length ? "new"
    : days.length === 0 ? "learning" : "review";
  return { stage, days: days.length, todayCorrect, masteredOn: stage === "mastered" ? days[KANA_MASTERY_DAYS - 1] : undefined };
};

export const getKanaStates = (day = today()): Record<string, KanaState> => {
  ensureKanaRows();
  const bySymbol = new Map<string, { answer: string; reviewed_on: string }[]>();
  for (const row of rowsFor("SELECT symbol, answer, reviewed_on FROM kana_reviews ORDER BY reviewed_at, id")) {
    const list = bySymbol.get(String(row.symbol)) ?? [];
    list.push({ answer: String(row.answer), reviewed_on: String(row.reviewed_on) });
    bySymbol.set(String(row.symbol), list);
  }
  return Object.fromEntries(KANA.map(([kana]) => [kana, kanaStateFrom(bySymbol.get(kana) ?? [], day)]));
};

// correct_streak 列沿用老含义「>= 2 = 掌握」（原生小程序、门槛都按它读）：掌握 2，过过关 1，其余 0。
const streakOf = (state: KanaState) => state.stage === "mastered" ? 2 : state.days > 0 ? 1 : 0;
export const kanaProgressFrom = (states: Record<string, KanaState>): KanaProgress =>
  Object.fromEntries(Object.entries(states).map(([kana, state]) => [kana, streakOf(state)]));
export const getKanaProgress = (): KanaProgress => kanaProgressFrom(getKanaStates());

/** 答过至少一次的字。网页的出题（kana-quiz.ts）拿它判断「教过没有」，没答过的先出教学卡。 */
export const getAnsweredKana = (): Set<string> => {
  ensureKanaRows();
  return new Set(rowsFor("SELECT symbol FROM kana_memory WHERE seen_count > 0").map((row) => String(row.symbol)));
};

export const kanaMasteredCount = (progress = getKanaProgress()) => KANA.filter(([kana]) => (progress[kana] ?? 0) >= 2).length;
// kana_completed 一旦是 1 就不再按字重算：10-28 之前按「当天连对两次」学完的人不能被新口径翻回未完成，
// 否则 enforceKanaGate 会把他们的每日新词压成 0。
export const kanaComplete = (progress?: KanaProgress) =>
  getState("kana_completed", "0") === "1" || kanaMasteredCount(progress ?? getKanaProgress()) === KANA.length;

export const deferWordPlanUntilKanaComplete = (wordGoal: number): void => {
  setState(WORD_GOAL_KEY, String(Math.max(0, Math.round(wordGoal))));
  setState("kana_completed", kanaComplete() ? "1" : "0");
  const prefs = getStudyPreferences();
  if (!kanaComplete()) saveStudyPreferences({ ...prefs, dailyGoal: 0 });
  requestFullSnapshot();
  scheduleSave(0);
};

export const enforceKanaGate = (): void => {
  if (getState("starting_level", "") !== "kana-none" || kanaComplete()) return;
  const prefs = getStudyPreferences();
  if (prefs.dailyGoal !== 0) saveStudyPreferences({ ...prefs, dailyGoal: 0 });
};

export const recordKanaAnswer = (kana: string, correct: boolean): { progress: KanaProgress; states: Record<string, KanaState>; completed: boolean } => {
  ensureKanaRows();
  if (!KANA.some(([symbol]) => symbol === kana)) throw new Error("未知的假名卡");
  const wasComplete = kanaComplete();
  const now = new Date();
  recordFsrsReview(kana, correct ? "know" : "forgot", now, {}, KANA_FSRS);
  const db = getDatabase();
  db.run("INSERT INTO kana_reviews (symbol,answer,reviewed_on,reviewed_at) VALUES (?,?,?,?)", [kana, correct ? "know" : "forgot", today(now), now.getTime()]);
  const states = getKanaStates(today(now));
  const progress = kanaProgressFrom(states);
  db.run("UPDATE kana_memory SET correct_streak=?, seen_count=seen_count+1 WHERE symbol=?", [progress[kana], kana]);
  const completed = kanaComplete(progress);
  if (completed && !wasComplete) {
    setState("kana_completed", "1");
    const goal = Math.max(0, Number(getState(WORD_GOAL_KEY, "0")) || 0);
    const prefs = getStudyPreferences();
    const startedOn = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    setState("jlpt_plan_started_on", startedOn);
    saveStudyPreferences({
      ...prefs,
      jlptPlanStartedOn: startedOn,
      dailyGoal: goal > 0 && prefs.dailyGoal === 0 ? goal : prefs.dailyGoal
    }, { keepPlanAnchor: true });
  }
  requestFullSnapshot();
  scheduleSave(0);
  notifyProgressUpdated();
  return { progress, states, completed };
};

/** 两台设备的作答取并集后，以同一条时间顺序重建 FSRS 和掌握状态。 */
export const replayKanaReviews = (): void => {
  ensureKanaRows();
  const db = getDatabase();
  const symbols = rowsFor("SELECT DISTINCT symbol FROM kana_reviews").map((row) => String(row.symbol));
  for (const symbol of symbols) {
    const events = rowsFor("SELECT answer, reviewed_at FROM kana_reviews WHERE symbol=? ORDER BY reviewed_at, id", [symbol]);
    db.run(`UPDATE kana_memory SET correct_streak=0, seen_count=?,
      fsrs_stability=NULL, fsrs_difficulty=NULL, fsrs_due=NULL, fsrs_last_review=NULL,
      fsrs_state=NULL, fsrs_steps=NULL, fsrs_reps=NULL, fsrs_lapses=NULL WHERE symbol=?`, [events.length, symbol]);
    for (const event of events) recordFsrsReview(symbol, event.answer === "know" ? "know" : "forgot", new Date(Number(event.reviewed_at)), {}, KANA_FSRS);
  }
  const states = getKanaStates();
  const progress = kanaProgressFrom(states);
  for (const symbol of symbols) db.run("UPDATE kana_memory SET correct_streak=? WHERE symbol=?", [progress[symbol] ?? 0, symbol]);
  const wasComplete = getState("kana_completed", "0") === "1";
  const completed = kanaComplete(progress);
  // 跨设备合并后才凑齐：计划起点记在真正掌握最后一个字的那天，不是合并那天。
  if (completed && !wasComplete) {
    const lastMastered = Object.values(states).map((state) => state.masteredOn ?? "").sort().pop();
    if (lastMastered) setState("jlpt_plan_started_on", lastMastered);
  }
  setState("kana_completed", completed ? "1" : "0");
};
