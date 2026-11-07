/** 到期池只做数字对账；不参与选卡、额度或 FSRS 写入，所有入口都从学习会话懒加载。 */
import { getDatabase } from "./database";
import { getState, rowsFor, setState, studyDayEnd, today } from "./database/db-utils";
import { WORD_FSRS, type FsrsEntity } from "./fsrs-store";
import { autoPlanReviewCap, autoReviewCap, recentReviewAverages } from "./review-budget";
import { pendingPriorSql } from "./prior-pacing";
import { wordFilterSql } from "./word-api/filters";
import { wordLearningScopeSql } from "./word-learning-scope";
import { getStudyPreferences } from "./studyPreferences";
import type { PlanKind } from "./plan-level-order";
import type { WordSessionOptions } from "./study-types";

const KEY = "pool_anomaly";
const KINDS: PlanKind[] = ["words", "grammar", "kanji", "confusion"];
interface PoolState {
  /** scope = 写下预测的会话范围；范围不同的池子没法比（筛选会话 / 单级语法比计划池小得多），只比同一个范围的。 */
  forecast?: { forDay: string; due: number; merged: boolean; scope?: string; signature?: string };
  checked?: string;
  reported?: string;
  manual?: string;
}
type State = Partial<Record<PlanKind, PoolState>>;

