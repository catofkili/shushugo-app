#!/usr/bin/env node
/**
 * 查「我现在这个词学成什么样了」——直接读 frontend/.local/live.db。
 *
 * 那份快照由 vite dev server 的 live-db-snapshot 插件写入:App 每次写盘时把整库
 * POST 过来。所以只要 `npm run dev` 开着、页面打开过,命令行就能看到真实学习数据,
 * 不用再去真实 Chrome 的 IndexedDB 现场取数。
 *
 *   npm run db -- 食べる            # 单词详情:FSRS 状态 + 最近作答 + 笔记
 *   npm run db -- --status          # 快照多新、最近 14 天的量、到期池
 *   npm run db -- --sql "SELECT …"  # 任意只读 SQL
 *   npm run db -- 食べる --reviews 50
 *   npm run db -- --file 某个.db 食べる
 *
 * 只读打开,不会改动任何东西。
 */

import { DatabaseSync } from "node:sqlite";
import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SNAPSHOT = resolve(ROOT, ".local/live.db");

const argv = process.argv.slice(2);
const options = { reviews: 12, limit: 8 };
const words = [];
let sql = null;
let showStatus = false;
let file = DEFAULT_SNAPSHOT;

for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === "--status") showStatus = true;
  else if (arg === "--sql") sql = argv[++i];
  else if (arg === "--file") file = resolve(process.cwd(), argv[++i]);
  else if (arg === "--reviews") options.reviews = Number(argv[++i]) || 12;
  else if (arg === "--limit") options.limit = Number(argv[++i]) || 8;
  else if (arg === "--help" || arg === "-h") { printHelp(); process.exit(0); }
  else if (arg.startsWith("--")) { console.error(`未知参数 ${arg}`); process.exit(1); }
  else words.push(arg);
}

function printHelp() {
  console.log(`用法:
  npm run db -- <词>              查单词(汉字/假名/释义都能搜)
  npm run db -- --status          快照新旧 + 最近 14 天 + 到期池
  npm run db -- --sql "SELECT …"  任意只读 SQL
选项:
  --reviews N   单词详情里列几条作答记录(默认 12)
  --limit N     模糊搜索最多列几个候选(默认 8)
  --file PATH   读别的 .db(默认 frontend/.local/live.db)`);
}

if (!existsSync(file)) {
  console.error(`找不到快照:${file}

快照由 dev server 写入。请确认:
  1. \`cd frontend && npm run dev\` 正在跑
  2. 浏览器打开过 http://localhost:5173(打开即落一份,答题时每 20 秒刷新)
用 --file 可以改读别的库。`);
  process.exit(1);
}

const db = new DatabaseSync(file, { readOnly: true });
const q = (text, ...params) => db.prepare(text).all(...params);
const q1 = (text, ...params) => db.prepare(text).get(...params);

const hasTable = (name) =>
  !!q1("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name = ?", name);
const columnsOf = (table) => new Set(q(`PRAGMA table_info(${table})`).map((r) => r.name));

// 快照可能来自还没跑过 ensureFsrsColumns 的库(比如种子库),列不存在就退化显示。
const progressColumns = hasTable("progress") ? columnsOf("progress") : new Set();
const hasFsrs = progressColumns.has("fsrs_due");
const FSRS_COLUMNS = [
  "fsrs_due", "fsrs_last_review", "fsrs_stability", "fsrs_difficulty",
  "fsrs_state", "fsrs_steps", "fsrs_reps", "fsrs_lapses",
];
const STATE_NAMES = ["新词 New", "学习中 Learning", "复习 Review", "重学 Relearning"];

const age = (mtime) => {
  const minutes = Math.round((Date.now() - mtime.getTime()) / 60000);
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 60 * 24) return `${(minutes / 60).toFixed(1)} 小时前`;
  return `${(minutes / 1440).toFixed(1)} 天前`;
};

const days = (from, to) =>
  (new Date(to).getTime() - new Date(from).getTime()) / 86400000;

