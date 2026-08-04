// 发布前阻止把开发者自己的学习记录、笔记或迁移痕迹带进安装包。
// `npm run build` 会自动执行本检查；出厂词库只应包含 words 和种子版本信息。

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import initSqlJs from "sql.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, "../public");
const dbPath = path.join(publicDir, "nihongo.db");

// public/ 下的**一切**都会被原样复制进 dist/ 并公开可下载。
//
// 以前这里只拦 .db/.sqlite,结果是「不是数据库的东西」照样能溜出去 ——
// 网页原型、设计稿、导出的 HTML 放进 public/ 都会随网页版一起公开。
// 所以改成白名单:只有明确列出的顶层条目允许存在,新增任何东西都必须
// 先在这里登记,顺便逼着人想一遍「这个真的要对外公开吗」。
const ALLOWED_PUBLIC_ENTRIES = new Set([
  "nihongo.db",   // 出厂词库
  "audio",        // 预生成单词读音
  ".DS_Store"
]);

const strayEntries = readdirSync(publicDir, { withFileTypes: true })
  .map((entry) => entry.name)
  .filter((name) => !ALLOWED_PUBLIC_ENTRIES.has(name));

if (strayEntries.length) {
  throw new Error(
    `拒绝构建：public/ 下存在未登记的条目（${strayEntries.join(", ")}）。\n` +
    `public/ 的内容会原样发布到网站上。确认可以公开的,加进 verify-release-db.mjs ` +
    `的 ALLOWED_PUBLIC_ENTRIES；否则请移出 public/（设计稿/原型放 design/）。`
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
