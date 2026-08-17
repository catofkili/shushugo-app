/**
 * FSRS 状态持久化 + 历史回填。
 *
 * 三个学习阶段(单词 progress / 汉字 kanji_memory / 语法 grammar_progress)共用
 * 同一套 fsrs_* 列和同一个调度内核,这里只负责「读状态 → 记一次作答 → 写回」,
 * 以及把切换到 FSRS 之前的历史一次性重放成初始的 S/D/due。
 */
import { getDatabase } from "./database";
import { rowsFor, firstValue, getState, setState, studyDate } from "./database/db-utils";
import type { WordAnswer } from "../types/vocabulary";
import {
  recordReview,
  retrievability,
  MASTERED_INTERVAL_DAYS,
  LEECH_LAPSE_THRESHOLD,
  type FsrsState,
  type StepMode
} from "./fsrs-scheduler";

const FSRS_COLS = [
  ["fsrs_stability", "REAL"],
  ["fsrs_difficulty", "REAL"],
  ["fsrs_due", "TEXT"],
  ["fsrs_last_review", "TEXT"],
  ["fsrs_state", "INTEGER"],   // 0=New 1=Learning 2=Review 3=Relearning
  ["fsrs_steps", "INTEGER"],   // 学习步索引
  ["fsrs_reps", "INTEGER"],
  ["fsrs_lapses", "INTEGER"]   // 累计答错(leech 判据)
] as const;

/**
 * 一个「可被 FSRS 调度的实体表」。三个学习阶段各挂一张:
 * 单词 progress、汉字 kanji_memory、语法 grammar_progress。
 * 调度算法(fsrs-scheduler)本身与实体无关,这里只负责把状态存到对应的表。
 */
export interface FsrsEntity {
  table: string;
  idColumn: string;
  /** 「够格参与调度」的过滤条件(不含到期判定)。汉字表没有 known_forever 列。 */
  eligible: string;
}

/**
 * 从外部词单/MOJi 导入的词按每天 30 个滴灌激活(见 stage1 的
 * activateMojiMigratedReviews),没轮到的不进当日轮换。这个闸门必须写进
 * eligible 里 —— 否则一次导入几千个词会当天全部涌进到期池,表现为
 * 「凭空多出上千个债」。moji_migrated_reviews 由 local-schema 保证存在。
 */
const MOJI_NOT_ACTIVATED = `word_id NOT IN (
  SELECT word_id FROM moji_migrated_reviews WHERE activated_on IS NULL
)`;

export const WORD_FSRS: FsrsEntity = {
  table: "progress",
  idColumn: "word_id",
  eligible: `known_forever = 0 AND seen_count > 0 AND ${MOJI_NOT_ACTIVATED}`
};
/**
 * 汉字卡。eligible 不再要求 seen_count > 0:卡是「按需建出来」的(ensureDirectionCards),
 * 刚建出来那张 seen_count 就是 0 —— 要求 > 0 等于把新卡全挡在到期集外面,
 * 汉字模式永远是空的(这正是它历史上 kanji_progress 一行都没有的原因之一)。
 */
export const KANJI_FSRS: FsrsEntity = {
  table: "kanji_memory",
  idColumn: "word_id",
  eligible: "1 = 1"
};
/**
 * 反向(日语 → 释义)的长期记忆。以前反向没有任何持久状态,只有当天的 stage2_progress,
 * 关掉应用就没了 —— 现在它和正向、汉字一样是一张真正的卡,有自己的 due/S/D。
 *
 * eligible 不要求 seen_count > 0:反向卡是「按需建卡」的(见 ensureDirectionCards),
 * 建出来的那一刻就带着从正向折算来的状态,当天就该参与调度。
 */
export const REVERSE_FSRS: FsrsEntity = {
  table: "reverse_memory",
  idColumn: "word_id",
  eligible: "1 = 1"
};
export const GRAMMAR_FSRS: FsrsEntity = {
  table: "grammar_progress",
  idColumn: "grammar_id",
  eligible: "known_forever = 0 AND seen_count > 0"
};

/** 每个 db 实例已经加过列的表集合 */
const columnsReady = new WeakMap<object, Set<string>>();