function snapshotHeader() {
  const stat = statSync(file);
  console.log(
    `快照 ${file.replace(`${ROOT}/`, "")} · ${(stat.size / 1048576).toFixed(1)} MB · 写于 ${age(stat.mtime)}`
  );
}

function printRows(rows) {
  if (!rows.length) { console.log("(空)"); return; }
  const keys = Object.keys(rows[0]);
  const widths = keys.map((k) =>
    Math.max(k.length, ...rows.map((r) => String(r[k] ?? "").length))
  );
  const line = (cells) => cells.map((c, i) => String(c ?? "").padEnd(widths[i])).join("  ");
  console.log(line(keys));
  console.log(widths.map((w) => "─".repeat(w)).join("  "));
  for (const row of rows) console.log(line(keys.map((k) => row[k])));
}

function status() {
  snapshotHeader();
  const total = q1("SELECT COUNT(*) AS n FROM words")?.n ?? 0;
  const touched = q1("SELECT COUNT(*) AS n FROM progress")?.n ?? 0;
  console.log(`\n词库 ${total} 条,学过 ${touched} 条`);

  if (hasFsrs) {
    const now = new Date().toISOString();
    const due = q1(
      `SELECT COUNT(*) AS n FROM progress
       WHERE (fsrs_due IS NULL OR fsrs_due <= ?) AND COALESCE(known_forever, 0) = 0`, now
    )?.n ?? 0;
    const leech = q1("SELECT COUNT(*) AS n FROM progress WHERE COALESCE(fsrs_lapses,0) >= 8")?.n ?? 0;
    const mastered = q1(
      `SELECT COUNT(*) AS n FROM progress
       WHERE fsrs_due IS NOT NULL AND fsrs_last_review IS NOT NULL
         AND julianday(fsrs_due) - julianday(fsrs_last_review) >= 180`
    )?.n ?? 0;
    console.log(`到期/薄弱 ${due} · 顽固词(lapses≥8) ${leech} · 已掌握(间隔≥180天) ${mastered}`);
  } else {
    console.log("(这份库没有 fsrs_* 列,应该是种子库或很旧的快照)");
  }

  console.log("\n最近 14 天:");
  printRows(q(
    `SELECT reviewed_on AS 日期,
            COUNT(DISTINCT word_id) AS 词数,
            COUNT(*) AS 作答,
            SUM(answer = 'forgot') AS 忘了,
            SUM(answer = 'fuzzy') AS 模糊,
            SUM(answer = 'right') AS 记得
     FROM reviews GROUP BY reviewed_on ORDER BY reviewed_on DESC LIMIT 14`
  ));
}

function findWords(term) {
  const like = `%${term}%`;
  const exact = q(
    `SELECT * FROM words WHERE kanji = ? OR kana = ? ORDER BY importance DESC`, term, term
  );
  if (exact.length) return exact;
  return q(
    `SELECT * FROM words WHERE kanji LIKE ? OR kana LIKE ? OR meaning LIKE ?
     ORDER BY (kanji = ?) DESC, importance DESC LIMIT ?`,
    like, like, like, term, options.limit
  );
}

