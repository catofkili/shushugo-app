#!/usr/bin/env python3
"""Build a small, disposable DB fixture from the shipped factory seed only."""
import base64
import json
import pathlib
import sqlite3

root = pathlib.Path(__file__).resolve().parents[1]
repo = root.parent
source_path = repo / "frontend/public/nihongo.db"
fixture_path = root / "src/platform/factory-test-fixture.weapp.js"
report_path = root / "reports/factory-test-seed.json"
if not source_path.is_file():
    raise SystemExit(f"factory seed missing: {source_path}")

source = sqlite3.connect(f"file:{source_path}?mode=ro", uri=True)
target = sqlite3.connect(":memory:")
per_level = {}

schema_only_tables = (
    "reviews", "stage1_tasks", "stage2_progress", "kanji_progress",
    "critical_reviews", "word_study_time",
)
for table in ("words", "progress", "app_state", *schema_only_tables):
    sql = source.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)
    ).fetchone()
    if not sql or not sql[0]:
        raise SystemExit(f"factory seed table missing: {table}")
    target.execute(sql[0])

columns = [row[1] for row in source.execute("PRAGMA table_info(words)")]
column_sql = ", ".join('"' + name.replace('"', '""') + '"' for name in columns)
marks = ", ".join("?" for _ in columns)
for level in ("N5", "N4", "N3", "N2", "N1"):
    rows = source.execute(
        f"SELECT {column_sql} FROM words WHERE jlpt_level=? AND meaning<>'' AND kana<>'' "
        "ORDER BY importance DESC, id ASC LIMIT 48",
        (level,),
    ).fetchall()
    if len(rows) < 48:
        raise SystemExit(f"factory seed has only {len(rows)} usable {level} words; need 48")
    target.executemany(f"INSERT INTO words ({column_sql}) VALUES ({marks})", rows)
    per_level[level] = len(rows)

target.commit()
target.execute("VACUUM")
payload = target.serialize()
encoded = base64.b64encode(payload).decode("ascii")
fixture_path.parent.mkdir(parents=True, exist_ok=True)
fixture_path.write_text(f"module.exports = {{ base64: '{encoded}' }};\n", encoding="ascii")
report = {
    "source": "frontend/public/nihongo.db",
    "sourceBytes": source_path.stat().st_size,
    "fixtureBytes": len(payload),
    "base64SourceBytes": fixture_path.stat().st_size,
    "wordCount": sum(per_level.values()),
    "wordsPerLevel": per_level,
    "tablesCopied": ["words", "progress", "app_state",
                     *[f"{table} (schema only)" for table in schema_only_tables]],
    "personalDataIncluded": False,
    "persistentStudyPathUsed": False,
}
report_path.parent.mkdir(parents=True, exist_ok=True)
report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(
    f"隔离出厂词库：{report['wordCount']} 词，{len(payload)} B SQLite，"
    f"{fixture_path.stat().st_size} B Base64 源码；未读取个人库。"
)
source.close()
target.close()