/** 幂等加列 */
export function ensureFsrsColumns(entity: FsrsEntity = WORD_FSRS): void {
  const db = getDatabase();
  let done = columnsReady.get(db);
  if (!done) { done = new Set(); columnsReady.set(db, done); }
  if (done.has(entity.table)) return;
  const existing = new Set(
    rowsFor(`PRAGMA table_info(${entity.table})`).map((r) => String(r.name ?? ""))
  );
  for (const [name, type] of FSRS_COLS) {
    if (!existing.has(name)) db.run(`ALTER TABLE ${entity.table} ADD COLUMN ${name} ${type}`);
  }
  done.add(entity.table);
}

const FSRS_SELECT = "fsrs_stability, fsrs_difficulty, fsrs_due, fsrs_last_review, fsrs_state, fsrs_steps, fsrs_reps, fsrs_lapses";

const rowToState = (r: Record<string, unknown> | null): FsrsState | null => {
  if (!r || r.fsrs_stability == null || !r.fsrs_due) return null;
  return {
    stability: Number(r.fsrs_stability),
    difficulty: Number(r.fsrs_difficulty),
    due: String(r.fsrs_due),
    lastReview: String(r.fsrs_last_review ?? r.fsrs_due),
    // 旧四列数据(迁移前)缺这些 → 兜底成复习卡,scheduler.toCard 也有同样兜底
    state: r.fsrs_state == null ? 2 : Number(r.fsrs_state),
    steps: r.fsrs_steps == null ? 0 : Number(r.fsrs_steps),
    reps: r.fsrs_reps == null ? 1 : Number(r.fsrs_reps),
    lapses: r.fsrs_lapses == null ? 0 : Number(r.fsrs_lapses)
  };
};

/**
 * 从一行已经带着 fsrs_* 列的查询结果直接算「此刻预测答对的概率」。
 * 排片器用它区分「容易/难」,不必为每张卡再查一次库。
 * 没有调度记录的词(新词/未调度)返回 undefined —— 那是「没学过」不是「记不住」,
 * 由调用方决定当成什么。
 */
export function recallFromRow(row: Record<string, unknown>, now = new Date()): number | undefined {
  const state = rowToState(row);
  return state ? retrievability(state, now) : undefined;
}

export function readFsrsState(id: number, entity: FsrsEntity = WORD_FSRS): FsrsState | null {
  ensureFsrsColumns(entity);
  const rows = rowsFor(
    `SELECT ${FSRS_SELECT} FROM ${entity.table} WHERE ${entity.idColumn} = ?`,
    [id]
  );
  return rowToState(rows[0] ?? null);
}

export function writeFsrsState(id: number, s: FsrsState, entity: FsrsEntity = WORD_FSRS): void {
  ensureFsrsColumns(entity);
  getDatabase().run(
    `UPDATE ${entity.table} SET fsrs_stability = ?, fsrs_difficulty = ?, fsrs_due = ?, fsrs_last_review = ?,
       fsrs_state = ?, fsrs_steps = ?, fsrs_reps = ?, fsrs_lapses = ? WHERE ${entity.idColumn} = ?`,
    [s.stability, s.difficulty, s.due, s.lastReview, s.state, s.steps, s.reps, s.lapses, id]
  );
}

/**
 * 汉字接入 FSRS 的一次性迁移。
 *
 * 汉字没有逐条复习日志(只有 kanji_memory 的聚合计数),所以无法像单词那样精确重放。
 * 但实际数据量极小且形态单一——按 right/fuzzy/forgot 计数把当初的作答**近似重放**
 * 一遍(先对后错的顺序无从得知,按「对→模糊→忘」的稳妥顺序),时间锚在 last_seen_on。
 * 重放不出来的(seen_count>0 但三个计数全 0)按一次 know 处理。
 */
