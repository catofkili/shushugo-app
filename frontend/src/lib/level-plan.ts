import { getDatabase } from "./database";
import { firstValue, getState, rowsFor, setState } from "./database/db-utils";
import { ensureGrammarProgressInitialized } from "./grammar-api";
import { loadKanjiCharData, materializeKanjiChars } from "./kanji-char-cards";
import { materializeConfusionCards } from "./confusion-cards";
import { refreshMixedCardTasks } from "./mixed-cards";
import { notifyProgressUpdated } from "./progress-events";
import { requestFullSnapshot, scheduleSave } from "./storage";
import { ensureProgressInitialized } from "./word-api/bootstrap";
import { refreshTodayWordPlan } from "./word-api";
import { JLPT_TARGETS, type JlptTarget } from "./jlpt/plan";
import { getStudyPreferences, PLAN_QUOTA_KEYS, saveStudyPreferences } from "./studyPreferences";
import { enforceKanaGate } from "./kana-progress";

export type StartingLevel = "kana-none" | "kana" | JlptTarget | "beyond";
export type Familiarity = Record<"words" | "grammar" | "kanji" | "confusion", number>;

export interface LevelPlanSettings {
  startingLevel: StartingLevel;
  familiarity: Familiarity;
  target: JlptTarget;
  examDate: string;
  startedOn: string;
}

const PRIOR_VERSION = "level-prior-v1";
const priorSignature = (settings: LevelPlanSettings) => JSON.stringify({ version: PRIOR_VERSION, level: settings.startingLevel, familiarity: settings.familiarity });
const STARTING_LEVELS = new Set<StartingLevel>(["kana-none", "kana", ...JLPT_TARGETS, "beyond"]);
const SETTINGS_KEYS = {
  startingLevel: "starting_level",
  familiarity: "type_familiarity",
  target: "jlpt_plan_target",
  examDate: "jlpt_plan_exam_date",
  startedOn: "jlpt_plan_started_on",
  applied: "level_prior_applied"
} as const;

const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const clamp = (value: unknown) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
const normalizedFamiliarity = (value: Partial<Familiarity> = {}): Familiarity => ({
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
    examDate: getState(SETTINGS_KEYS.examDate, ""),
    startedOn: getState(SETTINGS_KEYS.startedOn, "") || localDate()
  };
};

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

const hash = (value: string) => {
  let result = 2166136261;
  for (const char of value) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return result >>> 0;
};

const dueFor = (entity: string, key: string, spreadDays: number, now: Date) => {
  const due = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (hash(`${entity}:${key}`) % spreadDays), 12);
  return due.toISOString();
};

type Entity = {
  name: keyof Familiarity;
  table: string;
  key: string;
  level: string;
  reviewTable: string;
  reviewKey: string;
};

const ENTITIES: Entity[] = [
  { name: "words", table: "progress", key: "word_id", level: "(SELECT CASE w.jlpt_level WHEN 'N5' THEN 0 WHEN 'N4' THEN 1 WHEN 'N3' THEN 2 WHEN 'N2' THEN 3 WHEN 'N1' THEN 4 ELSE 99 END FROM words w WHERE w.id = t.word_id)", reviewTable: "reviews", reviewKey: "word_id" },
  { name: "grammar", table: "grammar_progress", key: "grammar_id", level: "(SELECT CASE g.level WHEN 'N5' THEN 0 WHEN 'N4' THEN 1 WHEN 'N3' THEN 2 WHEN 'N2' THEN 3 WHEN 'N1' THEN 4 ELSE 99 END FROM grammar_points g WHERE g.id = t.grammar_id)", reviewTable: "grammar_reviews", reviewKey: "grammar_id" },
  { name: "kanji", table: "kanji_char_memory", key: "char", level: "level_rank", reviewTable: "kanji_char_reviews", reviewKey: "char" },
  { name: "confusion", table: "confusion_progress", key: "group_key", level: "level_rank", reviewTable: "confusion_reviews", reviewKey: "group_key" }
];

const resetFields = `seen_count = 0, right_count = 0, fuzzy_count = 0, forgot_count = 0,
  known_forever = 0, last_seen_on = NULL, fsrs_stability = NULL, fsrs_difficulty = NULL,
  fsrs_due = NULL, fsrs_last_review = NULL, fsrs_state = NULL, fsrs_steps = NULL,
  fsrs_reps = NULL, fsrs_lapses = NULL`;

