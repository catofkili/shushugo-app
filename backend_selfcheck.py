from __future__ import annotations

import tempfile
from pathlib import Path

import server


def reset_temp_db() -> tempfile.TemporaryDirectory:
    tempdir = tempfile.TemporaryDirectory()
    server.DB_PATH = Path(tempdir.name) / "test.sqlite3"
    server.init_db()
    return tempdir


def answer(conn, word_id: int, answer_value: str) -> None:
    today = server.TODAY()
    progress = conn.execute("SELECT * FROM progress WHERE word_id = ?", (word_id,)).fetchone()
    score = progress["score"] + {"forgot": -10, "fuzzy": -5, "know": 10}[answer_value]
    score = max(score, -40)
    if score <= server.CRITICAL_SCORE:
        server.record_critical_review(conn, word_id)
    conn.execute(
        """
        UPDATE progress
        SET score = ?, seen_count = seen_count + 1,
            mastered_on = CASE WHEN ? >= 10 THEN ? ELSE NULL END,
            last_seen_on = ?
        WHERE word_id = ?
        """,
        (score, score, today, today, word_id),
    )
    conn.execute(
        "INSERT INTO reviews (word_id, answer, score_after, reviewed_on) VALUES (?, ?, ?, ?)",
        (word_id, answer_value, score, today),
    )
    server.record_stage2_word(conn, word_id)


def check_critical_reset_once() -> None:
    tempdir = reset_temp_db()
    try:
        with server.connect() as conn:
            server.record_critical_review(conn, 1)
            server.reset_previous_critical_reviews(conn, "2999-01-01")
            row = conn.execute("SELECT score FROM progress WHERE word_id = 1").fetchone()
            assert row["score"] == -1
            conn.execute("UPDATE progress SET score = 8 WHERE word_id = 1")
            server.reset_previous_critical_reviews(conn, "2999-01-02")
            row = conn.execute("SELECT score FROM progress WHERE word_id = 1").fetchone()
            assert row["score"] == 8
    finally:
        tempdir.cleanup()


def check_critical_backfill_from_reviews() -> None:
    tempdir = reset_temp_db()
    try:
        with server.connect() as conn:
            conn.execute(
                "INSERT INTO reviews (word_id, answer, score_after, reviewed_on) VALUES (?, ?, ?, ?)",
                (1, "forgot", server.CRITICAL_SCORE, "2999-01-01"),
            )
            server.backfill_critical_reviews(conn, "2999-01-02")
            server.reset_previous_critical_reviews(conn, "2999-01-02")
            row = conn.execute("SELECT score FROM progress WHERE word_id = 1").fetchone()
            reset = conn.execute(
                "SELECT reset_on FROM critical_reviews WHERE reviewed_on = ? AND word_id = ?",
                ("2999-01-01", 1),
            ).fetchone()
            assert row["score"] == -1
            assert reset["reset_on"] == "2999-01-02"
    finally:
        tempdir.cleanup()


def check_daily_decay_stops_at_minus_ten() -> None:
    tempdir = reset_temp_db()
    try:
        with server.connect() as conn:
            conn.execute(
                """
                UPDATE progress
                SET seen_count = 1, score = -9.5
                WHERE word_id = 1
                """
            )
            server.set_state(conn, "last_decay", "2000-01-01")
            server.apply_daily_decay(conn)
            row = conn.execute("SELECT score FROM progress WHERE word_id = 1").fetchone()
            assert row["score"] == server.AUTO_DECAY_FLOOR

            answer(conn, 1, "fuzzy")
            row = conn.execute("SELECT score FROM progress WHERE word_id = 1").fetchone()
            assert row["score"] == server.AUTO_DECAY_FLOOR - 5
    finally:
        tempdir.cleanup()


def check_done_stays_done() -> None:
    tempdir = reset_temp_db()
    try:
        with server.connect() as conn:
            server.set_phase(conn, "done")
            card, phase = server.next_card(conn)
            assert card is None
            assert phase == "done"
    finally:
        tempdir.cleanup()


def check_stage2_records_stage1_order() -> None:
    tempdir = reset_temp_db()
    try:
        with server.connect() as conn:
            answer(conn, 1, "know")
            answer(conn, 2, "know")
            rows = conn.execute(
                "SELECT word_id, order_index FROM stage2_progress ORDER BY order_index"
            ).fetchall()
            assert [(row["word_id"], row["order_index"]) for row in rows] == [(1, 1), (2, 2)]
    finally:
        tempdir.cleanup()