export function backfillKanjiFsrs(): { migrated: boolean; items: number } {
  if (getState("fsrs_backfilled_kanji", "") === "1") return { migrated: false, items: 0 };
  ensureFsrsColumns(KANJI_FSRS);

  const rows = rowsFor(`
    SELECT word_id, right_count, fuzzy_count, forgot_count, last_seen_on
    FROM kanji_memory
    WHERE seen_count > 0
  `);

  const db = getDatabase();
  let count = 0;
  db.run("BEGIN TRANSACTION");
  try {
    for (const r of rows) {
      const answers: WordAnswer[] = [
        ...Array(Math.max(Number(r.right_count ?? 0), 0)).fill("know" as const),
        ...Array(Math.max(Number(r.fuzzy_count ?? 0), 0)).fill("fuzzy" as const),
        ...Array(Math.max(Number(r.forgot_count ?? 0), 0)).fill("forgot" as const)
      ];
      if (!answers.length) answers.push("know");
      // 锚在最后一次学习那天,让「距今多久没复习」跟真实情况对得上
      const anchor = new Date(`${String(r.last_seen_on ?? "")}T12:00:00`);
      let when = Number.isNaN(anchor.getTime()) ? Date.now() - answers.length * 60_000 : anchor.getTime();
      let state: FsrsState | null = null;
      for (const answer of answers) {
        state = recordReview(state, answer, new Date(when));
        when += 60_000; // 同一场次内依次推进,保证时间单调
      }
      if (state) { writeFsrsState(Number(r.word_id), state, KANJI_FSRS); count++; }
    }
    db.run("COMMIT");
  } catch (e) {
    db.run("ROLLBACK");
    throw e;
  }
  setState("fsrs_backfilled_kanji", "1");
  return { migrated: true, items: count };
}

/**
 * 语法接入 FSRS。语法只需要建列——没学过的语法点在 FSRS 里就是 New 状态,
 * 第一次作答自然进入调度,不存在需要回填的历史。
 */
export function ensureGrammarFsrs(): void {
  ensureFsrsColumns(GRAMMAR_FSRS);
}

/**
 * 把一条目的 FSRS 状态清回「从未调度过」。
 * 撤销作答时用:如果这次作答是该条目的第一次,撤销后必须回到无状态,
 * 否则它会带着一个凭空出现的 due 留在调度里。
 */
export function clearFsrsState(id: number, entity: FsrsEntity = WORD_FSRS): void {
  ensureFsrsColumns(entity);
  getDatabase().run(
    `UPDATE ${entity.table} SET ${FSRS_COLS.map(([c]) => `${c} = NULL`).join(", ")}
     WHERE ${entity.idColumn} = ?`,
    [id]
  );
}

/** 撤销用:恢复到作答前的状态(prev 为 null 表示当时还没进过调度) */
export function restoreFsrsState(
  id: number,
  prev: FsrsState | null,
  entity: FsrsEntity = WORD_FSRS
): void {
  if (prev) writeFsrsState(id, prev, entity);
  else clearFsrsState(id, entity);
}

/** 读旧状态 → 记一次作答 → 写回。三个阶段的作答路径都走这里。 */
export function recordFsrsReview(
  id: number,
  answer: WordAnswer,
  now = new Date(),
  opts: { mode?: StepMode } = {},
  entity: FsrsEntity = WORD_FSRS
): FsrsState {
  const prev = readFsrsState(id, entity);
  const next = recordReview(prev, answer, now, opts);
  writeFsrsState(id, next, entity);
  return next;
}

/**
 * 一次性回填:把每个词的历史「当日首见」复习按时间顺序重放进 FSRS,
 * 落地初始 S/D/due。仿 ensureLadderColumns:用 state 标记幂等,只跑一次。
 * 合并库存在时间戳乱序 → 按 (word, day) 首条 + created_at 排序,并单调夹逼。
 */
export function backfillFsrsFromHistory(): { migrated: boolean; words: number } {
  ensureFsrsColumns();
  if (getState("fsrs_backfilled", "") === "1") return { migrated: false, words: 0 };

  // 每个 (word, 学习日) 的首条复习(已排除 known_forever 的当日重复噪声)
  const rows = rowsFor(`
    SELECT r.word_id, r.answer, r.created_at, r.reviewed_on
    FROM reviews r
    JOIN (
      SELECT word_id, reviewed_on, MIN(id) AS mid
      FROM reviews
      GROUP BY word_id, reviewed_on
    ) f ON f.mid = r.id
    ORDER BY r.word_id ASC, r.created_at ASC, r.id ASC
  `);

  const db = getDatabase();
  const byWord = new Map<number, { answer: WordAnswer; at: number }[]>();
  for (const r of rows) {
    const wid = Number(r.word_id);
    const at = new Date(String(r.created_at ?? r.reviewed_on).replace(" ", "T")).getTime();
    if (!byWord.has(wid)) byWord.set(wid, []);
    byWord.get(wid)!.push({ answer: String(r.answer) as WordAnswer, at: Number.isFinite(at) ? at : Date.now() });
  }

  let count = 0;
  db.run("BEGIN TRANSACTION");
  try {
    for (const [wid, seq] of byWord) {
      seq.sort((a, b) => a.at - b.at);
      let state: FsrsState | null = null;
      let lastAt = 0;
      for (const ev of seq) {
        const when = ev.at <= lastAt ? lastAt + 1000 : ev.at; // 乱序单调夹逼
        lastAt = when;
        state = recordReview(state, ev.answer, new Date(when));
      }
      if (state) { writeFsrsState(wid, state); count++; }
    }
    db.run("COMMIT");
  } catch (e) {
    db.run("ROLLBACK");
    throw e;
  }
  setState("fsrs_backfilled", "1");
  return { migrated: true, words: count };
}