export async function applyLevelStartingPoint(settings: LevelPlanSettings, now = new Date()): Promise<void> {
  const applied = priorSignature(settings);
  if (getState(SETTINGS_KEYS.applied, "") === applied) return;
  ensureProgressInitialized();
  ensureGrammarProgressInitialized();
  await loadKanjiCharData();
  materializeKanjiChars();
  materializeConfusionCards();

  const db = getDatabase();
  const rank = JLPT_TARGETS.indexOf(settings.startingLevel as JlptTarget);
  db.run("BEGIN");
  try {
    for (const entity of ENTITIES) {
      const existing = rowsFor(
        "SELECT entity_key FROM level_prior_baselines WHERE entity = ?",
        [entity.name]
      ).map((row) => String(row.entity_key));
      const desired = new Map<string, { familiarity: number; stability: number; due: string; lastReview: string }>();
      if (rank >= 0) {
        const candidates = rowsFor(`
          SELECT CAST(t.${entity.key} AS TEXT) AS entity_key, ${entity.level} AS level_rank
          FROM ${entity.table} t
          WHERE t.known_forever = 0
            AND (t.seen_count = 0 OR EXISTS (
              SELECT 1 FROM level_prior_baselines b WHERE b.entity = ? AND b.entity_key = CAST(t.${entity.key} AS TEXT)
            ))
            AND NOT EXISTS (SELECT 1 FROM ${entity.reviewTable} r WHERE r.${entity.reviewKey} = t.${entity.key})
        `, [entity.name]);
        for (const row of candidates) {
          const levelRank = Number(row.level_rank);
          if (levelRank > rank) continue;
          const familiarity = levelRank < rank ? 100 : settings.familiarity[entity.name];
          const stability = stabilityFor(familiarity);
          if (stability <= 0) continue;
          const spread = levelRank < rank ? 30 : 14;
          const key = String(row.entity_key);
          const due = dueFor(entity.name, key, spread, now);
          // FSRS 的 Review 卡必须有一个不晚于首次真实作答的 last_review；
          // 由稳定性和到期日反推一个虚拟日期，短稳定性遇到未来到期时夹到今天。
          const lastReview = new Date(Math.min(now.getTime(), Date.parse(due) - stability * 86_400_000)).toISOString();
          desired.set(key, { familiarity, stability, due, lastReview });
        }
      }

      for (const key of existing) {
        if (desired.has(key)) continue;
        const hasReview = firstValue<number>(
          `SELECT COUNT(*) FROM ${entity.reviewTable} WHERE ${entity.reviewKey} = ?`, [key], 0
        ) > 0;
        // 已有真实答题的卡仍要保留最初基线：汉字/辨析在云合并和撤销时会重放流水。
        // 删掉它会让历史作答从“全新卡”重新算，稳定性突然大幅缩短。
        if (hasReview) continue;
        db.run(`UPDATE ${entity.table} SET ${resetFields} WHERE ${entity.key} = ?`, [key]);
        db.run("DELETE FROM level_prior_baselines WHERE entity = ? AND entity_key = ?", [entity.name, key]);
      }

      for (const [key, value] of desired) {
        db.run(`
          INSERT OR REPLACE INTO level_prior_baselines
            (entity, entity_key, stability, difficulty, due, last_review, state, steps, reps, lapses, starting_level, familiarity, updated_at)
          VALUES (?, ?, ?, 5, ?, ?, 2, 0, 0, 0, ?, ?, ?)
        `, [entity.name, key, value.stability, value.due, value.lastReview, settings.startingLevel, value.familiarity, now.toISOString()]);
        db.run(`UPDATE ${entity.table} SET
          seen_count = 1, known_forever = 0, fsrs_stability = ?, fsrs_difficulty = 5,
          fsrs_due = ?, fsrs_last_review = ?, fsrs_state = 2, fsrs_steps = 0,
          fsrs_reps = 0, fsrs_lapses = 0
          WHERE ${entity.key} = ?`, [value.stability, value.due, value.lastReview, key]);
      }
    }
    setState(SETTINGS_KEYS.applied, applied);
    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }
  requestFullSnapshot();
  scheduleSave(0);
  notifyProgressUpdated();
}

export async function saveLevelPlanSettings(input: Omit<LevelPlanSettings, "startedOn"> & { startedOn?: string }): Promise<LevelPlanSettings> {
  const previous = getLevelPlanSettings();
  const familiarity = normalizedFamiliarity(input.familiarity);
  const unchanged = previous?.startingLevel === input.startingLevel
    && previous.target === input.target
    && previous.examDate === input.examDate
    && JSON.stringify(previous.familiarity) === JSON.stringify(familiarity);
  const settings: LevelPlanSettings = {
    ...input,
    familiarity,
    startedOn: input.startedOn || (unchanged ? previous.startedOn : localDate())
  };
  await applyLevelStartingPoint({ ...settings, startingLevel: effectiveStartingLevelFor(settings) ?? settings.startingLevel });
  setState(SETTINGS_KEYS.startingLevel, settings.startingLevel);
  setState(SETTINGS_KEYS.familiarity, JSON.stringify(settings.familiarity));
  setState(SETTINGS_KEYS.target, settings.target);
  setState(SETTINGS_KEYS.examDate, settings.examDate);
  setState(SETTINGS_KEYS.startedOn, settings.startedOn);
  setState("jlpt_plan_enabled", "1");
  const currentPrefs = getStudyPreferences();
  setState("level_plan_quotas", JSON.stringify(Object.fromEntries(PLAN_QUOTA_KEYS.map((key) => [key, currentPrefs[key]]))));
  saveStudyPreferences({
    ...currentPrefs,
    jlptPlanEnabled: true,
    jlptTarget: settings.target,
    jlptExamDate: settings.examDate,
    jlptPlanStartedOn: settings.startedOn
  }, { keepPlanAnchor: true, fromLevelPlanSync: true });
  requestFullSnapshot();
  scheduleSave(0);
  return settings;
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
    jlptExamDate: settings.examDate,
    jlptPlanStartedOn: settings.startedOn
  }, { keepPlanAnchor: true, fromLevelPlanSync: true });
  enforceKanaGate();
};

/** 两周前先相信用户自报；之后只有足够真实首答证据才上下调一级。 */
const effectiveStartingLevelFor = (settings: LevelPlanSettings, now = new Date()): JlptTarget | null => {
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
