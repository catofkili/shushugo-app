import { getDatabase } from "./database";
import { firstValue, getState, rowsFor, setState, studyDayEnd, today } from "./database/db-utils";
import { priorBaselineSql, type PlanKind } from "./plan-level-order";

export const PRIOR_QUOTA_INITIAL = 5;
export const PRIOR_QUOTA_MIN = 1;
export const PRIOR_QUOTA_MAX = 8;
export const PRIOR_CHECK_EVERY = 10;

export interface PriorPace { quota: number; window: string[] }

export const PRIOR_ENTITIES = {
  words: { table: "progress", idColumn: "word_id", reviews: "reviews" },
  grammar: { table: "grammar_progress", idColumn: "grammar_id", reviews: "grammar_reviews" },
  kanji: { table: "kanji_char_memory", idColumn: "char", reviews: "kanji_char_reviews" },
  confusion: { table: "confusion_progress", idColumn: "group_key", reviews: "confusion_reviews" }
} as const;
const ENTITIES = PRIOR_ENTITIES;

type Entity = { table: string; idColumn: string; eligible: string };
const stateKey = (kind: PlanKind) => `prior_pace:${kind}`;
const quoted = (value: string) => `'${value.replace(/'/gu, "''")}'`;
const inIds = (key: string, ids: string[]) => `${key} IN (${ids.map(quoted).join(",") || "NULL"})`;

export const priorKindForTable = (table: string): PlanKind | null => (
  table === "reverse_memory" || table === "kanji_reading_memory" ? "words"
    : (Object.keys(ENTITIES) as PlanKind[]).find((kind) => ENTITIES[kind].table === table) ?? null
);

/** 和 level-plan 同一判据：任意方向的一条真实流水就已验证，seen_count / 虚拟 last_review 都不算。 */
export const pendingPriorSql = (kind: PlanKind, key: string): string => {
  const baseline = priorBaselineSql(kind, key);
  if (baseline === "0") return "0";
  const entity = ENTITIES[kind];
  return `(${baseline} AND NOT EXISTS (SELECT 1 FROM ${entity.reviews} prior_review WHERE prior_review.${entity.idColumn} = ${key}))`;
};

const hasPriors = (kind: PlanKind) => priorBaselineSql(kind, "NULL") !== "0" && firstValue<number>(
  "SELECT 1 FROM level_prior_baselines WHERE entity = ? LIMIT 1", [kind], 0
) > 0;

export const readPriorPace = (kind: PlanKind): PriorPace => {
  try {
    const value = JSON.parse(getState(stateKey(kind), "") || "null");
    if (value && Number.isInteger(value.quota) && value.quota >= PRIOR_QUOTA_MIN && value.quota <= PRIOR_QUOTA_MAX
      && Array.isArray(value.window) && value.window.length < PRIOR_CHECK_EVERY
      && value.window.every((answer: unknown) => ["know", "fuzzy", "forgot", "known_forever"].includes(String(answer)))) {
      return { quota: value.quota, window: value.window };
    }
  } catch { /* 缺失或坏值按初始额度；不修写任何 FSRS 行。 */ }
  return { quota: PRIOR_QUOTA_INITIAL, window: [] };
};

export const advancePriorPace = (pace: PriorPace, answer: string): PriorPace => {
  const window = [...pace.window, answer];
  if (window.length < PRIOR_CHECK_EVERY) return { quota: pace.quota, window };
  const accuracy = window.filter((item) => item === "know").length / window.length;
  const change = accuracy >= 0.9 ? -1 : accuracy < 0.7 ? 1 : 0;
  return { quota: Math.max(PRIOR_QUOTA_MIN, Math.min(PRIOR_QUOTA_MAX, pace.quota + change)), window: [] };
};

/** 今天首次验证的条目数；重复刷、跨方向再答不再占一个名额，换设备也从同一份流水取数。 */
export const priorValidatedToday = (kind: PlanKind, day = today(), eligible = "1"): number => {
  if (!hasPriors(kind)) return 0;
  const { reviews, idColumn, table } = ENTITIES[kind];
  return firstValue<number>(`SELECT COUNT(DISTINCT r.${idColumn}) FROM ${reviews} r
    WHERE r.reviewed_on = ? AND ${priorBaselineSql(kind, `r.${idColumn}`)}
      AND r.${idColumn} IN (SELECT ${idColumn} FROM ${table} WHERE ${eligible})
      AND NOT EXISTS (SELECT 1 FROM ${reviews} earlier WHERE earlier.${idColumn} = r.${idColumn} AND earlier.reviewed_on < ?)
  `, [day, day], 0);
};

/** 当天的先验验证（含尚待首答的），在任务回填/补抽时也不能扣普通复习额度。 */
export const priorIntakeSql = (kind: PlanKind, key: string, day = today()): string => {
  if (!hasPriors(kind)) return "0";
  const { reviews, idColumn } = ENTITIES[kind];
  return `(${priorBaselineSql(kind, key)} AND NOT EXISTS (SELECT 1 FROM ${reviews} earlier
    WHERE earlier.${idColumn} = ${key} AND earlier.reviewed_on < ${quoted(day)}))`;
};

/** 放行名单只读：旧 due 是候选资格和次序，不是待还债务，绝不能为限速改写它。 */
export const releasedPriorIds = (kind: PlanKind, end = studyDayEnd(), day = today(), eligible = "1"): string[] => {
  if (!hasPriors(kind)) return [];
  const left = Math.max(0, readPriorPace(kind).quota - priorValidatedToday(kind, day));
  if (!left) return [];
  const { table, idColumn } = ENTITIES[kind];
  return rowsFor(`SELECT ${idColumn} AS k FROM ${table}
    WHERE known_forever = 0 AND seen_count > 0 AND fsrs_due <= ? AND (${eligible})
      AND ${pendingPriorSql(kind, `${table}.${idColumn}`)}
    ORDER BY fsrs_due ASC, ${idColumn} ASC LIMIT ?
  `, [end.toISOString(), left]).map((row) => String(row.k));
};