const RECENT_DAILY_EASY_MIGRATION_KEY = "fsrs_recent_daily_easy_v1";
const RECENT_DAILY_EASY_DAYS = 8;

interface HistoricalWordReview {
  id: number;
  wordId: number;
  answer: WordAnswer;
  studyDay: string;
  at: number;
}

const historicalReviewTime = (studyDay: string, createdAt: unknown): number => {
  const fallback = new Date(`${studyDay}T12:00:00`).getTime();
  if (createdAt == null || String(createdAt).trim() === "") return fallback;
  const parsed = new Date(String(createdAt).replace(" ", "T")).getTime();
  return Number.isFinite(parsed) ? parsed : fallback;
};

const recentStudyDayRange = (endDay: string, count: number): { startDay: string; endDay: string } => {
  const start = new Date(`${endDay}T12:00:00`);
  start.setDate(start.getDate() - Math.max(count - 1, 0));
  return { startDay: studyDate(start), endDay };
};

/**
 * 修复 FSRS 切换前后最近几天的「当天首答认识」:
 * - 范围是最近 8 个学习日(含今天);
 * - 每个词当天第一条复习就是 know 时,该次用 Easy 重放;
 * - 重放使用原 review.created_at,所以不会把几天前的作答伪装成今天;
 * - reviews 原始记录完全不改,只重建 progress 的 FSRS 状态。
 *
 * 这是一次性迁移,用于把 FSRS 上线前已经发生的首答奖励补回来。
 */
export function migrateRecentDailyEasyReviews(
  current = new Date(),
  dayCount = RECENT_DAILY_EASY_DAYS,
  migrationKey = RECENT_DAILY_EASY_MIGRATION_KEY
): { migrated: boolean; words: number; reviews: number } {
  if (getState(migrationKey, "") === "1") {
    return { migrated: false, words: 0, reviews: 0 };
  }

  ensureFsrsColumns();
  const endDay = studyDate(current);
  const { startDay } = recentStudyDayRange(endDay, dayCount);
  const rows = rowsFor(`
    SELECT r.id, r.word_id, r.answer, r.reviewed_on, r.created_at
    FROM reviews r
    JOIN progress p ON p.word_id = r.word_id
    WHERE p.known_forever = 0
    ORDER BY r.word_id ASC, r.id ASC
  `);
  const byWord = new Map<number, HistoricalWordReview[]>();

  rows.forEach((row) => {
    const wordId = Number(row.word_id);
    const id = Number(row.id);
    const answer = String(row.answer) as WordAnswer;
    const reviewDay = String(row.reviewed_on ?? "");
    if (!Number.isFinite(wordId) || !Number.isFinite(id) || !reviewDay) return;
    if (!byWord.has(wordId)) byWord.set(wordId, []);
    byWord.get(wordId)!.push({
      id,
      wordId,
      answer,
      studyDay: reviewDay,
      at: historicalReviewTime(reviewDay, row.created_at)
    });
  });

  const affected = new Map<number, HistoricalWordReview[]>();
  let affectedReviewCount = 0;
  byWord.forEach((events, wordId) => {
    const firstByDay = new Map<string, HistoricalWordReview>();
    events.forEach((event) => {
      if (!firstByDay.has(event.studyDay)) firstByDay.set(event.studyDay, event);
    });
    const hasRecentDailyEasy = [...firstByDay.values()].some((event) => (
      event.studyDay >= startDay && event.studyDay <= endDay && event.answer === "know"
    ));
    if (hasRecentDailyEasy) {
      affected.set(wordId, events);
      affectedReviewCount += events.length;
    }
  });

  const db = getDatabase();
  let migratedWords = 0;
  db.run("BEGIN TRANSACTION");
  try {
    affected.forEach((events, wordId) => {
      const firstByDay = new Map<string, HistoricalWordReview>();
      events.forEach((event) => {
        if (!firstByDay.has(event.studyDay)) firstByDay.set(event.studyDay, event);
      });
      const sorted = [...events].sort((left, right) => left.at - right.at || left.id - right.id);
      const wrongCountByDay = new Map<string, number>();
      let state: FsrsState | null = null;
      let lastAt = 0;

      sorted.forEach((event) => {
        if (event.answer === "known_forever") return;
        // 历史回填原本只把窗口之前的每天首条送进 FSRS,这里保持同一基线;
        // 窗口内则保留每次真实作答,才能把首答 Easy 对后续状态的影响完整重放。
        if (event.studyDay < startDay && firstByDay.get(event.studyDay)?.id !== event.id) return;

        const inRecentWindow = event.studyDay >= startDay && event.studyDay <= endDay;
        const isFirstOfDay = firstByDay.get(event.studyDay)?.id === event.id;
        const wrongCount = wrongCountByDay.get(event.studyDay) ?? 0;
        const isWrong = event.answer === "forgot" || event.answer === "fuzzy";
        const wrongToday = wrongCount + (isWrong ? 1 : 0);
        const mode = inRecentWindow && isFirstOfDay && event.answer === "know"
          ? "known"
          : inRecentWindow && wrongToday >= 3
            ? "stubborn"
            : "normal";
        const when = event.at <= lastAt ? lastAt + 1000 : event.at;
        lastAt = when;
        state = recordReview(state, event.answer, new Date(when), { mode });
        if (isWrong && inRecentWindow) wrongCountByDay.set(event.studyDay, wrongToday);
      });

      if (state) {
        writeFsrsState(wordId, state);
        migratedWords += 1;
      }
    });
    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }

  setState(migrationKey, "1");
  return { migrated: true, words: migratedWords, reviews: affectedReviewCount };
}

