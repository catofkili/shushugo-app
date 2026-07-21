// 发布前阻止把开发者自己的学习记录、笔记或迁移痕迹带进安装包。
// `npm run build` 会自动执行本检查；出厂词库只应包含 words 和种子版本信息。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import initSqlJs from "sql.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(here, "../public/nihongo.db");
const userDataTables = [
  "progress",
  "reviews",
  "checkins",
  "critical_reviews",
  "word_notes",
  "word_study_time",
  "kanji_progress",
  "kanji_memory",
  "kanji_char_overrides",
  "stage1_tasks",
  "stage2_progress",
  "moji_migrated_reviews",
  "grammar_progress",
  "grammar_reviews",
  "grammar_points_archive"
];

const SQL = await initSqlJs();
const bytes = readFileSync(dbPath);
const db = new SQL.Database(new Uint8Array(bytes));
const scalar = (query, params = []) => Number(db.exec(query, params)[0]?.values[0]?.[0] ?? 0);

const populated = userDataTables
  .map((table) => [table, scalar(`SELECT COUNT(*) FROM ${table}`)])
  .filter(([, count]) => count > 0);
const personalMarkers = ["project1", "personal_data_migrated", "/Users/"];
const databaseText = new TextDecoder().decode(bytes);
const foundMarkers = personalMarkers.filter((marker) => databaseText.includes(marker));

if (populated.length || foundMarkers.length) {
  const details = [
    populated.length && `含有用户记录: ${populated.map(([table, count]) => `${table}=${count}`).join(", ")}`,
    foundMarkers.length && `含有个人迁移标记: ${foundMarkers.join(", ")}`
  ].filter(Boolean).join("；");
  throw new Error(`拒绝构建：public/nihongo.db 不是干净的出厂词库（${details}）。请先清空个人数据。`);
}

console.log("✓ 出厂词库检查通过：未发现个人学习数据或迁移痕迹。");
