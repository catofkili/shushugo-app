/**
 * 隔离的 100 学习日压力模拟。
 *
 * 运行方式:
 *   cd frontend
 *   SIM_RUN=1 npx vitest run simulations/100-day-simulation.test.ts --reporter=verbose
 *   SIM_RUN=1 SIM_SCENARIOS=sprint-daily SIM_DAYS=100 SIM_WORD_LIMIT=1500 \
 *     npx vitest run simulations/100-day-simulation.test.ts --reporter=verbose
 *
 * 这个文件只在 Vitest 进程内使用 sql.js 内存数据库和 fake timers。
 * 它不会启动 Vite、不会连接浏览器 IndexedDB，也不会调用云同步。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import initSqlJs, { type Database } from "sql.js";

type Answer = "forgot" | "fuzzy" | "know" | "known_forever";
type Mode = "classic" | "mistakes" | "reverse" | "kanji" | "quick";
type MemoryBand = "strong" | "normal" | "weak";

interface Scenario {
  id: string;
  label: string;
  dailyGoal: number;
  reviewCap: number;
  memory: MemoryBand;
  attendance: (day: number, random: () => number) => boolean;
  mode: (day: number) => Mode;
  answerStyle?: "honest" | "optimistic" | "conservative" | "permanent";
  backlog?: { words: number; dueDaysAgo: number };
  boundaryProbe?: boolean;
  encoreRate?: number;
  undoRate?: number;
  secondsPerCard?: number;
  jumpRate?: number;
}

interface DailyMetric {
  day: number;
  studyDate: string;
  attended: boolean;
  mode: Mode | null;
  attempts: number;
  distinctWords: number;
  reviews: number;
  newTasks: number;
  reviewTasks: number;
  completed: number | null;
  totalTasks: number | null;
  backlog: number;
  nextDayDue: number;
}

interface Finding {
  kind: "exception" | "invariant" | "stall" | "boundary";
  user: string;
  day: number;
  mode: Mode | null;
  message: string;
  detail?: unknown;
}

interface UserRun {
  user: string;
  label: string;
  seed: number;
  days: number;
  attendedDays: number;
  totalAttempts: number;
  totalDistinctWords: number;
  totalReviews: number;
  finalBacklog: number;
  finalUnseen: number;
  findings: Finding[];
  daily: DailyMetric[];
  completedDays: number;
  aborted: boolean;
  dumpPath?: string;
  snapshotPath?: string;
}

const seedPath = fileURLToPath(new URL("../public/nihongo.db", import.meta.url));
const reportPath = process.env.SIM_REPORT_PATH ?? "/tmp/shushugo-100-day-simulation-report.json";
const simDumpPath = process.env.SIM_DUMP_DB?.trim() || null;
const configuredWordLimit = Math.max(0, Number(process.env.SIM_WORD_LIMIT ?? 0) || 0);
const simulationDays = Math.max(1, Math.min(100, Number(process.env.SIM_DAYS ?? 100) || 100));
const simDumpDay = Math.max(1, Math.min(simulationDays, Number(process.env.SIM_DUMP_DAY ?? Math.ceil(simulationDays / 2)) || Math.ceil(simulationDays / 2)));
const checkpointDays = Math.max(0, Number(process.env.SIM_CHECKPOINT_DAYS ?? 1) || 0);
const maxAttemptsOverride = Math.max(0, Number(process.env.SIM_MAX_ATTEMPTS ?? 0) || 0);
const sqlBudget = Math.max(0, Number(process.env.SIM_SQL_BUDGET ?? 180) || 180);
const DAY_MS = 86_400_000;
const START = new Date("2026-01-05T12:00:00");

let SQL: Awaited<ReturnType<typeof initSqlJs>>;
let currentDb: Database;
let baseDbBytes: Uint8Array;
let sqlCounter = { prepare: 0, run: 0, exec: 0 };

const instrumentDatabase = (db: Database): Database => {
  const target = db as Database & Record<string, unknown>;
  const originalPrepare = db.prepare.bind(db);
  const originalRun = db.run.bind(db);
  const originalExec = db.exec.bind(db);
  target.prepare = ((sql: string, params?: unknown[]) => {
    sqlCounter.prepare += 1;
    return originalPrepare(sql, params as never);
  }) as Database["prepare"];
  target.run = ((sql: string, params?: unknown[]) => {
    sqlCounter.run += 1;
    return originalRun(sql, params as never);
  }) as Database["run"];
  target.exec = ((sql: string, params?: unknown[]) => {
    sqlCounter.exec += 1;
    return originalExec(sql, params as never);
  }) as Database["exec"];
  return db;
};

const preferenceStore = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => preferenceStore.get(key) ?? null,
  setItem: (key: string, value: string) => preferenceStore.set(key, String(value)),
  removeItem: (key: string) => preferenceStore.delete(key),
  clear: () => preferenceStore.clear()
};
(globalThis as any).window = {
  dispatchEvent: () => true,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  matchMedia: () => ({ matches: false })
};

vi.mock("../src/lib/database", () => ({
  getDatabase: () => currentDb,
  initDatabase: async () => currentDb,
  exportDatabase: () => currentDb?.export() ?? null,
  importDatabase: async (bytes: Uint8Array) => { currentDb = instrumentDatabase(new SQL.Database(bytes)); }
}));
vi.mock("../src/lib/storage", () => ({ scheduleSave: () => undefined }));
vi.mock("../src/lib/progress-events", () => ({
  PROGRESS_UPDATED_EVENT: "simulation-progress",
  notifyProgressUpdated: () => undefined
}));

import {
  continueKanjiStudy,
  continueStage2Study,
  continueTodayPlanStudy,
  getQuickStudySession,
  getWordSession,
  submitQuickStudyBatch,
  submitWordAnswer,
  startEncore,
  undoLastWordAnswer,
  addWordStudySeconds,
  jumpToSimilarWord
} from "../src/lib/word-api";
import { ensureProgressInitialized } from "../src/lib/word-api/bootstrap";
import { readFsrsState, setFsrsActive, KANJI_FSRS, REVERSE_FSRS, WORD_FSRS } from "../src/lib/fsrs-store";
import { retrievability } from "../src/lib/fsrs-scheduler";
import { saveStudyPreferences, defaultStudyPreferences, REVIEW_CAP_UNLIMITED } from "../src/lib/studyPreferences";
import { studyDayEnd, today } from "../src/lib/database/db-utils";
import { resetInterferenceCache } from "../src/lib/scheduler/interference";
import type { WordCard, WordSessionResponse } from "../src/types/vocabulary";
import type { WordSessionOptions } from "../src/lib/study-types";

const one = (sql: string, params: unknown[] = []): unknown => {
  const statement = currentDb.prepare(sql);
  try {
    if (params.length) statement.bind(params as never);
    return statement.step() ? statement.get()[0] ?? null : null;
  } finally {
    statement.free();
  }
};

const rows = (sql: string, params: unknown[] = []): Record<string, unknown>[] => {
  const statement = currentDb.prepare(sql);
  try {
    if (params.length) statement.bind(params as never);
    const result: Record<string, unknown>[] = [];
    while (statement.step()) result.push(statement.getAsObject() as Record<string, unknown>);
    return result;
  } finally {
    statement.free();
  }
};

const makeRng = (seed: number) => {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
};

const dateAtDay = (day: number, hour = 12, minute = 0) => {
  const date = new Date(START.getTime() + day * DAY_MS);
  date.setHours(hour, minute, 0, 0);
  return date;
};

const attendance = {
  daily: () => true,
  workweek: (day: number) => new Date(START.getTime() + day * DAY_MS).getDay() >= 1
    && new Date(START.getTime() + day * DAY_MS).getDay() <= 5,
  weekend: (day: number) => {
    const weekday = new Date(START.getTime() + day * DAY_MS).getDay();
    return weekday === 0 || weekday === 6;
  },
  alternate: (day: number) => day % 2 === 0,
  sevenOnSevenOff: (day: number) => Math.floor(day / 7) % 2 === 0,
  holiday: (day: number) => day < 30 || day >= 60,
  random70: (_day: number, random: () => number) => random() < 0.7
};

const scenarios: Scenario[] = [
  { id: "light-daily", label: "轻量每日", dailyGoal: 5, reviewCap: 0, memory: "normal", attendance: attendance.daily, mode: () => "classic" },
  { id: "default-daily", label: "默认日常", dailyGoal: 15, reviewCap: 0, memory: "normal", attendance: attendance.daily, mode: () => "classic", encoreRate: 0.12, undoRate: 0.05, secondsPerCard: 12, jumpRate: 0.02 },
  { id: "serious-daily", label: "认真每日", dailyGoal: 30, reviewCap: 120, memory: "normal", attendance: attendance.daily, mode: () => "classic" },
  { id: "sprint-daily", label: "冲刺每日", dailyGoal: 50, reviewCap: REVIEW_CAP_UNLIMITED, memory: "normal", attendance: attendance.daily, mode: () => "classic" },
  { id: "strong-light", label: "强记忆轻量", dailyGoal: 5, reviewCap: 0, memory: "strong", attendance: attendance.daily, mode: () => "classic" },
  { id: "weak-daily", label: "弱记忆日常", dailyGoal: 15, reviewCap: 0, memory: "weak", attendance: attendance.daily, mode: () => "classic", encoreRate: 0.08, undoRate: 0.03, secondsPerCard: 15 },
  { id: "weak-sprint", label: "弱记忆冲刺", dailyGoal: 50, reviewCap: 120, memory: "weak", attendance: attendance.daily, mode: () => "classic" },
  { id: "workweek", label: "工作日用户", dailyGoal: 20, reviewCap: 100, memory: "normal", attendance: attendance.workweek, mode: () => "classic" },
  { id: "weekend", label: "周末集中", dailyGoal: 30, reviewCap: 150, memory: "normal", attendance: attendance.weekend, mode: () => "classic" },
  { id: "alternate", label: "隔日用户", dailyGoal: 25, reviewCap: 100, memory: "normal", attendance: attendance.alternate, mode: () => "classic" },
  { id: "seven-on-seven-off", label: "七学七停", dailyGoal: 30, reviewCap: 150, memory: "normal", attendance: attendance.sevenOnSevenOff, mode: () => "classic" },
  { id: "random", label: "随缘用户", dailyGoal: 15, reviewCap: 0, memory: "normal", attendance: attendance.random70, mode: () => "classic" },
  { id: "holiday-return", label: "长假回归", dailyGoal: 20, reviewCap: 150, memory: "weak", attendance: attendance.holiday, mode: () => "classic", backlog: { words: 1000, dueDaysAgo: 2 } },
  { id: "cap-30-backlog", label: "小上限积压", dailyGoal: 15, reviewCap: 30, memory: "normal", attendance: attendance.daily, mode: () => "classic", backlog: { words: 800, dueDaysAgo: 4 } },
  { id: "unlimited-backlog", label: "不限量积压", dailyGoal: 15, reviewCap: REVIEW_CAP_UNLIMITED, memory: "normal", attendance: attendance.daily, mode: () => "classic", backlog: { words: 800, dueDaysAgo: 4 } },
  { id: "optimistic", label: "乐观乱点认识", dailyGoal: 20, reviewCap: 100, memory: "weak", attendance: attendance.daily, mode: () => "classic", answerStyle: "optimistic" },
  { id: "conservative", label: "保守常点模糊", dailyGoal: 15, reviewCap: 100, memory: "strong", attendance: attendance.daily, mode: () => "classic", answerStyle: "conservative" },
  { id: "permanent-abuser", label: "滥用永久熟知", dailyGoal: 15, reviewCap: 100, memory: "normal", attendance: attendance.daily, mode: () => "classic", answerStyle: "permanent" },
  { id: "quick-pages", label: "快速学习分页", dailyGoal: 30, reviewCap: 120, memory: "normal", attendance: attendance.daily, mode: (day) => day % 4 === 0 ? "quick" : "classic" },
  { id: "reverse-switch", label: "正反向切换", dailyGoal: 15, reviewCap: 100, memory: "normal", attendance: attendance.daily, mode: (day) => day % 3 === 1 ? "reverse" : "classic" },
  { id: "kanji-switch", label: "汉字切换", dailyGoal: 15, reviewCap: 100, memory: "normal", attendance: attendance.daily, mode: (day) => day % 3 === 2 ? "kanji" : "classic" },
  { id: "mistake-notebook", label: "错题本用户", dailyGoal: 15, reviewCap: 100, memory: "weak", attendance: attendance.daily, mode: (day) => day % 5 === 4 ? "mistakes" : "classic" },
  { id: "boundary", label: "凌晨四点跨界", dailyGoal: 10, reviewCap: 80, memory: "normal", attendance: attendance.daily, mode: () => "classic", boundaryProbe: true, encoreRate: 0.1, undoRate: 0.05, secondsPerCard: 12, jumpRate: 0.02 }
];

const selectedScenarioIds = process.env.SIM_SCENARIOS?.split(",").map((id) => id.trim()).filter(Boolean);
const activeScenarios = selectedScenarioIds?.length
  ? scenarios.filter((scenario) => selectedScenarioIds.includes(scenario.id))
  : scenarios;
const shouldRunSimulation = process.env.SIM_RUN === "1";

const expectedFirstRecall = (band: MemoryBand): number => (
  band === "strong" ? 0.86 : band === "weak" ? 0.48 : 0.68
);

const memoryMultiplier = (band: MemoryBand): number => (
  band === "strong" ? 1.12 : band === "weak" ? 0.82 : 1
);

const chooseAnswer = (
  card: WordCard,
  scenario: Scenario,
  random: () => number,
  mode: Mode
): Answer => {
  const entity = mode === "reverse" ? REVERSE_FSRS : mode === "kanji" ? KANJI_FSRS : WORD_FSRS;
  const state = readFsrsState(card.id, entity);
  let probability = expectedFirstRecall(scenario.memory);
  if (state) {
    const r = retrievability(state, new Date());
    probability = Math.max(0.05, Math.min(0.98, r * memoryMultiplier(scenario.memory)));
  }

  const difficulty = Math.min(0.24, Math.max(0, (100 - card.importanceScore) / 500));
  probability = Math.max(0.03, Math.min(0.98, probability - difficulty));
  const recalled = random() < probability;
  if (scenario.answerStyle === "optimistic" && !recalled && random() < 0.38) return "know";
  if (scenario.answerStyle === "conservative" && recalled && random() < 0.42) return "fuzzy";
  if (scenario.answerStyle === "permanent" && recalled && random() < 0.12) return "known_forever";
  if (recalled) return "know";
  return random() < (scenario.memory === "weak" ? 0.34 : 0.24) ? "fuzzy" : "forgot";
};

const seedBacklog = (scenario: Scenario) => {
  if (!scenario.backlog) return;
  const anchor = dateAtDay(0);
  const due = new Date(anchor.getTime() - scenario.backlog.dueDaysAgo * DAY_MS).toISOString();
  const last = new Date(anchor.getTime() - 30 * DAY_MS).toISOString();
  const lastSeenDay = new Date(anchor.getTime() - 30 * DAY_MS).toISOString().slice(0, 10);
  currentDb.run(`
    UPDATE progress SET
      seen_count = 6,
      known_forever = 0,
      right_count = 4,
      fuzzy_count = 1,
      forgot_count = 1,
      fsrs_stability = 8 + (word_id % 20),
      fsrs_difficulty = 4 + (word_id % 6),
      fsrs_last_review = ?,
      fsrs_due = ?,
      fsrs_state = 2,
      fsrs_steps = 0,
      fsrs_reps = 6,
      fsrs_lapses = CASE WHEN word_id % 13 = 0 THEN 9 ELSE word_id % 3 END,
      last_seen_on = ?
    WHERE word_id IN (SELECT id FROM sim_subset_ids) AND word_id <= ?
  `, [last, due, lastSeenDay, scenario.backlog.words]);
};

const shrinkToWordSubset = () => {
  const target = configuredWordLimit || Math.max(
    1500,
    ...scenarios.map((scenario) => scenario.dailyGoal * simulationDays * 2)
  );
  currentDb.run("PRAGMA foreign_keys=OFF");
  // 按 JLPT 层级和 importance 分层轮询取样，而不是简单截取前 N 个 id；
  // 这样高频/低频、N5~N1 和未分级词都会进入压力样本，同时仍保留真实 schema。
  const sourceRows = rows("SELECT id, jlpt_level, importance FROM words ORDER BY id");
  const groups = new Map<string, number[]>();
  sourceRows.forEach((row) => {
    const key = `${String(row.jlpt_level ?? "Unleveled")}:${String(row.importance ?? "3")}`;
    const ids = groups.get(key) ?? [];
    ids.push(Number(row.id));
    groups.set(key, ids);
  });
  const selected: number[] = [];
  const cursors = new Map<string, number>();
  while (selected.length < target && groups.size) {
    let progressed = false;
    for (const [key, ids] of groups) {
      const cursor = cursors.get(key) ?? 0;
      if (cursor >= ids.length) continue;
      selected.push(ids[cursor]);
      cursors.set(key, cursor + 1);
      progressed = true;
      if (selected.length >= target) break;
    }
    if (!progressed) break;
  }
  currentDb.run("CREATE TEMP TABLE sim_subset_ids (id INTEGER PRIMARY KEY)");
  for (const id of selected) currentDb.run("INSERT INTO sim_subset_ids (id) VALUES (?)", [id]);
  // 仅删除模拟副本中的词条及其用户行；正式应用数据库不会被打开或写入。
  ["reviews", "stage1_tasks", "reverse_memory", "kanji_memory", "kanji_reading_memory", "word_notes", "moji_migrated_reviews"].forEach((table) => {
    const exists = Number(one("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", [table]) ?? 0);
    if (exists) currentDb.run(`DELETE FROM ${table} WHERE word_id NOT IN (SELECT id FROM sim_subset_ids)`);
  });
  currentDb.run("DELETE FROM progress WHERE word_id NOT IN (SELECT id FROM sim_subset_ids)");
  currentDb.run("DELETE FROM words WHERE id NOT IN (SELECT id FROM sim_subset_ids)");
};

const configureUser = (scenario: Scenario) => {
  preferenceStore.clear();
  saveStudyPreferences({
    ...defaultStudyPreferences,
    dailyGoal: scenario.dailyGoal,
    reviewCap: scenario.reviewCap
  });
  currentDb.run("DELETE FROM stage1_tasks");
  currentDb.run("DELETE FROM stage2_progress");
  currentDb.run("DELETE FROM kanji_progress");
  currentDb.run("DELETE FROM kanji_reading_progress");
  currentDb.run("DELETE FROM reviews");
  currentDb.run("DELETE FROM checkins");
  currentDb.run("DELETE FROM word_study_time");
  currentDb.run("DELETE FROM app_state WHERE key NOT IN ('jlpt_seed_version', 'grammar_seed_version')");
  currentDb.run(`UPDATE progress SET
    seen_count=0, known_forever=0, last_seen_on=NULL,
    right_count=0, fuzzy_count=0, forgot_count=0, mistake_streak=0,
    fsrs_stability=NULL, fsrs_difficulty=NULL, fsrs_due=NULL,
    fsrs_last_review=NULL, fsrs_state=NULL, fsrs_steps=NULL,
    fsrs_reps=NULL, fsrs_lapses=NULL`);
  currentDb.run("DELETE FROM reverse_memory");
  currentDb.run("DELETE FROM kanji_memory");
  currentDb.run("DELETE FROM kanji_reading_memory");
  setFsrsActive(true);
  resetInterferenceCache();
  seedBacklog(scenario);
};

const snapshotDaily = (day: number, attended: boolean, mode: Mode | null, attempts: number): DailyMetric => {
  const studyDate = today();
  const isStage1Metric = mode === "classic" || mode === "quick";
  const task = rows("SELECT task_type, COUNT(*) AS n FROM stage1_tasks WHERE reviewed_on = ? GROUP BY task_type", [studyDate]);
  const newTasks = Number(task.find((row) => row.task_type === "new")?.n ?? 0);
  const reviewTasks = Number(task.find((row) => row.task_type === "review")?.n ?? 0);
  const progress = isStage1Metric ? rows(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN known_forever = 1 OR (fsrs_due IS NOT NULL AND fsrs_due > ?) THEN 1 ELSE 0 END) AS completed
    FROM stage1_tasks t JOIN progress p ON p.word_id = t.word_id
    WHERE t.reviewed_on = ?
  `, [studyDayEnd().toISOString(), studyDate])[0] ?? {} : {};
  const distinctWords = Number(one("SELECT COUNT(DISTINCT word_id) FROM reviews WHERE reviewed_on = ?", [studyDate]) ?? 0);
  const reviews = Number(one("SELECT COUNT(*) FROM reviews WHERE reviewed_on = ?", [studyDate]) ?? 0);
  const backlog = Number(one(`SELECT COUNT(*) FROM progress
    WHERE known_forever=0 AND seen_count>0 AND (fsrs_due IS NULL OR fsrs_due <= ?)
  `, [studyDayEnd().toISOString()]) ?? 0);
  const nextDayDue = Number(one(`SELECT COUNT(*) FROM progress
    WHERE known_forever=0 AND seen_count>0 AND (fsrs_due IS NULL OR fsrs_due <= ?)
  `, [new Date(studyDayEnd().getTime() + DAY_MS).toISOString()]) ?? 0);
  return {
    day,
    studyDate,
    attended,
    mode,
    attempts,
    distinctWords,
    reviews,
    newTasks,
    reviewTasks,
    completed: isStage1Metric ? Math.min(Number(progress.completed ?? 0), Number(progress.total ?? 0)) : null,
    totalTasks: isStage1Metric ? Number(progress.total ?? 0) : null,
    backlog,
    nextDayDue
  };
};

const checkInvariants = (user: string, day: number, mode: Mode | null, findings: Finding[]) => {
  const studyDate = today();
  const push = (kind: Finding["kind"], message: string, detail?: unknown) => findings.push({ user, day, mode, kind, message, detail });

  const duplicateTasks = rows(`SELECT word_id, COUNT(*) AS n FROM stage1_tasks WHERE reviewed_on = ? GROUP BY word_id HAVING n > 1`, [studyDate]);
  if (duplicateTasks.length) push("invariant", "同一学习日出现重复 stage1 task", duplicateTasks.slice(0, 5));

  for (const [table, label] of [["stage2_progress", "反向"], ["kanji_reading_progress", "汉字读音"]] as const) {
    const duplicate = rows(`SELECT word_id, COUNT(*) AS n FROM ${table} WHERE reviewed_on = ? GROUP BY word_id HAVING n > 1`, [studyDate]);
    if (duplicate.length) push("invariant", `${label}计划出现重复任务`, duplicate.slice(0, 5));
    const orphan = Number(one(`SELECT COUNT(*) FROM ${table} t LEFT JOIN words w ON w.id=t.word_id WHERE w.id IS NULL`) ?? 0);
    if (orphan) push("invariant", `${label}计划存在孤儿词条`, orphan);
    const hasCompleted = Number(one(`SELECT COUNT(*) FROM pragma_table_info('${table}') WHERE name='completed'`) ?? 0);
    if (hasCompleted) {
      const badCompletion = Number(one(`SELECT COUNT(*) FROM ${table} WHERE completed NOT IN (0, 1)`) ?? 0);
      if (badCompletion) push("invariant", `${label}计划 completed 非 0/1`, badCompletion);
    }
  }

  const badDue = rows(`SELECT word_id, fsrs_due, fsrs_last_review FROM progress
    WHERE fsrs_due IS NOT NULL AND (julianday(fsrs_due) IS NULL OR julianday(fsrs_last_review) IS NULL OR fsrs_due < fsrs_last_review)`);
  if (badDue.length) push("invariant", "FSRS due 无效或早于 last_review", badDue.slice(0, 5));

  const badDirection = Number(one("SELECT COUNT(*) FROM reviews WHERE direction IS NULL OR direction NOT IN ('forward','reverse','kanji','kanji_reading')") ?? 0);
  if (badDirection) push("invariant", "reviews 出现无效 direction", badDirection);

  const badNew = Number(one(`SELECT COUNT(*) FROM stage1_tasks WHERE reviewed_on = ? AND task_type='new'`, [studyDate]) ?? 0);
  const dailyGoal = Number(JSON.parse(preferenceStore.get("mn-study-preferences") ?? "{}").dailyGoal ?? 15);
  if (badNew > dailyGoal) push("invariant", "今日新词任务超过 dailyGoal", { badNew, dailyGoal });

  const progressRow = rows(`SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN p.known_forever=1 OR (p.fsrs_due IS NOT NULL AND p.fsrs_due > ?) THEN 1 ELSE 0 END) AS completed
    FROM stage1_tasks t JOIN progress p ON p.word_id = t.word_id
    WHERE t.reviewed_on = ?`, [studyDayEnd().toISOString(), studyDate])[0] ?? {};
  if (Number(progressRow.completed ?? 0) > Number(progressRow.total ?? 0)) {
    push("invariant", "今日完成数超过今日任务总数", progressRow);
  }

  const orphanReviews = Number(one(`SELECT COUNT(*) FROM reviews r LEFT JOIN words w ON w.id=r.word_id WHERE w.id IS NULL`) ?? 0);
  if (orphanReviews) push("invariant", "reviews 存在不存在的 word_id", orphanReviews);

  const currentCard = Number(one("SELECT value FROM app_state WHERE key='current_card'") ?? 0);
  if (currentCard && !Number(one("SELECT 1 FROM words WHERE id=?", [currentCard]) ?? 0)) {
    push("invariant", "current_card 指向不存在的词", currentCard);
  }

  const todayDirections = rows("SELECT direction, COUNT(*) AS n FROM reviews WHERE reviewed_on = ? GROUP BY direction", [studyDate]);
  for (const row of todayDirections) {
    if (!(["forward", "reverse", "kanji", "kanji_reading"] as string[]).includes(String(row.direction))) {
      push("invariant", "今日复习方向不在三种正式方向内", row);
    }
  }
};

const runClassicLike = (
  scenario: Scenario,
  mode: Mode,
  random: () => number,
  maxAttempts: number,
  findings: Finding[],
  user: string,
  day: number,
  options: WordSessionOptions = {}
): number => {
  let response: WordSessionResponse;
  if (mode === "reverse") response = continueStage2Study();
  else if (mode === "kanji") response = continueKanjiStudy();
  else response = mode === "mistakes" ? getWordSession({ focus: "mistakes" }) : continueTodayPlanStudy();

  const taskTable = mode === "reverse" ? "stage2_progress" : mode === "kanji" ? "kanji_reading_progress" : "stage1_tasks";
  const derivedTasks = Number(one(`SELECT COUNT(*) FROM ${taskTable} WHERE reviewed_on = ?`, [today()]) ?? 0);
  const attemptBudget = maxAttempts > 0 ? maxAttempts : Math.max(30, derivedTasks * 8);
  let attempts = 0;
  while (response.card && attempts < attemptBudget) {
    const card = response.card;
    if (scenario.jumpRate && random() < scenario.jumpRate && card.similarMeaning?.items.length) {
      const target = card.similarMeaning.items[0];
      const beforeReviews = Number(one("SELECT COUNT(*) FROM reviews") ?? 0);
      try {
        response = jumpToSimilarWord(card.id, target.id, options);
      } catch (error) {
        findings.push({ user, day, mode, kind: "exception", message: `相似词跳转抛出异常: ${String(error)}`, detail: { wordId: card.id, targetId: target.id } });
        break;
      }
      attempts += 1;
      const afterReviews = Number(one("SELECT COUNT(*) FROM reviews") ?? 0);
      if (afterReviews !== beforeReviews + 1) findings.push({ user, day, mode, kind: "invariant", message: "相似词跳转没有恰好新增一条 review", detail: { wordId: card.id, targetId: target.id, beforeReviews, afterReviews } });
      if (scenario.secondsPerCard && scenario.secondsPerCard > 0) addWordStudySeconds(scenario.secondsPerCard);
      continue;
    }
    // 不在这里把 getWordSession() 当成“刷新页面”调用：它的契约就是取下一张卡。
    // 真实同步场景由 App 在学习页只更新概览，不调用 loadNext；因此不能用它制造
    // “刷新换卡”的假阳性。
    const answer = chooseAnswer(card, scenario, random, mode);
    const beforeReviews = Number(one("SELECT COUNT(*) FROM reviews") ?? 0);
    const entity = mode === "reverse" ? REVERSE_FSRS : mode === "kanji" ? KANJI_FSRS : WORD_FSRS;
    const stateBeforeAnswer = readFsrsState(card.id, entity);
    const sqlBefore = { ...sqlCounter };
    try {
      response = submitWordAnswer(card.id, answer, mode === "mistakes" ? { focus: "mistakes" } : options);
    } catch (error) {
      findings.push({ user, day, mode, kind: "exception", message: `提交作答抛出异常: ${String(error)}`, detail: { wordId: card.id, answer } });
      break;
    }
    attempts += 1;
    const afterReviews = Number(one("SELECT COUNT(*) FROM reviews") ?? 0);
    const sqlDelta = (sqlCounter.prepare - sqlBefore.prepare) + (sqlCounter.run - sqlBefore.run) + (sqlCounter.exec - sqlBefore.exec);
    if (sqlDelta > sqlBudget) findings.push({ user, day, mode, kind: "invariant", message: "单次作答 SQL 操作数超过预算", detail: { wordId: card.id, sqlDelta, sqlBudget } });
    if (afterReviews !== beforeReviews + 1) {
      findings.push({ user, day, mode, kind: "invariant", message: "一次正式作答没有恰好新增一条 review", detail: { wordId: card.id, answer, beforeReviews, afterReviews } });
    }
    if (scenario.secondsPerCard && scenario.secondsPerCard > 0) addWordStudySeconds(scenario.secondsPerCard);
    if (scenario.undoRate && random() < scenario.undoRate && response.canUndo) {
      const reviewCountBeforeUndo = afterReviews;
      try {
        response = undoLastWordAnswer(mode === "mistakes" ? { focus: "mistakes" } : options);
      } catch (error) {
        findings.push({ user, day, mode, kind: "exception", message: `撤销作答抛出异常: ${String(error)}` });
        break;
      }
      const reviewCountAfterUndo = Number(one("SELECT COUNT(*) FROM reviews") ?? 0);
      const stateAfterUndo = readFsrsState(card.id, entity);
      const stateRestored = JSON.stringify(stateBeforeAnswer) === JSON.stringify(stateAfterUndo);
      if (reviewCountAfterUndo !== reviewCountBeforeUndo - 1 || !stateRestored) {
        findings.push({ user, day, mode, kind: "invariant", message: "撤销没有完整回滚 review 和 FSRS 状态", detail: { wordId: card.id, reviewCountBeforeUndo, reviewCountAfterUndo, stateRestored } });
      }
    }
  }
  if (response.card && attempts >= attemptBudget) {
    const remaining = Number(one(`SELECT COUNT(*) FROM ${taskTable} t
      JOIN progress p ON p.word_id = t.word_id
      WHERE t.reviewed_on = ?
        AND p.known_forever = 0
        AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?)
    `, [today(), studyDayEnd().toISOString()]) ?? 0);
    if (remaining > 0) findings.push({ user, day, mode, kind: "stall", message: "达到按任务量×8推导的作答预算时仍有未完成任务", detail: { wordId: response.card.id, maxAttempts: attemptBudget, remaining } });
  }
  return attempts;
};

const runQuick = (scenario: Scenario, random: () => number, maxCards: number, findings: Finding[], user: string, day: number): number => {
  let total = 0;
  const seen = new Set<number>();
  let pages = 0;
  const derivedTasks = Number(one("SELECT COUNT(*) FROM stage1_tasks WHERE reviewed_on = ?", [today()]) ?? 0);
  const cardBudget = maxCards > 0 ? maxCards : Math.max(30, derivedTasks * 8);
  while (total < cardBudget && pages < Math.ceil(cardBudget / 50) + 1) {
    const page = getQuickStudySession(Math.min(50, cardBudget - total), [...seen]);
    if (!page.cards.length) break;
    const ids = page.cards.map((card) => card.id);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index || seen.has(id));
    if (duplicates.length) findings.push({ user, day, mode: "quick", kind: "invariant", message: "快速学习页出现重复词", detail: duplicates });
    ids.forEach((id) => seen.add(id));
    const answers = page.cards.map((card) => ({ wordId: card.id, answer: chooseAnswer(card, scenario, random, "quick") }));
    const beforeReviews = Number(one("SELECT COUNT(*) FROM reviews") ?? 0);
    try {
      submitQuickStudyBatch(answers, page.phase);
    } catch (error) {
      findings.push({ user, day, mode: "quick", kind: "exception", message: `快速学习批量提交抛出异常: ${String(error)}` });
      break;
    }
    const afterReviews = Number(one("SELECT COUNT(*) FROM reviews") ?? 0);
    if (afterReviews !== beforeReviews + page.cards.length) findings.push({ user, day, mode: "quick", kind: "invariant", message: "快速学习批量提交的 review 数量不等于卡片数", detail: { expected: page.cards.length, beforeReviews, afterReviews } });
    if (scenario.secondsPerCard && scenario.secondsPerCard > 0) addWordStudySeconds(scenario.secondsPerCard * page.cards.length);
    total += page.cards.length;
    pages += 1;
  }
  return total;
};

const dumpPathFor = (scenario: Scenario, seed: number, kind: "snapshot" | "final"): string | null => {
  if (!simDumpPath) return null;
  const singleRun = activeScenarios.length === 1 && seeds.length === 1;
  if (singleRun && kind === "final") return simDumpPath;
  const suffix = `${scenario.id}.seed${seed}.${kind === "snapshot" ? `day${simDumpDay}` : "final"}.db`;
  return `${simDumpPath}.${suffix}`;
};

const dumpCurrentDb = (path: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, currentDb.export());
};

const runUser = (scenario: Scenario, seed: number): UserRun => {
  console.log(`SIM_USER_START=${scenario.id}`);
  currentDb = instrumentDatabase(new SQL.Database(baseDbBytes));
  vi.setSystemTime(dateAtDay(0));
  sqlCounter = { prepare: 0, run: 0, exec: 0 };
  configureUser(scenario);
  const findings: Finding[] = [];
  const daily: DailyMetric[] = [];
  const random = makeRng(seed);
  let totalAttempts = 0;
  let totalDistinct = 0;
  let totalReviews = 0;
  let attendedDays = 0;
  let aborted = false;
  let snapshotPath: string | undefined;

  for (let day = 0; day < simulationDays; day += 1) {
    const attends = scenario.attendance(day, random);
    const mode = attends ? scenario.mode(day) : null;
    if (attends) attendedDays += 1;

    try {
      vi.setSystemTime(dateAtDay(day));
      let attempts = 0;
      if (attends) {
        if (scenario.boundaryProbe && day === 20) {
          vi.setSystemTime(dateAtDay(day, 3, 55));
          const before = getWordSession();
          if (before.card) {
            vi.setSystemTime(dateAtDay(day, 4, 5));
            try {
              submitWordAnswer(before.card.id, chooseAnswer(before.card, scenario, random, "classic"));
            } catch (error) {
              findings.push({ user: scenario.id, day, mode: "classic", kind: "exception", message: `4点跨界提交当前卡失败: ${String(error)}` });
            }
          }
          vi.setSystemTime(dateAtDay(day));
        }
        const maxAttempts = maxAttemptsOverride;
        attempts = mode === "quick"
          ? runQuick(scenario, random, maxAttempts, findings, scenario.id, day)
          : runClassicLike(scenario, mode ?? "classic", random, maxAttempts, findings, scenario.id, day);
        if (mode === "classic" && scenario.encoreRate && random() < scenario.encoreRate) {
          try {
            startEncore();
            attempts += runClassicLike(scenario, "classic", random, maxAttempts, findings, scenario.id, day);
          } catch (error) {
            findings.push({ user: scenario.id, day, mode, kind: "exception", message: `续杯流程抛出异常: ${String(error)}` });
            throw error;
          }
        }
        totalAttempts += attempts;
      }
      const metric = snapshotDaily(day, attends, mode, attempts);
      totalDistinct += metric.distinctWords;
      totalReviews += metric.reviews;
      daily.push(metric);
      checkInvariants(scenario.id, day, mode, findings);
      if (simDumpPath && day + 1 === simDumpDay) {
        snapshotPath = dumpPathFor(scenario, seed, "snapshot") ?? undefined;
        if (snapshotPath) dumpCurrentDb(snapshotPath);
      }
      if (checkpointDays > 0 && (day + 1) % checkpointDays === 0) {
        // 模拟关闭/重开应用：只保存这份隔离 SQLite，然后换一个 sql.js 实例。
        // 这会把 WASM 临时堆释放掉，同时验证跨重启的 FSRS、队列和 app_state。
        const checkpoint = currentDb.export();
        currentDb.close();
        currentDb = instrumentDatabase(new SQL.Database(checkpoint));
        resetInterferenceCache();
      }
    } catch (error) {
      findings.push({ user: scenario.id, day, mode, kind: "exception", message: `学习日执行抛出异常: ${String(error)}` });
      aborted = true;
      break;
    }
  }

  let finalBacklog = 0;
  let finalUnseen = 0;
  try {
    finalBacklog = Number(one("SELECT COUNT(*) AS n FROM progress WHERE known_forever=0 AND seen_count>0 AND (fsrs_due IS NULL OR fsrs_due <= ?)", [studyDayEnd().toISOString()]) ?? 0);
    finalUnseen = Number(one("SELECT COUNT(*) FROM progress WHERE known_forever=0 AND seen_count=0") ?? 0);
  } catch (error) {
    findings.push({ user: scenario.id, day: simulationDays - 1, mode: null, kind: "exception", message: `最终汇总查询失败: ${String(error)}` });
  }
  const dumpPath = dumpPathFor(scenario, seed, "final") ?? undefined;
  if (dumpPath) dumpCurrentDb(dumpPath);
  const result: UserRun = {
    user: scenario.id,
    label: scenario.label,
    seed,
    days: daily.length,
    attendedDays,
    totalAttempts,
    totalDistinctWords: totalDistinct,
    totalReviews,
    finalBacklog,
    finalUnseen,
    findings,
    daily,
    completedDays: daily.length,
    aborted,
    dumpPath,
    snapshotPath
  };
  currentDb.close();
  return result;
};

  const seeds = (process.env.SIM_SEEDS ?? "17,23,41").split(",")
  .map((seed) => Number(seed.trim()))
  .filter((seed) => Number.isFinite(seed));
const allRuns: UserRun[] = [];

const writeReport = () => {
  const report = {
    generatedAt: new Date().toISOString(),
    source: "frontend/public/nihongo.db copied into isolated sql.js memory databases",
    config: {
      simulationDays,
      wordLimit: configuredWordLimit || "auto",
      checkpointDays,
      scenarios: activeScenarios.map((scenario) => scenario.id),
      seeds,
      dumpDb: simDumpPath ? { path: simDumpPath, snapshotDay: simDumpDay } : null
    },
    users: allRuns,
    summary: {
      users: allRuns.length,
      userDays: allRuns.reduce((sum, run) => sum + run.completedDays, 0),
      abortedUsers: allRuns.filter((run) => run.aborted).length,
      findings: allRuns.reduce((sum, run) => sum + run.findings.length, 0),
      exceptions: allRuns.reduce((sum, run) => sum + run.findings.filter((finding) => finding.kind === "exception").length, 0),
      invariantViolations: allRuns.reduce((sum, run) => sum + run.findings.filter((finding) => finding.kind === "invariant").length, 0),
      stalls: allRuns.reduce((sum, run) => sum + run.findings.filter((finding) => finding.kind === "stall").length, 0)
    }
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`SIMULATION_REPORT=${reportPath}`);
  console.log(JSON.stringify(report.summary));
};

describe.skipIf(!shouldRunSimulation)("隔离的 100 学习日虚拟用户模拟", () => {
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(START);
    SQL = await initSqlJs();
    const seedBytes = new Uint8Array(readFileSync(seedPath));
    currentDb = instrumentDatabase(new SQL.Database(seedBytes));
    ensureProgressInitialized();
    shrinkToWordSubset();
    baseDbBytes = currentDb.export();
    currentDb.close();
    mkdirSync(dirname(reportPath), { recursive: true });
  }, 120_000);

  afterAll(() => {
    writeReport();
    vi.useRealTimers();
  });

  describe.each(activeScenarios)("%s", (scenario) => {
    it("完成配置的全部学习日且零异常零不变量违规", () => {
      for (const seed of seeds) {
        const run = runUser(scenario, seed);
        allRuns.push(run);
        writeReport();
        expect(run.aborted, JSON.stringify(run.findings.slice(-5), null, 2)).toBe(false);
        expect(run.completedDays, JSON.stringify(run.findings.slice(-5), null, 2)).toBe(simulationDays);
        expect(run.findings.filter((finding) => finding.kind === "exception"), JSON.stringify(run.findings.slice(0, 10), null, 2)).toEqual([]);
        expect(run.findings.filter((finding) => finding.kind === "invariant"), JSON.stringify(run.findings.slice(0, 10), null, 2)).toEqual([]);
        expect(run.findings.filter((finding) => finding.kind === "stall"), JSON.stringify(run.findings.slice(0, 10), null, 2)).toEqual([]);
      }
    }, 600_000);
  });
});