def check_stage1_progress_counts_complete_words_over_six() -> None:
    tempdir = reset_temp_db()
    try:
        with server.connect() as conn:
            today = server.TODAY()
            conn.execute("UPDATE progress SET known_forever = 1")
            conn.execute(
                """
                UPDATE progress
                SET known_forever = 0, seen_count = 1, score = -1
                WHERE word_id = 1
                """
            )
            conn.execute(
                """
                UPDATE progress
                SET known_forever = 0, seen_count = 0, score = 0
                WHERE word_id = 2
                """
            )
            conn.execute(
                "INSERT INTO reviews (word_id, answer, score_after, reviewed_on) VALUES (?, ?, ?, ?)",
                (1, "forgot", -1, "2000-01-01"),
            )
            answer(conn, 1, "know")
            answer(conn, 2, "know")
            done, total = server.stage1_progress_counts(conn)
            assert (done, total) == (2, 2)
            stats = server.stats(conn)
            assert stats["stage1ProgressDone"] == stats["stage1ProgressTotal"]
            assert stats["studyDate"] == today
    finally:
        tempdir.cleanup()


def check_stage1_task_pool_is_fixed() -> None:
    tempdir = reset_temp_db()
    try:
        with server.connect() as conn:
            conn.execute("UPDATE progress SET known_forever = 1")
            conn.execute(
                """
                UPDATE progress
                SET known_forever = 0, seen_count = 1, score = 0
                WHERE word_id IN (1, 2)
                """
            )
            server.ensure_stage1_tasks(conn)
            assert server.stage1_task_count(conn, server.TODAY()) == 2
            conn.execute(
                """
                UPDATE progress
                SET known_forever = 0, seen_count = 1, score = 0
                WHERE word_id = 3
                """
            )
            assert server.stage1_task_count(conn, server.TODAY()) == 2
    finally:
        tempdir.cleanup()


def check_stage1_task_pool_backfills_from_reviews() -> None:
    tempdir = reset_temp_db()
    try:
        with server.connect() as conn:
            today = server.TODAY()
            conn.execute("UPDATE progress SET known_forever = 1")
            conn.execute(
                """
                UPDATE progress
                SET known_forever = 0, seen_count = 1, score = 9
                WHERE word_id = 1
                """
            )
            conn.execute(
                """
                UPDATE progress
                SET known_forever = 0, seen_count = 1, score = 9
                WHERE word_id = 2
                """
            )
            conn.execute(
                "INSERT INTO reviews (word_id, answer, score_after, reviewed_on) VALUES (?, ?, ?, ?)",
                (1, "forgot", -1, "2000-01-01"),
            )
            conn.execute(
                "INSERT INTO reviews (word_id, answer, score_after, reviewed_on) VALUES (?, ?, ?, ?)",
                (1, "know", 9, today),
            )
            conn.execute(
                "INSERT INTO reviews (word_id, answer, score_after, reviewed_on) VALUES (?, ?, ?, ?)",
                (2, "know", 9, today),
            )
            server.ensure_stage1_tasks(conn)
            rows = conn.execute(
                "SELECT word_id, task_type FROM stage1_tasks WHERE reviewed_on = ? ORDER BY order_index",
                (today,),
            ).fetchall()
            assert [(row["word_id"], row["task_type"]) for row in rows] == [(1, "review"), (2, "new")]
    finally:
        tempdir.cleanup()


def check_seen_word_quick_grade() -> None:
    tempdir = reset_temp_db()
    try:
        with server.connect() as conn:
            page = server.seen_words_page(conn, 0, 5)
            assert page["total"] == 0
            word = server.quick_grade_word(conn, 1, "know")
            assert word["score"] == 10
            assert word["rightCount"] == 1
            page = server.seen_words_page(conn, 0, 5)
            assert page["total"] == 1
            word = server.quick_grade_word(conn, 1, "known_forever")
            assert word["knownForever"] is True
    finally:
        tempdir.cleanup()


def check_seen_word_sorting() -> None:
    tempdir = reset_temp_db()
    try:
        with server.connect() as conn:
            conn.execute(
                """
                UPDATE progress
                SET seen_count = 1, score = 30, right_count = 3
                WHERE word_id = 1
                """
            )
            conn.execute(
                """
                UPDATE progress
                SET seen_count = 1, score = -5, forgot_count = 2
                WHERE word_id = 2
                """
            )
            high_first = server.seen_words_page(conn, 0, 2, "score_desc")
            low_first = server.seen_words_page(conn, 0, 2, "score_asc")
            mistake_first = server.seen_words_page(conn, 0, 2, "mistake_desc")
            assert high_first["words"][0]["id"] == 1
            assert low_first["words"][0]["id"] == 2
            assert mistake_first["words"][0]["id"] == 2
    finally:
        tempdir.cleanup()


def main() -> None:
    check_critical_reset_once()
    check_critical_backfill_from_reviews()
    check_daily_decay_stops_at_minus_ten()
    check_done_stays_done()
    check_stage2_records_stage1_order()
    check_stage1_progress_counts_complete_words_over_six()
    check_stage1_task_pool_is_fixed()
    check_stage1_task_pool_backfills_from_reviews()
    check_seen_word_quick_grade()
    check_seen_word_sorting()
    print("backend selfcheck ok")


if __name__ == "__main__":
    main()
