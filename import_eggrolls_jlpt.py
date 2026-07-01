from __future__ import annotations

import csv
import sqlite3
from pathlib import Path

from server import DB_PATH, estimate_importance, init_db

SOURCE = Path("data/eggrolls_notes.csv")
TARGET_TOTAL = 2000


def has_ascii(text: str) -> bool:
    return any("A" <= char <= "Z" or "a" <= char <= "z" for char in text)


def has_katakana(text: str) -> bool:
    return any("\u30a0" <= char <= "\u30ff" for char in text)


def clean_text(text: str) -> str:
    return text.replace("<br>", "；").strip()


def level_rank(deck: str) -> int:
    if "::1-N5" in deck:
        return 1
    if "::2-N4" in deck:
        return 2
    if "::3-N3" in deck:
        return 3
    return 99


def infer_verb_type(pos: str, kana: str, kanji: str) -> str | None:
    if "サ変" in pos or ("名" in pos and "動3" in pos) or "する" in kanji or "する" in kana:
        return "suru"
    if "動" not in pos and "动" not in pos:
        return None
    base = kanji or kana
    if base in {"来る", "くる"}:
        return "kuru"
    if base in {"行く", "いく"}:
        return "iku"
    if base.endswith("る"):
        return "ichidan"
    return "godan"


def normalize_pos(pos: str, verb_type: str | None) -> str:
    if verb_type == "suru":
        return "名词・する动词"
    if "形動" in pos or "ナ形" in pos:
        return "な形容词"
    if "イ形" in pos:
        return "い形容词"
    if "動" in pos:
        return "动词"
    if "副" in pos:
        return "副词"
    if "名" in pos:
        return "名词"
    return pos or "词汇"


def load_rows() -> list[dict]:
    rows = []
    with SOURCE.open(encoding="utf-8") as file:
        for index, row in enumerate(csv.reader(file, delimiter="\t")):
            if not row or row[0].startswith("#") or len(row) < 39:
                continue
            deck, written, pos, reading, meaning = row[1], row[3], row[5], row[6], row[7]
            rank = level_rank(deck)
            if rank > 3 or not reading or not meaning:
                continue
            if has_ascii(reading) and has_katakana(written):
                kana, kanji = written, reading
            else:
                kana, kanji = reading, written
            verb_type = infer_verb_type(pos, kana, kanji)
            normalized = {
                "meaning": clean_text(meaning),
                "kana": kana.strip(),
                "kanji": (kanji or kana).strip(),
                "pos": normalize_pos(pos, verb_type),
                "verb_type": verb_type,
                "example_jp": clean_text(row[12]) if len(row) > 12 else "",
                "example_meaning": clean_text(row[14]) if len(row) > 14 else "",
                "source_rank": rank,
                "source_index": index,
            }
            normalized["importance"] = estimate_importance(normalized)
            rows.append(normalized)
    rows.sort(key=lambda item: (item["source_rank"], item["source_index"]))
    return rows[:TARGET_TOTAL]


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"Missing {SOURCE}. Download notes.csv first.")
    init_db()
    rows = load_rows()
    with sqlite3.connect(DB_PATH) as conn:
        existing = {
            (row[0], row[1])
            for row in conn.execute("SELECT kanji, kana FROM words").fetchall()
        }
        inserted = 0
        for row in rows:
            key = (row["kanji"], row["kana"])
            if key in existing:
                continue
            conn.execute(
                """
                INSERT INTO words (
                    meaning, kana, kanji, pos, verb_type, importance,
                    example_jp, example_meaning
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    row["meaning"],
                    row["kana"],
                    row["kanji"],
                    row["pos"],
                    row["verb_type"],
                    row["importance"],
                    row["example_jp"],
                    row["example_meaning"],
                ),
            )
            existing.add(key)
            inserted += 1
        conn.execute(
            """
            INSERT OR IGNORE INTO progress (word_id)
            SELECT id FROM words
            """
        )
        total = conn.execute("SELECT COUNT(*) FROM words").fetchone()[0]
    print(f"Inserted {inserted} words. Total words: {total}.")


if __name__ == "__main__":
    main()
