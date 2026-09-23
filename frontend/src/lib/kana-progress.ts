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

const WORD_GOAL_KEY = "kana_deferred_word_goal";
const KANA_FSRS: FsrsEntity = { table: "kana_memory", idColumn: "symbol", eligible: "1=1" };

export type KanaProgress = Record<string, number>;

const ensureKanaRows = () => oncePerDatabase("kana-rows", () => {
  const db = getDatabase();
  for (const [symbol] of KANA) db.run("INSERT OR IGNORE INTO kana_memory (symbol) VALUES (?)", [symbol]);
  ensureFsrsColumns(KANA_FSRS);
});

export const getKanaProgress = (): KanaProgress => {
  ensureKanaRows();
  return Object.fromEntries(rowsFor("SELECT symbol, correct_streak FROM kana_memory").map((row) => [String(row.symbol), Number(row.correct_streak)]));
};

export const kanaMasteredCount = (progress = getKanaProgress()) => KANA.filter(([kana]) => (progress[kana] ?? 0) >= 2).length;
export const kanaComplete = (progress = getKanaProgress()) => kanaMasteredCount(progress) === KANA.length;

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

export const recordKanaAnswer = (kana: string, correct: boolean): { progress: KanaProgress; completed: boolean } => {
  ensureKanaRows();
  if (!KANA.some(([symbol]) => symbol === kana)) throw new Error("未知的假名卡");
  const progress = getKanaProgress();
  const wasComplete = kanaComplete(progress);
  const now = new Date();
  recordFsrsReview(kana, correct ? "know" : "forgot", now, {}, KANA_FSRS);
  progress[kana] = correct ? Math.min(2, (progress[kana] ?? 0) + 1) : 0;
  const db = getDatabase();
  db.run("UPDATE kana_memory SET correct_streak=?, seen_count=seen_count+1 WHERE symbol=?", [progress[kana], kana]);
  db.run("INSERT INTO kana_reviews (symbol,answer,reviewed_on,reviewed_at) VALUES (?,?,?,?)", [kana, correct ? "know" : "forgot", today(now), now.getTime()]);
  const completed = kanaComplete(progress);
  if (completed && !wasComplete) {
    setState("kana_completed", "1");
    const goal = Math.max(0, Number(getState(WORD_GOAL_KEY, "0")) || 0);
    const prefs = getStudyPreferences();
    const now = new Date();
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
  return { progress, completed };
};

/** 两台设备的作答取并集后，以同一条时间顺序重建 FSRS 和记忆闸门。 */
export const replayKanaReviews = (): void => {
  ensureKanaRows();
  const db = getDatabase();
  const symbols = rowsFor("SELECT DISTINCT symbol FROM kana_reviews").map((row) => String(row.symbol));
  let completedAt = 0;
  for (const symbol of symbols) {
    const events = rowsFor("SELECT answer, reviewed_at FROM kana_reviews WHERE symbol=? ORDER BY reviewed_at, id", [symbol]);
    db.run(`UPDATE kana_memory SET correct_streak=0, seen_count=0,
      fsrs_stability=NULL, fsrs_difficulty=NULL, fsrs_due=NULL, fsrs_last_review=NULL,
      fsrs_state=NULL, fsrs_steps=NULL, fsrs_reps=NULL, fsrs_lapses=NULL WHERE symbol=?`, [symbol]);
    let streak = 0;
    let masteredAt = 0;
    for (const event of events) {
      const correct = event.answer === "know";
      recordFsrsReview(symbol, correct ? "know" : "forgot", new Date(Number(event.reviewed_at)), {}, KANA_FSRS);
      streak = correct ? Math.min(2, streak + 1) : 0;
      masteredAt = streak === 2 ? (masteredAt || Number(event.reviewed_at)) : 0;
      db.run("UPDATE kana_memory SET correct_streak=?, seen_count=seen_count+1 WHERE symbol=?", [streak, symbol]);
    }
    if (streak === 2) completedAt = Math.max(completedAt, masteredAt);
  }
  const completed = kanaComplete();
  if (completed && getState("kana_completed", "0") !== "1" && completedAt) {
    const date = new Date(completedAt);
    setState("jlpt_plan_started_on", `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`);
  }
  setState("kana_completed", completed ? "1" : "0");
};