function wordDetail(word) {
  const label = [word.kanji, word.kana].filter(Boolean).join(" / ");
  console.log(`\n${"═".repeat(60)}`);
  console.log(`${label}  #${word.id}  ${word.pos ?? ""} ${word.jlpt_level ?? ""} importance=${word.importance ?? ""}`);
  console.log(`释义:${word.meaning}`);
  if (word.example_jp) console.log(`例句:${word.example_jp}${word.example_meaning ? ` — ${word.example_meaning}` : ""}`);

  const p = q1("SELECT * FROM progress WHERE word_id = ?", word.id);
  if (!p) {
    console.log("\n进度:还没学过(progress 里没有这个词)");
  } else {
    console.log(
      `\n见过 ${p.seen_count ?? 0} 次 · 记得 ${p.right_count ?? 0} / 模糊 ${p.fuzzy_count ?? 0} / 忘了 ${p.forgot_count ?? 0}` +
      ` · 连错 ${p.mistake_streak ?? 0} · 最近一次 ${p.last_seen_on ?? "—"}` +
      (p.known_forever ? " · 已标记「永久掌握」" : "")
    );
    if (hasFsrs && p.fsrs_due) {
      const interval = p.fsrs_last_review ? days(p.fsrs_last_review, p.fsrs_due) : null;
      const overdue = days(p.fsrs_due, new Date().toISOString());
      console.log(
        `FSRS ${STATE_NAMES[p.fsrs_state ?? 2] ?? p.fsrs_state} · 到期 ${p.fsrs_due}` +
        `(${overdue >= 0 ? `已过期 ${overdue.toFixed(1)} 天` : `还有 ${(-overdue).toFixed(1)} 天`})` +
        `\n     上次复习 ${p.fsrs_last_review ?? "—"} · 间隔 ${interval == null ? "—" : `${interval.toFixed(1)} 天`}` +
        ` · stability ${Number(p.fsrs_stability ?? 0).toFixed(2)} · difficulty ${Number(p.fsrs_difficulty ?? 0).toFixed(2)}` +
        `\n     reps ${p.fsrs_reps ?? 0} · lapses ${p.fsrs_lapses ?? 0}` +
        (Number(p.fsrs_lapses ?? 0) >= 8 ? " ← 顽固词" : "") +
        (interval != null && interval >= 180 ? " · 已掌握(间隔≥180天)" : "")
      );
    } else if (hasFsrs) {
      console.log("FSRS:见过但还没进调度(fsrs_due 为空 ⇒ 当到期处理)");
    }
    if (FSRS_COLUMNS.some((c) => !progressColumns.has(c))) {
      console.log("(注意:这份库缺部分 fsrs_* 列)");
    }
  }

  if (hasTable("word_notes")) {
    const note = q1("SELECT * FROM word_notes WHERE word_id = ?", word.id);
    if (note?.note) console.log(`\n笔记(${note.updated_at ?? "—"}):${note.note}`);
  }

  const reviews = q(
    `SELECT reviewed_on AS 日期, created_at AS 时刻, answer AS 作答
     FROM reviews WHERE word_id = ? ORDER BY created_at DESC LIMIT ?`,
    word.id, options.reviews
  );
  console.log(`\n最近 ${reviews.length} 条作答(created_at 是 UTC):`);
  printRows(reviews);

  if (hasTable("kanji_memory")) {
    const k = q1("SELECT * FROM kanji_memory WHERE word_id = ?", word.id);
    if (k) {
      console.log(
        `\n汉字模式:见过 ${k.seen_count ?? 0} 次 · 记得 ${k.right_count ?? 0}/模糊 ${k.fuzzy_count ?? 0}/忘了 ${k.forgot_count ?? 0}` +
        (k.fsrs_due ? ` · 到期 ${k.fsrs_due}` : "")
      );
    }
  }
}

try {
  if (sql) {
    snapshotHeader();
    console.log();
    printRows(q(sql));
  } else if (showStatus || words.length === 0) {
    status();
    if (words.length === 0 && !showStatus) console.log("\n(没给词,默认按 --status 显示;`npm run db -- --help` 看用法)");
  } else {
    snapshotHeader();
    for (const term of words) {
      const found = findWords(term);
      if (!found.length) { console.log(`\n「${term}」没找到`); continue; }
      if (found.length > 1) {
        console.log(`\n「${term}」匹配到 ${found.length} 条:`);
        printRows(found.map((w) => ({ id: w.id, 汉字: w.kanji, 假名: w.kana, 释义: w.meaning, 级别: w.jlpt_level })));
      }
      for (const w of found.slice(0, found.length > 1 ? 3 : 1)) wordDetail(w);
      if (found.length > 3) console.log(`\n(只展开了前 3 条,想看别的用 --sql 或直接搜更准的词)`);
    }
  }
} finally {
  db.close();
}