const FULL_DAILY_EASY_MIGRATION_KEY = "fsrs_full_daily_easy_v1";
/** 够覆盖任何真实使用史的天数(约 27 年),用来把「窗口」放大成全量。 */
const FULL_HISTORY_DAYS = 10_000;

/**
 * 把「当天首答认识 = Easy」补到**全部**历史,而不只是最近 8 天。
 *
 * backfillFsrsFromHistory 当初把每一次「认识」都按 Good 重放(recordReview 不传
 * mode),而 App 实际的规则是当天第一次就点认识按 Easy 记。两者的差别在几个月的
 * 历史上会不断累积:间隔被系统性压短,迁移当天就表现为「凭空欠了一千多个词」。
 *
 * migrateRecentDailyEasyReviews 已经实现了正确的重放逻辑,只是窗口被限制在 8 天。
 * 这里用同一套逻辑跑全量,换一个幂等标记,让它在老库上再跑一次。
 */
export function migrateFullHistoryDailyEasy(current = new Date()) {
  return migrateRecentDailyEasyReviews(current, FULL_HISTORY_DAYS, FULL_DAILY_EASY_MIGRATION_KEY);
}

/**
 * 「已掌握」的 SQL 判据,与 fsrs-scheduler 的 isMastered 同口径:
 * 本次安排的间隔(下次到期 − 上次复习)≥ MASTERED_INTERVAL_DAYS 天。
 */
export const MASTERED_SQL =
  `(fsrs_due IS NOT NULL AND fsrs_last_review IS NOT NULL
    AND julianday(fsrs_due) - julianday(fsrs_last_review) >= ${MASTERED_INTERVAL_DAYS})`;

/** 尚未掌握、仍在日常轮换里的条目 */
export const NOT_MASTERED_SQL = `NOT ${MASTERED_SQL}`;

/**
 * 「到期待复习」的 SQL 判据(取代旧的 score <= 6)。带一个时间参数:
 * 传 studyDayEnd() 表示「本学习日内会到期的都算」,传此刻表示「现在就该复习的」。
 * fsrs_due 为空 = 已见过但还没进过调度,视同最高优先。
 */
export const DUE_SQL = "(fsrs_due IS NULL OR fsrs_due <= ?)";

/**
 * 「顽固词」的 SQL 判据(取代旧的 score <= -20 深坑池)。
 * 用 FSRS 原生的 lapses(累计在 Review 态答错次数),和 Anki 的 leech 同一口径。
 */
