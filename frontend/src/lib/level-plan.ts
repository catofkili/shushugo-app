import { getDatabase } from "./database";
import { firstValue, getState, rowsFor, setState } from "./database/db-utils";
import { refreshMixedCardTasks } from "./mixed-cards";
import { refreshTodayWordPlan } from "./word-api";
import { JLPT_TARGETS, type JlptTarget } from "./jlpt/plan";
import { isExamKind, type ExamKind } from "./jlpt/exam-dates";
import { getStudyPreferences, PLAN_QUOTA_KEYS, saveStudyPreferences } from "./studyPreferences";
import { enforceKanaGate } from "./kana-progress";

export type StartingLevel = "kana-none" | "kana" | JlptTarget | "beyond";
export type Familiarity = Record<"words" | "grammar" | "kanji" | "confusion", number>;

export interface LevelPlanSettings {
  startingLevel: StartingLevel;
  familiarity: Familiarity;
  target: JlptTarget;
  examKind: ExamKind;
  examDate: string;
  startedOn: string;
}
export type LevelPlanInput = Omit<LevelPlanSettings, "startedOn" | "examKind"> & { startedOn?: string; examKind?: ExamKind; planEnabled?: boolean };

const PRIOR_VERSION = "level-prior-v1";
const priorSignature = (settings: LevelPlanSettings) => JSON.stringify({ version: PRIOR_VERSION, level: settings.startingLevel, familiarity: settings.familiarity });
const STARTING_LEVELS = new Set<StartingLevel>(["kana-none", "kana", ...JLPT_TARGETS, "beyond"]);
export const SETTINGS_KEYS = {
  startingLevel: "starting_level",
  familiarity: "type_familiarity",
  target: "jlpt_plan_target",
  examKind: "jlpt_plan_exam_kind",
  examDate: "jlpt_plan_exam_date",
  startedOn: "jlpt_plan_started_on",
  applied: "level_prior_applied"
} as const;

export const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const clamp = (value: unknown) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
export const normalizedFamiliarity = (value: Partial<Familiarity> = {}): Familiarity => ({
  words: clamp(value.words), grammar: clamp(value.grammar), kanji: clamp(value.kanji), confusion: clamp(value.confusion)
});

export const familiarityDefaults = (level: StartingLevel): Familiarity => {
  const value = JLPT_TARGETS.includes(level as JlptTarget) ? 75 : 0;
  return { words: value, grammar: value, kanji: value, confusion: value };
};

export const stabilityFor = (familiarity: number): number => {
  const stops = [[0, 0], [25, 3], [50, 10], [75, 30], [100, 90]] as const;
  const value = clamp(familiarity);
  for (let index = 1; index < stops.length; index += 1) {
    const [rightX, rightY] = stops[index];
    const [leftX, leftY] = stops[index - 1];
    if (value <= rightX) {
      if (value === rightX) return rightY;
      const ratio = (value - leftX) / (rightX - leftX);
      return leftY === 0 ? rightY * ratio : Math.exp(Math.log(leftY) + (Math.log(rightY) - Math.log(leftY)) * ratio);
    }
  }
  return 90;
};

const parseFamiliarity = (raw: string): Familiarity | null => {
  try { return normalizedFamiliarity(JSON.parse(raw) as Partial<Familiarity>); }
  catch { return null; }
};

export const getLevelPlanSettings = (): LevelPlanSettings | null => {
  const startingLevel = getState(SETTINGS_KEYS.startingLevel, "") as StartingLevel;
  const familiarity = parseFamiliarity(getState(SETTINGS_KEYS.familiarity, ""));
  if (!STARTING_LEVELS.has(startingLevel) || !familiarity) return null;
  const targetRaw = getState(SETTINGS_KEYS.target, "");
  const target = JLPT_TARGETS.includes(targetRaw as JlptTarget) ? targetRaw as JlptTarget : getStudyPreferences().jlptTarget;
  return {
    startingLevel,
    familiarity,
    target,
    examKind: isExamKind(getState(SETTINGS_KEYS.examKind, "jlpt")) ? getState(SETTINGS_KEYS.examKind, "jlpt") as ExamKind : "jlpt",
    examDate: getState(SETTINGS_KEYS.examDate, ""),
    startedOn: getState(SETTINGS_KEYS.startedOn, "") || localDate()
  };
};

/**
 * 只有真正的新用户才弹首次设定。⚠️ 起点设定是 09-23 才有的，之前的用户全都没有 `startingLevel`：
 * `b2b4a5e`（加非 JLPT 考试）把下面「有真实学习记录就不弹」那段顺手删了，作者用了两个多月，
 * 09-26 打开被弹了一张新手等级表。老用户的起点由 `effectiveStartingLevel` / `learnedLevel()` 从学习数据推，
 * 想改去备考页。判据只看真实流水和真实学过的行（自报水平的基线要先有 startingLevel 才会写，不会误挡）。
 */
export const shouldShowLevelSetup = (): boolean => {
  if (getState(SETTINGS_KEYS.startingLevel, "")) return false;
  return [
    ["reviews", "1=1"], ["grammar_reviews", "1=1"], ["kanji_char_reviews", "1=1"], ["confusion_reviews", "1=1"], ["kana_reviews", "1=1"],
    ["progress", "seen_count > 0 OR known_forever = 1"], ["grammar_progress", "seen_count > 0 OR known_forever = 1"],
    ["checkins", "1=1"]
  ].every(([table, condition]) => {
    try { return firstValue<number>(`SELECT COUNT(*) FROM ${table} WHERE ${condition}`, [], 0) === 0; }
    catch { return true; }
  });
};

