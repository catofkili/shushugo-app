#!/usr/bin/env python3
"""Move DB-backed personal study data between Project1 and the iOS app.

Default direction is Project1 -> app. The script always creates timestamped
database backups before writing so the migration can be removed by restoring
the backup copy.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any


ROOT = Path("/Users/lsc/Documents")
PROJECT1_DB = ROOT / "japanese-learning-app" / "japanese_words.sqlite3"
APP_DB = ROOT / "master-nihongo-ios" / "frontend" / "public" / "nihongo.db"
IOS_DB = ROOT / "master-nihongo-ios" / "frontend" / "ios" / "App" / "App" / "public" / "nihongo.db"
ARCHIVE_ROOT = ROOT / "_archive" / "project1-app-personal-data"

WORD_ID_TABLES = {
    "critical_reviews": ["reviewed_on", "word_id", "reset_on"],
    "kanji_memory": [
        "word_id",
        "score",
        "seen_count",
        "right_count",
        "fuzzy_count",
        "forgot_count",
        "low_history",
        "last_seen_on",
    ],
    "kanji_progress": ["reviewed_on", "word_id", "order_index", "temp_score", "seen_count", "completed", "due_after"],
    "moji_migrated_reviews": ["word_id", "imported_on", "priority", "activated_on"],
    "stage1_tasks": ["reviewed_on", "word_id", "task_type", "order_index"],
    "stage2_progress": ["reviewed_on", "word_id", "order_index", "temp_score", "seen_count", "completed", "due_after"],
    "word_auto_known": ["word_id", "first_know_streak", "last_first_seen_on", "updated_at"],
    "word_notes": ["word_id", "note", "updated_at"],
}

DIRECT_TABLES = {
    "checkins": ["checked_on"],
    "word_study_time": ["studied_on", "seconds", "updated_at"],
}

GRAMMAR_ID_TABLES = {
    "grammar_progress": [
        "grammar_id",
        "score",
        "seen_count",
        "low_history",
        "known_forever",
        "mastered_on",
        "last_seen_on",
        "right_count",
        "fuzzy_count",
        "forgot_count",
        "mistake_streak",
        "last_decay_amount",
    ],
}

SKIPPED_RUNTIME_STATE = {
    "current_card",
    "last_answer",
    "phase",
    "phase_date",
    "review_queue",
}


def connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = OFF")
    return conn


def backup_databases(src_db: Path, dst_db: Path) -> Path:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_dir = ARCHIVE_ROOT / stamp
    backup_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src_db, backup_dir / f"{src_db.stem}.source.sqlite3")
    shutil.copy2(dst_db, backup_dir / f"{dst_db.stem}.target-before.sqlite3")
    if IOS_DB.exists():
        shutil.copy2(IOS_DB, backup_dir / "ios-nihongo.target-before.sqlite3")
    return backup_dir


def table_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}


def fetch_all(conn: sqlite3.Connection, table: str, columns: list[str]) -> list[sqlite3.Row]:
    selected = ", ".join(columns)
    return conn.execute(f"SELECT {selected} FROM {table}").fetchall()


def upsert(conn: sqlite3.Connection, table: str, columns: list[str], values: list[Any]) -> None:
    placeholders = ", ".join("?" for _ in columns)
    names = ", ".join(columns)
    conn.execute(f"INSERT OR REPLACE INTO {table} ({names}) VALUES ({placeholders})", values)


def build_word_map(src: sqlite3.Connection, dst: sqlite3.Connection) -> dict[int, int]:
    mapping: dict[int, int] = {}
    missing: list[int] = []
    for row in src.execute("SELECT id, meaning, kana, kanji FROM words"):
        target = dst.execute(
            "SELECT id FROM words WHERE meaning = ? AND kana = ? AND kanji = ?",
            (row["meaning"], row["kana"], row["kanji"]),
        ).fetchone()
        if not target:
            missing.append(row["id"])
            continue
        mapping[int(row["id"])] = int(target["id"])
    if missing:
        raise RuntimeError(f"Cannot map {len(missing)} word ids, sample={missing[:10]}")
    return mapping


def build_grammar_map(src: sqlite3.Connection, dst: sqlite3.Connection) -> dict[int, int]:
    mapping: dict[int, int] = {}
    missing: list[int] = []
    for row in src.execute("SELECT id, pattern FROM grammar_points"):
        target = dst.execute("SELECT id FROM grammar_points WHERE pattern = ?", (row["pattern"],)).fetchone()
        if not target:
            missing.append(row["id"])
            continue
        mapping[int(row["id"])] = int(target["id"])
    if missing:
        raise RuntimeError(f"Cannot map {len(missing)} grammar ids, sample={missing[:10]}")
    return mapping


def migrate_progress(src: sqlite3.Connection, dst: sqlite3.Connection, word_map: dict[int, int]) -> int:
    rows = src.execute("""
        SELECT word_id, score, seen_count, low_history, known_forever, mastered_on,
               last_seen_on, right_count, fuzzy_count, forgot_count, mistake_streak,
               last_decay_amount
        FROM progress
        WHERE seen_count > 0 OR score != 0 OR known_forever != 0
    """).fetchall()
    count = 0
    for row in rows:
        target_id = word_map[int(row["word_id"])]
        dst.execute("""
            INSERT INTO progress (
                word_id, score, seen_count, low_history, known_forever, mastered_on,
                last_seen_on, right_count, fuzzy_count, forgot_count, mistake_streak,
                last_decay_amount
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(word_id) DO UPDATE SET
                score = excluded.score,
                seen_count = excluded.seen_count,
                low_history = excluded.low_history,
                known_forever = excluded.known_forever,
                mastered_on = excluded.mastered_on,
                last_seen_on = excluded.last_seen_on,
                right_count = excluded.right_count,
                fuzzy_count = excluded.fuzzy_count,
                forgot_count = excluded.forgot_count,
                mistake_streak = excluded.mistake_streak,
                last_decay_amount = excluded.last_decay_amount
        """, [target_id, *[row[key] for key in row.keys() if key != "word_id"]])
        count += 1
    return count


def migrate_reviews(src: sqlite3.Connection, dst: sqlite3.Connection, word_map: dict[int, int]) -> int:
    rows = src.execute("SELECT word_id, answer, score_after, reviewed_on, created_at FROM reviews ORDER BY id").fetchall()
    dst.execute("DELETE FROM reviews")
    for row in rows:
        dst.execute(
            "INSERT INTO reviews (word_id, answer, score_after, reviewed_on, created_at) VALUES (?, ?, ?, ?, ?)",
            (word_map[int(row["word_id"])], row["answer"], row["score_after"], row["reviewed_on"], row["created_at"]),
        )
    return len(rows)


def migrate_word_id_table(src: sqlite3.Connection, dst: sqlite3.Connection, table: str, columns: list[str], word_map: dict[int, int]) -> int:
    if table not in table_columns(src, table) and False:
        return 0
    dst.execute(f"DELETE FROM {table}")
    count = 0
    for row in fetch_all(src, table, columns):
        values = [row[column] for column in columns]
        values[columns.index("word_id")] = word_map[int(row["word_id"])]
        upsert(dst, table, columns, values)
        count += 1
    return count


def migrate_direct_table(src: sqlite3.Connection, dst: sqlite3.Connection, table: str, columns: list[str]) -> int:
    dst.execute(f"DELETE FROM {table}")
    rows = fetch_all(src, table, columns)
    for row in rows:
        upsert(dst, table, columns, [row[column] for column in columns])
    return len(rows)


def migrate_grammar_progress(src: sqlite3.Connection, dst: sqlite3.Connection, grammar_map: dict[int, int]) -> int:
    columns = GRAMMAR_ID_TABLES["grammar_progress"]
    rows = src.execute("""
        SELECT grammar_id, score, seen_count, low_history, known_forever, mastered_on,
               last_seen_on, right_count, fuzzy_count, forgot_count, mistake_streak,
               last_decay_amount
        FROM grammar_progress
        WHERE seen_count > 0 OR score != 0 OR known_forever != 0
    """).fetchall()
    count = 0
    for row in rows:
        values = [row[column] for column in columns]
        values[0] = grammar_map[int(row["grammar_id"])]
        upsert(dst, "grammar_progress", columns, values)
        count += 1
    return count


def migrate_grammar_reviews(src: sqlite3.Connection, dst: sqlite3.Connection, grammar_map: dict[int, int]) -> int:
    rows = src.execute("SELECT grammar_id, answer, score_after, reviewed_on, created_at FROM grammar_reviews ORDER BY id").fetchall()
    dst.execute("DELETE FROM grammar_reviews")
    for row in rows:
        dst.execute(
            "INSERT INTO grammar_reviews (grammar_id, answer, score_after, reviewed_on, created_at) VALUES (?, ?, ?, ?, ?)",
            (grammar_map[int(row["grammar_id"])], row["answer"], row["score_after"], row["reviewed_on"], row["created_at"]),
        )
    return len(rows)


def map_grammar_queue(value: str, grammar_map: dict[int, int]) -> str:
    try:
        queue = json.loads(value)
    except json.JSONDecodeError:
        return value
    if not isinstance(queue, list):
        return value
    mapped = []
    for item in queue:
        if not isinstance(item, dict) or "grammar_id" not in item:
            continue
        source_id = int(item["grammar_id"])
        if source_id not in grammar_map:
            continue
        mapped.append({**item, "grammar_id": grammar_map[source_id]})
    return json.dumps(mapped, ensure_ascii=False)


def migrate_state(src: sqlite3.Connection, dst: sqlite3.Connection, grammar_map: dict[int, int]) -> dict[str, int]:
    app_count = 0
    grammar_count = 0
    for row in src.execute("SELECT key, value FROM app_state"):
        if row["key"] in SKIPPED_RUNTIME_STATE:
            continue
        dst.execute("INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)", (row["key"], row["value"]))
        app_count += 1
    for row in src.execute("SELECT key, value FROM grammar_state"):
        value = map_grammar_queue(row["value"], grammar_map) if row["key"] == "queue" else row["value"]
        dst.execute("INSERT OR REPLACE INTO grammar_state (key, value) VALUES (?, ?)", (row["key"], value))
        grammar_count += 1
    return {"app_state": app_count, "grammar_state": grammar_count}


def write_report(backup_dir: Path, stats: dict[str, int], direction: str) -> None:
    report = {
        "direction": direction,
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "backup_dir": str(backup_dir),
        "stats": stats,
        "rollback": "Restore frontend/public/nihongo.db from nihongo.target-before.sqlite3, then run `cd frontend && npx cap sync ios`.",
        "skipped": {
            "runtime_app_state": sorted(SKIPPED_RUNTIME_STATE),
            "browser_local_storage": [
                "jp-grammar-personal-notes-v1",
                "jp-grammar-review",
                "jp-grammar-mistakes",
                "jp-grammar-learned",
            ],
        },
    }
    (backup_dir / "migration-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (backup_dir / "README.md").write_text(
        "# Project1 personal data migration backup\n\n"
        "To remove the migration from the app seed DB, copy `nihongo.target-before.sqlite3` "
        "back to `/Users/lsc/Documents/master-nihongo-ios/frontend/public/nihongo.db`, "
        "then run `cd /Users/lsc/Documents/master-nihongo-ios/frontend && npx cap sync ios`.\n\n"
        "To preserve later app data back to Project1, run this script with `--direction app-to-project1` first.\n",
        encoding="utf-8",
    )


def migrate(direction: str) -> None:
    if direction == "project1-to-app":
        src_db, dst_db = PROJECT1_DB, APP_DB
    elif direction == "app-to-project1":
        src_db, dst_db = APP_DB, PROJECT1_DB
    else:
        raise ValueError(f"Unknown direction: {direction}")

    backup_dir = backup_databases(src_db, dst_db)
    src = connect(src_db)
    dst = connect(dst_db)
    word_map = build_word_map(src, dst)
    grammar_map = build_grammar_map(src, dst)

    stats: dict[str, int] = {}
    try:
        dst.execute("BEGIN")
        stats["progress"] = migrate_progress(src, dst, word_map)
        stats["reviews"] = migrate_reviews(src, dst, word_map)
        for table, columns in WORD_ID_TABLES.items():
            if table_columns(src, table) and table_columns(dst, table):
                stats[table] = migrate_word_id_table(src, dst, table, columns, word_map)
        for table, columns in DIRECT_TABLES.items():
            stats[table] = migrate_direct_table(src, dst, table, columns)
        stats["grammar_progress"] = migrate_grammar_progress(src, dst, grammar_map)
        stats["grammar_reviews"] = migrate_grammar_reviews(src, dst, grammar_map)
        stats.update(migrate_state(src, dst, grammar_map))
        dst.execute(
            "INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)",
            ("project1_personal_data_migrated_at", datetime.now().isoformat(timespec="seconds")),
        )
        dst.commit()
    except Exception:
        dst.rollback()
        raise
    finally:
        src.close()
        dst.close()

    shutil.copy2(APP_DB, IOS_DB)
    write_report(backup_dir, stats, direction)
    print(json.dumps({"backup_dir": str(backup_dir), "stats": stats}, ensure_ascii=False, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--direction", choices=["project1-to-app", "app-to-project1"], default="project1-to-app")
    args = parser.parse_args()
    migrate(args.direction)


if __name__ == "__main__":
    main()