/** 负荷图只预测放行节奏；未来准确率未知，沿用当前额度，不把未验证的旧 due 画成积压峰。 */
export const forecastPriorReleases = (kind: PlanKind, ends: Date[], eligible = "1"): number[] => {
  if (!ends.length || !hasPriors(kind)) return ends.map(() => 0);
  const { table, idColumn } = ENTITIES[kind];
  const dues = rowsFor(`SELECT fsrs_due FROM ${table} WHERE known_forever = 0 AND seen_count > 0
    AND fsrs_due <= ? AND (${eligible}) AND ${pendingPriorSql(kind, `${table}.${idColumn}`)} ORDER BY fsrs_due`,
  [ends[ends.length - 1].toISOString()]).map((row) => String(row.fsrs_due));
  const quota = readPriorPace(kind).quota;
  let taken = 0;
  return ends.map((end, index) => {
    const before = taken;
    const limit = index === 0 ? Math.max(0, quota - priorValidatedToday(kind, today(new Date(end.getTime() - 1)))) : quota;
    while (taken - before < limit && taken < dues.length && dues[taken] <= end.toISOString()) taken += 1;
    return taken - before;
  });
};

/** 词的三个方向共用正向基线的 due / 放行名单；方向自己的 due 仍须到期。 */
export const priorIdsForEntity = (entity: Entity, end = studyDayEnd(), day = today()): string[] => {
  const kind = priorKindForTable(entity.table);
  if (!kind) return [];
  const ids = releasedPriorIds(kind, end, day, entity.table === ENTITIES[kind].table ? entity.eligible : "1");
  if (!ids.length) return [];
  return rowsFor(`SELECT ${entity.idColumn} AS k FROM ${entity.table}
    WHERE (${entity.eligible}) AND (fsrs_due IS NULL OR fsrs_due <= ?) AND ${inIds(entity.idColumn, ids)}
    ORDER BY fsrs_due ASC, ${entity.idColumn} ASC
  `, [end.toISOString()]).map((row) => String(row.k));
};

/** 给非 FSRS-store 的到期读入口用；剩余数和取卡必须使用这一道闸。 */
export const priorGateSql = (kind: PlanKind, key: string, end = studyDayEnd(), day = today(), eligible = "1"): string => (
  hasPriors(kind) ? `(NOT ${pendingPriorSql(kind, key)} OR ${inIds(key, releasedPriorIds(kind, end, day, eligible))})` : "1"
);

/** 已物化的旧任务也要收口；只改当天投影，不改记忆或流水。 */
export const reconcilePriorTasks = (entity: Entity, tasks: string, day = today(), end = studyDayEnd(), taskType?: string): void => {
  const kind = priorKindForTable(entity.table);
  if (!kind || !hasPriors(kind)) return;
  const id = entity.idColumn;
  const ids = priorIdsForEntity(entity, end, day);
  const db = getDatabase();
  db.run(`DELETE FROM ${tasks} WHERE reviewed_on = ? AND ${pendingPriorSql(kind, `${tasks}.${id}`)} AND NOT ${inIds(id, ids)}`, [day]);
  if (!ids.length) return;
  const start = firstValue<number>(`SELECT COALESCE(MAX(order_index), 0) FROM ${tasks} WHERE reviewed_on = ?`, [day], 0);
  ids.forEach((key, index) => db.run(`INSERT OR IGNORE INTO ${tasks} (reviewed_on, ${id}, order_index${taskType ? ", task_type" : ""})
    VALUES (?, ?, ?${taskType ? ", ?" : ""})`, [day, key, start + index + 1, ...(taskType ? [taskType] : [])]));
};

/** 首次流水是事实；只在首次验证/撤销首次验证时重算，重复刷不更新窗口，重放不造第二笔。 */
export const rebuildPriorPace = (kind: PlanKind): void => {
  if (!hasPriors(kind)) return;
  const { reviews, idColumn } = ENTITIES[kind];
  // 合并到本机的更早作答可能拿到更大的本机 id；同一时刻用跨设备不变的 sync_uid 消歧。
  const time = kind === "grammar" ? "created_at" : "COALESCE(reviewed_at, strftime('%s', created_at) * 1000)";
  const events = rowsFor(`SELECT r.answer FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY ${idColumn} ORDER BY reviewed_on, ${time}, sync_uid, id) AS first_answer
    FROM ${reviews}
  ) r WHERE r.first_answer = 1 AND ${priorBaselineSql(kind, `r.${idColumn}`)}
  ORDER BY r.reviewed_on, ${time}, r.sync_uid, r.id`);
  const pace = events.reduce((state, event) => advancePriorPace(state, String(event.answer)), { quota: PRIOR_QUOTA_INITIAL, window: [] } as PriorPace);
  setState(stateKey(kind), JSON.stringify(pace));
};

export const withPriorValidation = <T>(kind: PlanKind, key: number | string, write: () => T): T => {
  const pending = hasPriors(kind) && firstValue<number>(`SELECT ${pendingPriorSql(kind, "?")}`, [key, key], 0) > 0;
  const result = write();
  if (pending) rebuildPriorPace(kind);
  return result;
};

export const undoPriorValidation = (kind: PlanKind, key: number | string): void => {
  // 合并后即使仍有流水，撤销首答也可能让另一评分接替首答，必须按基线重放。
  if (hasPriors(kind) && firstValue<number>(`SELECT ${priorBaselineSql(kind, "?")}`, [key], 0)) rebuildPriorPace(kind);
};