const readState = (): State => {
  try {
    const value = JSON.parse(getState(KEY, "{}"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
};
const writeState = (state: State) => {
  setState(KEY, JSON.stringify(state));
  // 预测和已报状态也必须落盘；上报失败不进入意见反馈的重试队列。
  void import("./storage").then(({ scheduleSave }) => scheduleSave()).catch(() => {});
};

export const markPoolManual = (kinds = KINDS, day = today()): void => {
  try {
    const state = readState();
    for (const kind of kinds) state[kind] = { ...state[kind], manual: day };
    writeState(state);
  } catch { /* 诊断失败不能打断保存设置或学习。 */ }
};

/** 读已保存的规范化偏好；有效额度会随计划自然降速，不能把它当手调。 */
const preferenceSignature = (kind: PlanKind): string => {
  const prefs = getStudyPreferences();
  const shared = ["jlptPlanEnabled", "jlptTarget", "planExamKind", "jlptExamDate"] as const;
  const fields = {
    words: ["dailyGoal", "reviewCap", "includeOptionalExpressions"],
    grammar: ["grammarDailyGoal", "grammarReviewCap"],
    kanji: ["kanjiDailyGoal", "kanjiReviewCap"],
    confusion: ["confusionDailyGoal", "confusionReviewCap"]
  } as const;
  return JSON.stringify([...shared, ...fields[kind]].map(key => prefs[key]));
};

/** 合并不压制检查；只给此前写下、尚在本机的预测加来源标记。 */
export const markPoolMerged = (): void => {
  try {
    const state = readState();
    let changed = false;
    for (const kind of KINDS) {
      const forecast = state[kind]?.forecast;
      if (forecast) { forecast.merged = true; changed = true; }
    }
    if (changed) writeState(state);
  } catch { /* 诊断状态不可阻止正式合并提交。 */ }
};

// 标记入口不静态引用会话或上报模块，避免首次设起点的懒加载环。
const poolFilter = async (kind: PlanKind, scope?: string | WordSessionOptions) => {
  if (kind === "grammar") {
    const { grammarReviewEntity, PLAN_GRAMMAR_LEVEL } = await import("./grammar-quiz");
    return { entity: grammarReviewEntity(typeof scope === "string" ? scope : PLAN_GRAMMAR_LEVEL), params: [] };
  }
  if (kind === "kanji") return { entity: (await import("./kanji-char-cards")).kanjiCharReviewEntity(), params: [] };
  if (kind === "confusion") return { entity: (await import("./confusion-cards")).confusionReviewEntity(), params: [] };
  const filter = wordFilterSql(typeof scope === "object" ? scope : {});
  // 正常 stage1 无等级硬过滤；筛选会话沿用 wordFilterSql，不另猜一份范围。
  const entity: FsrsEntity = { ...WORD_FSRS, eligible: `(${WORD_FSRS.eligible}) AND word_id IN (
    SELECT w.id FROM words w JOIN progress p ON p.word_id = w.id WHERE ${wordLearningScopeSql()} ${filter.clause})` };
  return { entity, params: filter.params };
};

/**
 * actual 是上限、顽固词闸和先验限速之前的到期池，含全部待验证先验。
 * 今天只检查一次；明日预测仍随会话更新，防止把今天的正常作答误认成明天的新增。
 */
const checkPoolAnomaly = async (kind: PlanKind, scope: string | WordSessionOptions | undefined, db: object): Promise<void> => {
  const { entity, params } = await poolFilter(kind, scope);
  if (db !== getDatabase()) return;
  const day = today();
  const state = readState();
  const saved = state[kind] ?? {};
  const forecast = saved.forecast;
  const scopeKey = typeof scope === "string" ? scope : JSON.stringify(scope ?? {});
  const check = saved.checked !== day;
  const hasPrediction = forecast?.forDay === day && (forecast.scope ?? scopeKey) === scopeKey
    && Number.isSafeInteger(forecast.due) && forecast.due >= 0;
  const signature = preferenceSignature(kind);
  // 旧预测缺签名也跳过一次；检查前改回原值则仍检查，避免主包保存偏好时新增加载桩。
  if (check && hasPrediction && forecast.signature !== signature) saved.manual = day;
  const compare = check && hasPrediction && saved.manual !== day;
  const end = studyDayEnd();
  const tomorrow = new Date(end);
  tomorrow.setHours(12);
  // 汉字/辨析原会话要求非空 due；单词/语法把已见但尚未调度的空 due 也算到期。
  const due = kind === "words" || kind === "grammar" ? "(fsrs_due IS NULL OR fsrs_due <= ?)" : "fsrs_due <= ?";
  const row = rowsFor(`SELECT COUNT(*) AS predicted${compare ? `,
      COUNT(CASE WHEN ${due} THEN 1 END) AS actual,
      COUNT(CASE WHEN ${due} AND ${pendingPriorSql(kind, `${entity.table}.${entity.idColumn}`)} THEN 1 END) AS pending`
    : ""} FROM ${entity.table} WHERE ${entity.eligible} AND ${due}`,
  [...(compare ? [end.toISOString(), end.toISOString()] : []), ...params, studyDayEnd(tomorrow).toISOString()])[0];
  const actual = Number(row?.actual ?? 0);
  saved.checked = day;
  saved.forecast = { forDay: today(tomorrow), due: Number(row?.predicted ?? 0), merged: false, scope: scopeKey, signature };
  state[kind] = saved;
  const cap = compare ? kind === "words" ? autoReviewCap(recentReviewAverages(day).avgDailyWords) : autoPlanReviewCap(kind, day) : 0;
  const report = compare && actual >= 2 * cap && actual - forecast!.due >= 30;
  if (report) saved.reported = day;
  // 先记已检查/已报再发请求，离线、未登录、重复调用都不重试。
  writeState(state);
  if (report) void import("./sync-api").then(async ({ postFeedbackReport }) => {
    const { Capacitor } = await import("@capacitor/core");
    return postFeedbackReport({
      kind: "error",
      message: JSON.stringify({ kind, day, actual, predicted: forecast!.due, cap,
        pending: Number(row?.pending ?? 0), merged: forecast!.merged === true, manual: false }),
      app_version: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "unknown",
      platform: Capacitor.getPlatform(),
      route: "pool-anomaly"
    });
  }).catch(() => {});
};

// 同一同步调用栈可能反复取会话；合并成一次 COUNT，且不能拿旧库的回调去写导入后的新库。
const pending = new WeakMap<object, Map<PlanKind, string | WordSessionOptions | undefined>>();
export const observePool = (kind: PlanKind, scope: string | WordSessionOptions | undefined, db: object): void => {
  if (db !== getDatabase()) return;
  let queue = pending.get(db);
  if (!queue) {
    queue = new Map();
    pending.set(db, queue);
    void Promise.resolve().then(async () => {
      pending.delete(db);
      if (db !== getDatabase()) return;
      for (const [queuedKind, queuedScope] of queue!) {
        try { await checkPoolAnomaly(queuedKind, queuedScope, db); } catch { /* 诊断与学习隔离。 */ }
      }
    }).catch(() => {});
  }
  queue.set(kind, scope);
};