export async function applyLevelStartingPoint(settings: LevelPlanSettings, now = new Date()): Promise<void> {
  const applied = priorSignature(settings);
  if (getState(SETTINGS_KEYS.applied, "") === applied) return;
  const { applyLevelStartingPoint: apply } = await import(
    /* webpackMode: "lazy", webpackChunkName: "lazy/level-starting-point" */ "./level-starting-point"
  );
  await apply(settings, now, applied);
}

/** `planEnabled: false` = 首次设定里选了「暂不备考」：起点和熟悉度照写（先验照样要），备考计划关着，每日量由调用方按强度定。 */
export async function saveLevelPlanSettings(input: LevelPlanInput): Promise<LevelPlanSettings> {
  // 保存本来就是异步入口；规范化与写入一起留在先验分包，避免挤占几乎已满的主包。
  const { saveLevelPlanSettings: save } = await import(
    /* webpackMode: "lazy", webpackChunkName: "lazy/level-starting-point" */ "./level-starting-point"
  );
  return save(input);
}

/** 云同步合并后，以 SQLite 中随账号同步的计划为准，恢复本机 UI 偏好。 */
export const hydrateLevelPlanPreferences = (): void => {
  const settings = getLevelPlanSettings();
  if (!settings) return;
  let quotas: Record<string, number> = {};
  try { quotas = JSON.parse(getState("level_plan_quotas", "{}")) as Record<string, number>; } catch { /* 旧计划保留本机额度 */ }
  if (settings.startingLevel === "kana-none" && getState("kana_completed", "0") === "1" && quotas.dailyGoal === 0) {
    const deferred = Number(getState("kana_deferred_word_goal", "0"));
    if (Number.isFinite(deferred) && deferred > 0) {
      quotas.dailyGoal = deferred;
      setState("level_plan_quotas", JSON.stringify(quotas));
    }
  }
  const syncedQuotas = Object.fromEntries(PLAN_QUOTA_KEYS.filter((key) => Number.isFinite(quotas[key])).map((key) => [key, quotas[key]]));
  saveStudyPreferences({
    ...getStudyPreferences(),
    ...syncedQuotas,
    jlptPlanEnabled: getState("jlpt_plan_enabled", "1") !== "0",
    jlptTarget: settings.target,
    planExamKind: settings.examKind,
    jlptExamDate: settings.examDate,
    jlptPlanStartedOn: settings.startedOn
  }, { keepPlanAnchor: true, fromLevelPlanSync: true });
  enforceKanaGate();
};

/** 两周前先相信用户自报；之后只有足够真实首答证据才上下调一级。 */
export const effectiveStartingLevelFor = (settings: LevelPlanSettings, now = new Date()): JlptTarget | null => {
  if (!JLPT_TARGETS.includes(settings.startingLevel as JlptTarget)) return null;
  const base = settings.startingLevel as JlptTarget;
  const start = new Date(`${settings.startedOn}T12:00:00`);
  if (!Number.isFinite(start.getTime()) || now.getTime() - start.getTime() < 14 * 86_400_000) return base;
  const rows = rowsFor(`
    SELECT w.jlpt_level AS level, COUNT(*) AS total,
      SUM(CASE WHEN first.answer IN ('know', 'known_forever') THEN 1 ELSE 0 END) AS correct
    FROM (
      SELECT r.word_id, r.answer, r.reviewed_on
      FROM reviews r
      JOIN (SELECT word_id, MIN(id) AS id FROM reviews WHERE direction = 'forward' GROUP BY word_id) f ON f.id = r.id
    ) first JOIN words w ON w.id = first.word_id
    WHERE first.reviewed_on >= ?
    GROUP BY w.jlpt_level
  `, [localDate(new Date(now.getTime() - 14 * 86_400_000))]);
  const evidence = new Map(rows.map((row) => [String(row.level), { total: Number(row.total), rate: Number(row.correct) / Math.max(1, Number(row.total)) }]));
  const index = JLPT_TARGETS.indexOf(base);
  const current = evidence.get(base);
  if (current && current.total >= 50 && current.rate < 0.55) return JLPT_TARGETS[Math.max(0, index - 1)];
  const next = JLPT_TARGETS[index + 1];
  const upper = next ? evidence.get(next) : undefined;
  if (upper && upper.total >= 50 && upper.rate >= 0.85) return next;
  return base;
};

export const effectiveStartingLevel = (now = new Date()): JlptTarget | null => {
  const settings = getLevelPlanSettings();
  return settings ? effectiveStartingLevelFor(settings, now) : null;
};

/** 只重估还没有真实作答的卡；用户自报的起点与已答卡基线保持原样。 */
export const recalibrateLevelStartingPoint = async (now = new Date()): Promise<boolean> => {
  const settings = getLevelPlanSettings();
  if (!settings) return false;
  const next = { ...settings, startingLevel: effectiveStartingLevelFor(settings, now) ?? settings.startingLevel };
  if (getState(SETTINGS_KEYS.applied, "") === priorSignature(next)) return false;
  await applyLevelStartingPoint(next, now);
  refreshTodayWordPlan();
  refreshMixedCardTasks(getDatabase());
  return true;
};
