// 发布前阻止把开发者自己的学习记录、笔记或迁移痕迹带进安装包。
// `npm run build` 会自动执行本检查；出厂词库只应包含 words 和种子版本信息。

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import initSqlJs from "sql.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, "../public");
const dbPath = path.join(publicDir, "nihongo.db");
// public/ 下的一切都会被原样复制进 dist/ 并公开可下载,所以出厂词库之外
// 不允许再出现任何数据库文件——个人学习库放这里会连同网站一起发出去。
const ALLOWED_PUBLIC_DATABASES = new Set(["nihongo.db"]);
const DATABASE_EXTENSIONS = new Set([".db", ".sqlite", ".sqlite3"]);

const collectDatabases = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return collectDatabases(full);
  return DATABASE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) ? [full] : [];
});

const strayDatabases = collectDatabases(publicDir)
  .filter((file) => !ALLOWED_PUBLIC_DATABASES.has(path.relative(publicDir, file)));

if (strayDatabases.length) {
  const list = strayDatabases.map((file) => path.relative(publicDir, file)).join(", ");
  throw new Error(
    `拒绝构建：public/ 下存在出厂词库以外的数据库文件（${list}）。` +
    `这些文件会被公开发布,请移出 public/ 后重新构建。`
  );
}

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
