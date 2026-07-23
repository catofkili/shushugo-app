/**
 * FSRS 状态持久化 + 历史回填 + 影子双写(阶段 P0)
 *
 * P0 目标:零用户可见变化。每次「当日首见」作答时,除现行分数系统外,
 * 额外把 FSRS 状态(S/D/due/lastReview)写进 progress 的四个新列——只写不读,
 * 供切换前对比「明日到期数」。切换(P1)时再把选词/到期判定改读这些列。
 */
import { getDatabase } from "./database";
import { rowsFor, firstValue, getState, setState } from "./database/db-utils";
import type { WordAnswer } from "../types/vocabulary";
import { recordReview, isDue, type FsrsState } from "./fsrs-scheduler";

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

const columnsReady = new WeakSet<object>();

/** 幂等加列;不破坏现有 score/streak 通路(保留只读,供回滚) */
export function ensureFsrsColumns(): void {
  const db = getDatabase();
  if (columnsReady.has(db)) return;
  const existing = new Set(rowsFor("PRAGMA table_info(progress)").map((r) => String(r.name ?? "")));
  for (const [name, type] of FSRS_COLS) {
    if (!existing.has(name)) db.run(`ALTER TABLE progress ADD COLUMN ${name} ${type}`);
  }
  columnsReady.add(db);
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

export function readFsrsState(wordId: number): FsrsState | null {
  ensureFsrsColumns();
  const rows = rowsFor(
    `SELECT ${FSRS_SELECT} FROM progress WHERE word_id = ?`,
    [wordId]
  );
  return rowToState(rows[0] ?? null);
}

export function writeFsrsState(wordId: number, s: FsrsState): void {
  ensureFsrsColumns();
  getDatabase().run(
    `UPDATE progress SET fsrs_stability = ?, fsrs_difficulty = ?, fsrs_due = ?, fsrs_last_review = ?,
       fsrs_state = ?, fsrs_steps = ?, fsrs_reps = ?, fsrs_lapses = ? WHERE word_id = ?`,
    [s.stability, s.difficulty, s.due, s.lastReview, s.state, s.steps, s.reps, s.lapses, wordId]
  );
}

/**
 * 影子写:仅在「当日首见」时调用。读旧 FSRS 状态 → 记一次作答 → 写回。
 * 不读不影响现行调度;P0 期间纯旁路。
 */
export function recordFsrsReview(wordId: number, answer: WordAnswer, now = new Date()): FsrsState {
  const prev = readFsrsState(wordId);
  const next = recordReview(prev, answer, now);
  writeFsrsState(wordId, next);
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

/** 对比埋点:FSRS 视角「此刻已到期」的词数(未永久掌握、已见过) */
export function fsrsDueCount(now = new Date()): number {
  ensureFsrsColumns();
  const rows = rowsFor(
    `SELECT ${FSRS_SELECT}
     FROM progress WHERE known_forever = 0 AND seen_count > 0 AND fsrs_due IS NOT NULL`
  );
  let due = 0;
  for (const r of rows) {
    const s = rowToState(r);
    if (s && isDue(s, now)) due++;
  }
  return due;
}

/** 对照组:现行系统「此刻积压」(score ≤ 6) */
export function currentSystemBacklogCount(): number {
  return firstValue<number>(
    "SELECT COUNT(*) FROM progress WHERE known_forever = 0 AND seen_count > 0 AND score <= 6",
    [],
    0
  );
}

/* ── 阶段 P1:切换开关(默认关。开=选词/到期读 FSRS,关=现行分数系统) ── */

export function isFsrsActive(): boolean {
  // 默认开(老算法已"关闭但保留"):仅当显式设为 "0" 才走旧分数系统,便于回滚。
  return getState("fsrs_active", "1") !== "0";
}
export function setFsrsActive(on: boolean): void {
  setState("fsrs_active", on ? "1" : "0");
}

/**
 * FSRS 到期词的 word_id,按「最该复习优先」= due 升序(越过期越靠前)。
 * 已见但从未进入 FSRS 调度的词(fsrs_due 为空)视同最高优先,排最前。
 * 返回顺序天然逐日轮换,治「每天开头都是同一批」。
 */
export function fsrsDueWordIds(limit: number, now = new Date()): number[] {
  ensureFsrsColumns();
  if (limit <= 0) return [];
  const rows = rowsFor(
    `SELECT word_id FROM progress
     WHERE known_forever = 0 AND seen_count > 0
       AND (fsrs_due IS NULL OR fsrs_due <= ?)
     ORDER BY (fsrs_due IS NULL) DESC, fsrs_due ASC, word_id ASC
     LIMIT ?`,
    [now.toISOString(), limit]
  );
  return rows.map((r) => Number(r.word_id));
}