export const LEECH_SQL = `COALESCE(fsrs_lapses, 0) >= ${LEECH_LAPSE_THRESHOLD}`;

/** FSRS 视角「已掌握」的条目数(取代旧的 3 连胜自动退休) */
export function fsrsMasteredCount(entity: FsrsEntity = WORD_FSRS): number {
  ensureFsrsColumns(entity);
  return firstValue<number>(
    `SELECT COUNT(*) FROM ${entity.table} WHERE ${entity.eligible} AND ${MASTERED_SQL}`,
    [],
    0
  );
}

/**
 * FSRS 视角「此刻已到期」的条目数。
 *
 * 口径必须和 fsrsDueWordIds / pickStage1Next 完全一致 —— 都把「已见过但还没进过
 * 调度」(fsrs_due 为空)算作到期。以前这里额外要求 fsrs_due IS NOT NULL,于是
 * 界面上显示的积压数和当天真正会出的词对不上。
 */
export function fsrsDueCount(now = new Date(), entity: FsrsEntity = WORD_FSRS): number {
  ensureFsrsColumns(entity);
  return firstValue<number>(
    `SELECT COUNT(*) FROM ${entity.table}
     WHERE ${entity.eligible} AND (fsrs_due IS NULL OR fsrs_due <= ?)`,
    [now.toISOString()],
    0
  );
}

/**
 * FSRS 到期词的 word_id,按「最该复习优先」= due 升序(越过期越靠前)。
 * 已见但从未进入 FSRS 调度的词(fsrs_due 为空)视同最高优先,排最前。
 * 返回顺序天然逐日轮换,治「每天开头都是同一批」。
 */
/** 「最近栽过跟头」的时间窗:这么多小时内答错过的词,排在陈年积压前面 */
export const RECENT_LAPSE_HOURS = 36;

/**
 * 每天最多放这么多顽固词进当日计划,其余顺延。
 *
 * 用绝对数量而不是占比:顽固词的成本是**绝对消耗**,一个当天要刷三到五次才毕业,
 * 十个就是四十次作答、小半场。按占比算的话,复习量越大的日子放进来的顽固词越多,
 * 恰恰是最不该的时候。
 *
 * 被挡在外面的不会消失 —— 它们仍然是到期状态,后面几天照常轮到,
 * 想集中攻坚就进错题本模式(那里本来就是按 lapses 权重挑词的)。
 */
export const LEECH_DAILY_INTAKE = 10;

export function fsrsDueWordIds(
  limit: number,
  now = new Date(),
  entity: FsrsEntity = WORD_FSRS,
  leechIntake = LEECH_DAILY_INTAKE
): number[] {
  ensureFsrsColumns(entity);
  if (limit <= 0) return [];
  // 排序的第一优先级不是「谁最过期」,而是「谁刚栽过跟头」。
  //
  // 只按 due 升序的话:积压老词 due 是好几天前、昨天刚答错的词 due 是今天晚些,
  // 于是昨天错的全排在队尾,被当日限额整批挤掉 —— 实测昨天答错的 223 个词,
  // 今天的计划里一个都没有。刚忘掉的词隔天不复习,等于白错一场。
  const lapseSince = new Date(now.getTime() - RECENT_LAPSE_HOURS * 3600_000).toISOString();
  // 多取一些:顽固词被挡下来之后,要有非顽固词补上,才不会把当日计划做少了。
  const rows = rowsFor(
    `SELECT ${entity.idColumn} AS id, COALESCE(fsrs_lapses, 0) AS lapses FROM ${entity.table}
     WHERE ${entity.eligible}
       AND (fsrs_due IS NULL OR fsrs_due <= ?)
     ORDER BY (fsrs_due IS NULL) DESC,
              (fsrs_lapses > 0 AND fsrs_last_review >= ?) DESC,
              fsrs_due ASC,
              ${entity.idColumn} ASC
     LIMIT ?`,
    [now.toISOString(), lapseSince, limit * 3]
  );

  const picked: number[] = [];
  let leeches = 0;
  for (const row of rows) {
    if (picked.length >= limit) break;
    if (Number(row.lapses ?? 0) >= LEECH_LAPSE_THRESHOLD) {
      if (leeches >= leechIntake) continue;
      leeches += 1;
    }
    picked.push(Number(row.id));
  }
  return picked;
}
