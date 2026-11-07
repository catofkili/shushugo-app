import { wordLearningScopeSql, wordStartedSql } from "./word-learning-scope";
import { getDatabase } from "./database";
import { firstValue, getState, rowsFor, setState, today } from "./database/db-utils";
import { ensureGrammarProgressInitialized } from "./grammar-api";
import { loadKanjiCharData, materializeKanjiChars } from "./kanji-char-cards";
import { materializeConfusionCards } from "./confusion-cards";
import { notifyProgressUpdated } from "./progress-events";
import { requestFullSnapshot, scheduleSave } from "./storage";
import { ensureProgressInitialized } from "./word-api/bootstrap";
import { JLPT_TARGETS, type JlptTarget } from "./jlpt/plan";
import { applyLevelStartingPoint as applyStartingPoint, effectiveStartingLevelFor, getLevelPlanSettings, localDate, normalizedFamiliarity, SETTINGS_KEYS, stabilityFor, type Familiarity, type LevelPlanInput, type LevelPlanSettings } from "./level-plan";
import { getStudyPreferences, PLAN_QUOTA_KEYS, saveStudyPreferences } from "./studyPreferences";

// 仅首次设定保存 / 备考页重估时执行；独立异步块共享主包数据库，不复制先验或排片状态。
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

export async function applyLevelStartingPoint(settings: LevelPlanSettings, now: Date, applied: string): Promise<void> {
  const diagnostics = await import(/* webpackMode: "lazy", webpackChunkName: "lazy/pool-anomaly" */ "./pool-anomaly").catch(() => null);
  let previous: { level?: string; familiarity?: Partial<Familiarity> } = {};
  try { previous = JSON.parse(getState("level_prior_applied", "{}")); } catch { /* 旧值损坏按换起点处理。 */ }
  const changedKinds = ENTITIES.map(entity => entity.name).filter(kind =>
    previous.level !== settings.startingLevel || previous.familiarity?.[kind] !== settings.familiarity[kind]);
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
            AND (${entity.name === "words" ? `NOT ${wordStartedSql("t")}` : "t.seen_count = 0"} OR EXISTS (
              SELECT 1 FROM level_prior_baselines b WHERE b.entity = ? AND b.entity_key = CAST(t.${entity.key} AS TEXT)
            ))
            AND NOT EXISTS (SELECT 1 FROM ${entity.reviewTable} r WHERE r.${entity.reviewKey} = t.${entity.key})
            ${entity.name === "words" ? `AND t.word_id IN (SELECT w.id FROM words w JOIN progress p ON p.word_id = w.id WHERE ${wordLearningScopeSql()})` : ""}
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
        // 标了熟知的卡（固定搭配退役、整组熟知……不一定有作答流水）不在候选里，
        // 所以一定落到这里。整行重置会把 known_forever 清掉、让它重新进排期 ——
        // 2026-10-13 起点重估就这样把 10-10 退役的 27 条固定搭配复活了。
        if (firstValue<number>(`SELECT known_forever FROM ${entity.table} WHERE ${entity.key} = ?`, [key], 0)) continue;
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
    setState("level_prior_applied", applied);
    if (changedKinds.length) diagnostics?.markPoolManual(changedKinds, today(now));
    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }
  requestFullSnapshot();
  scheduleSave(0);
  notifyProgressUpdated();
}

/** 保存与重估共用同一先验入口；同步回填仍只由 level-plan.hydrateLevelPlanPreferences 处理。 */
export async function saveLevelPlanSettings({ planEnabled = true, ...input }: LevelPlanInput): Promise<LevelPlanSettings> {
  const previous = getLevelPlanSettings();
  const examKind = input.examKind ?? previous?.examKind ?? "jlpt";
  const familiarity = normalizedFamiliarity(input.familiarity);
  const unchanged = previous?.startingLevel === input.startingLevel
    && previous.target === input.target
    && previous.examKind === examKind
    && previous.examDate === input.examDate
    && JSON.stringify(previous.familiarity) === JSON.stringify(familiarity);
  const settings: LevelPlanSettings = {
    ...input,
    examKind,
    familiarity,
    startedOn: input.startedOn || (unchanged ? previous.startedOn : localDate())
  };
  const effectiveStartingLevel = effectiveStartingLevelFor(settings) ?? settings.startingLevel;
  await applyStartingPoint({ ...settings, startingLevel: effectiveStartingLevel });
  // 自动重估可能已经应用了新起点；之后手动改自报起点时，签名不变也要记录这次手调。
  if (previous && previous.startingLevel !== settings.startingLevel) {
    await import(/* webpackMode: "lazy", webpackChunkName: "lazy/pool-anomaly" */ "./pool-anomaly")
      .then(({ markPoolManual }) => markPoolManual()).catch(() => {});
  }
  setState(SETTINGS_KEYS.startingLevel, settings.startingLevel);
  setState(SETTINGS_KEYS.familiarity, JSON.stringify(settings.familiarity));
  setState(SETTINGS_KEYS.target, settings.target);
  setState(SETTINGS_KEYS.examKind, settings.examKind);
  setState(SETTINGS_KEYS.examDate, settings.examDate);
  setState(SETTINGS_KEYS.startedOn, settings.startedOn);
  setState("jlpt_plan_enabled", planEnabled ? "1" : "0");
  const currentPrefs = getStudyPreferences();
  setState("level_plan_quotas", JSON.stringify(Object.fromEntries(PLAN_QUOTA_KEYS.map((key) => [key, currentPrefs[key]]))));
  saveStudyPreferences({
    ...currentPrefs,
    jlptPlanEnabled: planEnabled,
    jlptTarget: settings.target,
    planExamKind: settings.examKind,
    jlptExamDate: settings.examDate,
    jlptPlanStartedOn: settings.startedOn
  }, { keepPlanAnchor: true, fromLevelPlanSync: true });
  requestFullSnapshot();
  scheduleSave(0);
  return settings;
}
